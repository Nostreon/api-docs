/**
 * Browser NIP-98 helper. Uses window.nostr (NIP-07) to sign events
 * without ever handling the user's secret key.
 *
 * Requires a NIP-07 compatible extension (Alby, nos2x, Flamingo, etc.)
 */

/** Compute SHA-256 hex digest of a string using Web Crypto. */
async function sha256Hex(input) {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build and sign a NIP-98 auth event using the browser's Nostr extension.
 *
 * @param {string} url - Full request URL
 * @param {string} method - HTTP method
 * @param {string} [body] - Raw request body
 * @returns {Promise<string>} Base64-encoded signed event for Authorization header
 */
export async function buildNip98Auth(url, method, body = "") {
  if (!window.nostr) {
    throw new Error(
      "No Nostr signer found. Install a NIP-07 extension like Alby or nos2x."
    );
  }

  const tags = [
    ["u", url],
    ["method", method.toUpperCase()],
  ];

  if (body.length > 0) {
    tags.push(["payload", await sha256Hex(body)]);
  }

  const unsigned = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };

  const signed = await window.nostr.signEvent(unsigned);
  return btoa(JSON.stringify(signed));
}
