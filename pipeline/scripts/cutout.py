"""Product cut-out for in-image creatives, and the brand colour of a logo.
usage: python cutout.py product <in> <out.png>   → prints JSON {method, w, h}
       python cutout.py colour  <logo>           → prints JSON {hex, light}
product methods: "alpha" (the picture already has a transparent background), "plain-bg" (a plain studio background was
removed from the edges inwards), "photo" (a real photo: kept as it is and shown as a card, never cut out by guessing)."""
import sys, json
import numpy as np, cv2
from PIL import Image

def load_rgba(f):
    im = Image.open(f); im.load()
    return np.array(im.convert('RGBA'))

def trim(a, margin=0.03):
    ys, xs = np.where(a[..., 3] > 12)
    if not len(xs): return a
    m = int(max(xs.max() - xs.min(), ys.max() - ys.min()) * margin)
    return a[max(0, ys.min() - m):ys.max() + m + 1, max(0, xs.min() - m):xs.max() + m + 1]

def product(src, dst):
    a = load_rgba(src); h, w = a.shape[:2]
    method = 'photo'
    if (a[..., 3] < 20).mean() > 0.05:
        method = 'alpha'
    else:
        rgb = cv2.cvtColor(a[..., :3], cv2.COLOR_RGB2BGR)
        border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(np.float32)
        med = np.median(border, axis=0)
        plain = (np.abs(border - med).max(axis=1) < 18).mean()
        if plain > 0.9:   # a plain background all round: flood it from every edge pixel that has that colour
            mask = np.zeros((h + 2, w + 2), np.uint8)
            flags = 4 | cv2.FLOODFILL_MASK_ONLY | cv2.FLOODFILL_FIXED_RANGE | (255 << 8)
            step = max(1, min(h, w) // 60)
            seeds = [(x, 0) for x in range(0, w, step)] + [(x, h - 1) for x in range(0, w, step)] + [(0, y) for y in range(0, h, step)] + [(w - 1, y) for y in range(0, h, step)]
            for (x, y) in seeds:
                if mask[y + 1, x + 1] == 0 and np.abs(rgb[y, x].astype(np.float32) - med).max() < 18:
                    cv2.floodFill(rgb, mask, (x, y), 0, (14, 14, 14), (14, 14, 14), flags)
            bg = mask[1:-1, 1:-1] > 0
            fg = (~bg).astype(np.uint8)
            n, lab, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
            keep = np.zeros_like(fg)
            big = stats[1:, cv2.CC_STAT_AREA].max() if n > 1 else 0
            for i in range(1, n):   # specks of dust / jpeg noise out, every real part of the product in
                if stats[i, cv2.CC_STAT_AREA] >= max(60, big * 0.004): keep[lab == i] = 1
            if 0.04 < keep.mean() < 0.97:
                alpha = cv2.GaussianBlur((keep * 255).astype(np.float32), (0, 0), 0.8)
                a = a.copy(); a[..., 3] = np.clip(alpha, 0, 255).astype(np.uint8)
                method = 'plain-bg'
    out = trim(a) if method != 'photo' else a
    Image.fromarray(out).save(dst)
    print(json.dumps({'method': method, 'w': int(out.shape[1]), 'h': int(out.shape[0])}))

def colour(src):
    a = load_rgba(src)
    px = a[a[..., 3] > 200][:, :3].astype(np.float32)
    hsv = cv2.cvtColor(px.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2HSV).reshape(-1, 3).astype(np.float32)
    vivid = px[(hsv[:, 1] > 90) & (hsv[:, 2] > 60)]
    pick = vivid if len(vivid) > max(40, len(px) * 0.03) else px[(px.max(axis=1) < 235)]   # no colour at all: the darkest ink
    if not len(pick): pick = np.array([[30, 30, 30]], np.float32)
    k = min(3, len(pick))
    _, lab, cen = cv2.kmeans(pick, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 2, cv2.KMEANS_PP_CENTERS)
    c = cen[np.bincount(lab.ravel()).argmax()]
    lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
    print(json.dumps({'hex': '#%02x%02x%02x' % tuple(int(v) for v in c), 'light': bool(lum > 0.62), 'vivid': bool(len(vivid) > max(40, len(px) * 0.03))}))

if __name__ == '__main__':
    if sys.argv[1] == 'product': product(sys.argv[2], sys.argv[3])
    else: colour(sys.argv[2])
