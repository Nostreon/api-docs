# Nostreon API

Public API for third-party Nostr clients to integrate creator subscriptions.

Nostreon is a creator subscription platform on Nostr and Bitcoin. This API lets any Nostr client (Primal, Damus, Amethyst, etc.) embed subscription creation natively so their users can subscribe to creators without leaving the app.

## Quick Start

```bash
# 1. Fetch a creator's tiers (no auth required)
curl https://nostreon.com/api/v1/creators/npub1.../tiers

# 2. Request a dual-invoice subscription (API key + NIP-98 signed event)
curl -X POST https://nostreon.com/api/v1/subscribe/invoices \
  -H "Authorization: Nostr <base64_signed_event>" \
  -H "X-Api-Key: <your_api_key>" \
  -H "Content-Type: application/json" \
  -d '{"tier_id": "...", "billing": "monthly"}'
# => { "pending_id": "...", "creator": { "bolt11": "..." }, "nostreon": { "bolt11": "..." } }

# 3. User pays BOTH bolt11s from their own Lightning wallet
#    (Nostreon never holds subscriber funds)

# 4. Poll for settlement
curl "https://nostreon.com/api/v1/subscribe/invoices/status?pending_id=..." \
  -H "X-Api-Key: <your_api_key>"
# => { "status": "settled", "subscription_id": "..." }
```

For zap-aware wallets, use the zap-split path instead: [endpoints/zap-prepare.md](./endpoints/zap-prepare.md).

## How it Works

Nostreon is **non-custodial**. Subscriber funds go directly to each recipient (creator, Nostreon fee wallet, and optionally your partner wallet). Nostreon's servers record metadata and publish NIP-63 membership events; they never take custody of subscriber sats.

```
                  ┌─────────────┐
                  │  Nostreon   │  (metadata only,
                  │     API     │   never holds sats)
                  └──────┬──────┘
                    (1) prep    (5) publishes kind 1163 / 7003
                         │       on settlement
  ┌──────────┐          ▼                             ┌──────────┐
  │ Your     │──(2)─▶ pending row ──▶ poll (4) ──────▶│ Creator  │
  │ Client   │                                         │  LN addr │
  │          │──(3)─▶ pays bolt11(s) directly ─────────┘
  └──────────┘                      │
                                    └────▶┌──────────┐
                                          │ Nostreon │
                                          │  fee LN  │
                                          └──────────┘
```

1. Your client calls `POST /v1/subscribe/invoices` (or `GET /v1/subscribe/zap-prepare`) with a signed NIP-98 event and API key
2. Nostreon returns 2-3 BOLT11 invoices (one per recipient) and a `pending_id`
3. Your client shows the invoices to the subscriber; the subscriber's own wallet pays each directly
4. Your client polls `/v1/subscribe/invoices/status` (or listens for kind 9735 zap receipts) until the pending subscription settles
5. Nostreon reconciles the settlements and publishes a kind `1163` NIP-63 membership + kind `7003` payment receipt. The subscription is active.

The user can now access premium content from `wss://premium.nostreon.com` or any NIP-42 + NIP-63 aware relay.

## Documentation

**Reference**
- [Authentication](./authentication.md) - API keys and NIP-98 HTTP auth
- [Creators](./endpoints/creators.md) - fetch profiles and tiers
- [Subscriptions](./endpoints/subscriptions.md) - dual-invoice subscribe + status polling
- [Zap-split subscribe](./endpoints/zap-prepare.md) - primary path for zap-aware wallets
- [Partners](./endpoints/partners.md) - analytics for your own API key (referrals, GMV, earnings)

**Generic examples** (any HTTP-capable client)
- [Node.js](./examples/nodejs/) - full subscription flow with NIP-98 signing
- [Browser](./examples/browser/) - vanilla JavaScript integration

**Client-specific examples** (idiomatic for each Nostr client)
- [Primal](./examples/primal/) - web/iOS/Android, integrates with Primal Wallet for one-tap payment
- [Damus](./examples/damus/) - iOS Swift, hands off payment to the user's Lightning wallet via `lightning:` URI
- [Amethyst](./examples/amethyst/) - Android Kotlin, opens the user's Lightning wallet via Android intent

Each client example walks through the full flow (discover tiers → sign auth event → create invoice → handle payment → poll for settlement) using the language and patterns idiomatic to that client. The HTTP API is identical regardless of which client you're integrating into; the examples differ in how they sign events, how they pay invoices, and how they show subscription state to the user.

## Revenue Share

Nostreon takes a 5% platform fee on subscriptions, and shares 50% of that fee with the partner that drove the subscription (configurable per partner).

**Example on a $5/month subscription (above the $1k creator promo threshold):**
- Creator gets: $4.75 (95%)
- Nostreon gets: $0.125 (2.5%)
- Your client gets: $0.125 (2.5%)

**How the partner share is delivered depends on the subscribe path:**

| Path | How partner gets paid |
|---|---|
| Zap-split (`/v1/subscribe/zap-prepare`) | **Directly from the subscriber's wallet** as a third zap recipient, using your `partner_pubkey` on file. No settlement latency, no exposure to Nostreon. Register a pubkey with your key to enable this. |
| Dual-invoice (`/v1/subscribe/invoices`) | **Not paid.** Dual-invoice issues only two bolt11s (creator + Nostreon fee). Attribution is still recorded for analytics, but partners earn $0 on dual-invoice subscriptions. Route subscribers through zap-prepare when possible. |

**Fee-free subscriptions:** The first $1,000 of a creator's lifetime revenue is platform-fee-free. On those subscriptions, the full amount goes to the creator and both Nostreon and your partner share are $0. This is by design so creators keep every sat until they cross the threshold.

See [NON_CUSTODIAL_ARCHITECTURE.md §7](https://github.com/nostreon/nostreon/blob/main/NON_CUSTODIAL_ARCHITECTURE.md) for the full split math, and [endpoints/partners.md](./endpoints/partners.md) for the self-serve analytics endpoint.

## Get an API Key

API keys come in two flavors:

- **Test keys** (`npk_test_*`) - for development against `dev.nostreon.com`. BTCPay is skipped entirely; invoices are mocked and auto-settle on polling. No money moves, but real subscription records and kind 1163 membership events are created in the dev environment so you can test your full integration.
- **Live keys** (`npk_live_*`) - for production against `nostreon.com`. Real invoices, real payments, real payouts.

We recommend starting with a test key, building your integration, then requesting a live key once everything works end-to-end. See [authentication.md](./authentication.md#key-types) for full details on test mode.

To request a key, [open an issue](https://github.com/Nostreon/api-docs/issues/new) in this repo with:

- Client name
- **Your npub** (we'll deliver the API key via Nostr DM, never in the issue)
- Lightning address for receiving referral payouts
- **Partner pubkey** (hex, optional but required for zap-split earnings). This is the `p` tag target for your zap-split share; often the same as the npub above, converted to hex. Leave blank if you'll only use the dual-invoice flow and don't need partner revenue share.
- Which key you want: `test`, `live`, or `both`
- Expected monthly volume (optional)

We'll reply in the issue to confirm receipt, then send the API key to your npub as an encrypted Nostr direct message (NIP-04). Never share API keys in public channels.

## Base URL

- **Production**: `https://nostreon.com/api/v1`
- **Staging**: `https://dev.nostreon.com/api/v1`

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
