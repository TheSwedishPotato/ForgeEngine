# python3 tools/strip.py out.png crop_x0,y0,x1,y1 in1.png in2.png ...
import sys
from PIL import Image
out, crop, *ins = sys.argv[1:]
box = tuple(int(v) for v in crop.split(',')) if crop != '-' else None
ims = [Image.open(p).convert('RGB') for p in ins]
if box: ims = [i.crop(box) for i in ims]
W = sum(i.width for i in ims); H = max(i.height for i in ims)
o = Image.new('RGB', (W, H))
x = 0
for i in ims:
    o.paste(i, (x, 0)); x += i.width
if W > 2000:
    o = o.resize((2000, int(H * 2000 / W)))
o.save(out)
