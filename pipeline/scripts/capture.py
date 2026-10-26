"""Capture everything a contextual-ad video needs, from config.json, in parallel.
usage: python capture.py <workdir>          (workdir holds config.json; outputs go next to it)

Captures (nothing is downloaded as a file; all are screenshots/recordings of the YouTube player):
  pages/   home.png, results.png, watch.png, pages.json   (search query typed + result + title phrase rects)
  open/    2.0 s from open.t           (51 frames @25fps)  — plays on the watch page
  visual/  visual.t-1.4 .. +1.6        (76 frames; 036.jpg is the Visual Identify freeze)
  object/  object.t-1.4 .. +1.4        (71 frames;  036.jpg is the Object Identify freeze)
  ad/      the whole ad at 25fps + ad_audio.webm (the ad's own soundtrack)
The three moments are recorded in real time (yt.js rec, ~10 s each, in parallel); if a stretch has an ad or buffers,
that one falls back to frame-by-frame seeks (seq). CAPTURE_SKIP_PAGES=1 / CAPTURE_SKIP_AD=1 leave those to the caller.
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
# the three moments: (name, start, seconds, frames)
MOMENTS = [('open', o, 2.0, 51), ('visual', v - 1.4, 3.0, 76), ('object', b - 1.4, 2.8, 71)]
rec_args = lambda d, t0, sec: ['rec', vid, str(work / f'rec_{d}.webm'), f'{t0:.2f}', f'{sec + 0.2:.2f}']
specs = []
if not os.environ.get('CAPTURE_SKIP_PAGES'):
    specs.insert(0, (['pages', vid, C['search']['query'], str(work / 'pages'), '|'.join(C['keywords']['phrases'])], 'cap_pages.log'))
if not os.environ.get('CAPTURE_SKIP_AD'):
    specs.append((['adrec', ad, str(work / 'ad_rec.webm')], 'cap_ad.log'))   # ad recorded in real time (video + sound)
    if (work / 'ad_rec.webm').exists() and (work / 'ad_rec.webm').stat().st_size > 100000:   # already recorded while the AI was picking
        specs = [s for s in specs if s[0][0] != 'adrec']; open(work / 'cap_ad.log', 'w').write('ad: reused prefetched recording\n')
# run at most CAPTURE_PARALLEL browsers at once (default: all six; use 2 on small servers)
par = int(os.environ.get('CAPTURE_PARALLEL', '6')); running = []
for args, log in specs:
    while len([j for j in running if j.poll() is None]) >= par: __import__('time').sleep(1)
    running.append(job(args, log))
# the three moments in real time; each one is checked as soon as it finishes — a stretch with an ad, buffering or a
# hole is recorded once more straight away, and only then captured frame by frame (slow, but always works)
import shutil, time
def frames_from_rec(d, n):
    rec_f = work / f'rec_{d}.webm'
    if (work / d).exists(): shutil.rmtree(work / d)
    (work / d).mkdir()
    lg = open(work / f'cap_{d}.log', encoding='utf-8', errors='replace').read()
    if rec_f.exists() and 'stalls 0' in lg and 'ad false' in lg:
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(rec_f), '-vf', 'fps=25,scale=1280:-2:flags=lanczos', '-frames:v', str(n), '-q:v', '2', str(work / d / '%03d.jpg')])
    return len(list((work / d).glob('*.jpg'))) >= n
state = {d: ['rec', job(rec_args(d, t0, sec), f'cap_{d}.log')] for d, t0, sec, n in MOMENTS}
while state:
    for d, t0, sec, n in MOMENTS:
        if d not in state or state[d][1].poll() is None: continue
        stage = state[d][0]
        if stage == 'seq' or frames_from_rec(d, n): del state[d]; continue
        shutil.copy(work / f'cap_{d}.log', work / f'cap_{d}.{stage}.log')
        state[d] = ['rec2', job(rec_args(d, t0, sec), f'cap_{d}.log')] if stage == 'rec' else ['seq', job(['seq', vid, str(work / d), f'{t0:.2f}', f'{t0 + sec:.2f}'], f'cap_{d}.log')]
    time.sleep(0.15)
for j in running: j.wait()
# ad recording → 25 fps frames for the player + its own soundtrack
rec = work / 'ad_rec.webm'
if rec.exists() and not os.environ.get('CAPTURE_SKIP_AD'):
    if (work / 'ad').exists(): shutil.rmtree(work / 'ad')
    (work / 'ad').mkdir()
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(rec), '-vf', 'fps=25,scale=1280:720:flags=lanczos', '-q:v', '3', str(work / 'ad' / '%03d.jpg')], check=True)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(rec), '-vn', '-c:a', 'copy', str(work / 'ad_audio.webm')], check=True)
    C['ad']['seconds'] = round(len(list((work / 'ad').glob('*.jpg'))) / 25, 2); json.dump(C, open(work / 'config.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
for log in ['cap_pages.log', 'cap_open.log', 'cap_visual.log', 'cap_object.log', 'cap_ad.log']:
    if not (work / log).exists(): continue
    print(f'--- {log}'); print(''.join(open(work / log, encoding='utf-8', errors='replace').readlines()[-4:]).strip())
need = {'open': 51, 'visual': 76, 'object': 71}
for d, n in need.items():
    got = len(list((work / d).glob('*.jpg'))); print(f'{d}: {got} frames', 'OK' if got >= n else f'MISSING (need {n}) — rerun this capture')
if (work / 'ad').exists(): print('ad frames:', len(list((work / 'ad').glob('*.jpg'))), '| ad audio:', (work / 'ad_audio.webm').exists())
