# Australia Fuel Stocks MSO Dashboard

A small, dependency-free dashboard for tracking Australia's weekly fuel stock volumes against minimum stockholding obligation levels.

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

The `Update fuel data` workflow is scheduled for normal Saturday publication and an extra Sunday pass for exceptions. The updater discovers the embedded Power BI report URL from the DCCEEW page, launches a headless Chromium scrape in GitHub Actions, and only writes `data/fuels.json` when it can assemble a complete weekly record for gasoline, kerosene, and diesel. If the DCCEEW status page is unavailable from the runner, the workflow falls back to the current known Power BI URL and uploads scrape diagnostics as a `powerbi-debug` artifact.
