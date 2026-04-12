# Creators

Public read-only endpoints for fetching creator profiles and tiers. No authentication required.

Both endpoints accept **either** an `npub1...` string or a 64-character hex pubkey as the path parameter.

---

## Get creator profile

```
GET /v1/creators/{npub_or_hex}
```

Returns basic creator info without tiers.

### Example request

```bash
curl https://nostreon.com/api/v1/creators/npub1e80ugn39xl9zr8smljugd3u3te8233g62j2rt5gl4u4j4pymd6zshhu2w9
```

### Example response

```json
{
  "creator": {
    "npub": "npub1e80ugn39xl9zr8smljugd3u3te8233g62j2rt5gl4u4j4pymd6zshhu2w9",
    "pubkey": "c9df8889...",
    "display_name": "Jane Doe",
    "avatar_url": "https://example.com/avatar.jpg",
    "banner_url": "https://example.com/banner.jpg",
    "bio": "Writing about Bitcoin and Nostr.",
    "creator_type": "writer",
    "annual_discount_pct": 20,
    "nip05": "jane@nostreon.com"
  }
}
```

### Response fields

| Field | Type | Description |
|---|---|---|
| `npub` | string | Creator's npub |
| `pubkey` | string | 64-char hex pubkey |
| `display_name` | string \| null | Display name from Nostr profile |
| `avatar_url` | string \| null | Profile picture URL |
| `banner_url` | string \| null | Banner image URL |
| `bio` | string \| null | Creator's bio |
| `creator_type` | string \| null | e.g. `"writer"`, `"artist"` |
| `annual_discount_pct` | number | Annual billing discount (0-30) |
| `nip05` | string \| null | NIP-05 identifier, if claimed |

### Errors

| Status | When |
|---|---|
| `400` | Invalid npub or hex pubkey format |
| `404` | Creator not found |

---

## Get creator tiers

```
GET /v1/creators/{npub_or_hex}/tiers
```

Returns all active subscription tiers for a creator. Use this to display subscription options in your UI.

### Example request

```bash
curl https://nostreon.com/api/v1/creators/npub1.../tiers
```

### Example response

```json
{
  "creator": {
    "npub": "npub1...",
    "pubkey": "c9df8889...",
    "display_name": "Jane Doe",
    "avatar_url": "https://example.com/avatar.jpg",
    "bio": "Writing about Bitcoin and Nostr.",
    "annual_discount_pct": 20
  },
  "tiers": [
    {
      "id": "tier_abc123",
      "name": "Supporter",
      "description": "Basic support tier",
      "price_usd": 5.00,
      "image_url": null,
      "perks": [
        "Access to premium articles",
        "Subscriber-only chat"
      ],
      "is_featured": false
    },
    {
      "id": "tier_def456",
      "name": "Patron",
      "description": "Full access tier",
      "price_usd": 15.00,
      "image_url": "https://example.com/patron.png",
      "perks": [
        "All Supporter perks",
        "Monthly livestream",
        "Direct message access"
      ],
      "is_featured": true
    }
  ]
}
```

### Response fields

**`creator`** — same as the profile endpoint (minus banner and creator_type).

**`tiers`** — array of active tiers ordered by `sort_order` then `price_usd` ascending.

| Field | Type | Description |
|---|---|---|
| `id` | string | Tier ID (use in `/v1/subscribe` request) |
| `name` | string | Tier name (e.g. "Supporter") |
| `description` | string \| null | Tier description |
| `price_usd` | number | Monthly price in USD |
| `image_url` | string \| null | Tier badge/image URL |
| `perks` | string[] | List of perks included in this tier |
| `is_featured` | boolean | True if this is the "most popular" tier |

### Annual billing

To calculate the annual price with discount:

```
annualPrice = price_usd * 12 * (1 - annual_discount_pct / 100)
```

For example, a $5/month tier with 20% discount = $5 × 12 × 0.8 = **$48/year**.

Pass `"billing": "annual"` to `POST /v1/subscribe` to charge the discounted annual price.

### Errors

| Status | When |
|---|---|
| `400` | Invalid npub or hex pubkey format |
| `404` | Creator not found |
