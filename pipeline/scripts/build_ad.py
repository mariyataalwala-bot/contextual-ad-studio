"""Assemble the contextual-ad page from config.json + captures.
usage: python build_ad.py <workdir>      → <workdir>/dist/contextual-ad.html (+ assets beside it)
Needs ffmpeg/ffprobe on PATH. Stdlib only."""
import json, shutil, subprocess, sys, pathlib, re
HERE = pathlib.Path(__file__).resolve().parent; SKILL = HERE.parent
work = pathlib.Path(sys.argv[1]).resolve(); C = json.load(open(work / 'config.json', encoding='utf-8'))
dist = work / 'dist'; dist.mkdir(exist_ok=True)

def size(p):
    o = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(p)], capture_output=True, text=True).stdout.strip()
    w, h = o.split(',')[:2]; return int(w), int(h)

# frames + pages + fixed assets
for d in ['open', 'visual', 'object', 'ad']:
    if (dist / d).exists(): shutil.rmtree(dist / d)
    shutil.copytree(work / d, dist / d)
for f in ['home.png', 'results.png', 'watch.png']: shutil.copy(work / 'pages' / f, dist / f)
for f in ['laptop_black.png', 'mediakart.png']: shutil.copy(SKILL / 'assets' / f, dist / f)

def asset(rel):  # copy a brand asset into dist and return its published name
    if not rel: return None
    src = (work / rel); dst = dist / ('b_' + src.name); shutil.copy(src, dst); return dst.name
C['logo'] = asset(C.get('logo'))
if C.get('endcard'):
    E = C['endcard']; E['logo'] = asset(E.get('logo')) or C['logo']; E['packs'] = [asset(p) for p in E.get('packs', [])]

# geometry
C['pages'] = json.load(open(work / 'pages' / 'pages.json', encoding='utf-8'))
vw, vh = size(dist / 'visual' / '036.jpg'); C['video']['aspect'] = vw / vh
aw, ah = size(dist / 'ad' / '001.jpg'); C['video']['adAspect'] = aw / ah
C['ad']['frames'] = len(list((dist / 'ad').glob('*.jpg'))); C['ad']['seconds'] = C['ad']['frames'] / 25

# AI check list thumbnails: crop around each identify box (280x256 aspect), from the freeze frame
def thumb(src, box, out):
    x, y, w, h = box[0] * vw, box[1] * vh, box[2] * vw, box[3] * vh
    cx, cy = x + w / 2, y + h / 2; tw = max(w, h * 280 / 256) * 0.9; th = tw * 256 / 280
    tw, th = min(tw, vw), min(th, vh); x0 = min(max(0, cx - tw / 2), vw - tw); y0 = min(max(0, cy - th / 2), vh - th)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(src), '-vf', f'crop={int(tw)}:{int(th)}:{int(x0)}:{int(y0)},scale=280:256', '-q:v', '2', str(out)], check=True)
thumb(dist / 'visual' / '036.jpg', C['visual'].get('thumbBox', C['visual']['box']), dist / 'thumb_visual.jpg')
thumb(dist / 'object' / '036.jpg', C['object'].get('thumbBox', C['object']['box']), dist / 'thumb_object.jpg')

# page = template fragment with CFG, built by the engine
frag = open(SKILL / 'template' / 'contextual-ad.html', encoding='utf-8').read()
frag = frag.replace('/*__CFG__*/', 'window.CFG=' + json.dumps(C, ensure_ascii=False) + ';')
src = work / 'contextual-ad.frag.html'; open(src, 'w', encoding='utf-8').write(frag)
subprocess.run([sys.executable, str(SKILL / 'engine' / 'build.py'), str(dist), str(src)], check=True)
(dist / 'contextual-ad.frag.html').replace(dist / 'contextual-ad.html')
print('built', dist / 'contextual-ad.html')
