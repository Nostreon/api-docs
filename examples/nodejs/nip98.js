import { finalizeEvent } from "nostr-tools";
import { createHash } from "crypto";

/**
 * Build and sign a NIP-98 HTTP auth event.
 *
 * @param {Uint8Array} secretKey - 32-byte Nostr secret key
 * @param {string} url - Full request URL
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} [body] - Raw request body (for POST/PUT/PATCH)
 * @returns {string} Base64-encoded signed event, ready for Authorization header
 */
export function buildNip98Auth(secretKey, url, method, body = "") {
  const tags = [
    ["u", url],
    ["method", method.toUpperCase()],
  ];

  // Payload hash is required for requests with a body
  if (body.length > 0) {
    const hash = createHash("sha256").update(body).digest("hex");
    tags.push(["payload", hash]);
  }

  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: "",
    },
    secretKey
  );

  return Buffer.from(JSON.stringify(event)).toString("base64");
}
