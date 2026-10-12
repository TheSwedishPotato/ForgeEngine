import struct, math
LAT0, LON0 = 46.745, 8.62
A, F = 6378137.0, 1/298.257223563
E2 = F*(2-F)
def wkb(b):
    """Parse WKB (Point, LineString, Polygon, Multi*) -> nested lists of (lon,lat)."""
    def rd(o):
        bo = '<' if b[o] == 1 else '>'
        t, = struct.unpack(bo+'I', b[o+1:o+5]); o += 5
        t &= 0xff
        if t == 1:
            x, y = struct.unpack(bo+'dd', b[o:o+16]); return ('Point', (x, y)), o+16
        if t == 2:
            n, = struct.unpack(bo+'I', b[o:o+4]); o += 4
            pts = [struct.unpack(bo+'dd', b[o+16*i:o+16*i+16]) for i in range(n)]
            return ('LineString', pts), o+16*n
        if t == 3:
            nr, = struct.unpack(bo+'I', b[o:o+4]); o += 4; rings = []
            for _ in range(nr):
                n, = struct.unpack(bo+'I', b[o:o+4]); o += 4
                rings.append([struct.unpack(bo+'dd', b[o+16*i:o+16*i+16]) for i in range(n)]); o += 16*n
            return ('Polygon', rings), o
        if t in (4, 5, 6):
            n, = struct.unpack(bo+'I', b[o:o+4]); o += 4; parts = []
            for _ in range(n):
                g, o = rd(o); parts.append(g)
            return ('Multi', parts), o
        raise ValueError(t)
    return rd(0)[0]
# Transverse Mercator (Krüger series) centred on LON0, origin at LAT0: metres east (x), north (y)
def _tm_consts():
    n = F/(2-F); a_ = A/(1+n)*(1+n*n/4+n**4/64)
    al = [n/2 - 2*n*n/3 + 5*n**3/16, 13*n*n/48 - 3*n**3/5, 61*n**3/240]
    be = [n/2 - 2*n*n/3 + 37*n**3/96, n*n/48 + n**3/15, 17*n**3/480]
    return n, a_, al, be
_n, _a, _al, _be = _tm_consts()
def _tm(lat, lon):
    phi, lam = math.radians(lat), math.radians(lon - LON0)
    e = math.sqrt(E2)
    t = math.sinh(math.atanh(math.sin(phi)) - e*math.atanh(e*math.sin(phi)))
    xi = math.atan2(t, math.cos(lam)); eta = math.atanh(math.sin(lam)/math.sqrt(1+t*t))
    x = eta + sum(_al[j]*math.cos(2*(j+1)*xi)*math.sinh(2*(j+1)*eta) for j in range(3))
    y = xi + sum(_al[j]*math.sin(2*(j+1)*xi)*math.cosh(2*(j+1)*eta) for j in range(3))
    return _a*x, _a*y
_, _Y0 = _tm(LAT0, LON0)
def proj(lon, lat):
    x, y = _tm(lat, lon); return x, y - _Y0
def unproj(x, y):
    # Newton iterate on the forward projection (accurate to mm)
    lat, lon = LAT0 + y/111200.0, LON0 + x/(111320.0*math.cos(math.radians(LAT0)))
    for _ in range(6):
        px, py = proj(lon, lat)
        d = 1e-6
        ax, ay = proj(lon+d, lat); bx, by = proj(lon, lat+d)
        j11, j12, j21, j22 = (ax-px)/d, (bx-px)/d, (ay-py)/d, (by-py)/d
        det = j11*j22 - j12*j21; ex, ey = x-px, y-py
        lon += (j22*ex - j12*ey)/det; lat += (-j21*ex + j11*ey)/det
    return lon, lat
