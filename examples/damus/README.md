# Damus integration example

How to embed Nostreon subscriptions in [Damus](https://damus.io), the iOS Nostr client written in Swift. Damus has full access to the user's Nostr key but no built-in Lightning wallet, so the integration uses a `lightning:` deep link to hand off payment to the user's preferred wallet (Wallet of Satoshi, Phoenix, Cash App, Strike, etc.).

## User experience

1. The user opens a creator's profile in Damus
2. Damus calls `GET /api/v1/creators/{npub}/tiers` and renders a "Subscribe" button next to the existing zap button
3. The user taps a tier — Damus shows a sheet with tier name and price
4. The user taps "Pay with Lightning" — Damus calls `POST /api/v1/subscribe`, gets a BOLT11 invoice, and opens `lightning:lnbc...` which hands off to the user's default wallet app
5. The user confirms in their wallet app and returns to Damus
6. Damus polls `GET /api/v1/subscribe/status` and shows "Subscribed" once settled

The wallet handoff adds one tap compared to clients with a built-in wallet, but it works with any Lightning wallet the user already trusts. No new wallet setup, no new credentials.

## Integration

The code below is structured as a single `subscribeToCreator` function you'd call from a SwiftUI view. It assumes Damus exposes:
- A signing function on its key store (Damus already signs kind 1, kind 7, kind 9734 zap requests, etc.)
- A way to compute SHA-256 (CryptoKit is in iOS 13+)

```swift
import Foundation
import CryptoKit

let NOSTREON_API = "https://nostreon.com/api/v1"
let NOSTREON_API_KEY = "npk_live_..." // your partner key, stored in Keychain

struct Tier: Codable {
    let id: String
    let name: String
    let price_usd: Double
}

struct SubscribeResponse: Codable {
    let invoice_id: String
    let bolt11: String
    let amount_sats: Int
    let amount_usd: Double
    let tier: Tier
}

struct StatusResponse: Codable {
    let paid: Bool
    let expires_at: Int?
}

enum SubscribeError: Error {
    case httpError(Int)
    case decodingError
    case notSettled
    case walletNotFound
}

/// Subscribe the current Damus user to a creator tier.
/// Opens the user's Lightning wallet via a deep link, then polls for settlement.
func subscribeToCreator(
    creatorNpub: String,
    tier: Tier,
    billing: String = "monthly"
) async throws -> Int {
    // 1. Build the request body
    let bodyDict: [String: Any] = ["tier_id": tier.id, "billing": billing]
    let bodyData = try JSONSerialization.data(withJSONObject: bodyDict)
    let bodyString = String(data: bodyData, encoding: .utf8)!

    // 2. Build the NIP-98 auth event
    // The payload tag is sha256(raw body) for POST requests
    let payloadHash = SHA256.hash(data: bodyData).map { String(format: "%02x", $0) }.joined()
    let url = "\(NOSTREON_API)/subscribe"

    // damus.signer.sign is whatever Damus uses internally to sign Nostr events
    // (the same call you use for kind 1 notes, kind 7 reactions, kind 9734 zap requests)
    let authEvent = try await damus.signer.signEvent(
        kind: 27235, // NIP-98 HTTP Auth
        createdAt: Int(Date().timeIntervalSince1970),
        tags: [
            ["u", url],
            ["method", "POST"],
            ["payload", payloadHash],
        ],
        content: ""
    )

    let authEventJson = try JSONEncoder().encode(authEvent)
    let authHeader = "Nostr \(authEventJson.base64EncodedString())"

    // 3. POST /v1/subscribe to get a Lightning invoice
    var request = URLRequest(url: URL(string: url)!)
    request.httpMethod = "POST"
    request.httpBody = bodyData
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(NOSTREON_API_KEY, forHTTPHeaderField: "X-Api-Key")
    request.setValue(authHeader, forHTTPHeaderField: "Authorization")

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
        throw SubscribeError.httpError((response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    let subscribeResponse = try JSONDecoder().decode(SubscribeResponse.self, from: data)

    // 4. Open the user's Lightning wallet via the lightning: URI scheme
    // iOS will pick whichever wallet the user has set as their default Lightning handler
    let lightningURL = URL(string: "lightning:\(subscribeResponse.bolt11)")!
    guard await UIApplication.shared.canOpenURL(lightningURL) else {
        throw SubscribeError.walletNotFound
    }
    await UIApplication.shared.open(lightningURL)

    // 5. Poll for settlement after the user returns from their wallet
    // Settlement is usually instant, but give it up to 60 seconds for slow wallets
    for _ in 0..<30 {
        try await Task.sleep(nanoseconds: 2_000_000_000)
        let status = try await pollStatus(invoiceId: subscribeResponse.invoice_id)
        if status.paid, let expiresAt = status.expires_at {
            return expiresAt
        }
    }

    throw SubscribeError.notSettled
}

func pollStatus(invoiceId: String) async throws -> StatusResponse {
    var request = URLRequest(url: URL(string: "\(NOSTREON_API)/subscribe/status?invoice_id=\(invoiceId)")!)
    request.setValue(NOSTREON_API_KEY, forHTTPHeaderField: "X-Api-Key")
    let (data, _) = try await URLSession.shared.data(for: request)
    return try JSONDecoder().decode(StatusResponse.self, from: data)
}
```

## Discovering tiers

Render a Subscribe button on creator profiles only when Nostreon has tiers for that npub:

```swift
func fetchNostreonTiers(npub: String) async throws -> [Tier] {
    let url = URL(string: "\(NOSTREON_API)/creators/\(npub)/tiers")!
    let (data, response) = try await URLSession.shared.data(from: url)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
        return [] // no tiers, hide the button
    }
    struct TiersResponse: Codable { let tiers: [Tier] }
    return try JSONDecoder().decode(TiersResponse.self, from: data).tiers
}
```

Cache results for ~5 minutes to avoid hitting the rate limit on profile-heavy views.

## Showing the subscription state

Damus already queries Nostr relays for kind 1, kind 7, etc. To detect active Nostreon subscriptions, query `wss://premium.nostreon.com` for kind 1163 events tagged with the user's pubkey and check the NIP-40 `expiration` tag:

```swift
let filter = NostrFilter(
    kinds: [1163],
    pubkeys: nil,
    referenced_pubkeys: [userHexPubkey]
)

// Use Damus's existing relay subscription machinery
relayPool.subscribe(filter: filter) { event in
    let expirationTag = event.tags.first { $0.first == "expiration" }
    guard let exp = expirationTag?.last, let expUnix = Int(exp) else { return }
    if expUnix > Int(Date().timeIntervalSince1970) {
        // User has an active subscription
    }
}
```

The membership events live on a public relay, so detecting subscription state requires no Nostreon API call. If the user later subscribes via Primal or another client, Damus will see the same event.

## Hosted checkout fallback

For Damus users who don't have a Lightning wallet installed (or whose wallet doesn't handle the `lightning:` URI scheme), redirect to the Nostreon hosted checkout page in `SFSafariViewController`:

```swift
let checkoutUrl = "https://nostreon.com/checkout/\(invoiceId)?return_url=damus://subscribed"
let safariVC = SFSafariViewController(url: URL(string: checkoutUrl)!)
present(safariVC, animated: true)
```

The hosted page renders the QR code, polls for payment, and returns the user to Damus via the deep link when settled.

## Get an API key

[Open an issue](https://github.com/Nostreon/api-docs/issues/new) on this repo with your client name, npub (for delivery via NIP-04 DM), and a Lightning address for referral payouts.
