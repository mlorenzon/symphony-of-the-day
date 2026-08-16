# symphony of the day

Motion-graphics work for the Symphony of the Day project — After Effects driven
programmatically through an MCP connector, with historical maps built in
GEOlayers 3.

## Contents

| Path | What it is |
|---|---|
| [`docs/reel-cards.md`](docs/reel-cards.md) | The overlay card system — daily workflow, data schema, how to adapt a card, and the traps |
| [`docs/geolayers-3-via-mcp.md`](docs/geolayers-3-via-mcp.md) | How to drive GEOlayers 3 from the AE MCP connector — what's scriptable, what isn't, working recipes, and the traps |
| `scripts/prepare_work.py` | Gathers one work's data: Wikidata dates, a Commons portrait, place coordinates, the right basemap year |
| `scripts/sotd.jsx` | Builds the cards and the reel in After Effects, and drives the map |
| `data/works/*.json` | One file per symphony — the only thing After Effects reads |
| `data/periods.json` | The artistic-period timeline shown on the back card |
| `data/clip_region.py` | Clips a historical-basemaps world GeoJSON to a bounding box and simplifies it |

## Making a reel

Two commands per work. The first gathers the data, the second builds the comps:

```bash
python scripts/prepare_work.py --composer "Johannes Brahms" \
  --title "Symphony No. 4 in E minor, Op. 98" --year 1885 --place "Mürzzuschlag"
```

```
$.evalFile(new File("<repo>/scripts/sotd.jsx"));
SOTD.buildWork("brahms-no-4");
```

Then aim the map and freeze it — see [`docs/reel-cards.md`](docs/reel-cards.md)
for the full sequence and for why freezing is not optional.

## Getting the map data

The basemaps are not in this repo (~73 MB). Fetch them from
[aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps)
(GPL-3.0, WGS 84) into `data/historical-basemaps/geojson/`, then clip to the
region you need:

```bash
python data/clip_region.py 1783
```

Writes `data/clipped/europe_1783.geojson`. Defaults to a Europe bounding box of
`[-25, 34, 45, 72]`; override with `--bbox W S E N` and `--tolerance`.

Clip wider than you intend to display — the clip leaves straight edges along the
bounding box, and they need to sit off-frame.

## Working with the AE project

`symphonyOTD.aep` is deliberately not tracked, and neither are the downloaded
portraits or baked map stills — the scripts above regenerate all of it from the
work JSON, which is tracked. The documentation covers rebuilding a mapcomp from
scratch, including the one step that has to be done by hand in the GEOlayers
panel.
