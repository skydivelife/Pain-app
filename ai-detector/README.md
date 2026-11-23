# Verity — AI image & video detector

A paid web app: visitors upload a photo or video and get a verdict on whether it was AI-generated, with a plain-English explanation of the evidence. New visitors get free scans; after that they buy credit packs through Stripe.

## How detection works

| Layer | What it checks | Cost |
|---|---|---|
| **Provenance** | C2PA Content Credentials and the IPTC `trainedAlgorithmicMedia` label that OpenAI, Google, Adobe, Meta etc. embed | free, local |
| **Forensics** | Stable Diffusion / ComfyUI generation settings, generator names in EXIF/XMP/PNG/video tags (Midjourney, DALL·E, Firefly, Sora, Veo, Runway, Kling…), camera EXIF, phone-recorded video tags, generator-typical sizes | free, local |
| **AI model** | Sightengine's `genai` classifier scores the pixels. Videos: 4 frames are sampled with ffmpeg and scored | ~$0.001–0.002 per image op |

Signals are combined in `src/verdict.js`. Embedded provenance overrides the model ("confirmed by embedded metadata"); otherwise the model score drives the verdict and metadata nudges it.

**Be honest with customers:** without the model, most files (screenshots, social-media re-uploads) have stripped metadata and come back *Inconclusive*. The model is what makes this worth paying for — configure it before charging. No detector is 100% accurate; the UI says so.

## Run locally

Needs Node 22.5+ and (for video frames) `ffmpeg`.

```bash
cd ai-detector
npm install
cp .env.example .env   # fill in keys
npm start              # http://localhost:3000
npm test
```

## Going live (getting paid)

1. **Detection model:** create a Sightengine account, put `SIGHTENGINE_API_USER` / `SIGHTENGINE_API_SECRET` in `.env`.
2. **Stripe:** create an account, add `STRIPE_SECRET_KEY`. Add a webhook endpoint `https://YOUR-DOMAIN/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`. Test with `sk_test_…` keys and card `4242 4242 4242 4242` first.
3. **Host it** on anything that runs Node with a persistent disk (Render, Railway, Fly.io, a VPS). Set `BASE_URL` to your https domain. Back up `DB_PATH` — it holds paid balances.
4. **Pricing** lives in `PACKS` in `server.js` (default 25 / 100 / 500 scans for $4.99 / $14.99 / $49). At Sightengine's rates, margin per image scan is roughly 95%+.
5. Add a Terms of Service and Privacy Policy page before launch (uploads are deleted right after analysis; say so).

## Code map

- `server.js` — Express routes: accounts, `/api/analyze`, Stripe checkout + webhook
- `src/forensics.js` — JPEG/PNG/WebP/MP4 metadata parsing and signals
- `src/video.js` — ffprobe tags and frame extraction
- `src/providers/` — model providers (add Hive, Reality Defender, etc. with the same interface)
- `src/verdict.js` — evidence → score, label, confidence
- `src/db.js` — SQLite (built into Node) accounts, credits, payments, scan log
- `public/` — the web UI (no build step)

Accounts are anonymous: a cookie plus an account key users can save to restore credits. Credits are refunded automatically if analysis or the model fails. Free credits are limited per IP per day to slow abuse.
