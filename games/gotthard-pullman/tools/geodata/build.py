"""
Bakes the real geography of the Gotthard north ramp (Erstfeld - Göschenen)
into the game's data modules (src/data/*.js).

Sources (all open data, fetched from the AWS Open Data registry):
  * OpenStreetMap, through Overture Maps (release 2026-09-23.1): the two
    running tracks, station and platform features, named bridges, catenary
    masts, buildings, roads, rivers, land use.
  * Copernicus GLO-30 DEM (30 m, ESA/Airbus): terrain heights.
  * ESA WorldCover 2021 v200 (10 m): land cover (forest, grass, rock, built-up, water).

Usage:  python3 tools/geodata/build.py            (downloads into tools/geodata/.cache)
"""
import base64, gzip, json, math, os, subprocess, sys, urllib.request
from pathlib import Path
import numpy as np
import scipy.sparse as sp, scipy.sparse.linalg as spl
from scipy.ndimage import median_filter
from scipy.optimize import lsq_linear
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from geo import wkb, proj, unproj, LAT0, LON0  # noqa: E402

CACHE = HERE / '.cache'
OUT = HERE.parents[1] / 'src' / 'data'
RELEASE = '2026-09-23.1'
BBOX = (8.45, 46.58, 8.80, 46.90)
STEP = 2.0                       # metres between track samples

# ---------------------------------------------------------------------------
# fetching

def fetch():
    CACHE.mkdir(parents=True, exist_ok=True)
    jobs = {
        'seg.parquet': 'theme=transportation/type=segment/',
        'infra.parquet': 'theme=base/type=infrastructure/',
        'water.parquet': 'theme=base/type=water/',
        'landuse.parquet': 'theme=base/type=land_use/',
        'buildings.parquet': 'theme=buildings/type=building/',
    }
    for name, prefix in jobs.items():
        if not (CACHE / name).exists():
            bbox = BBOX if name != 'buildings.parquet' else (8.52, 46.62, 8.72, 46.86)
            subprocess.check_call([sys.executable, str(HERE / 'overture_extract.py'), f'release/{RELEASE}/{prefix}', str(CACHE / name), *map(str, bbox)])
    dem = CACHE / 'cop_n46_e008.tif'
    if not dem.exists():
        urllib.request.urlretrieve('https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N46_00_E008_00_DEM/Copernicus_DSM_COG_10_N46_00_E008_00_DEM.tif', dem)
    wc = CACHE / 'worldcover_N45E006.tif'
    if not wc.exists():
        urllib.request.urlretrieve('https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N45E006_Map.tif', wc)

def table(name):
    import pyarrow.parquet as pq
    return pq.read_table(CACHE / name)

# ---------------------------------------------------------------------------
# DEM

_DEM = None
def dem_ll(lon, lat):
    """Copernicus GLO-30: pixel centres on the integer arc-second grid (checked against
    Erstfeld 472.0 m and Amsteg-Silenen 544 m station heights)."""
    global _DEM
    if _DEM is None:
        import tifffile
        _DEM = tifffile.imread(CACHE / 'cop_n46_e008.tif').astype(np.float32)
    c = (np.asarray(lon) - 8.0) * 3600; r = (47.0 - np.asarray(lat)) * 3600
    c0 = np.clip(np.floor(c).astype(int), 0, 3598); r0 = np.clip(np.floor(r).astype(int), 0, 3598)
    fc = c - c0; fr = r - r0; D = _DEM
    return D[r0, c0] * (1 - fc) * (1 - fr) + D[r0, c0 + 1] * fc * (1 - fr) + D[r0 + 1, c0] * (1 - fc) * fr + D[r0 + 1, c0 + 1] * fc * fr

def dem_xy(x, y):
    x = np.atleast_1d(x); y = np.atleast_1d(y)
    ll = np.array([unproj(a, b) for a, b in zip(x, y)])
    return dem_ll(ll[:, 0], ll[:, 1])

# ---------------------------------------------------------------------------
# rail graph and the two mainline paths

def cut(xy, a, b):
    cum = [0.0]
    for i in range(len(xy) - 1): cum.append(cum[-1] + math.dist(xy[i], xy[i + 1]))
    L = cum[-1]; A, B = a * L, b * L
    def at(s):
        for i in range(len(xy) - 1):
            if cum[i + 1] >= s:
                t = (s - cum[i]) / max(1e-9, cum[i + 1] - cum[i])
                return (xy[i][0] + (xy[i + 1][0] - xy[i][0]) * t, xy[i][1] + (xy[i + 1][1] - xy[i][1]) * t)
        return xy[-1]
    out = [at(A)] + [xy[i] for i in range(1, len(xy) - 1) if A < cum[i] < B] + [at(B)]
    return out, B - A

def rail_graph():
    import pyarrow.compute as pc
    T = table('seg.parquet'); R = T.filter(pc.equal(T.column('subtype'), 'rail'))
    edges = []
    for sid, g, cl, fl, conn in zip(R.column('id').to_pylist(), R.column('geometry').to_pylist(), R.column('class').to_pylist(), R.column('rail_flags').to_pylist(), R.column('connectors').to_pylist()):
        if cl != 'standard_gauge': continue
        kind, pts = wkb(g)
        flags = [(tuple(e['between']) if e['between'] else (0.0, 1.0), set(e['values'])) for e in (fl or [])]
        if any('is_disused' in f or 'is_abandoned' in f for _, f in flags): continue
        xy = [proj(*p) for p in pts]
        cs = sorted([(c['at'], c['connector_id']) for c in conn or []])
        for (a, u), (b, v) in zip(cs, cs[1:]):
            if b - a < 1e-9: continue
            poly, L = cut(xy, a, b)
            edges.append(dict(u=u, v=v, xy=poly, len=L, a=a, b=b, flags=[[list(bt), sorted(f)] for bt, f in flags]))
    import heapq, collections
    adj = collections.defaultdict(list); pos = {}
    for i, e in enumerate(edges):
        adj[e['u']].append((e['v'], i, +1)); adj[e['v']].append((e['u'], i, -1))
        pos[e['u']] = e['xy'][0]; pos[e['v']] = e['xy'][-1]
    def nearest(p): return min(pos, key=lambda n: math.dist(pos[n], p))
    def dijkstra(src, dst, penal=None):
        dist = {src: 0}; prev = {}; h = [(0, src)]
        while h:
            d, u = heapq.heappop(h)
            if u == dst: break
            if d > dist.get(u, 1e18): continue
            for v, i, dirn in adj[u]:
                w = edges[i]['len'] * (penal.get(i, 1) if penal else 1)
                if d + w < dist.get(v, 1e18): dist[v] = d + w; prev[v] = (u, i, dirn); heapq.heappush(h, (d + w, v))
        path = []; u = dst
        while u != src: u0, i, dirn = prev[u]; path.append((i, dirn)); u = u0
        return path[::-1]
    s0, s1 = nearest(proj(8.6511, 46.8192)), nearest((-2394, -8804))
    p1 = dijkstra(s0, s1)
    p2 = dijkstra(s0, s1, {i: 40 for i, _ in p1})
    rail_graph.ctx = dict(adj=adj, pos=pos, nearest=nearest, dijkstra=dijkstra)
    return edges, p1, p2

def lane_of_edges(edges, C, sc):
    """Mean signed offset of every edge from the midline C (+ left, - right); NaN if off the corridor."""
    t, nrm = frame(C); tree = cKDTree(C); out = []
    for e in edges:
        xy = np.array(e['xy']); d, j = tree.query(xy)
        if d.max() > 12: out.append(np.nan); continue
        out.append(float(np.mean(np.einsum('ij,ij->i', xy - C[j], nrm[j]))))
    return np.array(out)

def running_path(edges, lane, via_edges, prefer='left'):
    """Path over the real tracks through the given edges in order (platform tracks),
    keeping to one main-line track between them where it can."""
    g = rail_graph.ctx
    penal = {}
    for i, o in enumerate(lane):
        if np.isnan(o): continue
        wrong = o < -0.9 if prefer == 'left' else o > 0.9
        if wrong: penal[i] = 9.0
    path = []
    for k, (i, d) in enumerate(via_edges):
        e = edges[i]; a, b = (e['u'], e['v']) if d > 0 else (e['v'], e['u'])
        if k > 0:
            pi, pd = via_edges[k - 1]; pe = edges[pi]; pend = pe['v'] if pd > 0 else pe['u']
            if pend != a: path += g['dijkstra'](pend, a, penal)
        path.append((i, d))
    return chain(edges, path)

def edge_beside(edges, xy, heading, maxd=8.0):
    """The track edge running beside a point (a platform): nearest edge roughly parallel to heading.
    Returns (edge index, direction) with direction +1 when u->v follows heading."""
    best = None
    for i, e in enumerate(edges):
        P = np.array(e['xy'])
        if len(P) < 2: continue
        d = np.hypot(*(P - xy).T); k = int(np.argmin(d))
        seg = P[min(k + 1, len(P) - 1)] - P[max(k - 1, 0)]
        n = np.linalg.norm(seg)
        if n < 1e-6: continue
        cosang = abs(seg @ heading) / n
        # distance to the polyline (segment-accurate)
        dm = min(abs((P[j + 1] - P[j])[0] * (xy - P[j])[1] - (P[j + 1] - P[j])[1] * (xy - P[j])[0]) / max(1e-9, np.linalg.norm(P[j + 1] - P[j]))
                 if 0 <= (xy - P[j]) @ (P[j + 1] - P[j]) <= (P[j + 1] - P[j]) @ (P[j + 1] - P[j]) else np.inf
                 for j in range(len(P) - 1))
        if dm < maxd and cosang > 0.95 and (best is None or dm < best[0]):
            dirn = 1 if (P[-1] - P[0]) @ heading > 0 else -1
            best = (dm, i, dirn)
    return best[1], best[2]

def extend_edge(edges, i, d, length, heading):
    """Walk on from an edge's end (or back from its start) along the straightest continuation for `length` m."""
    g = rail_graph.ctx; out = []
    e = edges[i]; node = (e['v'] if d > 0 else e['u']) if length > 0 else (e['u'] if d > 0 else e['v'])
    want = heading if length > 0 else -heading
    run = 0.0; seen = {i}
    while run < abs(length):
        cands = []
        for v, j, dirn in g['adj'][node]:
            if j in seen: continue
            P = np.array(edges[j]['xy']);
            P = P if dirn > 0 else P[::-1]
            seg = P[min(len(P) - 1, 3)] - P[0]; nn = np.linalg.norm(seg)
            if nn < 1e-6: continue
            cands.append(((seg / nn) @ want, j, dirn, v))
        if not cands: break
        c, j, dirn, v = max(cands)
        if c < 0.8: break
        seen.add(j); out.append((j, dirn if length > 0 else -dirn)); run += edges[j]['len']; node = v
        want = (np.array(edges[j]['xy'][-1 if dirn > 0 else 0]) - np.array(edges[j]['xy'][0 if dirn > 0 else -1])); want /= np.linalg.norm(want)
    return out if length > 0 else out[::-1]

def platform_track_ends(platforms, ref, station_xy, back, ahead, heading):
    """Points on the line beside a platform: `back` m before its near end, `ahead` m past its far end (heading = unit vector of travel)."""
    best = None
    for p in platforms:
        if str(p['ref']) != ref: continue
        xy = np.array(p['xy']); d = np.hypot(*(xy.mean(0) - station_xy))
        if best is None or d < best[0]: best = (d, xy)
    xy = best[1]; along = xy @ heading
    a, b = xy[np.argmin(along)], xy[np.argmax(along)]
    return a - heading * back, b + heading * ahead

# ---------------------------------------------------------------------------
# alignments

def resample(P, step):
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]
    s = np.arange(0, d[-1] + 1e-9, step)
    return np.c_[np.interp(s, d, P[:, 0]), np.interp(s, d, P[:, 1])], s

def frame(P):
    t = np.gradient(P, axis=0); t /= np.linalg.norm(t, axis=1)[:, None]
    return t, np.c_[-t[:, 1], t[:, 0]]

def curvature(P, step):
    d1 = np.gradient(P, step, axis=0); d2 = np.gradient(d1, step, axis=0)
    return (d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]) / np.maximum(1e-9, np.hypot(*d1.T) ** 3)

def whittaker(Y, lam, order=3, w=None):
    n = len(Y); Dk = sp.identity(n)
    for _ in range(order): Dk = sp.diags([1.0, -1.0], [0, 1], shape=(Dk.shape[0] - 1, Dk.shape[0])) @ Dk
    W = sp.diags(np.ones(n) if w is None else w)
    M = (W + lam * (Dk.T @ Dk)).tocsc()
    if Y.ndim == 1: return spl.spsolve(M, W @ Y)
    return np.c_[[spl.spsolve(M, W @ Y[:, c]) for c in range(Y.shape[1])]].T

def chain(edges, path):
    line = []
    for i, d in path:
        xy = edges[i]['xy'] if d > 0 else edges[i]['xy'][::-1]
        line += xy if not line else xy[1:]
    return np.array(line)

def alignments(edges, p1, p2):
    A, _ = resample(chain(edges, p1), 2.0)
    # rough reference along path 1 (which may change tracks at crossovers)
    C = whittaker(A, (20 / 2.0) ** 6)
    C, sc = resample(C, STEP)
    def match(C, sc):
        t, nrm = frame(C); S, O = [], []
        for path in (p1, p2):
            scur = 0.0
            for i, d in path:
                xy = edges[i]['xy'] if d > 0 else edges[i]['xy'][::-1]
                dens, _ = resample(np.array(xy), 1.0) if len(xy) > 1 else (np.array(xy), None)
                for p in dens:
                    lo, hi = np.searchsorted(sc, [scur - 80, scur + 600])
                    if hi <= lo: continue
                    k = lo + int(np.argmin(np.hypot(*(C[lo:hi] - p).T)))
                    if np.hypot(*(C[k] - p)) > 30: continue
                    scur = max(scur, sc[k] - 40)
                    S.append(sc[k] + (p - C[k]) @ t[k]); O.append((p - C[k]) @ nrm[k])
        return np.array(S), np.array(O)
    def lanes(S, O, sc, BIN=10.0):
        nb = int(sc[-1] // BIN) + 1; xs = np.arange(-6, 6.01, 0.05)
        oL = np.full(nb, np.nan); oR = np.full(nb, np.nan)
        order = np.argsort(S); So = S[order]; Oo = O[order]
        for b in range(nb):
            lo, hi = np.searchsorted(So, [b * BIN - 10, (b + 1) * BIN + 10])
            o = Oo[lo:hi]; o = o[np.abs(o) < 6]
            if len(o) < 4: continue
            dens = np.exp(-((xs[:, None] - o[None, :]) / 0.3) ** 2).sum(1)
            pk = [i for i in range(1, len(xs) - 1) if dens[i] >= dens[i - 1] and dens[i] > dens[i + 1] and dens[i] > 2]
            pk.sort(key=lambda i: -dens[i])
            for i in pk:
                cand = [k for k in pk if 2.6 < abs(xs[k] - xs[i]) < 6.5 and dens[k] > 0.15 * dens[pk[0]]]
                if cand and dens[i] > 0.15 * dens[pk[0]]:
                    a, b2 = sorted((xs[i], xs[cand[0]])); oR[b], oL[b] = a, b2; break
        ok = ~np.isnan(oL); sb = np.arange(nb) * BIN + BIN / 2
        return np.interp(sc, sb[ok], median_filter(oL[ok], 5)), np.interp(sc, sb[ok], median_filter(oR[ok], 5)), ok.mean()
    for it in range(2):
        S, O = match(C, sc)
        oL, oR, cov = lanes(S, O, sc)
        t, nrm = frame(C)
        M = whittaker(C + nrm * ((oL + oR) / 2)[:, None], (40 / STEP) ** 6)
        C, sc = resample(M, STEP)
        print(f'  alignment pass {it}: lane coverage {cov:.3f}, midline {sc[-1]:.1f} m')
    S, O = match(C, sc)
    oL, oR, cov = lanes(S, O, sc)
    t, nrm = frame(C)
    spacing = whittaker(oL - oR, (200 / STEP) ** 3, order=2)
    # The open line's spacing is constant in reality; OSM's scatter is mapping noise.
    # Keep the measured widening only where it is real (stations), otherwise 3.6 m.
    gap = np.where(spacing > 4.3, spacing, 3.6)
    gap = whittaker(gap, (40 / STEP) ** 4, order=2)
    off = np.c_[gap / 2, -gap / 2]
    tracks = {}
    for name, o in (('left', off[:, 0]), ('right', off[:, 1])):
        P = whittaker(C + nrm * o[:, None], (12 / STEP) ** 6)
        P, s = resample(P, STEP)
        tracks[name] = {'xy': P, 's': s}
        k = curvature(P, STEP); r = 1 / np.maximum(np.abs(whittaker(k, (10 / STEP) ** 4, order=2)), 1e-9)
        print(f'  {name} track {s[-1]:.1f} m, min radius {r.min():.0f} m')
    return C, sc, tracks

# ---------------------------------------------------------------------------
# structures on the track

def locate_factory(P, S):
    def locate(points, back=60, ahead=400, maxd=12):
        out = []; scur = 0.0
        for p in points:
            lo, hi = np.searchsorted(S, [scur - back, scur + ahead])
            if hi <= lo: out.append((np.nan, np.inf)); continue
            d = np.hypot(*(P[lo:hi] - p).T); k = lo + int(np.argmin(d))
            if d.min() > maxd: out.append((np.nan, d.min())); continue
            scur = max(scur, S[k] - 20); out.append((S[k], d.min()))
        return out
    return locate

def structures(edges, p1, p2, P, S):
    locate = locate_factory(P, S)
    def flags_of(e, frac):
        s = e['a'] + (e['b'] - e['a']) * frac; out = set()
        for (a, b), f in e['flags']:
            if a - 1e-9 <= s <= b + 1e-9: out |= set(f)
        return out
    samples = []
    for path in (p1, p2):
        pts, fl = [], []
        for i, d in path:
            e = edges[i]; xy = np.array(e['xy'] if d > 0 else e['xy'][::-1])
            seg = np.hypot(*np.diff(xy, axis=0).T); L = seg.sum()
            if L <= 0: continue
            cum = np.r_[0, np.cumsum(seg)]
            for u in np.arange(0, L, 2.0):
                k = min(np.searchsorted(cum, u, side='right') - 1, len(seg) - 1); t = (u - cum[k]) / max(seg[k], 1e-9)
                pts.append(xy[k] + (xy[k + 1] - xy[k]) * t)
                f = flags_of(e, (u / L) if d > 0 else (1 - u / L)); fl.append(('is_tunnel' in f, 'is_bridge' in f))
        for (s_, dist), (tn, br) in zip(locate(pts), fl):
            if not np.isnan(s_) and dist < 6: samples.append((s_, tn, br))
    samples = np.array(samples, float)
    bins = np.arange(0, S[-1] + 2, 2.0)
    idx = np.clip(np.digitize(samples[:, 0], bins) - 1, 0, len(bins) - 2)
    tun = np.zeros(len(bins) - 1); bri = np.zeros(len(bins) - 1); cnt = np.zeros(len(bins) - 1)
    np.add.at(tun, idx, samples[:, 1]); np.add.at(bri, idx, samples[:, 2]); np.add.at(cnt, idx, 1)
    with np.errstate(invalid='ignore'):
        tun = np.where(cnt > 0, tun / cnt, 0); bri = np.where(cnt > 0, bri / cnt, 0)
    def runs(v, minlen=6, merge=8):
        v = v > 0.5; out = []; i = 0
        while i < len(v):
            if v[i]:
                j = i
                while j < len(v) and v[j]: j += 1
                if (j - i) * 2.0 >= minlen: out.append([float(bins[i]), float(bins[j])])
                i = j
            else: i += 1
        m = []
        for a, b in out:
            if m and a - m[-1][1] < merge: m[-1][1] = b
            else: m.append([a, b])
        return m
    return runs(tun), runs(bri, minlen=4, merge=4)

# Tunnel names on the north ramp, matched by length (German Wikipedia route table,
# gotthardmodell.ch facts table): Intschi 88 m, Zgraggen 68 m, Breiten 57 m,
# Pfaffensprung 1476 m, Mühle 88 m, Wattinger 1084 m, Leggistein 1090 m, Naxberg 1570 m.
TUNNEL_NAMES = [((8250, 8420), 'Intschitunnel'), ((9480, 9620), 'Zgraggentunnel'), ((9920, 10050), 'Breitentunnel'),
                ((14400, 15950), 'Pfaffensprung-Kehrtunnel'), ((17780, 17900), 'Mühletunnel'),
                ((19300, 20450), 'Wattinger Kehrtunnel'), ((22850, 23980), 'Leggistein-Kehrtunnel'), ((25400, 27300), 'Naxbergtunnel')]

def name_structures(tunnels, bridges, P, S):
    out_t = []
    for a, b in tunnels:
        nm = next((n for (lo, hi), n in TUNNEL_NAMES if lo <= a and b <= hi + 300 and a <= hi), None)
        out_t.append({'s0': round(a, 1), 's1': round(b, 1), 'name': nm})
    # bridges: named SBB bridges from OSM (bridge:name on railway=rail)
    I = table('infra.parquet'); named = []
    for g, t in zip(I.column('geometry').to_pylist(), I.column('source_tags').to_pylist()):
        t = dict(t or [])
        if t.get('railway') == 'rail' and (t.get('bridge:name') or t.get('name')) and t.get('bridge') in ('yes', 'viaduct'):
            kind, pts = wkb(g)
            pts = pts if kind == 'LineString' else pts[0] if kind == 'Polygon' else []
            for p in pts: named.append((proj(*p), t.get('bridge:name') or t.get('name')))
    tree = cKDTree(P)
    out_b = []
    for a, b in bridges:
        mid = P[np.searchsorted(S, (a + b) / 2)]
        nm = None; best = 40
        for (x, y), n in named:
            d = math.hypot(x - mid[0], y - mid[1])
            if d < best: best, nm = d, n
        out_b.append({'s0': round(a, 1), 's1': round(b, 1), 'name': nm})
    return out_t, out_b

# ---------------------------------------------------------------------------
# vertical profile

def profile(P, S, tunnels, bridges, stations_ctrl):
    step = 50.0
    knots = np.arange(0, S[-1] + step, step); n = len(knots) - 1
    ds = 10.0; s_samp = np.arange(0, S[-1], ds)
    xy = np.c_[np.interp(s_samp, S, P[:, 0]), np.interp(s_samp, S, P[:, 1])]
    dem = dem_xy(xy[:, 0], xy[:, 1])
    mask = np.ones_like(s_samp, bool)
    for t in tunnels + bridges: mask &= ~((s_samp > t['s0'] - 40) & (s_samp < t['s1'] + 40))
    def row(s):
        r = np.zeros(n + 1); r[0] = 1.0; r[1:] = np.minimum(np.maximum(s - knots[:-1], 0), step); return r
    rows, rhs, w = [], [], []
    for s_, z_ in zip(s_samp[mask], dem[mask]): rows.append(row(s_)); rhs.append(z_); w.append(1.0)
    nd = len(rows)
    for s_, z_, wt in stations_ctrl: rows.append(row(s_)); rhs.append(z_); w.append(wt)
    # the published climbs through the three spiral/loop tunnels
    loops = sorted([t for t in tunnels if t['s1'] - t['s0'] > 1000 and t['s0'] < 24000], key=lambda t: t['s0'])
    for t, dz in zip(loops, (34.0, 24.0, 25.0)):
        rows.append(row(t['s1']) - row(t['s0'])); rhs.append(dz); w.append(400.0)
    A = np.array(rows); b = np.array(rhs); W = np.array(w)
    Dg = np.zeros((n - 1, n + 1))
    for i in range(n - 1): Dg[i, 1 + i] = -1; Dg[i, 2 + i] = 1
    lo = np.r_[-np.inf, np.zeros(n)]; hi = np.r_[np.inf, np.full(n, 0.0262)]
    for it in range(6):
        sol = lsq_linear(np.vstack([A * np.sqrt(W)[:, None], Dg * 4000.0]), np.r_[b * np.sqrt(W), np.zeros(n - 1)], bounds=(lo, hi), lsmr_tol='auto', max_iter=5000)
        x = sol.x; res = A @ x - b
        sig = 1.4826 * np.median(np.abs(res[:nd])) + 1e-6
        W[:nd] = 1.0 / np.maximum(1.0, np.abs(res[:nd]) / (2.0 * sig))
    z = x[0] + np.r_[0, np.cumsum(x[1:] * step)]
    print(f'  profile: DEM residual median {np.median(np.abs(res[:nd])):.1f} m, max gradient {x[1:].max() * 1000:.1f} permille')
    for (t, dz) in zip(loops, (34, 24, 25)):
        print(f'  loop tunnel {t["name"]}: climb {np.interp(t["s1"], knots, z) - np.interp(t["s0"], knots, z):.1f} m (published {dz}), {(np.interp(t["s1"], knots, z) - np.interp(t["s0"], knots, z)) / (t["s1"] - t["s0"]) * 1000:.1f} permille')
    return knots, z

# ---------------------------------------------------------------------------
# stations

STATIONS = [
    # name, official km (from Immensee), official height, OSM station-building fallback
    ('Erstfeld', 41.580, 472.0),
    ('Amsteg-Silenen', 46.55, 544.0),
    ('Gurtnellen', None, 737.5),
    ('Wassen', 62.76, None),
    ('Göschenen', 70.440, 1105.9),
]

def station_positions(P, S):
    B = table('buildings.parquet')
    pos = {}
    tree = cKDTree(P)
    cands = []
    for g, c in zip(B.column('geometry').to_pylist(), B.column('class').to_pylist()):
        kind, pts = wkb(g); ring = pts[0] if kind == 'Polygon' else pts[0][1][0]
        xy = np.array([proj(*p) for p in ring]); cen = xy.mean(0); d, i = tree.query(cen)
        area = 0.5 * abs(np.dot(xy[:-1, 0], xy[1:, 1]) - np.dot(xy[1:, 0], xy[:-1, 1]))
        cands.append((S[i], d, area, c, cen, xy))
    # station buildings tagged as such by OSM
    I = table('infra.parquet')
    for g, t in zip(I.column('geometry').to_pylist(), I.column('source_tags').to_pylist()):
        t = dict(t or [])
        if t.get('railway') == 'station' and t.get('uic_ref') in ('8505114', '8505119'):
            x, y = proj(*wkb(g)[1]); d, i = tree.query((x, y))
            pos['Erstfeld' if t['uic_ref'] == '8505114' else 'Göschenen'] = float(S[i])
    def building_near(s_est, window):
        best = None
        for s_, d, area, c, cen, xy in cands:
            if abs(s_ - s_est) < window and d < 30 and 100 < area < 450:
                score = abs(s_ - s_est) + (0 if c == 'train_station' else 200)
                if best is None or score < best[0]: best = (score, s_, cen, xy, d)
        return best
    scale = (pos['Göschenen'] - pos['Erstfeld']) / ((70.440 - 41.580) * 1000)
    out = []
    for name, km, z in STATIONS:
        s_km = pos['Erstfeld'] + (km - 41.580) * 1000 * scale if km else None
        if name in pos: s = pos[name]
        else:
            b = building_near(s_km if s_km else {'Gurtnellen': 12950}[name], 400)
            s = float(b[1]) if b else s_km
        out.append({'name': name, 's': round(s, 1), 'km': km, 'z': z})
        print(f'  station {name:15s} s={s:8.1f}' + (f'  (km estimate {s_km:.1f})' if s_km else ''))
    return out, cands

# ---------------------------------------------------------------------------
# catenary masts, platforms

def masts_and_platforms(P, S):
    I = table('infra.parquet'); tree = cKDTree(P); t, nrm = frame(P)
    masts, platforms = [], []
    for g, s_, c, tg in zip(I.column('geometry').to_pylist(), I.column('subtype').to_pylist(), I.column('class').to_pylist(), I.column('source_tags').to_pylist()):
        tg = dict(tg or [])
        if c == 'catenary_mast':
            x, y = proj(*wkb(g)[1]); d, i = tree.query((x, y))
            if d < 15:
                side = float((np.array([x, y]) - P[i]) @ nrm[i])
                masts.append([round(float(S[i]), 1), round(side, 2)])
        elif tg.get('railway') == 'platform' or (s_ == 'transit' and c == 'platform' and tg.get('railway') == 'platform'):
            kind, pts = wkb(g)
            ring = pts if kind == 'LineString' else pts[0] if kind == 'Polygon' else None
            if not ring: continue
            xy = np.array([proj(*p) for p in ring]); d, i = tree.query(xy.mean(0))
            if d < 120 and tg.get('operator') != 'MGB':
                platforms.append({'ref': tg.get('ref'), 'xy': np.round(xy, 2).tolist(), 's': round(float(S[i]), 1)})
    masts.sort()
    return masts, platforms

# ---------------------------------------------------------------------------
# terrain, land cover

TER = dict(x0=-10000.0, y0=-14000.0, x1=10000.0, y1=13000.0, step=25.0)

def terrain_grid():
    xs = np.arange(TER['x0'], TER['x1'] + 1e-6, TER['step']); ys = np.arange(TER['y0'], TER['y1'] + 1e-6, TER['step'])
    # project the grid to lon/lat once (vectorised by rows: TM is smooth; use exact unproj on a coarse lattice + bilinear)
    cx = np.arange(TER['x0'], TER['x1'] + 1e-6, 500.0); cy = np.arange(TER['y0'], TER['y1'] + 1e-6, 500.0)
    LL = np.array([[unproj(x, y) for x in cx] for y in cy])     # [ny, nx, 2]
    from scipy.interpolate import RegularGridInterpolator
    il = RegularGridInterpolator((cy, cx), LL[:, :, 0]); ia = RegularGridInterpolator((cy, cx), LL[:, :, 1])
    gy, gx = np.meshgrid(ys, xs, indexing='ij')
    q = np.c_[gy.ravel(), gx.ravel()]
    lon = il(q); lat = ia(q)
    h = dem_ll(lon, lat).reshape(gy.shape)
    return xs, ys, h, (il, ia)

def landcover_grid(interp, step=20.0):
    import tifffile
    il, ia = interp
    xs = np.arange(TER['x0'], TER['x1'] + 1e-6, step); ys = np.arange(TER['y0'], TER['y1'] + 1e-6, step)
    tf = tifffile.TiffFile(CACHE / 'worldcover_N45E006.tif'); p = tf.pages[0]
    sx, sy, _ = p.tags['ModelPixelScaleTag'].value; tp = p.tags['ModelTiepointTag'].value
    X0, Y0 = tp[3], tp[4]
    gy, gx = np.meshgrid(ys, xs, indexing='ij')
    lon = il(np.c_[gy.ravel(), gx.ravel()]); lat = ia(np.c_[gy.ravel(), gx.ravel()])
    c = ((lon - X0) / sx).astype(int); r = ((Y0 - lat) / sy).astype(int)
    r0, r1, c0, c1 = r.min(), r.max() + 1, c.min(), c.max() + 1
    # read the needed tiles
    tw, th = p.tilewidth, p.tilelength; ntx = (p.imagewidth + tw - 1) // tw
    arr = np.zeros((r1 - r0, c1 - c0), np.uint8)
    fh = open(CACHE / 'worldcover_N45E006.tif', 'rb')
    for ty in range(r0 // th, (r1 - 1) // th + 1):
        for tx in range(c0 // tw, (c1 - 1) // tw + 1):
            idx = ty * ntx + tx
            fh.seek(p.dataoffsets[idx]); data = fh.read(p.databytecounts[idx])
            seg, _i, _s = p.decode(data, idx)
            seg = np.asarray(seg).reshape(th, tw)
            ya, xa = ty * th, tx * tw
            y0_, y1_ = max(r0, ya), min(r1, ya + th); x0_, x1_ = max(c0, xa), min(c1, xa + tw)
            arr[y0_ - r0:y1_ - r0, x0_ - c0:x1_ - c0] = seg[y0_ - ya:y1_ - ya, x0_ - xa:x1_ - xa]
    lc = arr[r - r0, c - c0].reshape(gy.shape)
    return xs, ys, lc

# ---------------------------------------------------------------------------
# buildings, roads, water

def buildings(cands, P, S):
    B = table('buildings.parquet')
    out = []
    for g, c, sub, nm, nf, h, rs, rh, mh in zip(B.column('geometry').to_pylist(), B.column('class').to_pylist(), B.column('subtype').to_pylist(), B.column('names').to_pylist(),
                                              B.column('num_floors').to_pylist(), B.column('height').to_pylist(), B.column('roof_shape').to_pylist(), B.column('roof_height').to_pylist(), B.column('min_height').to_pylist()):
        kind, pts = wkb(g)
        polys = [pts] if kind == 'Polygon' else [p[1] for p in pts if p[0] == 'Polygon'] if kind == 'Multi' else []
        for rings in polys:
            ring = np.array([proj(*p) for p in rings[0]])
            if len(ring) < 4: continue
            cx, cy = ring.mean(0)
            if not (TER['x0'] + 500 < cx < TER['x1'] - 500 and TER['y0'] + 500 < cy < TER['y1'] - 500): continue
            area = 0.5 * abs(np.dot(ring[:-1, 0], ring[1:, 1]) - np.dot(ring[1:, 0], ring[:-1, 1]))
            if area < 6: continue
            base = float(dem_xy([cx], [cy])[0])
            out.append({'p': np.round(ring[:-1], 2).ravel().tolist(), 'c': c, 'u': sub, 'n': (nm or {}).get('primary'), 'f': nf, 'h': h, 'r': rs, 'z': round(base, 1)})
    print(f'  buildings: {len(out)}')
    return out

ROAD_KEEP = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service', 'living_street', 'track'}

def roads():
    import pyarrow.compute as pc
    T = table('seg.parquet'); Rd = T.filter(pc.equal(T.column('subtype'), 'road'))
    out = []
    for g, cl, nm, fl in zip(Rd.column('geometry').to_pylist(), Rd.column('class').to_pylist(), Rd.column('names').to_pylist(), Rd.column('road_flags').to_pylist()):
        if cl not in ROAD_KEEP: continue
        kind, pts = wkb(g)
        if kind != 'LineString': continue
        xy = np.array([proj(*p) for p in pts])
        if not ((xy[:, 0] > TER['x0']) & (xy[:, 0] < TER['x1']) & (xy[:, 1] > TER['y0']) & (xy[:, 1] < TER['y1'])).any(): continue
        flags = sorted(set(v for e in (fl or []) for v in e['values']))
        out.append({'p': np.round(xy, 1).ravel().tolist(), 'c': cl, 'n': (nm or {}).get('primary'), 'f': flags})
    print(f'  roads: {len(out)}')
    return out

def water():
    W = table('water.parquet'); out = []
    for g, sub, cl, nm in zip(W.column('geometry').to_pylist(), W.column('subtype').to_pylist(), W.column('class').to_pylist(), W.column('names').to_pylist()):
        kind, pts = wkb(g)
        parts = [(kind, pts)] if kind != 'Multi' else pts
        for k, pp in parts:
            if k == 'LineString': xy = np.array([proj(*p) for p in pp]); typ = 'line'
            elif k == 'Polygon': xy = np.array([proj(*p) for p in pp[0]]); typ = 'area'
            else: continue
            if not ((xy[:, 0] > TER['x0']) & (xy[:, 0] < TER['x1']) & (xy[:, 1] > TER['y0']) & (xy[:, 1] < TER['y1'])).any(): continue
            out.append({'t': typ, 'p': np.round(xy, 1).ravel().tolist(), 's': sub, 'c': cl, 'n': (nm or {}).get('primary')})
    print(f'  water features: {len(out)}')
    return out

# ---------------------------------------------------------------------------
# output

def b64gz(arr):
    return base64.b64encode(gzip.compress(np.ascontiguousarray(arr).tobytes(), 9, mtime=0)).decode()

def write_module(name, header, obj):
    OUT.mkdir(parents=True, exist_ok=True)
    txt = f'// {header}\n// Generated by tools/geodata/build.py. Do not edit by hand.\nexport default {json.dumps(obj, separators=(",", ":"), ensure_ascii=False)};\n'
    (OUT / name).write_text(txt)
    print(f'  wrote src/data/{name} ({len(txt) / 1e6:.2f} MB)')

def main():
    fetch()
    print('rail graph'); edges, p1, p2 = rail_graph()
    print('alignments'); C, sc, tracks = alignments(edges, p1, p2)
    P, S = tracks['left']['xy'], tracks['left']['s']
    print('structures'); tun, bri = structures(edges, p1, p2, P, S)
    tunnels, bridges = name_structures(tun, bri, P, S)
    print('stations'); stations, cands = station_positions(P, S)
    ctrl = [(st['s'], st['z'], 400.0 if st['name'] != 'Gurtnellen' else 40.0) for st in stations if st['z'] is not None]
    print('profile'); knots, z = profile(P, S, tunnels, bridges, ctrl)
    for st in stations: st['zFit'] = round(float(np.interp(st['s'], knots, z)), 1)
    print('masts, platforms'); masts, platforms = masts_and_platforms(P, S)
    # ---- the train's own running path: Erstfeld Gleis 1 -> left main line -> Göschenen Gleis 1
    lane = lane_of_edges(edges, C, sc)
    tL, nL = frame(P)
    def heading_at(s_): i = int(np.clip(np.searchsorted(S, s_), 0, len(S) - 1)); return tL[i]
    stE = next(st for st in stations if st['name'] == 'Erstfeld'); stG = next(st for st in stations if st['name'] == 'Göschenen')
    xyE = P[np.searchsorted(S, stE['s'])]; xyG = P[min(len(P) - 1, np.searchsorted(S, stG['s']))]
    hE, hG = heading_at(stE['s']), heading_at(stG['s'] - 50)
    def platform_centre(ref, near):
        c = [np.array(p['xy']).mean(0) for p in platforms if str(p['ref']) == ref]
        return min(c, key=lambda q: np.hypot(*(q - near)))
    iE, dE = edge_beside(edges, platform_centre('1', xyE), hE)
    iG, dG = edge_beside(edges, platform_centre('1', xyG), hG)
    via = extend_edge(edges, iE, dE, -320, hE) + [(iE, dE), (iG, dG)] + extend_edge(edges, iG, dG, 160, hG)
    raw = running_path(edges, lane, via, 'left')
    raw, _ = resample(raw, 1.0)
    light = whittaker(raw, (10 / 1.0) ** 6)
    trL = cKDTree(P); d, j = trL.query(light)
    w = np.clip((1.6 - d) / 1.0, 0, 1)
    # outside the two terminal stations the train is on the main line: use its geometry outright
    dStations = np.minimum(np.hypot(*(light - xyE).T), np.hypot(*(light - xyG).T))
    w = np.where(dStations > 900, 1.0, w)
    w = np.convolve(np.r_[np.full(60, w[0]), w, np.full(60, w[-1])], np.ones(121) / 121, mode='same')[60:-60]
    w = np.clip((w - 0.5) * 3 + 0.5, 0, 1)
    blend = light + w[:, None] * (P[j] - light)
    RP, RS = resample(whittaker(blend, (8 / 1.0) ** 6), STEP)
    # end the path 400 m past Göschenen station (the platform tracks run on into turnouts toward the tunnel)
    sGrun = RS[cKDTree(RP).query(xyG)[1]]
    keep = RS <= sGrun + 400
    RP, RS = RP[keep], RS[keep]
    # heights: the fitted profile through the left-lane chainage (flat beyond its ends: station areas)
    _, jr = cKDTree(P).query(RP)
    RZ = np.interp(S[jr], knots, z)
    # station positions on the running path
    trR = cKDTree(RP)
    for st in stations:
        st['sRun'] = round(float(RS[trR.query(P[min(len(P) - 1, np.searchsorted(S, st['s']))])[1]]), 1)
    for pl in platforms:
        pl['sRun'] = round(float(RS[trR.query(np.array(pl['xy']).mean(0))[1]]), 1)
    for t in tunnels + bridges:
        t['r0'] = round(float(RS[trR.query(P[min(len(P) - 1, np.searchsorted(S, t['s0']))])[1]]), 1)
        t['r1'] = round(float(RS[trR.query(P[min(len(P) - 1, np.searchsorted(S, t['s1']))])[1]]), 1)
    masts_run = []
    tRn, nRn = frame(RP)
    for s_, side in masts:
        p = P[min(len(P) - 1, np.searchsorted(S, s_))]; k = trR.query(p)[1]
        masts_run.append([round(float(RS[k]), 1), round(float(side + (p - RP[k]) @ nRn[k] * 0), 2)])
    kR = curvature(RP, STEP); rmin = 1 / np.abs(whittaker(kR, (10 / STEP) ** 4, order=2)).max()
    print(f'  running path {RS[-1]:.1f} m, min radius {rmin:.0f} m; stations on it: ' + ', '.join(f"{st['name']} {st['sRun']:.0f}" for st in stations))
    # the other main-line track (northbound), same heights as the left track beside it
    PR, SR = tracks['right']['xy'], tracks['right']['s']
    _, jr = cKDTree(P).query(PR)
    zR = np.interp(S[jr], knots, z)
    zL = np.interp(S, knots, z)
    # every other standard-gauge track near the stations (sidings, platform tracks), for scenery
    yard = []
    near_run = cKDTree(np.vstack([RP, PR]))
    for e in edges:
        xy = np.array(e['xy'])
        dd, _ = near_run.query(xy)
        if dd.max() < 1.2 or len(xy) < 2: continue
        dE = min(np.hypot(*(xy - xyE).T).min(), np.hypot(*(xy - xyG).T).min())
        if dE > 1600: continue
        _, jy = cKDTree(P).query(xy)
        yard.append({'p': np.round(np.c_[xy, np.interp(S[jy], knots, z)], 2).ravel().tolist()})
    print(f'  station tracks for scenery: {len(yard)}')
    route = {
        'origin': {'lat': LAT0, 'lon': LON0, 'projection': 'transverse Mercator (WGS84) centred on the origin; x east, y north, metres'},
        'step': STEP,
        'run': {'length': float(RS[-1]), 'xyz': b64gz(np.c_[RP, RZ].astype(np.float32))},
        'left': {'length': float(S[-1]), 'xyz': b64gz(np.c_[P, zL].astype(np.float32))},
        'right': {'length': float(SR[-1]), 'xyz': b64gz(np.c_[PR, zR].astype(np.float32))},
        'yard': yard,
        'profile': {'s': knots.round(1).tolist(), 'z': np.round(z, 3).tolist()},
        'stations': stations, 'tunnels': tunnels, 'bridges': bridges,
        'masts': masts_run, 'platforms': platforms,
        'sources': ['OpenStreetMap contributors via Overture Maps ' + RELEASE, 'Copernicus GLO-30 DEM', 'ESA WorldCover 2021 v200'],
    }
    write_module('route.js', 'The Gotthard north ramp, Erstfeld - Göschenen: both running tracks, profile, structures, stations (OpenStreetMap, Copernicus DEM).', route)
    print('terrain'); xs, ys, h, interp = terrain_grid()
    write_module('terrain.js', 'Copernicus GLO-30 heights on a 25 m grid in the local projection (decimetres, uint16).', {
        'x0': TER['x0'], 'y0': TER['y0'], 'step': TER['step'], 'w': len(xs), 'h': len(ys), 'data': b64gz(np.round(h * 10).astype(np.uint16))})
    print('land cover'); lxs, lys, lc = landcover_grid(interp)
    write_module('landcover.js', 'ESA WorldCover 2021 classes (10 tree, 20 shrub, 30 grass, 40 crop, 50 built, 60 bare, 70 snow/ice, 80 water, 90 wetland, 100 moss) on a 20 m grid.', {
        'x0': TER['x0'], 'y0': TER['y0'], 'step': 20.0, 'w': len(lxs), 'h': len(lys), 'data': b64gz(lc.astype(np.uint8))})
    print('places'); bl = buildings(cands, P, S); rd = roads(); wt = water()
    write_module('places.js', 'Buildings, roads and water of the Reuss valley (OpenStreetMap via Overture Maps).', {'buildings': bl, 'roads': rd, 'water': wt})

if __name__ == '__main__':
    main()
