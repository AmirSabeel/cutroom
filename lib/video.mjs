import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
export function stopVideoWorkers() { for (const child of children) child.kill(); }
export const ffmpeg = process.env.FFMPEG_PATH || (existsSync(path.join(root, 'tools', 'ffmpeg.exe')) ? path.join(root, 'tools', 'ffmpeg.exe') : 'ffmpeg');

export function runVideo(args, { cwd = root, acceptFailure = false, timeout = 900000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let log = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.on('data', b => { log = (log + b).slice(-50000); });
    child.stderr.on('data', b => { log = (log + b).slice(-50000); });
    child.on('error', () => { clearTimeout(timer); reject(new Error('FFmpeg is not available. Install it or set FFMPEG_PATH.')); });
    child.on('close', code => {
      children.delete(child);
      clearTimeout(timer);
      if (timedOut) reject(new Error('Video processing timed out. Try a shorter video.'));
      else if (code !== 0 && !acceptFailure) { const error = new Error('Video processing failed. Check that the MP4 contains playable video and audio.'); error.detail = log; reject(error); }
      else resolve(log);
    });
  });
}

export async function inspectVideo(filename) {
  const log = await runVideo(['-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', filename], { acceptFailure: true, timeout: 30000 });
  const match = log.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const videoLine = log.split('\n').find(line => /Stream.*Video:/.test(line));
  if (!match || !videoLine) throw new Error('This file is not a readable MP4 video.');
  const duration = +match[1]*3600 + +match[2]*60 + +match[3];
  if (duration < 5 || duration > 600.5) throw new Error('Use a video between 5 seconds and 10 minutes.');
  return { duration, hasAudio: /Stream.*Audio:/.test(log) };
}

export function cropFilter(position = 50) {
  const p = Math.min(100, Math.max(0, Number(position))) / 100;
  return `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280:(iw-ow)*${p}:(ih-oh)/2,setsar=1`;
}

export async function renderClip(directory, clip, position) {
  const name = `clip-${clip.index}`;
  await runVideo(['-y', '-protocol_whitelist', 'file,pipe', '-ss', String(clip.start), '-f', 'mov', '-i', 'source.mp4', '-t', String(clip.end-clip.start), '-map', '0:v:0', '-map', '0:a:0?', '-vf', `${cropFilter(position)},ass=${name}.ass`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-threads', '2', '-r', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', `${name}.mp4`], { cwd: directory });
  await runVideo(['-y', '-ss', '0.5', '-i', `${name}.mp4`, '-frames:v', '1', '-vf', 'scale=360:640', `${name}.jpg`], { cwd: directory, timeout: 30000 });
}
