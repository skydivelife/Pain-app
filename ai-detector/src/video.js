'use strict';
// Video helpers built on ffprobe/ffmpeg (optional: without them, videos get
// byte-level checks only).
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function run(cmd, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout));
  });
}

async function hasFfmpeg() {
  try { await run('ffprobe', ['-version'], 5000); return true; } catch { return false; }
}

/** Container + stream tags, flattened, plus duration in seconds. */
async function probe(file) {
  const out = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(out);
  const tags = {};
  for (const [k, v] of Object.entries(j.format?.tags || {})) tags[k.toLowerCase()] = v;
  for (const s of j.streams || []) {
    for (const [k, v] of Object.entries(s.tags || {})) {
      const key = k.toLowerCase();
      if (!(key in tags) && !['language', 'creation_time'].includes(key)) tags[key] = v;
    }
  }
  const video = (j.streams || []).find((s) => s.codec_type === 'video');
  return {
    tags,
    duration: Number(j.format?.duration) || 0,
    width: video?.width || null,
    height: video?.height || null,
    hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio'),
  };
}

/** Extract `count` evenly spaced JPEG frames; returns their paths and a cleanup fn. */
async function extractFrames(file, duration, count = 4) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'frames-'));
  const frames = [];
  const span = duration > 0 ? duration : 1;
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) / count) * span;
    const out = path.join(dir, `f${i}.jpg`);
    try {
      await run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-q:v', '2', '-y', out]);
      await fs.access(out);
      frames.push({ path: out, time: t });
    } catch { /* past the end or undecodable */ }
  }
  return { frames, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

module.exports = { hasFfmpeg, probe, extractFrames };
