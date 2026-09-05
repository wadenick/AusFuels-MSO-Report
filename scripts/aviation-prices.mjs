import fs from "node:fs/promises";

export const AVIATION_SOURCE_URL = "https://www.shellharbourairport.com.au/operational-information/aviation-fuel/";
const DATA_PATH = new URL("../data/aviation-prices.json", import.meta.url);
const MONTHS = "january february march april may june july august september october november december".split(" ");

export function parseAviationPrices(html) {
  // Ignore stale social metadata; only read the published price section.
  const section = html.match(/<h2\b[^>]*>\s*([A-Za-z]+)\s+(\d{4})\s+Posted Airfield Price\s*<\/h2>([\s\S]*?)<\/section>/i);
  if (!section) throw new Error("No dated airfield price section found.");
  const month = MONTHS.indexOf(section[1].toLowerCase()) + 1;
  if (!month) throw new Error("Unrecognised price month.");
  const text = section[3].replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ");
  const price = (label) => {
    const value = Number(text.match(new RegExp(`${label}\\s*\\$\\s*(\\d+\\.\\d{2,3})(?!\\d)`, "i"))?.[1]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Missing or invalid ${label} price.`);
    return value;
  };
  return {
    month: `${section[2]}-${String(month).padStart(2, "0")}`,
    jetA1: price("Jet\\s*A1"),
    avgas100LL: price("Avgas\\s*100LL"),
  };
}

export function mergeAviationPrices(records, incoming) {
  if (incoming.month < "2026-09" || (records.at(-1) && incoming.month < records.at(-1).month)) return records;
  const existing = records.find((record) => record.month === incoming.month);
  if (existing?.jetA1 === incoming.jetA1 && existing?.avgas100LL === incoming.avgas100LL) return records;
  return [...records.filter((record) => record.month !== incoming.month), incoming]
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function updateAviationPrices(fetchPage) {
  try {
    const response = await fetchPage(AVIATION_SOURCE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const incoming = parseAviationPrices(await response.text());
    const current = await fs.readFile(DATA_PATH, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const data = current ? JSON.parse(current) : {
      source: "Shellharbour Airport posted airfield prices",
      sourceUrl: AVIATION_SOURCE_URL,
      unit: "AUDPerLitre",
      prices: [],
    };
    data.prices = mergeAviationPrices(data.prices, incoming);
    const next = `${JSON.stringify(data, null, 2)}\n`;
    if (next === current) return false;
    await fs.writeFile(DATA_PATH, next);
    console.log(`Updated aviation prices for ${incoming.month}.`);
    return true;
  } catch (error) {
    console.warn(`Shellharbour price update skipped; retaining prior observations: ${error.message}`);
    return false;
  }
}
