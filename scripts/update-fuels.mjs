import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SOURCE_URLS = [
  "https://www.dcceew.gov.au/energy/security/australias-fuel-security/minimum-stockholding-obligation/statistics",
  "https://dcceew.gov.au/energy/security/australias-fuel-security/minimum-stockholding-obligation/statistics",
];
const DATA_PATH = new URL("../data/fuels.json", import.meta.url);
const POWERBI_DEBUG_DIR = new URL("../artifacts/powerbi-debug/", import.meta.url);
const REQUEST_TIMEOUT_MS = 120000;
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

function normalizeNumber(value) {
  return Number(String(value).replace(/,/g, ""));
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
    const msoRequiredML = msoRequirements[fuel] ?? numbers.find((number) => number >= 500 && number <= 3500);
    const volumeML = numbers.find((number) => number >= 500 && number <= 4000 && number !== msoRequiredML);
    const daysCover = numbers.find((number) => number >= 10 && number <= 90);

    if (volumeML && msoRequiredML && daysCover) {
      fuels[fuel] = { volumeML, msoRequiredML, daysCover };
    }
  }

  return fuels;
}

function mergeFuelMetrics(...metricsSets) {
  return metricsSets.reduce((merged, metrics) => {
    for (const [fuel, values] of Object.entries(metrics)) {
      if (!merged[fuel]) merged[fuel] = values;
    }
    return merged;
  }, {});
}

function completeFuelRecord(fuels) {
  return Object.keys(FUEL_LABELS).every((fuel) => {
    const values = fuels[fuel];
    return values?.volumeML && values?.msoRequiredML && values?.daysCover;
  });
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
    await page.waitForTimeout(10000);

    const bodyText = await page.locator("body").textContent({ timeout: 10000 }).catch(() => "");
    if (bodyText) textCandidates.unshift(bodyText);

    await fs.mkdir(POWERBI_DEBUG_DIR, { recursive: true });
    await fs.writeFile(new URL("response-summaries.json", POWERBI_DEBUG_DIR), `${JSON.stringify(responseSummaries, null, 2)}\n`);
    await fs.writeFile(
      new URL("text-candidates.txt", POWERBI_DEBUG_DIR),
      `${[...new Set(textCandidates)].slice(0, 100).join("\n\n---\n\n")}\n`,
    );

    const fuels = mergeFuelMetrics(...textCandidates.map((candidate) => parseFuelMetricsFromText(candidate, msoRequirements)));

    if (!completeFuelRecord(fuels)) {
      console.warn(
        `Power BI scrape found ${Object.keys(fuels).length} of 3 fuel records. Debug output written to artifacts/powerbi-debug/.`,
      );
      return null;
    }

    const stockDate = parseDccEeWDate(status.latestStockHeldText);
    const publishedDate = parseDccEeWDate(status.lastUpdatedText);

    if (!stockDate || !publishedDate) {
      console.warn("Power BI scrape found fuel values, but could not parse the DCCEEW stock/published dates.");
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
  if (existingIndex >= 0) {
    const existing = JSON.stringify(records[existingIndex]);
    const incoming = JSON.stringify(nextRecord);

    if (existing === incoming) {
      console.log(`No data delta found for ${nextRecord.stockDate}; data/fuels.json is already current.`);
      return false;
    }

    records[existingIndex] = nextRecord;
  } else {
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
        "--location",
        "--silent",
        "--show-error",
        "--max-time",
        String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)),
        "--retry",
        "2",
        "--retry-delay",
        "10",
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

async function main() {
  const records = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
  const localLatest = latestLocalStockDate(records);
  const response = await fetchPage();

  if (!response.ok) {
    throw new Error(`DCCEEW page request failed with HTTP ${response.status}`);
  }

  const html = await response.text();
  const status = extractPublishedStatus(html);
  const powerBiUrl = extractPowerBiUrl(html);
  const decodedPowerBi = powerBiUrl ? decodePowerBiViewParameter(powerBiUrl) : null;
  const msoRequirements = extractMsoRequirements(html);

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
  await writeIfNewRecord(records, scrapedRecord);
}

main().catch((error) => {
  console.warn(error.message);
  console.warn(
    "Skipping automated data update for this run. Existing data/fuels.json will remain unchanged and Pages can still deploy.",
  );
});
