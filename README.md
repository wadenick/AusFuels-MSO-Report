# Australia Fuel Stocks MSO Dashboard

A small, dependency-free dashboard for tracking Australia's weekly fuel stock volumes against minimum stockholding obligation levels.

## Run locally

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Publish

The site is static and can be published with GitHub Pages. The included `Deploy GitHub Pages` workflow deploys the repository root on pushes to `main`.

## Data

The dashboard reads weekly observations from `data/fuels.json`. Each record is expected to include:

- `stockDate`
- `publishedDate`
- `fuels.gasoline`
- `fuels.kerosene`
- `fuels.diesel`

Each fuel entry should contain `volumeML`, `msoRequiredML`, and `daysCover`.

The `Update fuel data` workflow is scheduled for normal Saturday publication and an extra Sunday pass for exceptions. DCCEEW publishes the weekly figures inside a Power BI viewer, so the included updater currently checks publication status and logs a clear message until the Power BI extraction endpoint is wired in.
