# Figma Clipboard Inspector

A small, private-in-browser explorer for Figma clipboard payloads.

**Live site:** https://gosuboy.github.io/FigmaClipboardInspector/

**Stack:** Bun, Vite, React/TypeScript, Tailwind v4, [Kiwi](https://github.com/evanw/kiwi) (via kiwi-schema), pako, fzstd.

## Use it

1. Copy a frame or layer in Figma.
2. Open the site and press **⌘V** or **Ctrl+V** anywhere on the page. The **Read clipboard** button is another option when your browser supports the Clipboard API.
3. The **Kiwi message** tab starts at the **root of the complete decoded message**. Click any field to drill into it; use the breadcrumb to go back. Arrays, long strings and byte buffers are paginated so even large messages can be inspected.
4. Click **Download full JSON** to export the entire decoded object, **without omitting nodes, fields, or bytes**. The export uses reversible type wrappers: \`Uint8Array\` data is base64 in \`{"__kiwiType":"Uint8Array","encoding":"base64","data":"..."}\`; BigInt and nonfinite numbers also use tagged representations. The JSON is compact and not artificially truncated.
5. **Layers** provides a simpler searchable node index; selecting a layer opens its full record in the Kiwi message viewer. **Raw** provides MIME types, original HTML, and original Kiwi bytes.
6. **Try demo** loads a valid, locally generated Kiwi message with five layers and two binary blobs, without needing a Figma clipboard.

You can also open a saved clipboard HTML/text file or raw \`.kiwi\` stream.

## Scope and limits

The viewer exposes **every field in the decoded message**, including all of \`nodeChanges\`, \`blobs\`, and unfamiliar schema fields. It uses page-at-a-time inspection backed by a Web Worker instead of trying to render the entire graph in one DOM tree. Clicking a \`byte[]\` shows the original bytes in a paged hex view, with a download option. The downloaded JSON is lossless for the supported decoded types but includes tagged representations for binary and large integers; it is not a Figma-authored JSON format.

To keep the lightweight **Layers** shortcut responsive, only its first 75,000 nodes are indexed; the **Kiwi message** view still has access to all \`nodeChanges\` records, with a jump-to-index control for large arrays. Original raw Kiwi binary is also downloadable.

Browser security limits which native clipboard representations can be accessed. The inspector supports Figma HTML with \`figma\` and \`figmeta\` markers and raw \`fig-kiwi\` streams. ZIP-wrapped \`.fig\` files are **not** supported. Input is capped at 48 MiB, and decoded chunk length is capped at 256 MiB. Some Figma versions or other applications may use formats this tool does not yet decode.

All parsing takes place locally in the browser; there is **no backend, clipboard upload, account, analytics, or remote font service**. Never share sensitive design content in a public bug report. This is an unofficial research project, not affiliated with Figma.

## Develop

~~~sh
bun install
bun run dev
bun run test
bun run build
~~~

Key files:

- \`src/lib/clipboard.ts\` – MIME access and HTML envelope extraction
- \`src/lib/container.ts\` – fig-kiwi container framing
- \`src/lib/decoder.ts\` – embedded-schema decoding (deflate / Zstandard)
- \`src/lib/message.ts\` – complete message pagination and lossless JSON export
- \`src/worker.ts\` – decode, inspect and export without blocking the UI
- \`src/main.tsx\` and \`src/style.css\` – minimal inspector interface

## GitHub Pages

The GitHub Actions workflow tests and builds on each push to \`main\`, then publishes \`dist/\` to GitHub Pages. The Vite base URL is set for the repository path. You can view deployments in the repository's **Actions** tab.

Kiwi is by Evan Wallace and distributed under the MIT license.
