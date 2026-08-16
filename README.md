# symphony of the day

Motion-graphics work for the Symphony of the Day project — After Effects driven
programmatically through an MCP connector, with historical maps built in
GEOlayers 3.

## Contents

| Path | What it is |
|---|---|
| [`docs/geolayers-3-via-mcp.md`](docs/geolayers-3-via-mcp.md) | How to drive GEOlayers 3 from the AE MCP connector — what's scriptable, what isn't, working recipes, and the traps |
| `data/clip_region.py` | Clips a historical-basemaps world GeoJSON to a bounding box and simplifies it |

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

`symphonyOTD.aep` is deliberately not tracked. The documentation above covers
rebuilding a mapcomp from scratch, including the one step that has to be done by
hand in the GEOlayers panel.
