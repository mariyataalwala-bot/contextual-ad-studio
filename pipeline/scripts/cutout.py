"""Product cut-out for in-image creatives, and the brand colour of a logo.
usage: python cutout.py product <in> <out.png> [--photo]   → prints JSON {method, w, h}   (--photo: keep the original photo)
       python cutout.py preview <png> <out.jpg>      → the PNG on a grey checkerboard, for the AI check
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

def product(src, dst, force_photo=False):
    a = load_rgba(src); h, w = a.shape[:2]
    method = 'photo'
    if force_photo:
        pass   # asked for the original photo as it is (a cut-out failed its check)
    elif (a[..., 3] < 20).mean() > 0.05:
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
            # a cut-out is only trusted when the product clearly differs from the background: light or metallic
            # products on a light background (silver jewellery, clear bottles) lose parts and keep background
            # "holes" inside them (a hoop's middle) — those are shown as their original photo instead
            fgpx = rgb[keep == 1].astype(np.float32)
            near = (np.abs(fgpx - med).max(axis=1) < 40).mean() if len(fgpx) else 1
            holes = (np.abs(rgb.astype(np.float32) - med).max(axis=2) < 18) & (keep == 1)
            risky = near > 0.30 or holes.sum() > 0.06 * max(1, keep.sum())
            print(json.dumps({'check': {'near_background': round(float(near), 3), 'holes': round(float(holes.sum() / max(1, keep.sum())), 3), 'risky': bool(risky)}}))
            if not risky and 0.04 < keep.mean() < 0.97:
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

def preview(src, dst, size=640):
    """The finished PNG as the checker sees it: on a grey checkerboard, so leftover background or holes show."""
    a = Image.open(src).convert('RGBA'); a.thumbnail((size, size))
    bg = Image.new('RGBA', a.size, (150, 150, 150, 255)); px = bg.load(); step = max(8, size // 32)
    for y in range(a.size[1]):
        for x in range(a.size[0]):
            if (x // step + y // step) % 2: px[x, y] = (205, 205, 205, 255)
    bg.alpha_composite(a); bg.convert('RGB').save(dst, quality=90)
    print(json.dumps({'preview': dst}))

def logo(src, dst):
    """A logo ready to sit directly on the ad (no white patch behind it):
    - a real transparent logo is kept; a logo on a flat background has that colour keyed out everywhere — also inside
      letters (the holes of a, o, e) — with soft edges;
    - kind: "badge" (a filled, multi-colour shape that carries its own background, e.g. Maggi's red oval — shown as is),
      "mark" (ink on transparent — shown in colour, or all-white / all-black when it would not stand out),
      "photo" (could not be separated — shown on a faint frosted chip);
    - ink: the logo's main colour, for the contrast check."""
    a = load_rgba(src).copy()
    kind = 'mark'
    real_alpha = (a[..., 3] < 20).mean() > 0.03
    if not real_alpha:
        rgb = a[..., :3].astype(np.float32)
        border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
        med = np.median(border, axis=0)
        if (np.abs(border - med).max(axis=1) < 18).mean() > 0.9:
            d = np.abs(rgb - med).max(axis=2)
            a[..., 3] = np.clip((d - 14) / (48 - 14) * 255, 0, 255).astype(np.uint8)   # soft key: 14 → clear, 48 → solid
            # the key leaves a light fringe of background colour on the edges: pull edge pixels back towards the ink
            edge = (a[..., 3] > 0) & (a[..., 3] < 255)
            if edge.any():
                k = (a[..., 3][edge].astype(np.float32) / 255)[:, None]
                a[..., :3][edge] = np.clip((rgb[edge] - med * (1 - k)) / np.maximum(k, 0.2), 0, 255).astype(np.uint8)
        else:
            kind = 'photo'
    out = trim(a, 0.02) if kind != 'photo' else a
    vis = out[out[..., 3] > 200][:, :3].astype(np.float32)
    ink, fill, second, colours = (30, 30, 30), 0.0, 0.0, 1
    # light parts (a white outline, a white letter inside a coloured shape) vanish when the logo is shown all-white
    light = float(((vis.min(axis=1) > 215) & (vis.max(axis=1) - vis.min(axis=1) < 30)).mean()) if len(vis) else 0.0
    if len(vis) > 20:
        k = min(3, len(vis))
        _, lab, cen = cv2.kmeans(vis, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 2, cv2.KMEANS_PP_CENTERS)
        counts = np.bincount(lab.ravel(), minlength=k); order = counts.argsort()[::-1]
        ink = tuple(int(v) for v in cen[order[0]])
        fill = (out[..., 3] > 200).mean()
        second = counts[order[1]] / counts.sum() if k > 1 else 0
        spread = np.abs(cen[order[0]] - cen[order[1]]).max() if k > 1 else 0
        if kind == 'mark' and fill > 0.55 and second > 0.08 and spread > 60: kind = 'badge'
        # distinct colours that matter (at least 10% of the logo and clearly different from the main one)
        colours = 1 + sum(1 for j in order[1:] if counts[j] / counts.sum() >= 0.10 and np.abs(cen[j] - cen[order[0]]).max() > 60)
    Image.fromarray(out).save(dst)
    lum = (0.2126 * ink[0] + 0.7152 * ink[1] + 0.0722 * ink[2]) / 255
    print(json.dumps({'kind': kind, 'ink': '#%02x%02x%02x' % ink, 'lum': round(float(lum), 3), 'fill': round(float(fill), 3), 'keyed': not real_alpha and kind != 'photo', 'colours': int(colours), 'light': round(light, 3), 'w': int(out.shape[1]), 'h': int(out.shape[0])}))

if __name__ == '__main__':
    if sys.argv[1] == 'product': product(sys.argv[2], sys.argv[3], '--photo' in sys.argv[4:])
    elif sys.argv[1] == 'preview': preview(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == 'logo': logo(sys.argv[2], sys.argv[3])
    else: colour(sys.argv[2])
