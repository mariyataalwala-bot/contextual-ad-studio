"""Trim plain borders from a logo found online, so it fills its slot in the template.
usage: python trim_logo.py <logo file>      (rewritten in place; a small margin is kept)
Transparent PNGs are cropped to their visible pixels; others to what differs from the corner (background) colour.
Logos from "free PNG" sites often have a fake transparency checkerboard painted in (white and light-grey squares):
on a picture with no real transparency, near-white neutral pixels are made white first, so the squares vanish."""
import sys
from PIL import Image, ImageChops

f = sys.argv[1]
im = Image.open(f)
im.load()
real_alpha = False
if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
    rgba = im.convert('RGBA')
    real_alpha = rgba.getchannel('A').getextrema()[0] < 250   # an alpha channel that is opaque everywhere is not transparency
changed = False
if real_alpha:
    im = rgba
    box = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
else:
    im = im.convert('RGB')
    corner = im.getpixel((0, 0))
    if min(corner) >= 225 and max(corner) - min(corner) <= 12:   # a white / light-grey background: checkerboard squares out
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                p = px[x, y]
                if min(p) >= 225 and max(p) - min(p) <= 12 and p != (255, 255, 255):
                    px[x, y] = (255, 255, 255); changed = True
        corner = (255, 255, 255)
    bg = Image.new('RGB', im.size, corner)
    diff = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > 24 else 0)
    box = diff.getbbox()
if box:
    w, h = im.size
    m = int(max(box[2] - box[0], box[3] - box[1]) * 0.04)   # keep a little breathing room
    box = (max(0, box[0] - m), max(0, box[1] - m), min(w, box[2] + m), min(h, box[3] + m))
    if (box[2] - box[0]) * (box[3] - box[1]) < 0.97 * w * h:
        im.crop(box).save(f)
        print('trimmed', im.size, '->', (box[2] - box[0], box[3] - box[1]))
    elif changed:
        im.save(f)
        print('background cleaned, nothing to trim')
    else:
        print('nothing to trim')
