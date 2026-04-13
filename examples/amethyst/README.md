# Amethyst integration example

How to embed Nostreon subscriptions in [Amethyst](https://github.com/vitorpamplona/amethyst), the Android Nostr client written in Kotlin. Like Damus, Amethyst has full Nostr key management but no built-in Lightning wallet, so the integration uses an Android intent with a `lightning:` URI to hand off payment to the user's preferred wallet (Phoenix, Wallet of Satoshi, Mutiny, Zeus, etc.).

## User experience

1. The user opens a creator's profile in Amethyst
2. Amethyst calls `GET /api/v1/creators/{npub}/tiers` and renders a "Subscribe" button next to the existing zap button
3. The user taps a tier — Amethyst shows a bottom sheet with tier name and price
4. The user taps "Pay with Lightning" — Amethyst calls `POST /api/v1/subscribe`, gets a BOLT11 invoice, and fires an `Intent.ACTION_VIEW` on `lightning:lnbc...` which opens the user's Lightning wallet via Android's standard handler picker
5. The user confirms in their wallet app and returns to Amethyst (Android handles the back navigation)
6. Amethyst polls `GET /api/v1/subscribe/status` and shows "Subscribed" inline once settled

Android's intent system means users get to use whichever Lightning wallet they already trust, with no in-app wallet maintenance burden for Amethyst.

## Integration

The code below is structured as a single suspend function you'd call from a `ViewModel`. It assumes Amethyst exposes:
- A signing function on its account/key store (Amethyst already signs every event the user publishes)
- A way to compute SHA-256 (`java.security.MessageDigest` is on every Android API level)

```kotlin
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.MessageDigest

const val NOSTREON_API = "https://nostreon.com/api/v1"
const val NOSTREON_API_KEY = "npk_live_..." // your partner key, stored in EncryptedSharedPreferences

@Serializable
data class Tier(
    val id: String,
    val name: String,
    val price_usd: Double,
)

@Serializable
data class SubscribeResponse(
    val invoice_id: String,
    val bolt11: String,
    val amount_sats: Int,
    val amount_usd: Double,
    val tier: Tier,
)

@Serializable
data class StatusResponse(
    val paid: Boolean,
    val expires_at: Long? = null,
)

sealed class SubscribeResult {
    data class Success(val expiresAt: Long) : SubscribeResult()
    data class Error(val message: String) : SubscribeResult()
    object NoWallet : SubscribeResult()
}

private val httpClient = OkHttpClient()
private val json = Json { ignoreUnknownKeys = true }

/**
 * Subscribe the current Amethyst user to a creator tier.
 * Opens the user's Lightning wallet via an Android intent, then polls for settlement.
 */
suspend fun subscribeToCreator(
    context: Context,
    creatorNpub: String,
    tier: Tier,
    billing: String = "monthly",
): SubscribeResult {
    // 1. Build the request body
    val body = buildJsonObject {
        put("tier_id", tier.id)
        put("billing", billing)
    }.toString()

    // 2. Build the NIP-98 auth event
    // The payload tag is sha256(raw body) for POST requests
    val payloadHash = MessageDigest.getInstance("SHA-256")
        .digest(body.toByteArray())
        .joinToString("") { "%02x".format(it) }
    val url = "$NOSTREON_API/subscribe"

    // amethystAccount.signEvent is whatever Amethyst uses to sign Nostr events
    // (the same call you use for kind 1 notes, kind 7 reactions, kind 9734 zap requests)
    val authEvent = amethystAccount.signEvent(
        kind = 27235, // NIP-98 HTTP Auth
        createdAt = System.currentTimeMillis() / 1000,
        tags = listOf(
            listOf("u", url),
            listOf("method", "POST"),
            listOf("payload", payloadHash),
        ),
        content = "",
    )

    val authEventJson = json.encodeToString(authEvent)
    val authHeader = "Nostr ${Base64.encodeToString(authEventJson.toByteArray(), Base64.NO_WRAP)}"

    // 3. POST /v1/subscribe to get a Lightning invoice
    val request = Request.Builder()
        .url(url)
        .post(body.toRequestBody("application/json".toMediaType()))
        .header("X-Api-Key", NOSTREON_API_KEY)
        .header("Authorization", authHeader)
        .build()

    val subscribeResponse = httpClient.newCall(request).execute().use { response ->
        if (!response.isSuccessful) {
            return SubscribeResult.Error("HTTP ${response.code}")
        }
        json.decodeFromString<SubscribeResponse>(response.body!!.string())
    }

    // 4. Open the user's Lightning wallet via an Android intent
    // Android shows the wallet picker if the user has multiple Lightning apps installed
    val lightningIntent = Intent(Intent.ACTION_VIEW, Uri.parse("lightning:${subscribeResponse.bolt11}"))
    if (lightningIntent.resolveActivity(context.packageManager) == null) {
        return SubscribeResult.NoWallet
    }
    context.startActivity(lightningIntent)

    // 5. Poll for settlement after the user returns from their wallet
    repeat(30) {
        delay(2000)
        val status = pollStatus(subscribeResponse.invoice_id)
        if (status.paid && status.expires_at != null) {
            return SubscribeResult.Success(status.expires_at)
        }
    }

    return SubscribeResult.Error("Timed out waiting for settlement")
}

suspend fun pollStatus(invoiceId: String): StatusResponse {
    val request = Request.Builder()
        .url("$NOSTREON_API/subscribe/status?invoice_id=$invoiceId")
        .header("X-Api-Key", NOSTREON_API_KEY)
        .build()
    return httpClient.newCall(request).execute().use { response ->
        json.decodeFromString(response.body!!.string())
    }
}
```

## Discovering tiers

Render a Subscribe button on creator profiles only when Nostreon has tiers for that npub:

```kotlin
suspend fun fetchNostreonTiers(npub: String): List<Tier> {
    val request = Request.Builder()
        .url("$NOSTREON_API/creators/$npub/tiers")
        .build()
    return httpClient.newCall(request).execute().use { response ->
        if (!response.isSuccessful) return emptyList() // hide the button
        @Serializable data class TiersResponse(val tiers: List<Tier>)
        json.decodeFromString<TiersResponse>(response.body!!.string()).tiers
    }
}
```

Cache results for ~5 minutes to stay well under the 60 req/min unauthenticated rate limit.

## Showing the subscription state

Amethyst already maintains relay subscriptions for the user's feed. To detect active Nostreon subscriptions, add a filter for kind 1163 events on `wss://premium.nostreon.com` and check the NIP-40 `expiration` tag:

```kotlin
val filter = NostrFilter(
    kinds = listOf(1163),
    referencedPubkeys = listOf(userHexPubkey),
)

// Use Amethyst's existing relay subscription machinery
relayPool.subscribe(filter) { event ->
    val expirationTag = event.tags.firstOrNull { it.firstOrNull() == "expiration" }
    val expUnix = expirationTag?.getOrNull(1)?.toLongOrNull() ?: return@subscribe
    if (expUnix > System.currentTimeMillis() / 1000) {
        // User has an active subscription
    }
}
```

This is purely Nostr — no Nostreon API call needed for state. If the user later subscribes via Primal or Damus, Amethyst will see the same event.

## Hosted checkout fallback

For users with no Lightning wallet installed, redirect to the Nostreon hosted checkout page using a Custom Tab:

```kotlin
import androidx.browser.customtabs.CustomTabsIntent

val checkoutUrl = "https://nostreon.com/checkout/${invoiceId}?return_url=amethyst://subscribed"
CustomTabsIntent.Builder()
    .build()
    .launchUrl(context, Uri.parse(checkoutUrl))
```

The hosted page renders the QR code, polls for payment, and redirects back to Amethyst via the deep link when settled.

## Get an API key

[Open an issue](https://github.com/Nostreon/api-docs/issues/new) on this repo with your client name, npub (for delivery via NIP-04 DM), and a Lightning address for referral payouts.
