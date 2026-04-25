# Australia Fuel Stocks MSO Dashboard

A small, dependency-free dashboard for tracking Australia's weekly fuel stock volumes against minimum stockholding obligation levels.

## Run locally

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Data

The dashboard reads weekly observations from `data/fuels.json`. Each record is expected to include:

- `stockDate`
- `publishedDate`
- `fuels.gasoline`
- `fuels.kerosene`
- `fuels.diesel`

Each fuel entry should contain `volumeML`, `msoRequiredML`, and `daysCover`.
