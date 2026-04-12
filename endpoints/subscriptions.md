# Subscriptions

Create subscriptions on behalf of users. Requires an API key and NIP-98 HTTP auth. See [authentication.md](../authentication.md) for details.

---

## Create a subscription

```
POST /v1/subscribe
```

Creates a Lightning invoice for a user to pay. The user's subscription is activated automatically when the invoice settles.

### Headers

| Header | Required | Description |
|---|---|---|
| `X-Api-Key` | Yes | Your partner API key |
| `Authorization` | Yes | `Nostr <base64_signed_event>` (NIP-98) |
| `Content-Type` | Yes | `application/json` |

### Body

```json
{
  "tier_id": "tier_abc123",
  "billing": "monthly"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `tier_id` | string | Yes | Tier ID from `GET /v1/creators/{npub}/tiers` |
| `billing` | string | No | `"monthly"` (default) or `"annual"` |

### Response

```json
{
  "invoice_id": "ABC123XYZ",
  "checkout_url": "https://btcpay.nostreon.com/i/ABC123XYZ",
  "bolt11": "lnbc50000n1p...",
  "amount_sats": 5000,
  "amount_usd": 5.00,
  "tier": {
    "id": "tier_abc123",
    "name": "Supporter",
    "price_usd": 5.00
  },
  "billing": "monthly"
}
```

| Field | Type | Description |
|---|---|---|
| `invoice_id` | string | Use with `GET /v1/subscribe/status` to poll |
| `checkout_url` | string | Full BTCPay checkout page (fallback if you can't render Lightning natively) |
| `bolt11` | string \| null | BOLT11 Lightning invoice — display as QR code or pass to a wallet |
| `amount_sats` | number \| null | Invoice amount in satoshis |
| `amount_usd` | number | Invoice amount in USD (includes annual discount if applicable) |
| `tier` | object | Tier info for display |
| `billing` | string | Confirmed billing period |

### What you should do with the response

1. Display the Lightning invoice (`bolt11`) as a QR code, or use WebLN / NWC to trigger payment automatically
2. Show the amount and billing period to the user
3. Poll `GET /v1/subscribe/status?invoice_id=...` until `paid: true`
4. Show a success state

Do not store the subscription yourself — Nostreon tracks it in the database and publishes a NIP-63 membership event automatically.

### Errors

| Status | When |
|---|---|
| `400` | Missing `tier_id`, invalid JSON, or invalid `billing` value |
| `401` | Missing/invalid API key or NIP-98 auth failed |
| `404` | Tier not found |
| `429` | Rate limited |
| `500` | BTCPay invoice creation failed |

---

## Poll payment status

```
GET /v1/subscribe/status?invoice_id=xxx
```

Poll this every 2-3 seconds after creating an invoice until `paid: true`. Typical confirmation is under 10 seconds for Lightning.

### Headers

| Header | Required | Description |
|---|---|---|
| `X-Api-Key` | Yes | Your partner API key |

NIP-98 is not required here — the `invoice_id` is not guessable.

### Example request

```bash
curl "https://nostreon.com/api/v1/subscribe/status?invoice_id=ABC123XYZ" \
  -H "X-Api-Key: npk_live_..."
```

### Response

```json
{
  "status": "Settled",
  "paid": true
}
```

| Field | Type | Values |
|---|---|---|
| `status` | string | `"New"`, `"Processing"`, `"Settled"`, `"Expired"`, `"Invalid"` |
| `paid` | boolean | `true` only when `status === "Settled"` |

### When `paid: true`

The user's subscription is active. Nostreon has:

1. Created the subscription record (`subscriber_npub`, `tier_id`, expiration)
2. Paid the creator via their Lightning address
3. Paid your referral share via your configured Lightning address
4. Published a kind `1163` NIP-63 membership event to the relay

The user can now access premium content from Nostreon's gated relay (`wss://premium.nostreon.com`) or any NIP-63 compatible relay. They will appear in your app's subscription UI without needing to visit nostreon.com.

### Errors

| Status | When |
|---|---|
| `400` | Missing `invoice_id` |
| `401` | Missing or invalid API key |
| `500` | BTCPay query failed |
