import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SOURCE_URLS = [
  "https://www.dcceew.gov.au/energy/security/australias-fuel-security/minimum-stockholding-obligation/statistics",
  "https://dcceew.gov.au/energy/security/australias-fuel-security/minimum-stockholding-obligation/statistics",
];
const AIP_TGP_URL = "https://www.aip.com.au/pricing/terminal-gate-prices";
const AIP_HISTORICAL_TGP_URL = "https://www.aip.com.au/historical-ulp-and-diesel-tgp-data";
const DATA_PATH = new URL("../data/fuels.json", import.meta.url);
const PRICE_DATA_PATH = new URL("../data/prices.json", import.meta.url);
const POWERBI_DEBUG_DIR = new URL("../artifacts/powerbi-debug/", import.meta.url);
const POWERBI_REPORT_URL = process.env.POWERBI_REPORT_URL?.trim() || null;
const SKIP_DCCEEW_STATUS = process.env.SKIP_DCCEEW_STATUS === "1";
const REQUEST_TIMEOUT_MS = 45000;
const POWERBI_TIMEOUT_MS = 90000;
const USER_AGENT = "AusFuels-MSO-Report data updater (+https://github.com/wadenick/AusFuels-MSO-Report)";
const FUEL_LABELS = {
  gasoline: ["gasoline", "petrol"],
  kerosene: ["kerosene", "jet fuel"],
  diesel: ["diesel"],
};

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function latestLocalStockDate(records) {
  return records
    .map((record) => record.stockDate)
    .sort((a, b) => parseDate(a) - parseDate(b))
    .at(-1);
}

function extractPublishedStatus(html) {
  const compact = html.replace(/\s+/g, " ");
  const lastUpdated = compact.match(/fuel stock statistics were last updated on ([^,]+), to show stocks held on ([^.]+)\./i);
  const specialUpdate = compact.match(/fuel stock statistics will be updated this ([^.]+)\./i);

  return {
    lastUpdatedText: lastUpdated?.[1] ?? null,
    latestStockHeldText: lastUpdated?.[2] ?? null,
    specialUpdateText: specialUpdate?.[1] ?? null,
  };
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/\\\//g, "/");
}

function extractPowerBiUrl(html) {
  const decoded = decodeHtml(html);
  const matches = decoded.match(/https:\/\/app\.powerbi\.com\/view\?r=[^"' <>)\\]+/gi) ?? [];
  const cleanMatches = [...new Set(matches.map((url) => url.replace(/[.,;]+$/, "")))];
  return cleanMatches[0] ?? null;
}

function decodePowerBiViewParameter(powerBiUrl) {
  try {
    const encoded = new URL(powerBiUrl).searchParams.get("r");
    if (!encoded) return null;
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function extractMsoRequirements(html) {
  const compact = html.replace(/\s+/g, " ");
  const requirements = {};

  for (const fuel of Object.keys(FUEL_LABELS)) {
    const labels = FUEL_LABELS[fuel].join("|");
    const beforeFuel = compact.match(new RegExp(`(\\d{3,4})\\s+megalitres?\\s+\\(ML\\)\\s+for\\s+(${labels})`, "i"));
    const afterFuel = compact.match(new RegExp(`(${labels})\\s+(\\d{3,4})\\s+`, "i"));
    const value = beforeFuel?.[1] ?? afterFuel?.[2];

    if (value) {
      requirements[fuel] = Number(value);
    }
  }

  return requirements;
}

function inferYearForMonth(monthIndex, referenceDate = new Date()) {
  const referenceYear = referenceDate.getFullYear();

  if (monthIndex === 11 && referenceDate.getUTCMonth() === 0) return referenceYear - 1;
  if (monthIndex === 0 && referenceDate.getUTCMonth() === 11) return referenceYear + 1;
  return referenceYear;
}

function parseDccEeWDate(text, referenceDate = new Date()) {
  if (!text) return null;

  const match = text.match(/(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
  if (!match) return null;

  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const monthIndex = monthNames.indexOf(match[2].toLowerCase());
  if (monthIndex < 0) return null;

  const year = match[3] ? Number(match[3]) : inferYearForMonth(monthIndex, referenceDate);
  const date = new Date(Date.UTC(year, monthIndex, Number(match[1])));
  return date.toISOString().slice(0, 10);
}

function parseSlashDate(text) {
  const match = text?.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return null;

  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
  return date.toISOString().slice(0, 10);
}

function sydneyDateParts(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(referenceDate);

  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function datePartsToIso({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateToIso(value) {
  if (value instanceof Date) return datePartsToIso(sydneyDateParts(value));
  if (typeof value === "number") {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

function inferLatestTuesdayInSydney(referenceDate = new Date()) {
  const parts = sydneyDateParts(referenceDate);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const dayOfWeek = date.getUTCDay();
  const daysSinceTuesday = dayOfWeek >= 2 ? dayOfWeek - 2 : dayOfWeek + 5;
  date.setUTCDate(date.getUTCDate() - daysSinceTuesday);
  return date.toISOString().slice(0, 10);
}

function todayInSydney(referenceDate = new Date()) {
  return datePartsToIso(sydneyDateParts(referenceDate));
}

function findDatesInCandidates(candidates) {
  const dateTexts = [];

  for (const candidate of candidates) {
    dateTexts.push(...candidate.matchAll(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*\d{1,2}\s+[A-Za-z]+(?:\s+\d{4})?/gi));
  }

  return [...new Set(dateTexts.map((match) => parseDccEeWDate(match[0])).filter(Boolean))].sort();
}

function normalizeNumber(value) {
  return Number(String(value).replace(/,/g, ""));
}

function includesAllFuelLabels(text) {
  return Object.values(FUEL_LABELS).every((labels) => labels.some((label) => new RegExp(`\\b${label.replace(/\s+/g, "\\s+")}\\b`, "i").test(text)));
}

function hasTableLikeSignals(text) {
  return /(stock|held|volume)/i.test(text) && /(mso|minimum|required)/i.test(text) && /\bdays?\b/i.test(text);
}

function collectTextCandidates(value, candidates = []) {
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact.length > 20 && /(gasoline|petrol|kerosene|jet fuel|diesel)/i.test(compact)) {
      candidates.push(compact);
    }
    return candidates;
  }

  if (Array.isArray(value)) {
    const strings = value.filter((item) => typeof item === "string").join(" ");
    if (strings && /(gasoline|petrol|kerosene|jet fuel|diesel)/i.test(strings)) {
      candidates.push(value.map((item) => (typeof item === "object" ? "" : String(item))).join(" ").replace(/\s+/g, " ").trim());
    }

    for (const item of value) collectTextCandidates(item, candidates);
    return candidates;
  }

  if (value && typeof value === "object") {
    const strings = Object.values(value)
      .filter((item) => typeof item === "string")
      .join(" ");
    if (strings && /(gasoline|petrol|kerosene|jet fuel|diesel)/i.test(strings)) {
      candidates.push(
        Object.values(value)
          .map((item) => (typeof item === "object" ? "" : String(item)))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    }

    for (const item of Object.values(value)) collectTextCandidates(item, candidates);
  }

  return candidates;
}

function parseFuelMetricsFromText(text, msoRequirements) {
  const normalized = text.replace(/,/g, "").replace(/\s+/g, " ");
  const fuels = {};

  for (const [fuel, labels] of Object.entries(FUEL_LABELS)) {
    const labelPattern = labels.map((label) => label.replace(/\s+/g, "\\s+")).join("|");
    const labelMatch = normalized.match(new RegExp(`(${labelPattern})`, "i"));
    if (!labelMatch) continue;

    const start = Math.max(0, labelMatch.index - 80);
    const end = Math.min(normalized.length, labelMatch.index + 240);
    const window = normalized.slice(start, end);
    const numbers = [...window.matchAll(/\b\d{1,4}\b/g)].map((match) => normalizeNumber(match[0]));
    const msoRequiredML = msoRequirements[fuel];
    const daysMatch = window.match(/\b(\d{1,2})\s*days?\b/i);
    const daysCover = daysMatch ? normalizeNumber(daysMatch[1]) : numbers.find((number) => number >= 10 && number <= 90);
    const volumeML = numbers.find((number) => {
      if (number < 500 || number > 4000) return false;
      if (number === msoRequiredML || number === daysCover) return false;
      if (number >= 2020 && number <= 2030) return false;
      return true;
    });

    if (volumeML && msoRequiredML && daysCover && numbers.includes(msoRequiredML) && /\bdays?\b/i.test(window)) {
      fuels[fuel] = { volumeML, msoRequiredML, daysCover };
    }
  }

  return fuels;
}

function splitStockDigits(value) {
  const candidates = [];

  for (let gasolineLength = 3; gasolineLength <= 4; gasolineLength += 1) {
    for (let keroseneLength = 3; keroseneLength <= 4; keroseneLength += 1) {
      const dieselLength = value.length - gasolineLength - keroseneLength;
      if (dieselLength < 3 || dieselLength > 4) continue;

      const gasoline = Number(value.slice(0, gasolineLength));
      const kerosene = Number(value.slice(gasolineLength, gasolineLength + keroseneLength));
      const diesel = Number(value.slice(gasolineLength + keroseneLength));

      if (gasoline >= 500 && gasoline <= 3000 && kerosene >= 300 && kerosene <= 1500 && diesel >= 1500 && diesel <= 4000) {
        candidates.push({ gasoline, kerosene, diesel });
      }
    }
  }

  return candidates.sort((a, b) => {
    const aScore = Math.abs(a.gasoline - 1800) + Math.abs(a.kerosene - 850) + Math.abs(a.diesel - 2900);
    const bScore = Math.abs(b.gasoline - 1800) + Math.abs(b.kerosene - 850) + Math.abs(b.diesel - 2900);
    return aScore - bScore;
  })[0] ?? null;
}

function parseRenderedSummaryText(text, msoRequirements) {
  const normalized = text.replace(/Press Enter to explore data/g, "|").replace(/\s+/g, " ");
  const stockDate = parseSlashDate(normalized.match(/Stocks held on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i)?.[1]);
  const numberRun = normalized.match(/Automotive\s*gasoline.*?Aviation\s*kerosene.*?Automotive\s*diesel(\d{18,40})\|\s*Stocks held \(ML\)/i)?.[1];

  if (!stockDate || !numberRun) return null;

  const baseMsoRun = `${msoRequirements.gasoline}${msoRequirements.kerosene}${msoRequirements.diesel}`;
  const baseMsoIndex = numberRun.indexOf(baseMsoRun);
  if (baseMsoIndex <= 0) return null;

  const volumes = splitStockDigits(numberRun.slice(0, baseMsoIndex));
  if (!volumes) return null;

  const days = {
    kerosene: Number(normalized.match(/Kerosene\|\s*Days\s*(\d{1,2})/i)?.[1]),
    diesel: Number(normalized.match(/Diesel\|\s*Days\s*(\d{1,2})/i)?.[1]),
    gasoline: Number(normalized.match(/Gasoline\|\s*Days\s*(\d{1,2})/i)?.[1]),
  };

  if (!days.gasoline || !days.kerosene || !days.diesel) return null;

  return {
    stockDate,
    fuels: {
      gasoline: {
        volumeML: volumes.gasoline,
        msoRequiredML: msoRequirements.gasoline,
        daysCover: days.gasoline,
      },
      kerosene: {
        volumeML: volumes.kerosene,
        msoRequiredML: msoRequirements.kerosene,
        daysCover: days.kerosene,
      },
      diesel: {
        volumeML: volumes.diesel,
        msoRequiredML: msoRequirements.diesel,
        daysCover: days.diesel,
      },
    },
  };
}

function chooseRenderedSummaryRecord(textCandidates, msoRequirements) {
  return [...new Set(textCandidates)]
    .map((candidate) => parseRenderedSummaryText(candidate, msoRequirements))
    .find((candidate) => candidate && completeFuelRecord(candidate.fuels)) ?? null;
}

function suspiciousRoundVolumes(fuels) {
  return Object.values(fuels).filter((values) => values.volumeML % 100 === 0).length >= 2;
}

function candidateScore(candidate, fuels) {
  let score = 0;
  if (includesAllFuelLabels(candidate)) score += 4;
  if (hasTableLikeSignals(candidate)) score += 4;
  score += Object.keys(fuels).length * 2;
  if (suspiciousRoundVolumes(fuels)) score -= 5;
  return score;
}

function chooseScrapedFuelRecord(textCandidates, msoRequirements) {
  const candidates = [...new Set(textCandidates)]
    .map((candidate) => {
      const fuels = parseFuelMetricsFromText(candidate, msoRequirements);
      return {
        score: candidateScore(candidate, fuels),
        complete: completeFuelRecord(fuels),
        tableLike: includesAllFuelLabels(candidate) && hasTableLikeSignals(candidate),
        suspiciousRoundVolumes: suspiciousRoundVolumes(fuels),
        fuels,
        preview: candidate.slice(0, 500),
      };
    })
    .filter((candidate) => candidate.complete)
    .sort((a, b) => b.score - a.score);

  return {
    candidates,
    best: candidates.find((candidate) => candidate.tableLike && !candidate.suspiciousRoundVolumes) ?? null,
  };
}

function completeFuelRecord(fuels) {
  return Object.keys(FUEL_LABELS).every((fuel) => {
    const values = fuels[fuel];
    return values?.volumeML && values?.msoRequiredML && values?.daysCover;
  });
}

function latestLocalRequirements(records) {
  const latest = records.toSorted((a, b) => parseDate(a.stockDate) - parseDate(b.stockDate)).at(-1);
  if (!latest) return {};

  return Object.fromEntries(Object.entries(latest.fuels).map(([fuel, values]) => [fuel, values.msoRequiredML]));
}

function resolveRecordDates(status, textCandidates, renderedStockDate = null) {
  const statusStockDate = parseDccEeWDate(status.latestStockHeldText);
  const statusPublishedDate = parseDccEeWDate(status.lastUpdatedText);

  if (statusStockDate && statusPublishedDate) {
    return {
      stockDate: statusStockDate,
      publishedDate: statusPublishedDate,
    };
  }

  const candidateDates = findDatesInCandidates(textCandidates);
  const inferredStockDate = inferLatestTuesdayInSydney();
  const stockDate = renderedStockDate ?? candidateDates.find((date) => date === inferredStockDate) ?? candidateDates.at(-1) ?? inferredStockDate;

  return {
    stockDate,
    publishedDate: statusPublishedDate ?? todayInSydney(),
  };
}

async function scrapePowerBiRecord(powerBiUrl, status, msoRequirements) {
  let chromium;

  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    console.warn(`Power BI browser scrape skipped because Playwright is not installed: ${error.message}`);
    return null;
  }

  const browser = await chromium.launch({ headless: true });
  const responseSummaries = [];
  const textCandidates = [];

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 },
      userAgent: USER_AGENT,
    });

    page.on("response", async (response) => {
      const url = response.url();
      if (!/(querydata|explore|models|reports|visual|metadata)/i.test(url)) return;

      const contentType = response.headers()["content-type"] ?? "";
      const summary = {
        url,
        status: response.status(),
        contentType,
      };

      try {
        if (contentType.includes("application/json")) {
          const json = await response.json();
          const candidates = collectTextCandidates(json);
          summary.candidateCount = candidates.length;
          textCandidates.push(...candidates);
        } else if (contentType.includes("text")) {
          const body = await response.text();
          const candidates = collectTextCandidates(body);
          summary.candidateCount = candidates.length;
          textCandidates.push(...candidates);
        }
      } catch (error) {
        summary.error = error.message;
      }

      responseSummaries.push(summary);
    });

    await page.goto(powerBiUrl, { waitUntil: "domcontentloaded", timeout: POWERBI_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: POWERBI_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(15000);

    const body = page.locator("body");
    const bodyText = await body.textContent({ timeout: 10000 }).catch(() => "");
    const bodyInnerText = await body.innerText({ timeout: 10000 }).catch(() => "");
    if (bodyText) textCandidates.unshift(bodyText);
    if (bodyInnerText) textCandidates.unshift(bodyInnerText);

    await fs.mkdir(POWERBI_DEBUG_DIR, { recursive: true });
    await fs.writeFile(new URL("response-summaries.json", POWERBI_DEBUG_DIR), `${JSON.stringify(responseSummaries, null, 2)}\n`);
    await fs.writeFile(
      new URL("text-candidates.txt", POWERBI_DEBUG_DIR),
      `${[...new Set(textCandidates)].slice(0, 100).join("\n\n---\n\n")}\n`,
    );

    const renderedSummary = chooseRenderedSummaryRecord(textCandidates, msoRequirements);
    const { candidates, best } = chooseScrapedFuelRecord(textCandidates, msoRequirements);
    await fs.writeFile(new URL("parsed-candidates.json", POWERBI_DEBUG_DIR), `${JSON.stringify(candidates, null, 2)}\n`);

    const fuels = renderedSummary?.fuels ?? best?.fuels ?? {};

    if (!completeFuelRecord(fuels)) {
      console.warn(
        `Power BI scrape did not find a reliable table-like fuel record. ${candidates.length} complete but rejected candidate(s) were written to artifacts/powerbi-debug/parsed-candidates.json.`,
      );
      return null;
    }

    const { stockDate, publishedDate } = resolveRecordDates(status, textCandidates, renderedSummary?.stockDate);

    if (!stockDate || !publishedDate) {
      console.warn("Power BI scrape found fuel values, but could not resolve the stock/published dates.");
      return null;
    }

    return {
      stockDate,
      publishedDate,
      source: "DCCEEW MSO statistics Power BI viewer",
      fuels,
    };
  } finally {
    await browser.close();
  }
}

async function writeIfNewRecord(records, nextRecord) {
  if (!nextRecord) return false;

  const existingIndex = records.findIndex((record) => record.stockDate === nextRecord.stockDate);
  const latestRecord = records.toSorted((a, b) => parseDate(a.stockDate) - parseDate(b.stockDate)).at(-1);

  if (existingIndex >= 0) {
    const existing = JSON.stringify(records[existingIndex]);
    const incoming = JSON.stringify(nextRecord);

    if (existing === incoming) {
      console.log(`No data delta found for ${nextRecord.stockDate}; data/fuels.json is already current.`);
      return false;
    }

    records[existingIndex] = nextRecord;
  } else {
    if (latestRecord && parseDate(nextRecord.stockDate) > parseDate(latestRecord.stockDate)) {
      const latestFuels = JSON.stringify(latestRecord.fuels);
      const incomingFuels = JSON.stringify(nextRecord.fuels);

      if (latestFuels === incomingFuels) {
        console.warn(
          `Scraped fuel values match the latest local record exactly, so ${nextRecord.stockDate} was not added as a new inferred week.`,
        );
        return false;
      }
    }

    records.push(nextRecord);
  }

  records.sort((a, b) => parseDate(a.stockDate) - parseDate(b.stockDate));
  await fs.writeFile(DATA_PATH, `${JSON.stringify(records, null, 2)}\n`);
  console.log(`Updated data/fuels.json with stock date ${nextRecord.stockDate}.`);
  return true;
}

async function fetchWithNode(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": USER_AGENT,
      },
    });
    return {
      ok: response.ok,
      status: response.status,
      text: () => response.text(),
      via: "node-fetch",
      url,
    };
  } catch (error) {
    const cause = error.cause ? ` Cause: ${error.cause.code ?? error.cause.message ?? error.cause}` : "";
    throw new Error(`Node fetch failed for ${url}: ${error.message}.${cause}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithCurl(url) {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      [
        "--fail-with-body",
        "--http1.1",
        "--location",
        "--silent",
        "--show-error",
        "--max-time",
        String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)),
        "--retry",
        "1",
        "--retry-delay",
        "3",
        "--user-agent",
        USER_AGENT,
        "--header",
        "accept: text/html,application/xhtml+xml",
        url,
      ],
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: REQUEST_TIMEOUT_MS + 30000,
      },
    );

    return {
      ok: true,
      status: 200,
      text: async () => stdout,
      via: "curl",
      url,
    };
  } catch (error) {
    const stderr = error.stderr ? ` ${String(error.stderr).trim()}` : "";
    throw new Error(`curl failed for ${url}: ${error.message}.${stderr}`);
  }
}

async function fetchBinaryWithNode(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*",
        "user-agent": USER_AGENT,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBinaryWithCurl(url) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "--fail",
      "--http1.1",
      "--location",
      "--silent",
      "--show-error",
      "--max-time",
      String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)),
      "--retry",
      "1",
      "--retry-delay",
      "3",
      "--user-agent",
      USER_AGENT,
      url,
    ],
    {
      encoding: "buffer",
      maxBuffer: 60 * 1024 * 1024,
      timeout: REQUEST_TIMEOUT_MS + 30000,
    },
  );
  return stdout;
}

async function fetchPage() {
  const errors = [];

  for (const url of SOURCE_URLS) {
    for (const fetcher of [fetchWithNode, fetchWithCurl]) {
      try {
        const response = await fetcher(url);
        console.log(`Fetched DCCEEW status page via ${response.via}: ${response.url}`);
        return response;
      } catch (error) {
        errors.push(error.message);
        console.warn(error.message);
      }
    }
  }

  throw new Error(`Could not fetch DCCEEW status page after ${errors.length} attempts.`);
}

async function fetchAipPage() {
  const urls = [AIP_TGP_URL, AIP_HISTORICAL_TGP_URL];

  for (const url of urls) {
    for (const fetcher of [fetchWithNode, fetchWithCurl]) {
      try {
        const response = await fetcher(url);
        console.log(`Fetched AIP TGP page via ${response.via ?? "node-fetch"}: ${url}`);
        const html = await response.text();
        if (extractAipWorkbookUrl(html)) return html;
      } catch (error) {
        console.warn(`AIP TGP page fetch failed: ${error.message}`);
      }
    }
  }

  throw new Error("Could not fetch AIP Terminal Gate Prices page.");
}

function extractAipWorkbookUrl(html) {
  const decoded = decodeHtml(html);
  const workbookPath = decoded.match(/href="([^"]*AIP_TGP_Data_[^"]+\.xlsx)"/i)?.[1];
  if (!workbookPath) return null;
  return new URL(workbookPath, AIP_TGP_URL).toString();
}

async function fetchWorkbook(url) {
  for (const fetcher of [fetchBinaryWithNode, fetchBinaryWithCurl]) {
    try {
      return await fetcher(url);
    } catch (error) {
      console.warn(`AIP workbook fetch failed: ${error.message}`);
    }
  }

  throw new Error("Could not fetch AIP Terminal Gate Prices workbook.");
}

function parseSydneyPriceSheet(sheet, xlsx) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true });
  const header = rows[0] ?? [];
  const dateIndex = 0;
  const sydneyIndex = header.findIndex((cell) => String(cell).trim().toLowerCase() === "sydney");

  if (sydneyIndex < 0) throw new Error("AIP workbook did not include a Sydney column.");

  return new Map(
    rows
      .slice(1)
      .map((row) => [dateToIso(row[dateIndex]), Number(row[sydneyIndex])])
      .filter(([date, price]) => date && Number.isFinite(price)),
  );
}

async function buildSydneyPriceData(stockRecords) {
  let xlsx;

  try {
    xlsx = await import("xlsx");
  } catch (error) {
    console.warn(`AIP price update skipped because xlsx is not installed: ${error.message}`);
    return null;
  }

  const html = await fetchAipPage();
  const workbookUrl = extractAipWorkbookUrl(html);
  if (!workbookUrl) throw new Error("Could not find AIP_TGP_Data workbook link on AIP page.");

  const workbookBuffer = await fetchWorkbook(workbookUrl);
  const workbook = xlsx.read(workbookBuffer, { type: "buffer", cellDates: true });
  const petrol = parseSydneyPriceSheet(workbook.Sheets["Petrol TGP"], xlsx);
  const diesel = parseSydneyPriceSheet(workbook.Sheets["Diesel TGP"], xlsx);
  const stockDates = [...new Set(stockRecords.map((record) => record.stockDate))].sort();
  const prices = stockDates.map((date) => ({
    date,
    gasoline: petrol.has(date) ? { priceCpl: petrol.get(date), label: "Sydney ULP TGP" } : null,
    diesel: diesel.has(date) ? { priceCpl: diesel.get(date), label: "Sydney diesel TGP" } : null,
  }));

  return {
    source: "Australian Institute of Petroleum Terminal Gate Prices",
    sourceUrl: AIP_TGP_URL,
    workbookUrl,
    location: "Sydney",
    unit: "centsPerLitre",
    updatedAt: todayInSydney(),
    prices,
  };
}

async function updatePriceData(stockRecords) {
  try {
    const priceData = await buildSydneyPriceData(stockRecords);
    if (!priceData) return false;

    const next = `${JSON.stringify(priceData, null, 2)}\n`;
    const current = await fs.readFile(PRICE_DATA_PATH, "utf8").catch(() => "");
    if (current === next) {
      console.log("No data delta found for data/prices.json.");
      return false;
    }

    await fs.writeFile(PRICE_DATA_PATH, next);
    console.log(`Updated data/prices.json with ${priceData.prices.length} Sydney price observations.`);
    return true;
  } catch (error) {
    console.warn(`AIP price update skipped: ${error.message}`);
    return false;
  }
}

async function main() {
  const records = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
  const localLatest = latestLocalStockDate(records);
  let status = {
    lastUpdatedText: null,
    latestStockHeldText: null,
    specialUpdateText: null,
  };
  let powerBiUrl = POWERBI_REPORT_URL;
  let msoRequirements = latestLocalRequirements(records);

  if (SKIP_DCCEEW_STATUS) {
    console.log("Skipping DCCEEW status page fetch because SKIP_DCCEEW_STATUS=1.");
  } else {
    try {
      const response = await fetchPage();

      if (!response.ok) {
        throw new Error(`DCCEEW page request failed with HTTP ${response.status}`);
      }

      const html = await response.text();
      status = extractPublishedStatus(html);
      powerBiUrl = extractPowerBiUrl(html) ?? POWERBI_REPORT_URL;
      msoRequirements = {
        ...msoRequirements,
        ...extractMsoRequirements(html),
      };
    } catch (error) {
      if (!POWERBI_REPORT_URL) throw error;

      console.warn(error.message);
      console.warn("Falling back to POWERBI_REPORT_URL because the DCCEEW status page could not be fetched.");
    }
  }

  const decodedPowerBi = powerBiUrl ? decodePowerBiViewParameter(powerBiUrl) : null;

  console.log(`Local latest stock date: ${localLatest}`);
  console.log(`DCCEEW latest stock text: ${status.latestStockHeldText ?? "not found"}`);
  if (status.specialUpdateText) {
    console.log(`DCCEEW upcoming update note: ${status.specialUpdateText}`);
  }
  console.log(`DCCEEW Power BI URL: ${powerBiUrl ?? "not found"}`);
  if (decodedPowerBi) {
    console.log(`Power BI report key: ${decodedPowerBi.k ?? "unknown"}`);
    console.log(`Power BI tenant id: ${decodedPowerBi.t ?? "unknown"}`);
  }
  console.log(`DCCEEW MSO requirements: ${JSON.stringify(msoRequirements)}`);

  if (!powerBiUrl) {
    console.warn("DCCEEW page did not include an app.powerbi.com report URL, so no automated data update was attempted.");
    return;
  }

  const scrapedRecord = await scrapePowerBiRecord(powerBiUrl, status, msoRequirements);
  const wroteFuelData = await writeIfNewRecord(records, scrapedRecord);
  const nextRecords = wroteFuelData ? JSON.parse(await fs.readFile(DATA_PATH, "utf8")) : records;
  await updatePriceData(nextRecords);
}

main().catch((error) => {
  console.warn(error.message);
  console.warn(
    "Skipping automated data update for this run. Existing data/fuels.json will remain unchanged and Pages can still deploy.",
  );
});
