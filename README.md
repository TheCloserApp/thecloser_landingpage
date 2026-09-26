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

`api/` holds the Vercel Functions behind TheCloser Pro, the paid plan with no keys. There's no database and no account: Stripe is the only record, and customers are identified by an anonymous fingerprint of their Mac.

| Endpoint | What it does |
|---|---|
| `POST /api/checkout` `{device, plan}` | Starts Stripe Checkout. The Mac's fingerprint is stored on the subscription, which locks it to that Mac. |
| `POST /api/stripe-webhook` | On checkout, creates the subscriber's own OpenRouter key, capped at one allowance. Each paid renewal (`invoice.paid`) adds a fresh allowance, so it resets on the subscriber's billing date. On cancellation or failed payment, disables the key. |
| `POST /api/pass` `{device, pass?}` | Returns a signed pass valid for 1 hour. The app renews it about hourly, so a cancellation takes effect within an hour. |
| `POST /api/chat` | OpenAI-compatible, streaming. Checks the pass and the plan's models, then forwards to OpenRouter with the subscriber's key. |
| `GET /api/usage` | This billing period's allowance: used, remaining, and when it resets. |
| `POST /api/portal` | Opens Stripe's customer portal (cancel, change plan, card) for this subscription. |
| `POST /api/upgrade` | Pro → Pro Max: opens Stripe's page confirming the switch and its prorated charge. Needs "customers can switch plans" in the portal settings. |
| `GET /api/models` | Each plan's models and allowance. Plans live in `api/_lib/config.js`. |
| `POST /api/model-request` `{model, note?, plan?, source?}` | "Request a model" from `/request-model` (the app links there). Saves each request as a private JSON file under `model-requests/` in the project's Blob store, with nothing that identifies the sender. Read them in Vercel → Storage → the Blob store → Browser. |

The subscription's Stripe metadata holds `device`, `plan`, `or_hash`, `or_key`, `or_base` and `or_period`. `or_key` is the subscriber's OpenRouter key, encrypted with AES-256-GCM. The pass carries the same encrypted key, so `/api/chat` needs no lookups. `or_base` is what the key had spent when the current billing period began, and the key's cap is always `or_base` plus the plan's allowance.

### Settings (Vercel → Project → Settings → Environment Variables)

| Name | Where it comes from |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → Secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → your endpoint → Signing secret |
| `OPENROUTER_MANAGEMENT_KEY` | OpenRouter → Settings → Provisioning (management) keys |
| `BLOB_READ_WRITE_TOKEN` | Set by Vercel when a **private** Blob store is connected to the project (Storage → Create → Blob). Used by `/api/model-request`. |
| `PASS_SECRET` | Any long random string, e.g. `openssl rand -hex 32`. Changing it signs everyone out, and existing subscribers' stored keys can no longer be decrypted, so set it once. |

Stripe prices are found by lookup key: `pro_monthly` and `pro_max_monthly`.

### Tests

```bash
npm install
npm test
```

## License

MIT
