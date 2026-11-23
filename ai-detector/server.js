'use strict';
try { process.loadEnvFile?.(); } catch { /* no .env file */ }

const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const store = require('./src/db');
const { analyzeImage, analyzeVideo } = require('./src/analyze');
const providers = require('./src/providers');

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const COOKIE = 'aid_account';
const COST = { image: 1, video: Number(process.env.VIDEO_COST || 4) };

// Credit packs sold through Stripe Checkout. Edit freely; prices are in cents.
const PACKS = {
  starter: { name: '25 scans', credits: 25, cents: 499 },
  pro: { name: '100 scans', credits: 100, cents: 1499 },
  business: { name: '500 scans', credits: 500, cents: 4900 },
};

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---- Stripe webhook (needs the raw body, so it is registered before JSON parsing) ----
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook signature failed: ${e.message}`);
  }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    creditSession(event.data.object);
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function setCookie(res, id) {
  res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: BASE_URL.startsWith('https'), maxAge: 400 * 864e5 });
}

/** Loads the visitor's account, creating one (with free credits) on first visit. */
function account(req, res, next) {
  let acct = store.getAccount(req.cookies[COOKIE]);
  if (!acct) {
    acct = store.createAccount(req.ip || 'unknown');
    setCookie(res, acct.id);
  }
  req.account = acct;
  next();
}

function creditSession(session) {
  if (session.payment_status !== 'paid') return false;
  const { account_id: accountId, credits } = session.metadata || {};
  if (!accountId || !credits) return false;
  return store.recordPayment({
    sessionId: session.id, accountId, credits: Number(credits),
    amountCents: session.amount_total, email: session.customer_details?.email,
  });
}

// ---- API ----
app.get('/api/me', account, (req, res) => {
  const provider = providers.active();
  res.json({
    accountKey: req.account.id,
    credits: req.account.credits,
    costs: COST,
    packs: Object.entries(PACKS).map(([id, p]) => ({ id, ...p })),
    paymentsEnabled: Boolean(stripe),
    modelEnabled: Boolean(provider),
  });
});

app.post('/api/account/restore', (req, res) => {
  const acct = store.getAccount(String(req.body?.key || '').trim());
  if (!acct) return res.status(404).json({ error: 'No account found for that key.' });
  setCookie(res, acct.id);
  res.json({ credits: acct.credits });
});

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 100) * 1024 * 1024, files: 1 },
});
const IMAGE_MAX = Number(process.env.MAX_IMAGE_MB || 20) * 1024 * 1024;

app.post('/api/analyze', account, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    const file = req.file;
    const cleanup = () => file && fs.unlink(file.path).catch(() => {});
    try {
      if (err) return res.status(413).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message });
      if (!file) return res.status(400).json({ error: 'No file uploaded.' });
      const kind = file.mimetype.startsWith('video/') ? 'video' : file.mimetype.startsWith('image/') ? 'image' : null;
      if (!kind) return res.status(415).json({ error: 'Upload an image or video file.' });
      if (kind === 'image' && file.size > IMAGE_MAX) return res.status(413).json({ error: 'Image is too large.' });

      const cost = COST[kind];
      if (!store.spend(req.account.id, cost)) {
        return res.status(402).json({ error: 'Not enough credits.', needed: cost, credits: store.getAccount(req.account.id).credits });
      }
      let result;
      try {
        result = kind === 'image' ? await analyzeImage(file.path, file.mimetype) : await analyzeVideo(file.path);
      } catch (e) {
        store.refund(req.account.id, cost);
        console.error('analysis failed', e);
        return res.status(500).json({ error: 'Analysis failed. You were not charged.' });
      }
      // If the paid model was meant to run but failed outright, give the credits back.
      if (result.model && result.model.score === null) store.refund(req.account.id, cost);
      store.logScan(req.account.id, kind, cost, result.verdict.score, result.verdict.label);
      res.json({ ...result, credits: store.getAccount(req.account.id).credits });
    } finally {
      cleanup();
    }
  });
});

app.post('/api/checkout', account, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments are not configured yet.' });
  const pack = PACKS[req.body?.pack];
  if (!pack) return res.status(400).json({ error: 'Unknown pack.' });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: process.env.CURRENCY || 'usd',
          unit_amount: pack.cents,
          product_data: { name: `AI Detector – ${pack.name}`, description: `${pack.credits} scan credits` },
        },
      }],
      metadata: { account_id: req.account.id, credits: String(pack.credits), pack: req.body.pack },
      client_reference_id: req.account.id,
      success_url: `${BASE_URL}/?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/#pricing`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('checkout failed', e);
    res.status(502).json({ error: 'Could not start checkout.' });
  }
});

// Called when Stripe redirects back, so credits land even before the webhook arrives.
app.get('/api/checkout/confirm', account, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments are not configured.' });
  try {
    const session = await stripe.checkout.sessions.retrieve(String(req.query.session_id || ''));
    if (session.metadata?.account_id !== req.account.id) return res.status(403).json({ error: 'This payment belongs to another account.' });
    creditSession(session);
    res.json({ paid: session.payment_status === 'paid', credits: store.getAccount(req.account.id).credits });
  } catch {
    res.status(400).json({ error: 'Unknown checkout session.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AI Detector running at ${BASE_URL}`);
    console.log(`  model provider: ${providers.active()?.name || 'none (forensics only — set SIGHTENGINE_API_USER/SECRET)'}`);
    console.log(`  payments: ${stripe ? 'Stripe enabled' : 'disabled (set STRIPE_SECRET_KEY)'}`);
  });
}

module.exports = app;
