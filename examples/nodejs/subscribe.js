/**
 * Full subscription flow example.
 *
 * Run with: NOSTREON_API_KEY=npk_live_... node subscribe.js
 *
 * This script:
 *   1. Generates a demo subscriber key (in production, use the user's real key)
 *   2. Fetches a creator's tiers
 *   3. Creates a subscription with NIP-98 auth
 *   4. Prints the Lightning invoice for the user to pay
 *   5. Polls until the invoice is paid
 */
import { generateSecretKey, nip19 } from "nostr-tools";
import { buildNip98Auth } from "./nip98.js";

const API_BASE = process.env.API_BASE || "https://nostreon.com/api/v1";
const API_KEY = process.env.NOSTREON_API_KEY;

if (!API_KEY) {
  console.error("Set NOSTREON_API_KEY");
  process.exit(1);
}

// Demo: an example creator npub. Replace with a real one.
const CREATOR_NPUB = process.env.CREATOR_NPUB || "npub1...";

async function main() {
  // Step 1: Generate a demo subscriber key
  // In production, use the user's real Nostr key via their signer
  const subscriberKey = generateSecretKey();
  const subscriberNpub = nip19.npubEncode(
    // getPublicKey from nostr-tools would go here — omitted for brevity
    Buffer.from(subscriberKey).toString("hex").slice(0, 64)
  );
  console.log(`Subscriber: ${subscriberNpub}`);

  // Step 2: Fetch the creator's tiers
  console.log(`\nFetching tiers for ${CREATOR_NPUB}...`);
  const tiersRes = await fetch(`${API_BASE}/creators/${CREATOR_NPUB}/tiers`);
  if (!tiersRes.ok) {
    console.error("Failed to fetch tiers:", await tiersRes.text());
    process.exit(1);
  }
  const { creator, tiers } = await tiersRes.json();
  console.log(`Creator: ${creator.display_name}`);
  console.log("Tiers:");
  for (const tier of tiers) {
    console.log(`  - ${tier.name}: $${tier.price_usd}/mo (id: ${tier.id})`);
  }

  if (tiers.length === 0) {
    console.error("Creator has no active tiers");
    process.exit(1);
  }

  // Step 3: Create a subscription to the first tier
  const tier = tiers[0];
  const body = JSON.stringify({ tier_id: tier.id, billing: "monthly" });

  const url = `${API_BASE}/subscribe`;
  const authHeader = buildNip98Auth(subscriberKey, url, "POST", body);

  console.log(`\nCreating subscription to ${tier.name}...`);
  const subRes = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
      Authorization: `Nostr ${authHeader}`,
    },
    body,
  });

  if (!subRes.ok) {
    console.error("Subscribe failed:", await subRes.text());
    process.exit(1);
  }

  const invoice = await subRes.json();
  console.log(`\n✓ Invoice created`);
  console.log(`  Invoice ID: ${invoice.invoice_id}`);
  console.log(`  Amount: $${invoice.amount_usd} (${invoice.amount_sats} sats)`);
  console.log(`  BOLT11: ${invoice.bolt11?.slice(0, 60)}...`);
  console.log(`  Checkout: ${invoice.checkout_url}`);
  console.log(`\nDisplay this invoice to your user. Waiting for payment...`);

  // Step 4: Poll for payment
  const statusUrl = `${API_BASE}/subscribe/status?invoice_id=${invoice.invoice_id}`;
  const start = Date.now();
  const timeoutMs = 5 * 60 * 1000; // 5 minutes

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));

    const statusRes = await fetch(statusUrl, {
      headers: { "X-Api-Key": API_KEY },
    });
    if (!statusRes.ok) continue;

    const status = await statusRes.json();
    process.stdout.write(`\r  Status: ${status.status}          `);

    if (status.paid) {
      console.log(`\n\n✓ Subscription active!`);
      console.log(
        `The user can now access premium content from wss://premium.nostreon.com`
      );
      console.log(
        `or any other NIP-63 compatible relay. No need to visit nostreon.com.`
      );
      return;
    }

    if (status.status === "Expired" || status.status === "Invalid") {
      console.log(`\n\n✗ Invoice ${status.status}`);
      return;
    }
  }

  console.log("\n\nTimed out waiting for payment");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
