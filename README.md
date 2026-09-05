# Australia Fuel Stocks MSO Dashboard

A small, dependency-free dashboard for tracking Australia's weekly fuel stock volumes against minimum stockholding obligation levels.


## Demo

See it live in GitHub Pages in this repo at `https://wadenick.github.io/AusFuels-MSO-Report/`

## Run locally

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Publish

The site is static and can be published with GitHub Pages.

Recommended repo setting:

- Settings -> Pages -> Build and deployment -> Static HTML
- Branch: `main`
- Folder: `/ (root)`

The `.nojekyll` marker is included so GitHub Pages serves this as plain static HTML.

The included `Deploy GitHub Pages` workflow can also deploy the repository root if the repository is configured to use GitHub Actions for Pages. If GitHub asks you to choose between Jekyll and Static HTML, choose Static HTML.

## Data

The dashboard reads weekly observations from `data/fuels.json`. Each record is expected to include:

- `stockDate`
- `publishedDate`
- `fuels.gasoline`
- `fuels.kerosene`
- `fuels.diesel`

Each fuel entry should contain `volumeML`, `msoRequiredML`, and `daysCover`.

Sydney petrol and diesel terminal gate prices are stored separately in `data/prices.json`, sourced from the Australian Institute of Petroleum's Terminal Gate Prices workbook. Gasoline uses Sydney ULP TGP as the proxy. The Jet fuel panel also shows Shellharbour Airport monthly retail Jet A1 and Avgas 100LL prices in AUD per litre, on their own monthly timeline starting September 2026. Avgas is aviation gasoline. Observations are stored in `data/aviation-prices.json`; the updater reads the published month, retains history, updates corrections within a month, and leaves the prior observation untouched when no new publication is available or fetching/parsing fails. The publication day is not assumed.

The `Update fuel data` workflow is scheduled for normal Saturday publication and an extra Sunday pass for exceptions. Because the DCCEEW page can time out from GitHub-hosted runners, the workflow goes straight to the current known Power BI URL. Local/manual runs can still discover the embedded Power BI report URL from the DCCEEW page when reachable. The updater launches a headless Chromium scrape and only writes `data/fuels.json` when it can assemble a complete weekly record for gasoline, kerosene, and diesel. It also updates `data/prices.json` from AIP and checks Shellharbour prices independently before the stock scrape. Scrape diagnostics are uploaded as a `powerbi-debug` artifact.

## Getting oriented

If you are new to this codebase, start with [`NEWCOMER_GUIDE.md`](NEWCOMER_GUIDE.md).
