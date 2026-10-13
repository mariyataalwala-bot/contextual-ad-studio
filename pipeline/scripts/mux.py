"""Add sound: house music bed under the demo (fades out as the ad starts), then the ad's own soundtrack.
usage: python mux.py <video_noaudio.mp4> <ad_audio.webm|none> <out.mp4> [--no-music]
Reads <video_noaudio>.times.json (AD0, ADLEN, T) written by render.js."""
import json, subprocess, sys, pathlib
SKILL = pathlib.Path(__file__).resolve().parent.parent
v, aud, out = sys.argv[1:4]; music = '--no-music' not in sys.argv
tm = json.load(open(v[:-4] + '.times.json')); AD0, ADLEN, T = tm['AD0'], tm['ADLEN'], tm['T']
cmd = ['ffmpeg', '-loglevel', 'error', '-y', '-i', v]; parts = []; n = 1
if music:
    cmd += ['-stream_loop', '-1', '-i', str(SKILL / 'assets' / 'music_bed.m4a')]
    parts.append(f'[{n}:a]atrim=0:{AD0},asetpts=PTS-STARTPTS,afade=t=out:st={max(0, AD0 - 0.9)}:d=0.9,apad,atrim=0:{T}[m]'); n += 1
if aud != 'none':
    cmd += ['-i', aud]; d = int(AD0 * 1000)
    parts.append(f'[{n}:a]atrim=0:{ADLEN},asetpts=PTS-STARTPTS,afade=t=out:st={max(0, ADLEN - 0.3)}:d=0.3,adelay={d}|{d},apad,atrim=0:{T}[d]'); n += 1
labels = ('[m]' if music else '') + ('[d]' if aud != 'none' else '')
k = len(labels) // 3
if k == 0: parts.append(f'anullsrc=r=48000:cl=stereo,atrim=0:{T}[a]')
else: parts.append(f'{labels}amix=inputs={k}:normalize=0,alimiter=limit=0.95[a]')
cmd += ['-filter_complex', ';'.join(parts), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', str(T), '-movflags', '+faststart', out]
subprocess.run(cmd, check=True); print('wrote', out)
