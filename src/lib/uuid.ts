/**
 * Generate a UUID, falling back when `crypto.randomUUID` is unavailable.
 *
 * `crypto.randomUUID` only exists in secure contexts (HTTPS or localhost). When
 * the app is served over a plain-HTTP LAN address (e.g. http://192.168.x.x),
 * `crypto.randomUUID` is `undefined`, so calling it throws
 * "crypto.randomUUID is not a function". This helper degrades gracefully to a
 * RFC-4122-ish v4 UUID built from `crypto.getRandomValues` (or `Math.random` as
 * a last resort).
 */
export function uuid(): string {
  const cryptoObj = globalThis.crypto;

  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Per RFC 4122 §4.4: set version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}
