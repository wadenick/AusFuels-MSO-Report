import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SOURCE_URLS = [
  "https://www.dcceew.gov.au/energy/security/australias-fuel-security/minimum-stockholding-obligation/statistics",
  "https://dcceew.gov.au/energy/security/australias-fuel-security/minimum-stockholding-obligation/statistics",
];
const DATA_PATH = new URL("../data/fuels.json", import.meta.url);
const REQUEST_TIMEOUT_MS = 120000;
const USER_AGENT = "AusFuels-MSO-Report data updater (+https://github.com/wadenick/AusFuels-MSO-Report)";

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

  console.log(`Local latest stock date: ${localLatest}`);
  console.log(`DCCEEW latest stock text: ${status.latestStockHeldText ?? "not found"}`);
  if (status.specialUpdateText) {
    console.log(`DCCEEW upcoming update note: ${status.specialUpdateText}`);
  }

  console.warn(
    [
      "DCCEEW exposes the weekly figures inside an embedded Power BI viewer, not in the static page HTML.",
      "This workflow is ready to run on schedule, but the Power BI extraction step still needs to be implemented against the viewer's accessible data/export endpoint.",
      "Until then, update data/fuels.json manually and push to trigger Pages deployment.",
    ].join(" "),
  );
}

main().catch((error) => {
  console.warn(error.message);
  console.warn(
    "Skipping automated data update for this run. Existing data/fuels.json will remain unchanged and Pages can still deploy.",
  );
});
