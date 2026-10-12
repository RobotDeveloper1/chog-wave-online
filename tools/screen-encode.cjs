// Turns a GIF or an MP4 into a light WebM that the city's screens play. The result goes into
// client/public/screens/ with the same name and a .webm extension; then add that name to playlist.json.
//
//   node tools/screen-encode.cjs clip.gif            (640 px wide)
//   node tools/screen-encode.cjs clip.mp4 480        (480 px wide)
//
// Needs ffmpeg. Set FFMPEG to its path if it is not on PATH:
//   FFMPEG="C:/path/to/ffmpeg.exe" node tools/screen-encode.cjs clip.mp4
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [input, widthArg] = process.argv.slice(2);
if (!input) {
  console.error('uso: node tools/screen-encode.cjs arquivo.gif|arquivo.mp4 [largura]');
  process.exit(1);
}
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const width = Number(widthArg) || 640;
const outDir = path.join(__dirname, '..', 'client', 'public', 'screens');
const out = path.join(outDir, path.basename(input).replace(/\.[^.]+$/, '') + '.webm');

const args = [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', path.resolve(input),
  '-vf', `scale=${width}:-2:flags=lanczos,fps=24`,
  '-an',
  '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1',
  out,
];
const r = spawnSync(ffmpeg, args, { stdio: 'inherit' });
if (r.error) {
  console.error(`não achei o ffmpeg (${ffmpeg}): ${r.error.message}`);
  process.exit(1);
}
if (r.status === 0) console.log(`pronto: ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`);
process.exit(r.status ?? 1);
