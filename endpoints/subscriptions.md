# Subscriptions

Create subscriptions on behalf of users. Two paths, both non-custodial:

1. **Dual-invoice fallback** - `POST /v1/subscribe/invoices`. Returns two BOLT11 invoices (creator + Nostreon fee). Works with any Lightning wallet. Use this when you don't know if the subscriber's wallet supports zap-splits.
2. **Zap-split primary** - `GET /v1/subscribe/zap-prepare`. Returns the zap recipients + weights. The wallet signs one kind 9734 zap-request per recipient and pays them as a batch. See [zap-prepare.md](./zap-prepare.md).

Both require an API key. Dual-invoice also requires NIP-98 HTTP auth (so the subscriber proves they authored the request). See [authentication.md](../authentication.md).

> **Removed 2026-04-17.** The legacy custodial endpoint `POST /v1/subscribe` now returns `410 Gone` with `code: "custodial_subscribe_deprecated"`. If your integration still hits that path, migrate to `/v1/subscribe/invoices` below.

---

## Create a dual-invoice subscription

```
POST /v1/subscribe/invoices
```

Returns two BOLT11 invoices that, paid together, activate the subscription. The subscriber pays the creator's Lightning address directly (via LUD-21) and Nostreon's fee invoice (via BTCPay). Nostreon never holds subscriber funds.

### Headers

| Header | Required | Description |
|---|---|---|
| `X-Api-Key` | Yes | Your partner API key |
| `Authorization` | Yes | `Nostr <base64_signed_event>` (NIP-98, signed by the subscriber) |
| `Content-Type` | Yes | `application/json` |

### Body

```json
{
  "tier_id": "tier_abc123",
  "billing": "monthly",
  "subscribe_event": { "kind": 7001, "pubkey": "...", "sig": "..." }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `tier_id` | string | Yes | Tier ID from `GET /v1/creators/{npub}/tiers` |
| `billing` | string | No | `"monthly"` (default) or `"annual"` |
| `subscribe_event` | object | No | Signed NIP-88 kind 7001 event. See below. |

#### `subscribe_event` (optional NIP-88 subscribe event)

If you include a signed kind 7001 event, Nostreon publishes it to public relays on settlement so the subscription appears in NIP-88 aware clients and the kind 7003 payment receipt can reference it.

The event must be signed by the **same pubkey** as the NIP-98 auth event (the subscriber).

Build it with tags:

```json
{
  "kind": 7001,
  "pubkey": "<subscriber_pubkey>",
  "tags": [
    ["p", "<creator_pubkey>"],
    ["a", "37001:<creator_pubkey>:<tier_id>"],
    ["amount", "500", "USD", "monthly"]
  ],
  "content": "",
  "created_at": 1712345678,
  "id": "...",
  "sig": "..."
}
```

The `amount` tag uses cents (stringified). Cadence must match the `billing` field in the body.

### Response

```json
{
  "pending_id": "42a9e1c0-...-....",
  "creator": {
    "bolt11": "lnbc47500n1p...",
    "amount_sats": 7125,
    "amount_usd": 4.75
  },
  "nostreon": {
    "invoice_id": "ABC123XYZ",
    "bolt11": "lnbc2500n1p...",
    "amount_sats": 375,
    "amount_usd": 0.25
  },
  "tier": {
    "id": "tier_abc123",
    "name": "Supporter",
    "price_usd": 5.00
  },
  "billing": "monthly",
  "fee_pct": 0.05,
  "expires_in_seconds": 900,
  "livemode": true
}
```

| Field | Type | Description |
|---|---|---|
| `pending_id` | string (UUID) | Use with `GET /v1/subscribe/invoices/status` to poll settlement |
| `creator` | object | Creator-side invoice (LUD-21 bolt11 against the creator's Lightning address) |
| `creator.bolt11` | string | BOLT11 Lightning invoice to pay the creator |
| `creator.amount_sats` | number | Invoice amount in satoshis |
| `creator.amount_usd` | number | Creator's share in USD (after platform fee) |
| `nostreon` | object \| null | Nostreon fee invoice. `null` when the creator is in the free-tier promo (0% fee). |
| `nostreon.invoice_id` | string | BTCPay invoice ID |
| `nostreon.bolt11` | string | BOLT11 Lightning invoice for the platform fee |
| `nostreon.amount_sats` | number \| null | Invoice amount in satoshis |
| `nostreon.amount_usd` | number | Platform fee in USD |
| `tier` | object | Tier info for display |
| `billing` | string | Confirmed billing period (`"monthly"` or `"annual"`) |
| `fee_pct` | number | Platform fee rate applied (`0.05` or `0`) |
| `expires_in_seconds` | number | Time until the pending subscription abandons. Default 900 (15 min). |
| `livemode` | boolean | `true` in production |

### How to pay

Both invoices must settle for the subscription to activate. Order doesn't matter. The subscriber's wallet can pay them sequentially or in parallel.

1. Display both BOLT11 invoices to the subscriber. Most wallets can pay multiple invoices in a batch; WebLN's `webln.sendPayment` can also be called twice.
2. If `nostreon` is `null` (free-tier promo), only the creator invoice needs to be paid.
3. Poll `GET /v1/subscribe/invoices/status?pending_id=...` every 2-3 seconds until `status: "settled"`.

Nostreon reconciles settlements via:
- LUD-21 `verify` URL for the creator side (polled every few seconds on the server too)
- BTCPay webhook for the Nostreon-fee side

As soon as both arrive, Nostreon publishes the NIP-63 kind 1163 membership event, kind 7003 payment receipt, and the subscriber's signed kind 7001 (if provided) to public + gated relays.

### Errors

| Status | When |
|---|---|
| `400` | Missing `tier_id`, invalid JSON, invalid `billing`, or an invalid `subscribe_event` |
| `400` with `code: "lud21_unsupported"` | Creator's Lightning service does not support LUD-21 verify (required for non-custodial checkout). The subscriber cannot subscribe via dual-invoice for this creator; fall back to zap-split if their wallet supports it. |
| `401` | Missing/invalid API key or NIP-98 auth failed |
| `404` | Tier not found |
| `429` | Rate limited |
| `500` | BTCPay / LNURL resolution failed |
| `502` | Could not resolve creator's LN address or could not fetch BTC/USD rate |

---

## Poll pending subscription status

```
GET /v1/subscribe/invoices/status?pending_id=xxx
```

Poll this every 2-3 seconds after creating a pending subscription until `status: "settled"`. Typical confirmation is under 10 seconds once both invoices are paid.

### Headers

| Header | Required | Description |
|---|---|---|
| `X-Api-Key` | Yes | Your partner API key |

NIP-98 is not required. The `pending_id` is a UUID and not guessable.

### Example request

```bash
curl "https://nostreon.com/api/v1/subscribe/invoices/status?pending_id=42a9e1c0-..." \
  -H "X-Api-Key: npk_live_..."
```

### Response

```json
{
  "pending_id": "42a9e1c0-...-....",
  "creator_paid": true,
  "nostreon_paid": true,
  "status": "settled",
  "subscription_id": "9fa1d8f8-...-....",
  "expires_at": "2026-04-22T14:47:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `pending_id` | string | Echoes the query param |
| `creator_paid` | boolean | Creator invoice has settled |
| `nostreon_paid` | boolean | Nostreon fee invoice has settled (always `true` if the creator is in the free-tier promo) |
| `status` | string | See status values below |
| `subscription_id` | string \| null | Set when `status = "settled"`. Use this as the stable subscription identifier. |
| `expires_at` | string (ISO-8601) | When the pending subscription abandons if not yet settled |

#### Status values

| Status | Meaning |
|---|---|
| `pending` | Waiting for one or both invoices to settle |
| `settled` | Both sides paid. NIP-63 kind 1163, kind 7003, and kind 7001 (if provided) are published. Subscription is active. |
| `partial_expired` | Pending expired with one side paid. Subscriber should be refunded manually by contacting support (non-custodial: Nostreon cannot auto-refund). |
| `abandoned` | Pending expired with neither side paid. No action needed. |
| `not_found` | `pending_id` doesn't match any row |

### When `status: "settled"`

The subscription is active. Nostreon has:

1. Created the subscription record (`subscription_id`, `subscriber_npub`, `tier_id`, `expires_at`)
2. Published a kind `1163` NIP-63 membership event to the public + gated relays
3. Published a kind `7003` payment receipt tagging the kind 7001 subscribe event (if provided)

No creator payout or referral payout happens on Nostreon's side - funds are already at each recipient (creator's LN address and Nostreon's LN node, and, for zap-split subs, the partner's LN node).

The user can now access premium content from Nostreon's gated relay (`wss://premium.nostreon.com`) or any NIP-42 + NIP-63 aware relay.

### Errors

| Status | When |
|---|---|
| `400` | Missing `pending_id` |
| `401` | Missing or invalid API key |
| `404` | `pending_id` not found |
| `429` | Rate limited |
| `500` | Database or LNURL probe failed |

---

## Delete a test subscription (test mode only)

```
DELETE /v1/subscribe?invoice_id=test_xxx
```

Retained from the custodial era so partners can still clean up test rows created during integration testing. Only works for test subscriptions with an `invoice_id` that starts with `test_`.

**Restrictions:**
- Only works with `npk_test_*` keys
- Only deletes subscriptions whose `invoice_id` starts with `test_`
- Only deletes subscriptions created by **your** API key (partners can't delete each other's test data)
- Live subscriptions cannot be deleted via this endpoint - use the standard cancellation flow

### Headers

| Header | Required | Description |
|---|---|---|
| `X-Api-Key` | Yes | Your `npk_test_*` API key |

### Example request

```bash
curl -X DELETE "https://dev.nostreon.com/api/v1/subscribe?invoice_id=test_abc123" \
  -H "X-Api-Key: npk_test_..."
```

### Response

```json
{
  "deleted": 1,
  "livemode": false
}
```

| Field | Type | Description |
|---|---|---|
| `deleted` | number | Number of rows removed (0 or 1) |
| `livemode` | boolean | Always `false` for this endpoint |

### Errors

| Status | When |
|---|---|
| `400` | Missing `invoice_id` or `invoice_id` doesn't start with `test_` |
| `401` | Missing or invalid API key |
| `403` | Using a live key (not allowed) |
| `500` | Database error |

---

## Deprecated: `POST /v1/subscribe` (custodial, removed 2026-04-17)

Returns `410 Gone` with:

```json
{
  "error": "Gone",
  "code": "custodial_subscribe_deprecated",
  "message": "The single-invoice custodial subscribe endpoint has been removed. Use POST /api/v1/subscribe/invoices for the non-custodial dual-invoice flow.",
  "replacement": "/api/v1/subscribe/invoices",
  "docs": "https://github.com/nostreon/nostreon/blob/main/NON_CUSTODIAL_ARCHITECTURE.md"
}
```

**Migration:** point your POST at `/v1/subscribe/invoices` and handle two bolt11s in the response instead of one. Poll `/v1/subscribe/invoices/status?pending_id=X` instead of `/v1/subscribe/status?invoice_id=X`. The NIP-98 auth flow is unchanged except for the URL and the new response shape.
