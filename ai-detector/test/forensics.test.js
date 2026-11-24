'use strict';
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { analyzeBuffer } = require('../src/forensics');
const { combine } = require('../src/verdict');

// --- tiny file builders ---
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, textChunks = []) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    ...textChunks.map(([k, v]) => chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1'))),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(10))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function tiff(entries) { // ASCII entries only, little-endian, IFD0
  const n = entries.length, head = 8, ifdLen = 2 + n * 12 + 4;
  let dataOff = head + ifdLen; const parts = []; const ifd = Buffer.alloc(ifdLen);
  ifd.writeUInt16LE(n, 0);
  entries.forEach(([tag, str], i) => {
    const s = Buffer.from(str + '\0', 'latin1'); const e = 2 + i * 12;
    ifd.writeUInt16LE(tag, e); ifd.writeUInt16LE(2, e + 2); ifd.writeUInt32LE(s.length, e + 4);
    if (s.length <= 4) s.copy(ifd, e + 8); else { ifd.writeUInt32LE(dataOff, e + 8); parts.push(s); dataOff += s.length; }
  });
  return Buffer.concat([Buffer.from('II*\0\x08\0\0\0', 'latin1'), ifd, ...parts]);
}
function jpeg({ w = 4032, h = 3024, exif, xmp } = {}) {
  const seg = (m, d) => { const l = Buffer.alloc(2); l.writeUInt16BE(d.length + 2); return Buffer.concat([Buffer.from([0xff, m]), l, d]); };
  const sof = Buffer.alloc(6); sof[0] = 8; sof.writeUInt16BE(h, 1); sof.writeUInt16BE(w, 3); sof[5] = 0;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...(exif ? [seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff(exif)]))] : []),
    ...(xmp ? [seg(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0${xmp}`, 'utf8'))] : []),
    seg(0xc0, sof), Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9]),
  ]);
}
const ids = (r) => r.signals.map((s) => s.id);

test('Stable Diffusion parameters in PNG are detected as AI', () => {
  const r = analyzeBuffer(png(1024, 1024, [['parameters', 'a cat\nSteps: 30, Sampler: DPM++ 2M, CFG scale: 7, Seed: 1']]));
  assert.equal(r.type, 'png'); assert.equal(r.width, 1024);
  assert.ok(ids(r).includes('gen_params'));
  assert.match(combine({ signals: r.signals }).label, /confirmed/);
});

test('ComfyUI workflow is detected', () => {
  const r = analyzeBuffer(png(832, 1216, [['prompt', '{}'], ['workflow', '{"nodes":[]}']]));
  assert.ok(ids(r).includes('gen_params'));
});

test('IPTC trainedAlgorithmicMedia in XMP is detected', () => {
  const xmp = '<x:xmpmeta><rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/></x:xmpmeta>';
  const r = analyzeBuffer(jpeg({ w: 1024, h: 1024, xmp }));
  assert.ok(ids(r).includes('iptc_ai'));
});

test('Generator in EXIF Software tag is detected', () => {
  const r = analyzeBuffer(jpeg({ w: 1456, h: 816, exif: [[0x0131, 'Midjourney v6']] }));
  assert.ok(ids(r).includes('generator_name'));
  assert.equal(r.software, 'Midjourney v6');
});

test('Camera EXIF points toward real', () => {
  const r = analyzeBuffer(jpeg({ exif: [[0x010f, 'Apple'], [0x0110, 'iPhone 15 Pro'], [0x0131, '17.1'], [0x9003, '2024:05:01 10:00:00'], [0xa434, 'iPhone 15 Pro back camera']] }));
  assert.equal(r.camera, 'Apple iPhone 15 Pro');
  assert.ok(ids(r).includes('camera_exif'));
  assert.ok(!ids(r).includes('gen_size'));
  assert.ok(combine({ modelScore: 0.3, signals: r.signals }).score < 0.3);
});

test('Stripped image with no model is inconclusive, not a false accusation', () => {
  const r = analyzeBuffer(jpeg({ w: 1200, h: 900 }));
  assert.ok(ids(r).includes('stripped'));
  const v = combine({ signals: r.signals });
  assert.equal(v.label, 'Inconclusive'); assert.equal(v.confidence, 'low');
});

test('Short generator names are not matched inside random bytes', () => {
  const noise = Buffer.from('xxSORAxxveoxxKLINGxx', 'latin1'); // raw bytes, not metadata
  const r = analyzeBuffer(Buffer.concat([jpeg({ w: 1200, h: 900 }), noise]));
  assert.ok(!ids(r).includes('generator_name'));
});

test('Video container tags naming a generator are detected', () => {
  const r = analyzeBuffer(Buffer.from('\0\0\0\x18ftypmp42' + '\0'.repeat(64), 'latin1'), { extraTags: { encoder: 'Google Veo 3' } });
  assert.equal(r.type, 'mp4');
  assert.ok(ids(r).includes('generator_name'));
});

test('Verdict follows the model when there is no metadata', () => {
  assert.equal(combine({ modelScore: 0.97, signals: [] }).label, 'Likely AI-generated');
  assert.equal(combine({ modelScore: 0.03, signals: [] }).label, 'Likely authentic');
  assert.equal(combine({ modelScore: 0.5, signals: [] }).label, 'Inconclusive');
});

test('A weak size hint alone stays inconclusive', () => {
  const r = analyzeBuffer(jpeg({ w: 1024, h: 1024 }));
  assert.equal(combine({ signals: r.signals }).label, 'Inconclusive');
});

test('Camera brand is not repeated when the model already includes it', () => {
  const r = analyzeBuffer(jpeg({ exif: [[0x010f, 'Canon'], [0x0110, 'Canon EOS R6']] }));
  assert.equal(r.camera, 'Canon EOS R6');
});
