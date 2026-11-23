'use strict';
// Sightengine "genai" model: a trained classifier for AI-generated images.
// https://sightengine.com/docs/ai-generated-image-detection
const fs = require('node:fs/promises');

const ENDPOINT = 'https://api.sightengine.com/1.0/check.json';

function configured() {
  return Boolean(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET);
}

/** Returns probability (0..1) that the image at `filePath` is AI-generated. */
async function scoreImage(filePath, mime = 'image/jpeg') {
  const form = new FormData();
  form.append('media', new Blob([await fs.readFile(filePath)], { type: mime }), 'upload');
  form.append('models', 'genai');
  form.append('api_user', process.env.SIGHTENGINE_API_USER);
  form.append('api_secret', process.env.SIGHTENGINE_API_SECRET);
  const res = await fetch(ENDPOINT, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (j.status !== 'success' || typeof j.type?.ai_generated !== 'number') {
    throw new Error(`Sightengine error: ${j.error?.message || res.status}`);
  }
  return j.type.ai_generated;
}

module.exports = { name: 'Sightengine', configured, scoreImage };
