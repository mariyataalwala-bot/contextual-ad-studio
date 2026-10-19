"""Capture everything a contextual-ad video needs, from config.json, in parallel.
usage: python capture.py <workdir>          (workdir holds config.json; outputs go next to it)

Captures (nothing is downloaded as a file; all are screenshots/recordings of the YouTube player):
  pages/   home.png, results.png, watch.png, pages.json   (search query typed + result + title phrase rects)
  open/    2.0 s from open.t           (51 frames @25fps)  — plays on the watch page
  visual/  visual.t-1.4 .. +1.6        (76 frames; 036.jpg is the Visual Identify freeze)
  object/  object.t-1.4 .. +1.4        (71 frames;  036.jpg is the Object Identify freeze)
  ad/      the whole ad at 25fps + ad_audio.webm (the ad's own soundtrack)
"""
import json, os, subprocess, sys, pathlib
HERE = pathlib.Path(__file__).resolve().parent
SKILL = HERE.parent
work = pathlib.Path(sys.argv[1]).resolve(); C = json.load(open(work / 'config.json', encoding='utf-8'))
env = dict(os.environ); env.setdefault('NODE_PATH', str(SKILL / 'node_modules'))
YT = ['node', str(HERE / 'yt.js')]
def job(args, log):
    return subprocess.Popen(YT + args, stdout=open(work / log, 'w'), stderr=subprocess.STDOUT, env=env)

vid, ad = C['video']['id'], C['ad']['id']
if 'seconds' not in C['ad']:
    meta = json.loads(subprocess.run(YT + ['meta', ad], capture_output=True, text=True, env=env).stdout)
    C['ad']['seconds'] = float(meta['length']); json.dump(C, open(work / 'config.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
ads = C['ad']['seconds']
o, v, b = C['open']['t'], C['visual']['t'], C['object']['t']
specs = [
    (['pages', vid, C['search']['query'], str(work / 'pages'), '|'.join(C['keywords']['phrases'])], 'cap_pages.log'),
    (['seq', vid, str(work / 'open'), f'{o:.2f}', f'{o + 2.0:.2f}'], 'cap_open.log'),
    (['seq', vid, str(work / 'visual'), f'{v - 1.4:.2f}', f'{v + 1.6:.2f}'], 'cap_visual.log'),   # 76 frames (all the template uses)
    (['seq', vid, str(work / 'object'), f'{b - 1.4:.2f}', f'{b + 1.4:.2f}'], 'cap_object.log'),
    (['adrec', ad, str(work / 'ad_rec.webm')], 'cap_ad.log'),   # ad recorded in real time (video + sound)
]
if (work / 'ad_rec.webm').exists() and (work / 'ad_rec.webm').stat().st_size > 100000:   # already recorded while the AI was picking
    specs = [s for s in specs if s[0][0] != 'adrec']; open(work / 'cap_ad.log', 'w').write('ad: reused prefetched recording\n')
# run at most CAPTURE_PARALLEL browsers at once (default: all six; use 2 on small servers)
par = int(os.environ.get('CAPTURE_PARALLEL', '6')); running = []
for args, log in specs:
    while len([j for j in running if j.poll() is None]) >= par: __import__('time').sleep(1)
    running.append(job(args, log))
for j in running: j.wait()
# ad recording → 25 fps frames for the player + its own soundtrack
import shutil
rec = work / 'ad_rec.webm'
if rec.exists():
    if (work / 'ad').exists(): shutil.rmtree(work / 'ad')
    (work / 'ad').mkdir()
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(rec), '-vf', 'fps=25,scale=1280:720:flags=lanczos', '-q:v', '3', str(work / 'ad' / '%03d.jpg')], check=True)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(rec), '-vn', '-c:a', 'copy', str(work / 'ad_audio.webm')], check=True)
    C['ad']['seconds'] = round(len(list((work / 'ad').glob('*.jpg'))) / 25, 2); json.dump(C, open(work / 'config.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
for log in ['cap_pages.log', 'cap_open.log', 'cap_visual.log', 'cap_object.log', 'cap_ad.log']:
    print(f'--- {log}'); print(''.join(open(work / log, encoding='utf-8', errors='replace').readlines()[-4:]).strip())
need = {'open': 51, 'visual': 76, 'object': 71}
for d, n in need.items():
    got = len(list((work / d).glob('*.jpg'))); print(f'{d}: {got} frames', 'OK' if got >= n else f'MISSING (need {n}) — rerun this capture')
print('ad frames:', len(list((work / 'ad').glob('*.jpg'))), '| ad audio:', (work / 'ad_audio.webm').exists())
