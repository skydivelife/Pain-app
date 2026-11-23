'use strict';
const fs = require('node:fs/promises');
const { analyzeBuffer } = require('./forensics');
const video = require('./video');
const providers = require('./providers');
const { combine } = require('./verdict');

const VIDEO_FRAMES = Number(process.env.VIDEO_FRAMES || 4);

async function analyzeImage(filePath, mime) {
  const buf = await fs.readFile(filePath);
  const forensics = analyzeBuffer(buf);
  const provider = providers.active();
  let modelScore = null, modelError = null;
  if (provider) {
    try { modelScore = await provider.scoreImage(filePath, mime); }
    catch (e) { modelError = e.message; }
  }
  return finish('image', forensics, provider, modelScore, modelError);
}

async function analyzeVideo(filePath) {
  const buf = await fs.readFile(filePath);
  const ff = await video.hasFfmpeg();
  let info = null;
  if (ff) { try { info = await video.probe(filePath); } catch { /* unreadable container */ } }
  const forensics = analyzeBuffer(buf, { extraTags: info?.tags || {} });
  if (info) Object.assign(forensics, { width: info.width, height: info.height, duration: info.duration });

  const provider = providers.active();
  let modelScore = null, modelError = null, frames = [];
  if (provider && ff && info) {
    const { frames: extracted, cleanup } = await video.extractFrames(filePath, info.duration, VIDEO_FRAMES);
    try {
      for (const f of extracted) {
        try { frames.push({ time: Math.round(f.time * 10) / 10, score: await provider.scoreImage(f.path) }); }
        catch (e) { modelError = e.message; }
      }
    } finally { await cleanup(); }
    if (frames.length) {
      // Blend mean and max: a few clearly synthetic frames should count even if others look clean.
      const scores = frames.map((f) => f.score);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      modelScore = 0.6 * mean + 0.4 * Math.max(...scores);
    }
  } else if (provider && !ff) {
    modelError = 'ffmpeg not installed on server; video frames were not analysed';
  }
  return { ...finish('video', forensics, provider, modelScore, modelError), frames };
}

function finish(kind, forensics, provider, modelScore, modelError) {
  const verdict = combine({ modelScore, signals: forensics.signals });
  return {
    kind,
    verdict,
    model: provider ? { name: provider.name, score: modelScore, error: modelError } : null,
    file: { type: forensics.type, width: forensics.width, height: forensics.height,
      duration: forensics.duration ?? null, camera: forensics.camera, software: forensics.software, c2pa: forensics.c2pa },
    signals: forensics.signals,
  };
}

module.exports = { analyzeImage, analyzeVideo };
