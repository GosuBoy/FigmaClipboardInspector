# Figma Clipboard Inspector

A privacy-first, static website for inspecting what Figma actually puts on the clipboard.

**Stack:** Bun · Vite · React + TypeScript · Tailwind CSS v4 · Kiwi (evanw/kiwi, via kiwi-schema) · pako · fzstd.

**Intended site:** https://gosuboy.github.io/FigmaClipboardInspector/

## What you can inspect

- Paste with **⌘V** / **Ctrl+V**, or click **Read clipboard** (browser clipboard permission may be requested).
- Enumerate the MIME representations exposed to the browser, including text/plain, text/html, and files.
- Extract Figma's figmeta JSON metadata and figma base64 buffer from clipboard HTML.
- Decode self-describing fig-kiwi binary containers: schema and message chunks, raw deflate/zlib or Zstandard, embedded Kiwi schema and scene graph.
- Explore Figma layer changes as a searchable, expandable tree, inspect one node's decoded properties, view the raw binary hex and original HTML, and download the Kiwi payload or a JSON report.
- Load a **fully local demo** containing a small, genuinely Kiwi-encoded scene, without using Figma.
- Drop a saved clipboard HTML file (.html / .txt) or raw .kiwi/binary payload.

### Browser limitations

Figma's clipboard data is often HTML containing base64-encoded Kiwi data. Modern browsers can usually read text/html through the paste event; this is the primary supported path. Browser security *does not* expose every native operating-system clipboard flavor. Results show only what that particular browser makes available. navigator.clipboard.read() is optional, requires a secure context and a user gesture, and varies across browsers.

This inspector supports **clipboard HTML and raw fig-kiwi containers**, not ZIP-wrapped Figma .fig documents. Some application clipboard payloads are not fig-kiwi; they are retained as raw representations but may not decode as scene graphs. This is a research utility, not an official Figma decoder.

The in-page tree indexes up to 75,000 nodes for responsive browsing. Raw HTML and selected JSON previews are truncated on screen. Full original Kiwi bytes remain available to download. Decoded JSON exports replace binary byte arrays with a size and a short hex prefix and may be truncated for exceptionally large files. Input files and extracted base64 are limited to 48 MiB; decompressed chunks are limited to 256 MiB. These caps are safeguards, not fidelity guarantees.

**Privacy:** Everything is processed in-browser, in memory. There is no app backend, clipboard upload, account requirement, analytics, or external font service. Do not paste sensitive design content into issue comments or bug reports.

## Develop

Install [Bun](https://bun.com/docs/installation), then:

~~~bash
bun install
bun run dev
~~~

Visit the local URL printed by Vite.

~~~bash
bun run test
bun run build
bun run preview
~~~

The decoder runs in a Web Worker so most of the interface stays responsive while Kiwi decoding runs.

### Repo map

~~~text
src/lib/clipboard.ts  MIME extraction, base64 and Figma HTML markers
src/lib/container.ts  fig-kiwi binary framing
src/lib/decoder.ts    per-chunk decompression and embedded schema decode
src/lib/demo.ts       small deterministic Kiwi fixture
src/worker.ts         background decoding and node JSON export
src/main.tsx          inspector interface
src/style.css         Tailwind + interface styles
tests/                regression checks
~~~

## Deploy to GitHub Pages

The workflow in .github/workflows/pages.yml runs tests, builds with Bun/Vite, and publishes dist/ on every push to main. Vite is configured with the repository subpath so assets resolve on GitHub Pages.

**One-time repository setting:** Open [Settings → Pages](https://github.com/GosuBoy/FigmaClipboardInspector/settings/pages), then under **Build and deployment** choose **GitHub Actions** as the source. The workflow can then deploy the site at https://gosuboy.github.io/FigmaClipboardInspector/. You do not need to buy a domain.

If GitHub Pages is not enabled for the repository, deployment cannot succeed until this setting is changed; committing the workflow alone does not guarantee a live site.

## Credits and scope

Kiwi was created by [Evan Wallace](https://github.com/evanw/kiwi) and is MIT licensed. Figma's internal clipboard format is undocumented and can change. This is an unofficial independent tool, unaffiliated with Figma, Inc.
