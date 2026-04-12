# Browser Example

Browser JavaScript example using a NIP-07 Nostr signer extension (Alby, nos2x, etc.).

Unlike the Node.js example, the browser never handles the user's secret key directly. Instead, it asks the installed Nostr signer extension (`window.nostr`) to sign the NIP-98 event.

## Files

- [`index.html`](./index.html) — Standalone HTML page demonstrating the full flow
- [`nip98-browser.js`](./nip98-browser.js) — Browser helper that uses `window.nostr` to sign

## Usage

Serve this directory with any static file server:

```bash
npx serve .
```

Open `http://localhost:3000` in a browser with a Nostr extension installed (Alby, nos2x, Flamingo, etc.).

You'll need a valid Nostreon API key and a creator npub. Both are entered in the UI.
