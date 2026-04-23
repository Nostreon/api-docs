# Zap-split subscribe (zap-prepare)

The primary non-custodial subscribe path for zap-aware wallets. Returns the full list of recipients (creator, Nostreon, and optionally your partner wallet) with sats amounts and relay hints. The subscriber's wallet then signs one kind 9734 zap-request per recipient and pays them as a batch.

Compared to [dual-invoice](./subscriptions.md#create-a-dual-invoice-subscription):

| | Zap-split | Dual-invoice |
|---|---|---|
| Wallet requirements | Must support NIP-57 zaps; zap-split awareness ideal | Any Lightning wallet |
| Invoices per subscribe | 2-3 (creator, Nostreon, partner if present) | 2 (creator, Nostreon) |
| Partner revenue share | **Yes** - paid directly to partner's LN address | **No** - only attributed for analytics |
| HTTP writes | 0 (preparation only, no pending row is created) | 1 pending row |
| Settlement detection | Nostreon listens for kind 9735 zap receipts | LUD-21 verify + BTCPay webhook |

**Use this path when your app has a built-in wallet** (Primal, some Damus users with NWC configured). Fall back to dual-invoice when you don't know what the subscriber is using.

---

## Prepare a zap-split subscription

```
GET /v1/subscribe/zap-prepare?tier_id=...&billing=monthly
```

Returns everything your wallet needs to build and sign kind 9734 zap requests for the subscription. Does **not** create a pending row; nothing persists server-side from this call.

### Headers

| Header | Required | Description |
|---|---|---|
| `X-Api-Key` | Yes | Your partner API key |
| `Authorization` | Yes | `Nostr <base64_signed_event>` (NIP-98 over the request URL + method, no body) |

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `tier_id` | string | Yes | Tier ID from `GET /v1/creators/{npub}/tiers` |
| `billing` | string | No | `"monthly"` (default) or `"annual"` |

### Example request

```bash
curl "https://nostreon.com/api/v1/subscribe/zap-prepare?tier_id=tier_abc123&billing=monthly" \
  -H "X-Api-Key: npk_live_..." \
  -H "Authorization: Nostr eyJraW5kIjoyNzIzNSwi..."
```

### Response

```json
{
  "tier": { "id": "tier_abc123", "name": "Supporter", "price_usd": 5.00 },
  "tier_addr": "37001:c9df8889.../tier_abc123",
  "billing": "monthly",
  "amount_usd": 5.00,
  "amount_sats": 7500,
  "partner": {
    "pubkey": "abcdef0123...",
    "api_key_id": "d3bc1a8e-...-....",
    "client_name": "Primal",
    "share_pct": 50,
    "amount_sats": 187
  },
  "recipients": [
    {
      "role": "creator",
      "pubkey": "c9df8889...",
      "ln_address": "jane@getalby.com",
      "amount_sats": 7125,
      "weight": 95,
      "relay_hint": "wss://relay.nostreon.com"
    },
    {
      "role": "nostreon",
      "pubkey": "f000...",
      "ln_address": "fees@nostreon.com",
      "amount_sats": 188,
      "weight": 3,
      "relay_hint": "wss://relay.nostreon.com"
    },
    {
      "role": "partner",
      "pubkey": "abcdef0123...",
      "ln_address": "primal@strike.me",
      "amount_sats": 187,
      "weight": 3,
      "relay_hint": "wss://relay.nostreon.com"
    }
  ],
  "relays": [
    "wss://relay.nostreon.com",
    "wss://nos.lol",
    "wss://relay.damus.io"
  ],
  "livemode": true
}
```

### Response fields

| Field | Type | Description |
|---|---|---|
| `tier` | object | Tier info for display |
| `tier_addr` | string | NIP-01 addressable reference `37001:<creator_pubkey>:<tier_id>`. Include as an `a` tag in each zap request. |
| `billing` | string | Echoes the query param |
| `amount_usd` | number | Total subscription price in USD (with annual discount applied if `billing=annual`) |
| `amount_sats` | number | Total subscription price in satoshis at the BTC/USD rate at request time. **Sum of `recipients[].amount_sats`.** |
| `partner` | object \| null | Present when your API key has a `partner_pubkey` AND a non-zero partner share was carved out (see "Fee-free subscriptions" below) |
| `partner.share_pct` | number | Your configured `revenue_share_pct` |
| `partner.amount_sats` | number | Partner's share in sats |
| `recipients` | array | Each zap recipient with pubkey, LN address, sats amount, weight, and relay hint |
| `recipients[].role` | string | `"creator"`, `"nostreon"`, or `"partner"` |
| `recipients[].pubkey` | string | 64-char hex pubkey. Use as the `p` tag target of the kind 9734 zap request. |
| `recipients[].ln_address` | string \| null | LUD-16 lightning address. Use to fetch the recipient's callback URL via `https://<domain>/.well-known/lnurlp/<name>`. |
| `recipients[].amount_sats` | number | Millisats = `amount_sats * 1000` for the `amount` tag |
| `recipients[].weight` | number | Relative weight out of 100 for UI display (e.g. "95% to creator"). Sum may be 99 or 100 due to rounding. |
| `recipients[].relay_hint` | string | Relay where the recipient is expected to see the resulting kind 9735 receipt |
| `relays` | string[] | Full relay set. Include in the zap request's `relays` tag so the LN service knows where to publish the kind 9735 receipt. |
| `livemode` | boolean | `true` when called with a live key |

### Fee-free subscriptions

The first $1,000 of a creator's lifetime revenue is platform-fee-free. When the current subscription is below that threshold:

- `nostreonFee = 0`, so no `nostreon` recipient is included
- `referrerFee = 0`, so no `partner` recipient is included (and top-level `partner` is `null`)
- `creatorAmount = amountUsd`, so the creator receives 100%

Partners **do not earn** on fee-free subscriptions. This is by design - creators keep every sat until they cross the threshold. See [NON_CUSTODIAL_ARCHITECTURE.md §7.1](https://github.com/nostreon/nostreon/blob/main/NON_CUSTODIAL_ARCHITECTURE.md).

### How to use the response

For each recipient in `recipients`:

1. Fetch the recipient's LNURL-pay params via their `ln_address` (standard LUD-16 resolution).
2. Build a kind 9734 zap request with:
   - `tags`:
     - `["p", recipient.pubkey]`
     - `["a", tier_addr]` - ties this zap to the NIP-88 tier
     - `["amount", String(recipient.amount_sats * 1000)]` - millisats
     - `["relays", ...relays]`
   - `pubkey`: the subscriber's pubkey (same as NIP-98 auth)
   - `kind`: 9734
3. Sign the zap request with the subscriber's key.
4. POST the signed event (encoded per NIP-57) to the LNURL callback with `nostr=<encoded>&amount=<millisats>`.
5. Receive the BOLT11 invoice back. Pay it with your wallet.

Repeat for each recipient (2 or 3 invoices). When all settle, the recipients' LN services publish kind 9735 zap receipts, which Nostreon's listener picks up and uses to finalise the subscription (publishes kind 1163 + 7003).

### Subscriber should publish kind 7001 too

Unlike dual-invoice, zap-prepare does not accept a `subscribe_event` in the request. Your client should publish the subscriber's signed kind 7001 event to public relays separately, ideally right after all zap payments settle. Nostreon's finaliser does not require the kind 7001 to issue membership, but NIP-88 aware clients expect it to render the subscription.

### Errors

| Status | When |
|---|---|
| `400` | Missing `tier_id`, invalid `billing`, tier inactive, or creator has no Lightning address |
| `401` | Missing/invalid API key or NIP-98 auth failed |
| `404` | Tier or creator not found |
| `429` | Rate limited |
| `500` | Creator npub could not be decoded |
| `502` | Could not fetch BTC/USD rate |

### Rate limit

30 requests / minute per API key.

---

## Complete example (pseudocode)

```ts
const prep = await fetch(
  `${API}/v1/subscribe/zap-prepare?tier_id=${tierId}&billing=monthly`,
  { headers: { "X-Api-Key": key, Authorization: nip98 } }
).then((r) => r.json());

for (const recipient of prep.recipients) {
  const lnurlp = await resolveLnurlp(recipient.ln_address);
  const zapRequest = await signZapRequest({
    subscriberNsec,
    recipient: recipient.pubkey,
    tierAddr: prep.tier_addr,
    amountMsats: recipient.amount_sats * 1000,
    relays: prep.relays,
  });
  const bolt11 = await fetchInvoiceWithZap(lnurlp.callback, zapRequest);
  await wallet.pay(bolt11);
}

// Poll NIP-63 kind 1163 on gated relay, or rely on Nostreon's listener to
// publish it within ~10 seconds of the last zap settling.
```
