import fs from "node:fs/promises";

const SOURCE_URL =
  "https://www.dcceew.gov.au/energy/security/australias-fuel-security/minimum-stockholding-obligation/statistics";
const DATA_PATH = new URL("../data/fuels.json", import.meta.url);

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

async function main() {
  const records = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
  const localLatest = latestLocalStockDate(records);
  const response = await fetch(SOURCE_URL, {
    headers: {
      "user-agent": "AusFuels-MSO-Report data updater",
    },
  });

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
  console.error(error.message);
  process.exitCode = 1;
});
