# Authentication

The Nostreon API uses two authentication mechanisms:

1. **API keys** identify your client (Primal, Damus, etc.) for rate limiting and revenue attribution
2. **NIP-98 HTTP Auth** identifies the individual subscriber who is creating a subscription

Read-only endpoints need neither. Write endpoints need both.

## API Keys

API keys are passed in the `X-Api-Key` header:

```
X-Api-Key: npk_live_abc123...
```

Keys are issued per partner. See [README.md](./README.md#get-an-api-key) for how to request one.

Keys are hashed (SHA-256) at rest. If you lose your key, we can't recover it — we'll issue a new one.

### Key types

| Prefix | Mode | Base URL | BTCPay |
|---|---|---|---|
| `npk_test_*` | test | `https://dev.nostreon.com/api/v1` | Skipped — invoices are mocked |
| `npk_live_*` | live | `https://nostreon.com/api/v1` | Real invoices, real payments |

**Test mode** bypasses BTCPay entirely. When you call `POST /v1/subscribe` with a test key:

1. A fake invoice is created in memory with a `test_` prefix
2. You get back a placeholder `bolt11` string and the amount — **do NOT try to pay it**, it's not a real invoice
3. When you poll `GET /v1/subscribe/status`, it returns `Processing` for the first 3 seconds, then `Settled`
4. On settlement, Nostreon creates a real subscription record in the dev database AND publishes a real kind 1163 NIP-63 membership event to the dev gated relay
5. No money moves. No creator payout. No referral payout.

This lets you build and test your full integration — invoice display, polling, post-success UI, subscription verification on the gated relay — without spending any sats.

Responses include a `livemode: false` field when using a test key, matching Stripe's convention.

Start with a test key. Once everything works end-to-end, request a live key for production.

## NIP-98 HTTP Auth

NIP-98 lets users authenticate HTTP requests by signing an event with their Nostr key. The subscriber never gives you their key; they sign each request through their Nostr signer (browser extension, remote signer, etc.).

Spec: https://github.com/nostr-protocol/nips/blob/master/98.md

### The flow

For each authenticated request, your client must:

1. Build a kind `27235` event with specific tags
2. Have the subscriber sign it with their Nostr key
3. Base64-encode the signed event
4. Send it in the `Authorization` header as `Nostr <base64>`

### Required tags

| Tag | Description |
|---|---|
| `u` | The full request URL (must exactly match what the server sees) |
| `method` | HTTP method in uppercase (e.g. `POST`) |
| `payload` | SHA-256 hex digest of the raw request body (required for POST/PUT/PATCH with a body) |

### Example event (before signing)

```json
{
  "kind": 27235,
  "created_at": 1712345678,
  "content": "",
  "tags": [
    ["u", "https://nostreon.com/api/v1/subscribe"],
    ["method", "POST"],
    ["payload", "a3b5c7d9..."]
  ]
}
```

### Example request

```
POST /api/v1/subscribe HTTP/1.1
Host: nostreon.com
Content-Type: application/json
X-Api-Key: npk_live_abc123...
Authorization: Nostr eyJraW5kIjoyNzIzNSwiY3JlYXRlZF9hdCI6MTcxMjM0NTY3OCwi...

{"tier_id":"tier_abc","billing":"monthly"}
```

### Rules

- The event `created_at` must be within **60 seconds** of the server's clock
- The `u` tag must **exactly match** the request URL (scheme, host, path, query)
- The `method` tag must match the HTTP method in uppercase
- For requests with a body, the `payload` tag must be the SHA-256 hex digest of the raw bytes

If any check fails, the server returns `401 Unauthorized`.

### Why the payload hash?

Without it, an attacker could intercept a valid Authorization header and replay it with a different body (e.g., swap `tier_id` or `billing`). The payload hash binds the signature to the exact request body.

## Code Examples

See working examples:
- [Node.js](./examples/nodejs/)
- [Browser JavaScript](./examples/browser/)

## Common Errors

| Error | Cause |
|---|---|
| `Missing Authorization header` | Header not sent |
| `Authorization scheme must be 'Nostr'` | Wrong scheme (should be `Nostr <base64>`) |
| `Failed to decode Authorization payload` | Invalid base64 or JSON |
| `Invalid event signature` | Signature check failed |
| `Timestamp outside allowed window` | `created_at` more than 60s from now |
| `URL mismatch` | `u` tag doesn't match request URL |
| `Method mismatch` | `method` tag doesn't match HTTP method |
| `Missing 'payload' tag` | POST request without a payload tag |
| `Payload hash mismatch` | Body was modified or hash is wrong |
| `Missing X-Api-Key header` | API key not sent |
| `Invalid or inactive API key` | Key doesn't exist or was deactivated |
