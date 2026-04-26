# Newcomer Guide

This repository is a static dashboard for Australia fuel stock monitoring. It has no bundler and no framework: HTML, CSS, and vanilla JavaScript run directly in the browser.

## Repository structure

- `index.html`: the page skeleton (header, controls, KPI cards, canvas chart, expandable data table).
- `styles.css`: all styling and responsive behavior.
- `app.js`: data loading, derived metrics, chart rendering, interactivity, and table rendering.
- `data/fuels.json`: the source dataset the UI reads at runtime.
- `scripts/update-fuels.mjs`: Node script used by automation to scrape/update `data/fuels.json`.
- `.github/workflows/pages.yml`: deploys the static site to GitHub Pages.
- `.github/workflows/update-fuels.yml`: scheduled data refresh and then deploy.

## Runtime flow (browser)

1. `index.html` loads `styles.css` and `app.js`.
2. `app.js` fetches `data/fuels.json` in `init()`.
3. Records are sorted and used to:
   - render the latest-week header,
   - build fuel filter tabs,
   - render KPI cards,
   - draw the canvas chart,
   - populate the table.
4. User interactions (`fuel` tab selection, `days cover` toggle, tooltip hover, window resize) trigger re-renders.

## Data model

Each weekly record in `data/fuels.json` contains:

- `stockDate`
- `publishedDate`
- `source`
- `fuels` object keyed by `gasoline`, `kerosene`, `diesel`

Each fuel has:

- `volumeML`
- `msoRequiredML`
- `daysCover`

The UI computes `surplusML` and percentage `coverage` at render time.

## Automation flow (Node script)

`scripts/update-fuels.mjs` does the following:

1. Loads existing records from `data/fuels.json`.
2. Optionally fetches the DCCEEW status page to discover:
   - latest publication dates,
   - Power BI URL,
   - MSO requirement values.
3. Launches headless Chromium with Playwright and listens to network responses.
4. Extracts candidate text blocks and scores them for table-like completeness.
5. Accepts only complete gasoline/kerosene/diesel records.
6. Writes back to `data/fuels.json` only when data is new/changed and not suspiciously duplicated.

## Things to know before changing code

- There is no build step; test by serving the repo root (for example `python3 -m http.server 8000`).
- The chart is custom canvas code, not Chart.js/D3.
- `app.js` assumes `records` is non-empty after load.
- Fuel keys are canonical (`gasoline`, `kerosene`, `diesel`); changing keys requires coordinated edits in data + UI + scraper.
- Scraper reliability depends on Power BI response formats, so defensive parsing and diagnostics are important.

## Good next learning steps

1. Trace `render()` in `app.js` to understand state -> UI updates.
2. Step through `drawChart()` and tooltip hit testing to understand canvas coordinate mapping.
3. Run `node scripts/update-fuels.mjs` locally and inspect `artifacts/powerbi-debug/` outputs.
4. Read GitHub workflows to see how scheduled updates and deployment are chained.
5. Consider adding lightweight schema validation for `data/fuels.json` as a first improvement.
