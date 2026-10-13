"""Contact sheet of stills for picking moments.
usage: python sheet.py <dir> <out.png> [cols=6] [glob='f_*.png']
Prints the file order (row by row) so a tile can be mapped back to its timestamp (f_00810.png = 81.0 s)."""
import subprocess, sys, pathlib, math
d = pathlib.Path(sys.argv[1]); out = sys.argv[2]; cols = int(sys.argv[3]) if len(sys.argv) > 3 else 6
pat = sys.argv[4] if len(sys.argv) > 4 else 'f_*.png'
fs = sorted(d.glob(pat))
rows = math.ceil(len(fs) / cols); fs_pad = fs + [fs[-1]] * (rows * cols - len(fs))
args = []; [args.extend(['-i', str(f)]) for f in fs_pad]
fc = ''.join(f'[{i}]scale=320:180[s{i}];' for i in range(len(fs_pad))) + ''.join(f'[s{i}]' for i in range(len(fs_pad))) + f'xstack=inputs={len(fs_pad)}:grid={cols}x{rows}'
if len(fs_pad) == 1: fc = '[0]scale=320:180'
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *args, '-filter_complex', fc, out], check=True)
for r in range(rows): print(f'row {r + 1}:', ' '.join(f.stem for f in fs[r * cols:(r + 1) * cols]))
