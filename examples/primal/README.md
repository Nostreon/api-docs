# Primal integration example

How to embed Nostreon subscriptions in a Primal client (web, iOS, or Android). The example below is for [Primal Web](https://primal.net) (React/TypeScript), but the same flow works in any Primal surface that has access to the user's Nostr key and a Lightning wallet.

## User experience

When a Primal user opens a creator's profile and that creator has subscription tiers on Nostreon:

1. Primal calls `GET /api/v1/creators/{npub}/tiers` to discover the tiers
2. Primal renders a "Subscribe" button alongside the existing follow/zap buttons
3. The user taps a tier — Primal shows a native sheet with tier name, price, and "Pay $5/month with Primal Wallet"
4. The user confirms — Primal calls `POST /api/v1/subscribe`, gets a BOLT11 invoice, pays it with the built-in Primal Wallet, and shows "Subscribed" inline
5. The subscription is active immediately; Primal can refresh the user's gated content from the relays

Total time from tap to confirmation: under 5 seconds. The user never leaves Primal, never sees a QR code, never opens a browser.

## Why Primal is the ideal surface

Primal has the rare combination of Nostr key management *and* a native Lightning wallet, which makes the API integration trivial: you sign the auth event with the key you already have, and you pay the invoice with the wallet you already have. No third-party redirects.

For Primal users who haven't enabled Primal Wallet, fall back to either:
- A `lightning:` deep link that opens the user's external wallet (Wallet of Satoshi, Phoenix, etc.)
- The [hosted checkout page](../../endpoints/subscriptions.md#hosted-checkout) (one-line redirect)

## Integration

The code below is structured as a single `subscribeToCreator` function you'd call from a React component. It assumes Primal exposes:
- A `signEvent` method on its key manager (any Nostr client has one)
- A `payInvoice` method on Primal Wallet (or any NWC-compatible wallet)

Substitute those with your client's actual APIs.

```typescript
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

const NOSTREON_API = "https://nostreon.com/api/v1";
const NOSTREON_API_KEY = process.env.NOSTREON_API_KEY!; // your partner key

interface Tier {
  id: string;
  name: string;
  price_usd: number;
}

interface SubscribeResponse {
  invoice_id: string;
  bolt11: string;
  amount_sats: number;
  amount_usd: number;
  tier: Tier;
}

/**
 * Subscribe the current Primal user to a creator tier.
 * Returns when payment settles.
 */
export async function subscribeToCreator(
  creatorNpub: string,
  tier: Tier,
  billing: "monthly" | "annual" = "monthly"
): Promise<{ success: true; expiresAt: number } | { success: false; error: string }> {
  // 1. Build the request body
  const body = JSON.stringify({ tier_id: tier.id, billing });

  // 2. Build the NIP-98 auth event
  // The payload tag must be sha256 of the raw body for POST requests
  const payloadHash = bytesToHex(sha256(body));
  const url = `${NOSTREON_API}/subscribe`;

  // primal.signEvent is whatever your client uses to sign Nostr events
  // (the same call you use for kind 1 notes, kind 7 reactions, etc.)
  const authEvent = await primal.signEvent({
    kind: 27235, // NIP-98 HTTP Auth
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", "POST"],
      ["payload", payloadHash],
    ],
    content: "",
  });

  const authHeader = `Nostr ${btoa(JSON.stringify(authEvent))}`;

  // 3. POST /v1/subscribe to get a Lightning invoice
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": NOSTREON_API_KEY,
      Authorization: authHeader,
    },
    body,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { success: false, error: err.error || `HTTP ${res.status}` };
  }

  const data: SubscribeResponse = await res.json();

  // 4. Pay the invoice with Primal Wallet
  // primal.wallet.payInvoice is whatever Primal exposes for its built-in wallet.
  // If your wallet is NWC-based, this is `nwc.makeInvoicePayment(bolt11)`.
  try {
    await primal.wallet.payInvoice(data.bolt11);
  } catch (err) {
    return { success: false, error: `Payment failed: ${err}` };
  }

  // 5. Poll for settlement (usually instant after Lightning success)
  for (let i = 0; i < 30; i++) {
    const statusRes = await fetch(
      `${NOSTREON_API}/subscribe/status?invoice_id=${data.invoice_id}`,
      { headers: { "X-Api-Key": NOSTREON_API_KEY } }
    );
    const status = await statusRes.json();
    if (status.paid) {
      return { success: true, expiresAt: status.expires_at };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  return { success: false, error: "Timed out waiting for settlement" };
}
```

## Discovering tiers

Render a Subscribe button on creator profiles only when Nostreon has tiers for that npub:

```typescript
async function fetchNostreonTiers(npub: string): Promise<Tier[]> {
  const res = await fetch(`${NOSTREON_API}/creators/${npub}/tiers`);
  if (!res.ok) return []; // creator has no tiers, hide the button
  const { tiers } = await res.json();
  return tiers;
}
```

This endpoint requires no auth and is rate-limited to 60 req/min per IP, so it's safe to call on every profile view (cache the result for ~5 minutes).

## Showing the subscription state

Once subscribed, the user has access to gated content via NIP-63 kind 1163 membership events, which Nostreon publishes to the gated relay automatically. To show "Subscribed" status in Primal, query the gated relay (`wss://premium.nostreon.com`) for kind 1163 events tagged with the user's pubkey:

```typescript
import { SimplePool } from "nostr-tools";

const pool = new SimplePool();
const events = await pool.querySync(
  ["wss://premium.nostreon.com"],
  { kinds: [1163], "#p": [userHexPubkey] }
);

// Each event carries a NIP-40 expiration tag with the unix timestamp
const activeMembership = events.find((e) => {
  const exp = e.tags.find((t) => t[0] === "expiration");
  return exp && parseInt(exp[1]) > Date.now() / 1000;
});
```

This is purely Nostr — no Nostreon API call needed for state. If the user later subscribes via a different client, Primal will see the same kind 1163 event.

## Get an API key

[Open an issue](https://github.com/Nostreon/api-docs/issues/new) on this repo with your client name, npub (for delivery via NIP-04 DM), and a Lightning address for referral payouts. We'll send you a `npk_test_*` key for development and a `npk_live_*` key once you're ready to ship.
