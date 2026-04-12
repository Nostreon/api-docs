# Nostreon API

Public API for third-party Nostr clients to integrate creator subscriptions.

Nostreon is a creator subscription platform on Nostr and Bitcoin. This API lets any Nostr client (Primal, Damus, Amethyst, etc.) embed subscription creation natively so their users can subscribe to creators without leaving the app.

## Quick Start

```bash
# 1. Fetch a creator's tiers (no auth required)
curl https://api.nostreon.com/v1/creators/npub1.../tiers

# 2. Subscribe a user (requires API key + NIP-98 signed event)
curl -X POST https://api.nostreon.com/v1/subscribe \
  -H "Authorization: Nostr <base64_signed_event>" \
  -H "X-Api-Key: <your_api_key>" \
  -H "Content-Type: application/json" \
  -d '{"tier_id": "...", "billing": "monthly"}'

# 3. Poll for payment (after user pays the Lightning invoice)
curl "https://api.nostreon.com/v1/subscribe/status?invoice_id=..." \
  -H "X-Api-Key: <your_api_key>"
```

## How it Works

```
┌──────────┐       ┌──────────┐       ┌───────────┐       ┌──────────┐
│ Your     │──(1)─▶│ Nostreon │──(2)─▶│ Lightning │       │ Creator  │
│ Client   │       │ API      │       │ Network   │       │          │
│          │◀─(3)──│          │       │           │       │          │
│          │◀─(4)──│          │◀──────│           │──(5)─▶│          │
└──────────┘       └──────────┘       └───────────┘       └──────────┘
   User pays          Creates         Settles the         Auto-payout
  invoice in          invoice         invoice             via Lightning
  your UI
```

1. Your client calls `POST /v1/subscribe` with a signed NIP-98 event and API key
2. Nostreon creates a BTCPay invoice and returns a BOLT11 Lightning invoice
3. Your client displays the QR code / invoice for the user to pay
4. When payment settles, Nostreon automatically creates the subscription, publishes a NIP-63 membership event, and pays the creator
5. The user can now access premium content from any NIP-63 compatible relay

## Documentation

- [Authentication](./authentication.md) — API keys and NIP-98 HTTP auth
- [Creators](./endpoints/creators.md) — fetch profiles and tiers
- [Subscriptions](./endpoints/subscriptions.md) — create and poll subscriptions
- [Node.js Example](./examples/nodejs/) — working Node.js integration
- [Browser Example](./examples/browser/) — browser JavaScript integration

## Revenue Share

Nostreon takes a 5% platform fee on subscriptions. When a subscription is created through your API integration, Nostreon shares 50% of the platform fee with you (configurable per partner).

**Example on a $5/month subscription:**
- Creator gets: $4.75 (95%)
- Nostreon gets: $0.125 (2.5%)
- Your client gets: $0.125 (2.5%)

Payouts are sent automatically to your Lightning address on each successful subscription.

## Get an API Key

API keys are issued manually. To request one, [open an issue](https://github.com/Nostreon/api-docs/issues/new) in this repo with:

- Client name
- **Your npub** (we'll deliver the API key via Nostr DM, never in the issue)
- Lightning address for receiving referral payouts
- Expected monthly volume (optional)

We'll reply in the issue to confirm receipt, then send the API key to your npub as an encrypted Nostr direct message (NIP-04). Never share API keys in public channels.

## Base URL

- **Production**: `https://api.nostreon.com/v1`
- **Staging**: `https://dev-api.nostreon.com/v1`

## Rate Limits

| Endpoint type | Default limit |
|---|---|
| Read-only (no auth) | 60 requests / minute per IP |
| Authenticated (with API key) | 30 requests / minute per API key |

Rate limits are configurable per partner. If you need higher limits, contact us.

Rate-limited responses return HTTP 429 with a `Retry-After` header.

## Errors

All errors return JSON with an `error` field:

```json
{ "error": "Invalid or inactive API key" }
```

| Status | Meaning |
|---|---|
| `400` | Bad request (invalid parameters) |
| `401` | Missing or invalid authentication |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Server error |

## License

MIT
