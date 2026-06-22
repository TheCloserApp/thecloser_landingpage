#!/usr/bin/env python3
"""
Update the GitHub and/or Download links inside the bundled landing page.

The real markup lives JSON-encoded inside index.html (a ~23 MB self-contained
bundle), so editing it by hand is painful. This script decodes that payload,
rewrites the links, re-encodes it (escaping </ so embedded </script> can't
close the outer script tag), and writes index.html back in place.

Usage:
    python3 update_links.py --download "https://example.com/TheCloser.dmg"
    python3 update_links.py --github   "https://github.com/abhishek-reddy-m/MAC"
    python3 update_links.py --download "..." --github "..."
"""
import argparse
import json
import re
import sys

BUNDLE = "index.html"


def load_bundle():
    with open(BUNDLE, "r", encoding="utf-8") as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        if line.lstrip().startswith('"<!DOCTYPE'):
            return lines, i, json.loads(lines[i])
    sys.exit("error: could not find the embedded template payload in index.html")


def save_bundle(lines, idx, html):
    payload = json.dumps(html, ensure_ascii=True).replace("</", "<\\u002F")
    lines[idx] = payload + "\n"
    with open(BUNDLE, "w", encoding="utf-8") as f:
        f.writelines(lines)


def set_github(html, url):
    # design-tool default (HTML-attr encoded inside data-props)
    html = re.sub(
        r"(&quot;githubUrl&quot;:\{&quot;editor&quot;:&quot;text&quot;,&quot;default&quot;:&quot;)[^&]*(&quot;)",
        lambda m: m.group(1) + url + m.group(2),
        html,
    )
    # runtime fallbacks (used when served standalone) — appears twice
    html = re.sub(
        r"(this\.props\.githubUrl \?\? ')[^']*(')",
        lambda m: m.group(1) + url + m.group(2),
        html,
    )
    return html


def set_download(html, url):
    html = re.sub(
        r"(&quot;downloadUrl&quot;:\{&quot;editor&quot;:&quot;text&quot;,&quot;default&quot;:&quot;)[^&]*(&quot;)",
        lambda m: m.group(1) + url + m.group(2),
        html,
    )
    html = re.sub(
        r"(this\.props\.downloadUrl \?\? ')[^']*(')",
        lambda m: m.group(1) + url + m.group(2),
        html,
    )
    return html


def main():
    ap = argparse.ArgumentParser(description="Update GitHub/Download links in the bundle.")
    ap.add_argument("--github", help="GitHub / Contribute URL")
    ap.add_argument("--download", help="Download button URL (e.g. a .dmg link)")
    args = ap.parse_args()

    if not args.github and not args.download:
        ap.error("pass --github and/or --download")

    for label, val in (("github", args.github), ("download", args.download)):
        if val and ("'" in val or '"' in val):
            sys.exit(f"error: {label} URL must not contain quote characters: {val}")

    lines, idx, html = load_bundle()
    if args.github:
        html = set_github(html, args.github)
    if args.download:
        html = set_download(html, args.download)
    save_bundle(lines, idx, html)

    # verify round-trip
    _, _, check = load_bundle()
    if args.github:
        assert check.count(args.github) >= 2, "github link did not apply cleanly"
        print(f"github   -> {args.github}")
    if args.download:
        assert check.count(args.download) >= 1, "download link did not apply cleanly"
        print(f"download -> {args.download}")
    print("index.html updated. Redeploy to publish.")


if __name__ == "__main__":
    main()
