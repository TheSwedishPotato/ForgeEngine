"""Turns engine renders into the illustrated story's pictures.

  paint.py portrait <black.jpg> <white.jpg> <out.webp>   difference matte -> RGBA cut-out, painted
  paint.py plate <in.jpg> <out.webp>                     background plate, painted

The painterly look is a Kuwahara filter (each pixel takes the mean of the calmest of the four
quadrants around it), which flattens texture into brush-like patches while keeping edges, then a
little contrast, saturation and an unsharp mask: the digital-painting finish of the reference.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter, ImageEnhance


def box_mean(img, r):
    """Mean over (2r+1)^2 windows via an integral image; img HxWxC float."""
    pad = np.pad(img, ((r + 1, r), (r + 1, r), (0, 0)), mode='edge')
    ii = pad.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = ii[k:, k:] - ii[:-k, k:] - ii[k:, :-k] + ii[:-k, :-k]
    return s / (k * k)


def kuwahara(rgb, r):
    """Classic Kuwahara: four (r+1)^2 quadrants per pixel, choose the lowest-variance mean."""
    h, w, _ = rgb.shape
    lum = (rgb @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
    q = r // 2
    m = box_mean(rgb, q)          # means of (r+1)-ish windows centred at every pixel
    ml = box_mean(lum, q)
    vl = box_mean(lum * lum, q) - ml * ml
    best = None
    best_var = None
    for dy in (-q, q):
        for dx in (-q, q):
            mm = np.roll(np.roll(m, dy, 0), dx, 1)
            vv = np.roll(np.roll(vl, dy, 0), dx, 1)[..., 0]
            if best is None:
                best, best_var = mm.copy(), vv.copy()
            else:
                sel = vv < best_var
                best[sel] = mm[sel]
                best_var[sel] = vv[sel]
    return best


def finish(im, sat=1.08, contrast=1.06, sharp=110):
    im = ImageEnhance.Color(im).enhance(sat)
    im = ImageEnhance.Contrast(im).enhance(contrast)
    return im.filter(ImageFilter.UnsharpMask(radius=2, percent=sharp, threshold=2))


def portrait(black, white, out):
    B = np.asarray(Image.open(black).convert('RGB')).astype(np.float32) / 255
    W = np.asarray(Image.open(white).convert('RGB')).astype(np.float32) / 255
    diff = np.clip((W - B).max(axis=2), 0, 1)
    bg_w = np.median(W[:20, :20].reshape(-1, 3), axis=0).max()   # how white the backdrop came out
    alpha = np.clip(1 - diff / max(bg_w, 1e-3), 0, 1)
    alpha = np.where(alpha < 0.04, 0, alpha)
    rgb = np.clip(B / np.maximum(alpha[..., None], 1e-3), 0, 1) * (alpha[..., None] > 0)
    painted = kuwahara(rgb, 4)
    painted = np.where(alpha[..., None] > 0.5, painted, rgb)
    im = Image.fromarray((painted * 255).astype(np.uint8))
    im = finish(im)
    a = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    im.putalpha(a)
    bbox = a.getbbox()
    im.save(out, 'WEBP', quality=86, method=6)
    print('portrait', out, bbox)


def plate(src, out):
    rgb = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
    painted = kuwahara(rgb, 6)
    im = finish(Image.fromarray((painted * 255).astype(np.uint8)), sat=1.12, contrast=1.08, sharp=80)
    im.save(out, 'WEBP', quality=84, method=6)
    print('plate', out)


if __name__ == '__main__':
    if sys.argv[1] == 'portrait':
        portrait(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        plate(sys.argv[2], sys.argv[3])
