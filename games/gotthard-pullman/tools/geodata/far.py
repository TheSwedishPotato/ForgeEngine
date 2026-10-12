"""
The mountains beyond the map: a 100 m height grid 84 x 88 km round the line, so that the
view down the valley to Lake Uri and up to the Gotthard pass ends on real mountains.

Source: Copernicus GLO-30 DEM tiles N46E008, N47E008, N46E009 (AWS Open Data), sampled
in the game's transverse-Mercator projection (geo.py). Writes src/data/terrain_far.js.

Usage:  python3 tools/geodata/far.py
"""
import sys, urllib.request
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from geo import unproj  # noqa: E402
from build import write_module, b64gz, CACHE  # noqa: E402

FAR = dict(x0=-42000.0, y0=-42000.0, x1=42000.0, y1=46000.0, step=100.0)
TILES = [(46, 8), (47, 8), (46, 9), (47, 9)]


def tile(lat, lon):
    name = f'Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM'
    path = CACHE / f'cop_n{lat}_e{lon:03d}.tif'
    if lat == 46 and lon == 8:
        path = CACHE / 'cop_n46_e008.tif'
    if not path.exists():
        print('  fetching', name)
        urllib.request.urlretrieve(f'https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif', path)
    import tifffile
    return tifffile.imread(path).astype(np.float32)


def main():
    dems = {}
    for la, lo in TILES:
        try:
            dems[(la, lo)] = tile(la, lo)
        except Exception as e:   # a missing tile is filled from its neighbours below
            print('  no tile', la, lo, e)
    xs = np.arange(FAR['x0'], FAR['x1'] + 1e-6, FAR['step'])
    ys = np.arange(FAR['y0'], FAR['y1'] + 1e-6, FAR['step'])
    # lon/lat of the grid from an exact lattice every 2 km, interpolated (the projection is smooth)
    cx = np.arange(FAR['x0'], FAR['x1'] + 1e-6, 2000.0); cy = np.arange(FAR['y0'], FAR['y1'] + 1e-6, 2000.0)
    LL = np.array([[unproj(x, y) for x in cx] for y in cy])
    from scipy.interpolate import RegularGridInterpolator
    il = RegularGridInterpolator((cy, cx), LL[:, :, 0]); ia = RegularGridInterpolator((cy, cx), LL[:, :, 1])
    gy, gx = np.meshgrid(ys, xs, indexing='ij')
    q = np.c_[gy.ravel(), gx.ravel()]
    lon = il(q); lat = ia(q)
    h = np.full(lon.shape, np.nan, np.float32)
    for (la, lo), D in dems.items():
        n = D.shape[0]                       # 3600 rows; columns narrow north of 50 deg (not here)
        m = D.shape[1]
        sel = (lat >= la) & (lat < la + 1) & (lon >= lo) & (lon < lo + 1)
        c = (lon[sel] - lo) * m; r = (la + 1 - lat[sel]) * n
        c0 = np.clip(np.floor(c).astype(int), 0, m - 2); r0 = np.clip(np.floor(r).astype(int), 0, n - 2)
        fc = c - c0; fr = r - r0
        h[sel] = D[r0, c0] * (1 - fc) * (1 - fr) + D[r0, c0 + 1] * fc * (1 - fr) + D[r0 + 1, c0] * (1 - fc) * fr + D[r0 + 1, c0 + 1] * fc * fr
    h = h.reshape(gy.shape)
    # fill any gap from the nearest known height
    if np.isnan(h).any():
        from scipy.ndimage import distance_transform_edt
        idx = distance_transform_edt(np.isnan(h), return_distances=False, return_indices=True)
        h = h[tuple(idx)]
    h = np.maximum(h, 0)
    print(f'  far grid {len(xs)} x {len(ys)}, heights {h.min():.0f}..{h.max():.0f} m')
    write_module('terrain_far.js', 'Copernicus GLO-30 heights on a 100 m grid round the line (decimetres, uint16), for the distant mountains.', {
        'x0': FAR['x0'], 'y0': FAR['y0'], 'step': FAR['step'], 'w': len(xs), 'h': len(ys), 'data': b64gz(np.round(h * 10).astype(np.uint16))})


if __name__ == '__main__':
    main()
