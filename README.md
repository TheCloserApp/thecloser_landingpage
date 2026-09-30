# TheCloser — Website

The landing page for [TheCloser](https://thecloser.tech), an invisible AI interview copilot for macOS. The app itself lives at [TheCloserApp/MAC](https://github.com/TheCloserApp/MAC).

It's a single hand-written static `index.html` with no framework and no build step. Fonts (Geist, Geist Mono) come from Google Fonts. The only script handles the sticky nav, scroll reveals, the demo's typing animation and the "What they see" toggle.

## Run locally

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

## Deploy

Vercel deploys `main` automatically. `vercel.json` sets clean URLs, cache and security headers, and redirects `/thecloser.dmg` to the latest release so old download links keep working.

## Downloads

Every Download button points to the latest GitHub Release of the app:

```
https://github.com/TheCloserApp/MAC/releases/latest/download/TheCloser.dmg
```

That URL always resolves to the newest release, as long as each release attaches a file named exactly `TheCloser.dmg`. Shipping a new version needs no change to this site:

```bash
# From the app repo, after ./build.sh
STAGE=$(mktemp -d)
ditto build/thecloser.app "$STAGE/thecloser.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "TheCloser" -srcfolder "$STAGE" -ov -format UDZO TheCloser.dmg
rm -rf "$STAGE"

gh release create v3.1 TheCloser.dmg --repo TheCloserApp/MAC --title "TheCloser 3.1" --notes "…"
```

### Gatekeeper

The app is ad-hoc signed, not notarized, so macOS blocks it on first launch. Users need to open **System Settings → Privacy & Security** and click **Open Anyway**. Removing that step requires signing with an Apple Developer ID and notarizing. The build is Apple Silicon only.

## Pro API

`api/` holds the Vercel Functions behind TheCloser Pro, the paid plan for AI answers on Mac and Windows. There is no user account: Stripe holds the subscription and encrypted provider-key metadata. Each app identifies its installation with a device credential. Windows uses a random, DPAPI-protected credential; Mac uses its existing device fingerprint.

| Endpoint | What it does |
|---|---|
| `POST /api/checkout` `{device, plan, requestId?}` | Starts or reuses Stripe Checkout for this device. Returns `{url, sessionId}`. A stable optional request ID makes retries idempotent. Existing unpaid subscriptions are sent to billing recovery instead of charged twice. |
| `POST /api/stripe-webhook` | On checkout, creates the subscriber's own OpenRouter key, capped at one allowance. Each paid renewal (`invoice.paid`) adds a fresh allowance, so it resets on the subscriber's billing date. On cancellation or failed payment, disables the key. |
| `POST /api/pass` `{device, pass?, checkoutSessionId?}` | Returns a signed pass valid for 1 hour only after a paid current invoice. An optional Checkout session ID bypasses Stripe search indexing delays; pending payments return 409. The app renews it about hourly, so a cancellation takes effect within an hour. |
| `POST /api/chat` | OpenAI-compatible, streaming. Checks the pass and the plan's models, then forwards to OpenRouter with the subscriber's key. |
| `POST /api/stt-token` `{provider?}` | Pro transcription: a short-lived token for Grok Transcribe 2 (`provider: "grok"`, the default; 5 minutes, `Authorization: Bearer` on `wss://api.x.ai/v1/stt`) or ElevenLabs Scribe (`"elevenlabs"`; single use, 15 minutes, `?token=` on the realtime WebSocket). The app never holds our keys and asks again for each connection. Answers 503 when that provider isn't set up, and the app then transcribes on-device. Testers get it too; their transcription isn't part of the tester budget. |
| `GET /api/usage` | This billing period's allowance: used, remaining, and when it resets. |
| `POST /api/portal` | Opens Stripe's customer portal (cancel, change plan, card) for this subscription. An expired signed pass can recover billing only with a matching `{device}` body and Stripe subscription ownership. It cannot authorize AI requests. |
| `POST /api/upgrade` | Pro → Pro Max: opens Stripe's page confirming the switch and its prorated charge. Needs "customers can switch plans" in the portal settings. |
| `GET /api/plans` | Returns current recurring Stripe prices and plan details from the same catalog used by Mac. Missing or unsuitable prices disable purchase. |
| `GET /api/models` | Each plan's models and allowance. Plans live in `api/_lib/config.js`. |
| `POST /api/model-request` `{model, note?, plan?, source?}` | "Request a model" from `/request-model` (the app links there). Saves each request as a private JSON file under `model-requests/` in the project's Blob store, with nothing that identifies the sender. Read them in Vercel → Storage → the Blob store → Browser. |

The subscription's Stripe metadata holds `device`, `plan`, `or_hash`, `or_key`, `or_base`, `or_period` and `or_period_start`. `or_key` is the subscriber's OpenRouter key, encrypted with AES-256-GCM. The pass carries the same encrypted key, so `/api/chat` needs no lookups. `or_base` is what the key had spent when the current billing period began, and the key's cap is always `or_base` plus the plan's allowance.

### Settings (Vercel → Project → Settings → Environment Variables)

| Name | Where it comes from |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → Secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → your endpoint → Signing secret |
| `OPENROUTER_MANAGEMENT_KEY` | OpenRouter → Settings → Provisioning (management) keys |
| `BLOB_STORE_ID` | Set by Vercel when a **private** Blob store is connected to the project (Storage → Create → Blob). Used by `/api/model-request`, which signs in with the deployment's OIDC token. Older stores set `BLOB_READ_WRITE_TOKEN` instead, which also works. |
| `PASS_SECRET` | Any long random string, e.g. `openssl rand -hex 32`. Changing it signs everyone out, and existing subscribers' stored keys can no longer be decrypted, so set it once. |
| `XAI_API_KEY` | Optional. xAI → API Keys. Pro (subscribers and testers) transcribes with Grok Transcribe 2 through it, about $0.20 per hour of interview. Without it, Pro transcribes on-device. |
| `ELEVENLABS_API_KEY` | Optional. ElevenLabs → API keys. Pro users who pick ElevenLabs as their transcription transcribe through it (billed to this account). Without it, that choice falls back to on-device. |
| `TESTER_CODE` | Optional. The code testers type in the app to get Pro for free. See **Tester access** below. |
| `TESTER_OPENROUTER_KEY` | Optional. The shared OpenRouter key testers use. It **must** have a credit limit, the total test budget; the server refuses a key without one. |

Stripe prices are found by lookup key: `pro_monthly1` ($19) and `pro_max_monthly1` ($39). Subscriptions started on the earlier $1 test prices (`pro_monthly`, `pro_max_monthly`) keep their plan (`formerLookupKeys` in `api/_lib/config.js`). Reuse the existing **TheCloser Pro** and **TheCloser Pro Max** products for both platforms. Do not create Windows-specific products. Prices must be active, fixed-amount, licensed, monthly recurring prices. The app reads the actual amount and currency; the AI allowances ($8/$20) are independent of the subscription prices.

### Tester access

To let people try Pro without paying, set `TESTER_CODE` and `TESTER_OPENROUTER_KEY`, then redeploy.
- **Budget:** create the key in OpenRouter (Settings → API Keys → Create) with a **credit limit** and no reset, for example $5. That's the most all testers together can spend, and OpenRouter enforces it.
- **Redeeming:** testers type the code under **Have a tester code?**, next to the plans in onboarding or Settings → AI. Case, spaces and dashes don't matter.
- **What they get:** Pro's models. The usage bar shows the shared budget.
- **Ending it:** delete `TESTER_CODE`, and passes stop renewing within an hour. Or disable the key in OpenRouter to stop AI at once.

### Stripe event destination and customer portal

Keep the existing endpoint `https://www.thecloser.tech/api/stripe-webhook` and signing secret. Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`

Invoice subscription IDs from the existing `2023-10-16` webhook shape and the current Stripe shape are both supported. The handler re-reads current Stripe state so delayed event snapshots do not reset a newer allowance or restore canceled access. Webhook signatures are checked against the raw request body.

Enable Stripe Customer Portal payment-method updates, invoices, cancellation, and switching between these same two products. Upgrades open Stripe's confirmation screen; the desktop never confirms a charge itself. Pending or failed payments do not create new AI access. Successful recovery re-enables the existing key. Access already issued in a pass can remain cached for up to one hour, while disabled provider keys stop further use.

### Deployment and verification

Deploy this backend before distributing the Windows build in TheCloserApp/TheCloser. Existing Mac `/models`, checkout, pass, portal and upgrade contracts remain compatible; the Mac production feature flag is not changed here.

Run `npm ci && npm test` (Node 22 or later for module-mock tests). Tests cover actual webhook-signature verification, the existing catalog, checkout retries and plan switches, pending/foreign checkout rejection, recovery, renewal ordering and both invoice formats. Then verify a Stripe sandbox subscription through purchase, renewal, failed payment, recovery, upgrade and end-of-period cancellation before enabling a production release. Keep test and live keys, prices and webhook secrets in the same mode.

**Concurrency limit:** same-instance work is serialized and Stripe customer/checkout creation uses idempotency. Stripe metadata is not an atomic cross-instance store: simultaneous provisioning/renewals on different server instances can still race. New candidate keys start at zero allowance and disabled; unused candidates stay disabled. A durable per-device/per-subscription queue or lock is required before claiming exactly-once processing across a scaled deployment. No database or new cloud service is provisioned by these changes.

### Tests

```bash
npm install
npm test
```

## License

MIT
