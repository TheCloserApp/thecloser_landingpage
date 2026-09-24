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

## License

MIT
