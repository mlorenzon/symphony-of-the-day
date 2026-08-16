#!/usr/bin/env python3
"""Clip an aourednik/historical-basemaps world GeoJSON to a bounding box.

Cuts geometry to the box (Sutherland-Hodgman) and simplifies (Douglas-Peucker)
so GEOlayers 3 draws far fewer shape-layer vertices for an inset map.

Usage:
    python clip_region.py 1783
    python clip_region.py 1815 --bbox -25 34 45 72 --tolerance 0.02
"""
import argparse
import json
import os

REGIONS = {
    # name: (min_lon, min_lat, max_lon, max_lat)
    "europe": (-25.0, 34.0, 45.0, 72.0),
}

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(HERE, "historical-basemaps", "geojson")
OUT_DIR = os.path.join(HERE, "clipped")


def ring_bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def bbox_intersects(a, b):
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def clip_ring(ring, bbox):
    """Sutherland-Hodgman clip of a ring against an axis-aligned rectangle."""
    min_lon, min_lat, max_lon, max_lat = bbox

    def inside(p, edge):
        if edge == 0:
            return p[0] >= min_lon
        if edge == 1:
            return p[0] <= max_lon
        if edge == 2:
            return p[1] >= min_lat
        return p[1] <= max_lat

    def intersect(p, q, edge):
        px, py = p[0], p[1]
        qx, qy = q[0], q[1]
        if edge in (0, 1):
            x = min_lon if edge == 0 else max_lon
            if qx == px:
                return [x, py]
            t = (x - px) / (qx - px)
            return [x, py + t * (qy - py)]
        y = min_lat if edge == 2 else max_lat
        if qy == py:
            return [px, y]
        t = (y - py) / (qy - py)
        return [px + t * (qx - px), y]

    out = [p[:2] for p in ring]
    for edge in range(4):
        if not out:
            return []
        inp, out = out, []
        for i in range(len(inp)):
            cur, prev = inp[i], inp[i - 1]
            cur_in, prev_in = inside(cur, edge), inside(prev, edge)
            if cur_in:
                if not prev_in:
                    out.append(intersect(prev, cur, edge))
                out.append(cur)
            elif prev_in:
                out.append(intersect(prev, cur, edge))
    if out and out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else []


def perp_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == 0 and dy == 0:
        return ((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2) ** 0.5
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return ((p[0] - (a[0] + t * dx)) ** 2 + (p[1] - (a[1] + t * dy)) ** 2) ** 0.5


def simplify(points, tol):
    """Iterative Douglas-Peucker (recursion would blow the stack on big rings)."""
    if tol <= 0 or len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        max_d, idx = 0.0, first
        for i in range(first + 1, last):
            d = perp_dist(points[i], points[first], points[last])
            if d > max_d:
                max_d, idx = d, i
        if max_d > tol:
            keep[idx] = True
            stack.append((first, idx))
            stack.append((idx, last))
    return [p for p, k in zip(points, keep) if k]


def process_polygon(rings, bbox, tol):
    out = []
    for ring in rings:
        if not bbox_intersects(ring_bbox(ring), bbox):
            continue
        clipped = clip_ring(ring, bbox)
        if not clipped:
            continue
        simplified = simplify(clipped, tol)
        if len(simplified) >= 4:
            out.append(simplified)
    # drop the polygon if its outer ring vanished
    return out if out else None


def process_geometry(geom, bbox, tol):
    t = geom.get("type")
    if t == "Polygon":
        rings = process_polygon(geom["coordinates"], bbox, tol)
        return {"type": "Polygon", "coordinates": rings} if rings else None
    if t == "MultiPolygon":
        polys = []
        for poly in geom["coordinates"]:
            rings = process_polygon(poly, bbox, tol)
            if rings:
                polys.append(rings)
        if not polys:
            return None
        if len(polys) == 1:
            return {"type": "Polygon", "coordinates": polys[0]}
        return {"type": "MultiPolygon", "coordinates": polys}
    return None


def count_vertices(geom):
    if geom is None:
        return 0
    if geom["type"] == "Polygon":
        return sum(len(r) for r in geom["coordinates"])
    return sum(len(r) for p in geom["coordinates"] for r in p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("year", help="e.g. 1783, bc323")
    ap.add_argument("--region", default="europe", choices=sorted(REGIONS))
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("W", "S", "E", "N"))
    ap.add_argument("--tolerance", type=float, default=0.02,
                    help="Douglas-Peucker tolerance in degrees (0 disables)")
    args = ap.parse_args()

    bbox = tuple(args.bbox) if args.bbox else REGIONS[args.region]
    src = os.path.join(SRC_DIR, "world_%s.geojson" % args.year)
    if not os.path.exists(src):
        raise SystemExit("No such source file: %s" % src)

    with open(src, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    kept, in_verts, out_verts = [], 0, 0
    for feat in data.get("features", []):
        geom = feat.get("geometry")
        if not geom:
            continue
        in_verts += count_vertices(geom)
        new_geom = process_geometry(geom, bbox, args.tolerance)
        if new_geom is None:
            continue
        out_verts += count_vertices(new_geom)
        kept.append({
            "type": "Feature",
            "properties": feat.get("properties", {}),
            "geometry": new_geom,
        })

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, "%s_%s.geojson" % (args.region, args.year))
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": kept}, fh)

    print("source     : %s" % os.path.basename(src))
    print("bbox       : %s" % (bbox,))
    print("tolerance  : %s deg" % args.tolerance)
    print("features   : %d -> %d" % (len(data.get("features", [])), len(kept)))
    print("vertices   : %d -> %d (%.1f%% removed)"
          % (in_verts, out_verts, 100.0 * (1 - out_verts / in_verts) if in_verts else 0))
    print("size       : %.2f MB -> %.2f MB"
          % (os.path.getsize(src) / 1048576.0, os.path.getsize(out_path) / 1048576.0))
    print("written    : %s" % out_path)
    names = sorted({f["properties"].get("NAME") for f in kept if f["properties"].get("NAME")})
    print("polities   : %s" % ", ".join(names))


if __name__ == "__main__":
    main()
