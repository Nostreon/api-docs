# Partners

Partner-facing analytics for your own API key. Lets you display referrals + revenue share inside your own client dashboard (e.g. "You've driven $420 of subscriptions this month on Nostreon").

Authed with your `X-Api-Key` only - no NIP-98 needed. A partner can only ever read the stats attributed to its own key.

---

## Get partner stats

```
GET /v1/partners/stats
```

Returns aggregate counts, attributed GMV (gross merchandise value), and earnings buckets for subscriptions referred through your API key.

### Headers

| Header | Required | Description |
|---|---|---|
| `X-Api-Key` | Yes | Your partner API key |

### Query parameters

| Param | Type | Description |
|---|---|---|
| `from` | string (ISO-8601 date) | Only include subscriptions started on or after this date. Filter also applied to `referral_payouts.created_at`. |
| `to` | string (ISO-8601 date) | Only include subscriptions started strictly before this date. |

Both are optional. Omit both for all-time stats.

### Example request

```bash
# All-time
curl https://nostreon.com/api/v1/partners/stats \
  -H "X-Api-Key: npk_live_..."

# This month
curl "https://nostreon.com/api/v1/partners/stats?from=2026-04-01&to=2026-05-01" \
  -H "X-Api-Key: npk_live_..."
```

### Example response

```json
{
  "partner": {
    "client_name": "Primal",
    "revenue_share_pct": 50,
    "partner_pubkey": "c9df8889...",
    "mode": "live"
  },
  "subscriptions": {
    "total": 42,
    "active": 30,
    "last_30_days": 5,
    "via_zap_split": 12,
    "via_custodial_payout": 30
  },
  "gmv_usd": {
    "total": 210.00,
    "last_30_days": 25.00,
    "via_zap_split": 60.00
  },
  "earnings_usd": {
    "paid_out": 20.00,
    "pending_payout": 0.50,
    "failed_payout": 0,
    "no_lightning_address": 0
  },
  "notes": {
    "earnings_scope": "`earnings_usd` only reflects the pre-Phase-3 custodial flow where Nostreon settled the referrer share. Phase-3+ subscriptions pay partners directly via zap-split (see `subscriptions.via_zap_split`); those sats don't touch Nostreon's books - reconcile against your Lightning wallet history.",
    "gmv_definition": "`gmv_usd` is the sum of tier list prices (monthly-equivalent) across attributed subscriptions. Annual subscriptions count once at the monthly price."
  },
  "period": {
    "from": null,
    "to": null
  },
  "generated_at": "2026-04-22T14:32:11.042Z"
}
```

### Response fields

**`partner`** - identifies the key that made the request.

| Field | Type | Description |
|---|---|---|
| `client_name` | string | Your client name as registered with Nostreon |
| `revenue_share_pct` | number | Your share of the platform fee (default 50) |
| `partner_pubkey` | string \| null | Hex pubkey used for zap-split payments (Phase 4). Nullable for older keys. |
| `mode` | string | `"live"` or `"test"` - derived from the key prefix |

**`subscriptions`** - counts of subscriptions attributed to your key.

| Field | Type | Description |
|---|---|---|
| `total` | number | All subscriptions ever referred by your key (within date range if provided) |
| `active` | number | Currently active: `status = 'active'` AND `expires_at > now()` |
| `last_30_days` | number | Subscriptions started in the last 30 days (ignores `from`/`to` filters) |
| `via_zap_split` | number | Subscriptions settled via zap-split - partner paid directly from subscriber wallet |
| `via_custodial_payout` | number | Pre-Phase-3 subscriptions where Nostreon paid the partner share from its own wallet |

**`gmv_usd`** - attributed subscription volume. Sum of tier list prices (monthly-equivalent).

| Field | Type | Description |
|---|---|---|
| `total` | number | Total attributed GMV |
| `last_30_days` | number | GMV in the last 30 days |
| `via_zap_split` | number | GMV from zap-split subscriptions only |

**`earnings_usd`** - payouts from `referral_payouts`, bucketed by status. **See important caveat below.**

| Field | Type | Description |
|---|---|---|
| `paid_out` | number | Partner share that has been paid to your Lightning address |
| `pending_payout` | number | Owed but not yet sent (typically settles within minutes) |
| `failed_payout` | number | Payout attempt failed (retried automatically; contact us if this stays non-zero) |
| `no_lightning_address` | number | Owed but no Lightning address on file for your key |

**`period`** - echoes the `from`/`to` filters. `null` means unbounded.

**`generated_at`** - ISO-8601 timestamp when the response was computed. Not cached - each request runs fresh queries.

### Earnings caveat (read this)

`earnings_usd` only reflects the **pre-Phase-3 custodial flow**. In that older flow, subscribers paid Nostreon a single invoice, we took our cut, paid the creator, and paid your partner share to your Lightning address. Those settlements are what `referral_payouts` records.

In the current (Phase 3+) **non-custodial zap-split flow**, subscribers pay each recipient directly from their wallet - creator, Nostreon, and you (if you have a `partner_pubkey` on file). Those sats never touch Nostreon's books, so they don't appear in `earnings_usd`. What you do get is the count and GMV:

- `subscriptions.via_zap_split` - how many zap-split subs were attributed to you
- `gmv_usd.via_zap_split` - total monthly-equivalent USD value of those subs

To estimate your earnings from zap-split subs, multiply by your `revenue_share_pct` and the platform fee rate:

```
zap_split_earnings ≈ gmv_usd.via_zap_split × 0.05 × revenue_share_pct / 100
```

This is an approximation (creators in the $1k free-tier promo pay 0% platform fee, so your share is $0 for those subs). For authoritative numbers, reconcile against your own Lightning wallet history using the zap receipt IDs recorded on the Nostr side.

### Errors

| Status | When |
|---|---|
| `400` | Invalid `from` or `to` date (not parseable as ISO-8601) |
| `401` | Missing or invalid API key |
| `429` | Rate limited |
| `500` | Database error |

### Rate limit

60 requests / minute per API key. This endpoint is intended to be called on dashboard load, not polled.

### Privacy

Only aggregates are returned - no subscriber npubs, no per-subscription rows, no creator identities. Partners can only see their own numbers, never another partner's.
