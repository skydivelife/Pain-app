'use strict';
// Local, free forensic checks. These read the file's own bytes: embedded
// provenance (C2PA / IPTC), generator metadata, camera EXIF and dimensions.
// They never prove a file is authentic (metadata is easy to strip or forge),
// but some of them prove a file is AI-generated with near certainty.

const zlib = require('node:zlib');

// Generator names searched in parsed metadata text (case-insensitive, word-bounded).
const GENERATORS = [
  ['Midjourney', /\bmidjourney\b/i],
  ['DALL·E', /\bdall[\s·\-–]?e\b|\bdalle\b/i],
  ['OpenAI', /\bopenai\b|\bchatgpt\b|\bgpt-4o\b|\bgpt-image\b/i],
  ['Stable Diffusion', /\bstable[\s_-]?diffusion\b|\bsdxl\b/i],
  ['Adobe Firefly', /\bfirefly\b/i],
  ['Google Imagen / Gemini', /\bimagen\b|\bgemini\b|\bnano[\s-]?banana\b/i],
  ['Flux', /\bflux(\.1)?[\s_-]?(dev|pro|schnell|kontext)\b|black forest labs/i],
  ['ComfyUI', /\bcomfyui\b/i],
  ['Automatic1111 / Forge', /\bautomatic1111\b|\bsd-webui\b/i],
  ['NovelAI', /\bnovelai\b/i],
  ['Leonardo.Ai', /\bleonardo\.?ai\b/i],
  ['Ideogram', /\bideogram\b/i],
  ['Microsoft Designer / Bing', /\bbing image creator\b|\bmicrosoft designer\b|Microsoft_Responsible_AI/i],
  ['Grok / Aurora', /\bgrok\b|\bxai aurora\b/i],
  ['Sora', /\bsora\b/i],
  ['Google Veo', /\bveo\s?\d?\b/i],
  ['Runway', /\brunway(ml)?\b|\bgen-[234]\b/i],
  ['Pika', /\bpika\s?(labs|art)?\b/i],
  ['Kling', /\bkling\b/i],
  ['Luma Dream Machine', /\bdream machine\b|\bluma ai\b|\blumalabs\b/i],
  ['Hailuo / MiniMax', /\bhailuo\b|\bminimax\b/i],
  ['Recraft', /\brecraft\b/i],
  ['Krea', /\bkrea\b/i],
];

// Long, distinctive byte strings safe to look for anywhere in the raw file.
const RAW_MARKERS = {
  trainedAI: 'trainedAlgorithmicMedia',
  compositeAI: 'compositeWithTrainedAlgorithmicMedia',
  synthetic: 'compositeSynthetic',
  digitalCapture: 'digitalsourcetype/digitalCapture',
  c2pa: 'c2pa.actions',
  c2paClaim: 'c2pa.claim',
};

// Output sizes common to image generators (and rare from real cameras).
const GENERATOR_SIZES = new Set([
  '512x512', '768x768', '1024x1024', '2048x2048', '1152x896', '896x1152', '1216x832',
  '832x1216', '1344x768', '768x1344', '1536x640', '640x1536', '1792x1024', '1024x1792',
  '1536x1024', '1024x1536', '1456x816', '816x1456', '1232x928', '928x1232', '1664x928',
  '928x1664', '1472x1104', '1104x1472', '1584x1056', '1056x1584', '1280x720', '720x1280',
]);

function detectType(buf) {
  if (buf.length < 12) return 'unknown';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a') return 'gif';
  const box = buf.toString('latin1', 4, 12);
  if (box.startsWith('ftyp')) {
    const brand = buf.toString('latin1', 8, 12);
    if (/^(heic|heix|mif1|msf1|hevc)$/.test(brand)) return 'heic';
    if (/^avi[fs]$/.test(brand)) return 'avif';
    return 'mp4';
  }
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  return 'unknown';
}

// ---------- TIFF / EXIF ----------
function parseTiff(buf) {
  const out = {};
  if (buf.length < 8) return out;
  const le = buf.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const TAGS = {
    0x010e: 'ImageDescription', 0x010f: 'Make', 0x0110: 'Model', 0x0131: 'Software',
    0x013b: 'Artist', 0x8298: 'Copyright', 0x9003: 'DateTimeOriginal', 0xa434: 'LensModel',
    0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8827: 'ISO', 0x920a: 'FocalLength',
    0x9286: 'UserComment',
  };
  const seen = new Set();
  const readIfd = (off) => {
    if (!off || seen.has(off) || off + 2 > buf.length) return;
    seen.add(off);
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > buf.length) return;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (tag === 0x8769) { readIfd(u32(e + 8)); continue; } // Exif sub-IFD
      const name = TAGS[tag];
      if (!name) continue;
      if (type === 2 || type === 7) { // ASCII / UNDEFINED
        const start = count <= 4 ? e + 8 : u32(e + 8);
        if (start + count > buf.length) continue;
        let s = buf.toString('latin1', start, start + count).replace(/\0+$/, '');
        if (name === 'UserComment') s = s.replace(/^(ASCII|UNICODE)\0*/, '').replace(/\0/g, '');
        out[name] = s.trim();
      } else {
        out[name] = true; // numeric value present; presence is all we use
      }
    }
  };
  try { readIfd(u32(4)); } catch { /* truncated EXIF */ }
  return out;
}

// ---------- container parsers ----------
function parseJpeg(buf, meta) {
  let o = 2;
  while (o + 4 <= buf.length) {
    if (buf[o] !== 0xff) { o++; continue; }
    const marker = buf[o + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end
    const len = buf.readUInt16BE(o + 2);
    const seg = buf.subarray(o + 4, o + 2 + len);
    if (marker === 0xe1 && seg.toString('latin1', 0, 6) === 'Exif\0\0') {
      Object.assign(meta.exif, parseTiff(seg.subarray(6)));
    } else if (marker === 0xe1 && seg.toString('latin1', 0, 28).startsWith('http://ns.adobe.com/xap/1.0/')) {
      meta.xmp += seg.toString('utf8');
    } else if (marker === 0xeb) {
      meta.c2pa = true;
      meta.c2paText += seg.toString('latin1');
    } else if (marker === 0xfe) {
      meta.text.Comment = seg.toString('utf8');
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      meta.height = seg.readUInt16BE(1);
      meta.width = seg.readUInt16BE(3);
    }
    o += 2 + len;
  }
}

function parsePng(buf, meta) {
  let o = 8;
  while (o + 12 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    try {
      if (type === 'IHDR') {
        meta.width = data.readUInt32BE(0);
        meta.height = data.readUInt32BE(4);
      } else if (type === 'tEXt') {
        const z = data.indexOf(0);
        meta.text[data.toString('latin1', 0, z)] = data.toString('latin1', z + 1);
      } else if (type === 'zTXt') {
        const z = data.indexOf(0);
        meta.text[data.toString('latin1', 0, z)] = zlib.inflateSync(data.subarray(z + 2)).toString('latin1');
      } else if (type === 'iTXt') {
        const z = data.indexOf(0);
        const key = data.toString('latin1', 0, z);
        const compressed = data[z + 1] === 1;
        let p = data.indexOf(0, z + 3); // end of language tag
        p = data.indexOf(0, p + 1); // end of translated keyword
        const body = data.subarray(p + 1);
        const txt = (compressed ? zlib.inflateSync(body) : body).toString('utf8');
        if (key === 'XML:com.adobe.xmp') meta.xmp += txt; else meta.text[key] = txt;
      } else if (type === 'eXIf') {
        Object.assign(meta.exif, parseTiff(data));
      } else if (type === 'caBX') {
        meta.c2pa = true;
        meta.c2paText += data.toString('latin1');
      }
    } catch { /* malformed chunk: skip */ }
    if (type === 'IEND') break;
    o += 12 + len;
  }
}

function parseWebp(buf, meta) {
  let o = 12;
  while (o + 8 <= buf.length) {
    const type = buf.toString('latin1', o, o + 4);
    const len = buf.readUInt32LE(o + 4);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'VP8X' && data.length >= 10) {
      meta.width = 1 + data.readUIntLE(4, 3);
      meta.height = 1 + data.readUIntLE(7, 3);
    } else if (type === 'VP8 ' && data.length >= 10) {
      meta.width = data.readUInt16LE(6) & 0x3fff;
      meta.height = data.readUInt16LE(8) & 0x3fff;
    } else if (type === 'VP8L' && data.length >= 5) {
      const b = data.readUInt32LE(1);
      meta.width = (b & 0x3fff) + 1;
      meta.height = ((b >> 14) & 0x3fff) + 1;
    } else if (type === 'EXIF') {
      const start = data.toString('latin1', 0, 6) === 'Exif\0\0' ? 6 : 0;
      Object.assign(meta.exif, parseTiff(data.subarray(start)));
    } else if (type === 'XMP ') {
      meta.xmp += data.toString('utf8');
    } else if (type === 'C2PA') {
      meta.c2pa = true;
      meta.c2paText += data.toString('latin1');
    }
    o += 8 + len + (len & 1);
  }
}

// Scan the head and tail of large files (MP4 metadata often sits at the end).
function rawScanText(buf) {
  const LIMIT = 8 * 1024 * 1024;
  if (buf.length <= LIMIT * 2) return buf.toString('latin1');
  return buf.toString('latin1', 0, LIMIT) + buf.toString('latin1', buf.length - LIMIT);
}

/**
 * Analyse a file's bytes. `extraTags` lets callers pass container tags
 * (e.g. from ffprobe for video) to be included in the metadata text.
 */
function analyzeBuffer(buf, { extraTags = {} } = {}) {
  const type = detectType(buf);
  const meta = { type, width: null, height: null, exif: {}, xmp: '', text: {}, c2pa: false, c2paText: '' };
  try {
    if (type === 'jpeg') parseJpeg(buf, meta);
    else if (type === 'png') parsePng(buf, meta);
    else if (type === 'webp') parseWebp(buf, meta);
  } catch { /* fall through to raw scanning */ }

  const raw = rawScanText(buf);
  const has = (k) => raw.includes(RAW_MARKERS[k]) || meta.xmp.includes(RAW_MARKERS[k]);
  if (!meta.c2pa && (has('c2pa') || has('c2paClaim'))) meta.c2pa = true;

  const signals = [];
  const add = (s) => signals.push(s);

  // 1. Industry provenance labels (IPTC DigitalSourceType, used inside XMP and C2PA).
  if (has('trainedAI')) {
    add({ id: 'iptc_ai', direction: 'ai', strength: 'strong', label: 'Embedded "AI-generated" label',
      detail: 'The file carries the IPTC digital-source-type "trainedAlgorithmicMedia", the industry tag that OpenAI, Google, Adobe, Meta and others write into AI-generated media.' });
  } else if (has('compositeAI') || has('synthetic')) {
    add({ id: 'iptc_ai_edit', direction: 'ai', strength: 'moderate', label: 'Embedded "AI-edited" label',
      detail: 'The file is tagged as a composite that includes AI-generated elements (e.g. generative fill or AI editing).' });
  }
  if (has('digitalCapture') && !has('trainedAI')) {
    add({ id: 'iptc_capture', direction: 'real', strength: meta.c2pa ? 'strong' : 'moderate', label: 'Declared as a camera capture',
      detail: meta.c2pa
        ? 'Signed C2PA content credentials declare this was captured by a camera ("digitalCapture").'
        : 'Metadata declares this as a camera capture ("digitalCapture"). This tag is unsigned and could be edited.' });
  }
  if (meta.c2pa) {
    add({ id: 'c2pa', direction: 'info', strength: 'info', label: 'Content Credentials (C2PA) present',
      detail: 'The file contains a C2PA provenance manifest. You can inspect it in full at contentcredentials.org/verify.' });
  }

  // 2. Generator names and generation parameters in metadata.
  const textBlob = [
    ...Object.entries(meta.text).map(([k, v]) => `${k}: ${v}`),
    ...['Software', 'Artist', 'ImageDescription', 'UserComment', 'Make', 'Model', 'Copyright']
      .filter((k) => typeof meta.exif[k] === 'string').map((k) => `${k}: ${meta.exif[k]}`),
    meta.xmp, meta.c2paText,
    ...Object.entries(extraTags).map(([k, v]) => `${k}: ${v}`),
  ].join('\n');

  const found = GENERATORS.filter(([, re]) => re.test(textBlob)).map(([name]) => name);
  if (found.length) {
    add({ id: 'generator_name', direction: 'ai', strength: 'strong', label: `Generator named in metadata: ${found.join(', ')}`,
      detail: 'The file\'s metadata names an AI image/video generator as the software that produced or edited it.' });
  }
  const sdParams = meta.text.parameters && /Steps:\s*\d+.*Sampler:/s.test(meta.text.parameters);
  const comfy = meta.text.prompt && meta.text.workflow;
  const dream = meta.text.Dream || meta.text['sd-metadata'] || meta.text.invokeai_metadata;
  if (sdParams || comfy || dream) {
    add({ id: 'gen_params', direction: 'ai', strength: 'strong', label: 'Diffusion-model generation settings embedded',
      detail: 'The image contains prompt / sampler / seed settings written by Stable Diffusion tools (A1111, ComfyUI, InvokeAI). Real photos never contain these.' });
  }

  // 3. Camera evidence.
  const ex = meta.exif;
  const cameraFields = ['Make', 'Model', 'DateTimeOriginal', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'LensModel']
    .filter((k) => ex[k]);
  const videoCamera = extraTags['com.apple.quicktime.make'] || extraTags['com.android.manufacturer'] || extraTags.make;
  if (!found.length && cameraFields.length >= 4) {
    add({ id: 'camera_exif', direction: 'real', strength: 'moderate', label: `Camera metadata: ${[ex.Make, ex.Model].filter(Boolean).join(' ') || 'present'}`,
      detail: `Found ${cameraFields.length} camera fields (${cameraFields.join(', ')}). Typical of an unedited photo, though EXIF can be copied onto a fake.` });
  } else if (!found.length && videoCamera) {
    add({ id: 'camera_video', direction: 'real', strength: 'moderate', label: `Recorded on a device: ${[videoCamera, extraTags['com.apple.quicktime.model'] || extraTags.model].filter(Boolean).join(' ')}`,
      detail: 'Container metadata records the phone/camera that recorded this video. It can be forged, but AI video tools do not write it.' });
  }

  // 4. Dimensions typical of generators.
  if (meta.width && meta.height && !cameraFields.length) {
    const key = `${meta.width}x${meta.height}`;
    if (GENERATOR_SIZES.has(key) || (meta.width % 64 === 0 && meta.height % 64 === 0 && meta.width === meta.height)) {
      add({ id: 'gen_size', direction: 'ai', strength: 'weak', label: `Generator-typical size (${key})`,
        detail: 'These dimensions are a default output size for popular generators. Many real images share them too, so this is a weak hint only.' });
    }
  }

  // 5. Nothing to go on.
  const isImage = ['jpeg', 'png', 'webp', 'gif', 'heic', 'avif'].includes(type);
  if (isImage && !meta.c2pa && !cameraFields.length && !meta.xmp && !Object.keys(meta.text).length && !found.length) {
    add({ id: 'stripped', direction: 'info', strength: 'info', label: 'Metadata stripped',
      detail: 'No camera or provenance metadata. Common for screenshots and social-media re-uploads, so it is not evidence either way.' });
  }

  return {
    type,
    width: meta.width,
    height: meta.height,
    camera: [ex.Make, ex.Model].filter((v) => typeof v === 'string').join(' ') || null,
    software: typeof ex.Software === 'string' ? ex.Software : null,
    c2pa: meta.c2pa,
    signals,
  };
}

module.exports = { analyzeBuffer, detectType, parseTiff, GENERATORS };
