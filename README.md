# TheCloser — Landing Page

A self-contained static landing page for **TheCloser** (native macOS interview copilot).
Everything — fonts, the component runtime, and the live interactive demo — is inlined into a
single `index.html`, so there is **no build step** and no external requests at runtime.

## Deploy to Vercel

This is a pure static site. Vercel serves `index.html` from the root automatically.

### Option A — Vercel CLI (fastest)

```bash
npm i -g vercel        # if you don't have it
cd landing
vercel                 # preview deploy
vercel --prod          # production deploy
```

### Option B — Git + Vercel dashboard

1. Push this folder to a Git repo (GitHub/GitLab/Bitbucket).
2. In the Vercel dashboard: **Add New… → Project → Import** the repo.
3. Framework Preset: **Other** (no build command, no output dir needed).
4. **Deploy.**

### Option C — Drag & drop

Open <https://vercel.com/new>, then drag this folder onto the page.

## Configuration

Two links are configurable in the page. They live inside the bundled template, so use the
helper script to change them rather than hand-editing the 23 MB `index.html`:

| What            | Current value                                   |
| --------------- | ----------------------------------------------- |
| GitHub / Contribute | `https://github.com/abhishek-reddy-m/MAC`   |
| Download button | `/thecloser.dmg` (served from this folder)      |

### Set the download link (when ready)

```bash
python3 update_links.py --download "https://your-download-url/TheCloser.dmg"
```

You can also change the GitHub URL the same way:

```bash
python3 update_links.py --github "https://github.com/abhishek-reddy-m/MAC"
```

Re-run, then redeploy. The script rewrites `index.html` in place.

## The download (thecloser.dmg)

`thecloser.dmg` is a compressed, drag-to-install disk image (TheCloser.app + an
Applications shortcut) built from `MacOverlay/build/thecloser.app` (v3.0, Apple
Silicon / arm64). All three "Download" buttons point at `/thecloser.dmg`, and
Vercel serves it with a download header.

To rebuild the DMG after a new app build:

```bash
STAGE=$(mktemp -d)
ditto /path/to/thecloser.app "$STAGE/TheCloser.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "TheCloser" -srcfolder "$STAGE" -ov -format UDZO thecloser.dmg
rm -rf "$STAGE"
```

### ⚠️ Gatekeeper warning (important)

The app is **ad-hoc signed, not notarized** (no Apple Developer ID). When a user
downloads and opens it, macOS will say *"TheCloser is damaged / cannot be opened
because the developer cannot be verified."* They must bypass Gatekeeper:

- **Right-click the app → Open → Open** (one-time), or
- Run: `xattr -dr com.apple.quarantine /Applications/TheCloser.app`

For a clean public release with no warnings you need to **sign with a Developer
ID certificate and notarize** with Apple. Also note this build is **arm64 only**
— it won't run on Intel Macs.

> Tip: for large/updating binaries, hosting the DMG as a **GitHub Release asset**
> on the MAC repo (and pointing the download link there) keeps it out of the
> deploy. Run `python3 update_links.py --download "<release-asset-url>"` to switch.

## Files

- `index.html` — the deployable, self-contained landing page.
- `thecloser.dmg` — the downloadable macOS app (drag-to-install).
- `vercel.json` — static hosting config (clean URLs, download + security headers).
- `update_links.py` — safely edits the GitHub / Download links inside the bundle.
- `TheCloser Landing.html` — original export, kept as the source of truth.
