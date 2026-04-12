# Node.js Example

Working Node.js script that demonstrates the full subscription flow.

## Install

```bash
npm install nostr-tools
```

## Usage

```bash
NOSTREON_API_KEY=npk_live_... node subscribe.js
```

## Files

- [`subscribe.js`](./subscribe.js) — Full subscription flow: fetch tiers, sign NIP-98 event, create invoice, poll status
- [`nip98.js`](./nip98.js) — Helper for building and signing NIP-98 auth events
