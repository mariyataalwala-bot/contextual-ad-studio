"""Trim plain borders from a logo found online, so it fills its slot in the template.
usage: python trim_logo.py <logo file>      (rewritten in place; a small margin is kept)
Transparent PNGs are cropped to their visible pixels; others to what differs from the corner (background) colour."""
import sys
from PIL import Image, ImageChops

f = sys.argv[1]
im = Image.open(f)
im.load()
if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
    im = im.convert('RGBA')
    box = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
else:
    im = im.convert('RGB')
    bg = Image.new('RGB', im.size, im.getpixel((0, 0)))
    diff = ImageChops.difference(im, bg).convert('L').point(lambda v: 255 if v > 24 else 0)
    box = diff.getbbox()
if box:
    w, h = im.size
    m = int(max(box[2] - box[0], box[3] - box[1]) * 0.04)   # keep a little breathing room
    box = (max(0, box[0] - m), max(0, box[1] - m), min(w, box[2] + m), min(h, box[3] + m))
    if (box[2] - box[0]) * (box[3] - box[1]) < 0.97 * w * h:
        im.crop(box).save(f)
        print('trimmed', im.size, '->', (box[2] - box[0], box[3] - box[1]))
    else:
        print('nothing to trim')
