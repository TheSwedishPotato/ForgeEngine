"""Extract Overture features intersecting a bbox via HTTP range reads of the GeoParquet files.
usage: overture_extract.py <theme/type prefix> <out.parquet> xmin ymin xmax ymax [subtype filter]"""
import sys, re, urllib.request, time
sys.path.insert(0, '/tmp/claude-0/geo')
from httpfile import HTTPRangeFile
import pyarrow.parquet as pq, pyarrow as pa, pyarrow.compute as pc
from concurrent.futures import ThreadPoolExecutor
B = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com'
prefix, out = sys.argv[1], sys.argv[2]
xmin, ymin, xmax, ymax = map(float, sys.argv[3:7])
keys, token = [], None
while True:
    u = f'{B}/?list-type=2&prefix={prefix}&max-keys=1000' + (f'&continuation-token={urllib.parse.quote(token)}' if token else '')
    d = urllib.request.urlopen(u, timeout=60).read().decode()
    keys += [k for k in re.findall(r'<Key>(.*?)</Key>', d) if k.endswith('.parquet')]
    t = re.findall(r'<NextContinuationToken>(.*?)</NextContinuationToken>', d)
    if not t: break
    token = t[0]
print(len(keys), 'files', flush=True)
def colidx(md, name):
    for i in range(md.num_columns):
        if md.schema.column(i).path == name: return i
def scan(k):
    f = HTTPRangeFile(f'{B}/{k}', block=1<<18)
    pf = pq.ParquetFile(f)
    md = pf.metadata
    ix = {n: colidx(md, f'bbox.{n}') for n in ('xmin', 'xmax', 'ymin', 'ymax')}
    rgs = []
    for g in range(md.num_row_groups):
        rg = md.row_group(g)
        st = {n: rg.column(i).statistics for n, i in ix.items()}
        if st['xmin'].min > xmax or st['xmax'].max < xmin or st['ymin'].min > ymax or st['ymax'].max < ymin: continue
        rgs.append(g)
    tabs = []
    for g in rgs:
        t = pf.read_row_group(g)
        bb = t.column('bbox')
        m = pc.and_(pc.and_(pc.less_equal(pc.struct_field(bb, 'xmin'), xmax), pc.greater_equal(pc.struct_field(bb, 'xmax'), xmin)),
                    pc.and_(pc.less_equal(pc.struct_field(bb, 'ymin'), ymax), pc.greater_equal(pc.struct_field(bb, 'ymax'), ymin)))
        t = t.filter(m)
        if t.num_rows: tabs.append(t)
    return k, rgs, tabs, f.bytes_read
t0 = time.time(); allt = []; total = 0
with ThreadPoolExecutor(8) as ex:
    for k, rgs, tabs, nb in ex.map(scan, keys):
        total += nb
        if rgs: print(k.split('/')[-1][:12], 'row groups', rgs, 'rows', sum(t.num_rows for t in tabs), flush=True)
        allt += tabs
print('downloaded MB', total / 1e6, 'time', time.time() - t0)
if allt:
    T = pa.concat_tables(allt, promote_options='permissive')
    pq.write_table(T, out)
    print('rows', T.num_rows, 'columns', T.column_names)
