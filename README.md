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

Sydney petrol and diesel terminal gate prices are stored separately in `data/prices.json`, sourced from the Australian Institute of Petroleum's Terminal Gate Prices workbook. Gasoline uses Sydney ULP TGP as the proxy. Jet fuel pricing is omitted until a reliable public kerosene/jet fuel series is available.

The `Update fuel data` workflow is scheduled for normal Saturday publication and an extra Sunday pass for exceptions. Because the DCCEEW page can time out from GitHub-hosted runners, the workflow goes straight to the current known Power BI URL. Local/manual runs can still discover the embedded Power BI report URL from the DCCEEW page when reachable. The updater launches a headless Chromium scrape and only writes `data/fuels.json` when it can assemble a complete weekly record for gasoline, kerosene, and diesel. It also updates `data/prices.json` from AIP. Scrape diagnostics are uploaded as a `powerbi-debug` artifact.

## Getting oriented

If you are new to this codebase, start with [`NEWCOMER_GUIDE.md`](NEWCOMER_GUIDE.md).
