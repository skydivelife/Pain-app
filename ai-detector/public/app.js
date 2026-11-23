'use strict';
const $ = (id) => document.getElementById(id);
let me = null;
let chosen = null;

const fmtMoney = (cents) => `$${(cents / 100).toFixed(2)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opts = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status, body });
  return body;
}

function setCredits(n) {
  me.credits = n;
  $('creditsBtn').textContent = `${n} credit${n === 1 ? '' : 's'}`;
}

async function loadMe() {
  me = await api('/api/me');
  setCredits(me.credits);
  $('acctKey').textContent = me.accountKey;
  $('videoCost').textContent = me.costs.video;
  $('costNote').textContent = `Image: ${me.costs.image} credit · Video: ${me.costs.video} credits`;
  const per = me.packs.map((p) => p.cents / p.credits);
  $('packs').innerHTML = me.packs.map((p, i) => `
    <div class="pack ${i === 1 ? 'best' : ''}">
      <strong>${esc(p.name)}</strong>
      <div class="price">${fmtMoney(p.cents)}</div>
      <div class="per">${fmtMoney(per[i])} per image scan${i > 0 ? ` · save ${Math.round((1 - per[i] / per[0]) * 100)}%` : ''}</div>
      <button class="${i === 1 ? 'primary' : ''}" data-pack="${esc(p.id)}">Buy</button>
    </div>`).join('');
  $('payNote').textContent = me.paymentsEnabled ? 'Secure checkout by Stripe. Credits never expire.' : 'Payments are not configured on this server yet.';
  if (!me.modelEnabled) $('payNote').textContent += ' (Note: AI model not configured — running forensic checks only.)';
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

function choose(file) {
  if (!file) return;
  if (!/^(image|video)\//.test(file.type)) return showError('Please choose an image or video file.');
  showError('');
  chosen = file;
  const url = URL.createObjectURL(file);
  const media = file.type.startsWith('video/') ? `<video src="${url}" controls muted playsinline></video>` : `<img src="${url}" alt="">`;
  $('preview').innerHTML = `${media}<div class="name">${esc(file.name)} · ${(file.size / 1048576).toFixed(1)} MB</div>`;
  $('preview').hidden = false;
  $('dropInner').hidden = true;
  $('analyzeBtn').disabled = false;
  $('resetBtn').hidden = false;
  $('result').hidden = true;
}

function reset() {
  chosen = null;
  $('file').value = '';
  $('preview').hidden = true;
  $('preview').innerHTML = '';
  $('dropInner').hidden = false;
  $('analyzeBtn').disabled = true;
  $('resetBtn').hidden = true;
  $('result').hidden = true;
  showError('');
}

async function analyze() {
  if (!chosen) return;
  showError('');
  const btn = $('analyzeBtn');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Analyzing…`;
  try {
    const form = new FormData();
    form.append('file', chosen);
    const r = await api('/api/analyze', { method: 'POST', body: form });
    setCredits(r.credits);
    render(r);
  } catch (e) {
    if (e.status === 402) {
      showError(`You need ${e.body.needed} credit${e.body.needed === 1 ? '' : 's'} for this scan. Pick a pack below.`);
      $('pricing').scrollIntoView({ behavior: 'smooth' });
    } else showError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze';
  }
}

function render(r) {
  const pct = Math.round(r.verdict.score * 100);
  const color = pct >= 60 ? 'var(--ai)' : pct <= 40 ? 'var(--real)' : 'var(--warn)';
  $('meter').style.setProperty('--p', pct);
  $('meter').style.setProperty('--c', color);
  $('meterVal').textContent = `${pct}%`;
  $('verdictLabel').textContent = r.verdict.label;
  $('verdictLabel').style.color = color;

  const sub = [`Confidence: ${r.verdict.confidence}`];
  if (r.model?.score != null) sub.push(`${r.model.name} model: ${Math.round(r.model.score * 100)}% AI`);
  else if (r.model?.error) sub.push(`Model unavailable — you were not charged`);
  else if (!r.model) sub.push('Forensic checks only');
  $('verdictSub').textContent = sub.join(' · ');

  const items = [...r.signals];
  if (r.model?.score != null) {
    items.unshift({
      direction: r.model.score >= 0.6 ? 'ai' : r.model.score <= 0.4 ? 'real' : 'info', strength: 'model',
      label: `Detection model: ${Math.round(r.model.score * 100)}% likely AI`,
      detail: r.kind === 'video' ? `Average of ${r.frames.length} sampled frames, weighted toward the most suspicious.` : 'A trained classifier scored the image pixels directly.',
    });
  }
  if (!items.length) items.push({ direction: 'info', strength: 'info', label: 'No strong signals either way', detail: 'Nothing in the file points clearly to AI or to a camera.' });
  $('signals').innerHTML = items.map((s) => `
    <li class="${s.direction === 'ai' ? 'ai' : s.direction === 'real' ? 'real' : ''}">
      <strong>${esc(s.label)}<span class="tag">${esc(s.strength === 'info' ? 'note' : s.strength === 'model' ? 'model' : `${s.strength} · ${s.direction === 'ai' ? 'points to AI' : 'points to real'}`)}</span></strong>
      <p>${esc(s.detail)}</p>
    </li>`).join('');

  $('frames').innerHTML = r.frames?.length
    ? `<div class="frames">${r.frames.map((f) => `<span>${f.time}s · ${Math.round(f.score * 100)}%</span>`).join('')}</div>` : '';

  const f = r.file;
  const facts = [
    ['Type', f.type?.toUpperCase()],
    ['Dimensions', f.width && f.height ? `${f.width} × ${f.height}` : null],
    ['Duration', f.duration ? `${f.duration.toFixed(1)} s` : null],
    ['Camera', f.camera], ['Software', f.software],
    ['Content Credentials', f.c2pa ? 'Present' : 'None'],
  ].filter(([, v]) => v);
  $('facts').innerHTML = facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function buy(pack) {
  try {
    const { url } = await api('/api/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack }),
    });
    location.href = url;
  } catch (e) { alert(e.message); }
}

async function confirmPayment() {
  const id = new URLSearchParams(location.search).get('paid');
  if (!id) return;
  history.replaceState(null, '', '/');
  try {
    const r = await api(`/api/checkout/confirm?session_id=${encodeURIComponent(id)}`);
    setCredits(r.credits);
    if (r.paid) alert('Payment received — your credits have been added. Thank you!');
  } catch (e) { alert(e.message); }
}

// ---- wiring ----
const drop = $('drop');
$('file').addEventListener('change', (e) => choose(e.target.files[0]));
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => choose(e.dataTransfer.files[0]));
document.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f) choose(f); });
$('analyzeBtn').addEventListener('click', analyze);
$('resetBtn').addEventListener('click', reset);
$('creditsBtn').addEventListener('click', () => $('pricing').scrollIntoView({ behavior: 'smooth' }));
$('packs').addEventListener('click', (e) => { const p = e.target.closest('[data-pack]'); if (p) buy(p.dataset.pack); });
$('copyKey').addEventListener('click', () => navigator.clipboard?.writeText(me.accountKey).then(() => { $('copyKey').textContent = 'Copied'; }));
$('restoreForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/account/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: $('restoreKey').value }) });
    $('restoreKey').value = '';
    await loadMe();
  } catch (err) { alert(err.message); }
});
$('year').textContent = new Date().getFullYear();

loadMe().then(confirmPayment).catch((e) => showError(e.message));
