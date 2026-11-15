import * as crypto from "crypto";

/**
 * HMAC signing/verification for x-agent-games-signature.
 *
 * The /build spec says: compute the HMAC over the RAW request body and compare
 * to the x-agent-games-signature header, before parsing JSON. It does not pin
 * the algorithm/encoding in prose, so:
 *  - outbound signing uses HMAC-SHA256 with a lowercase hex digest (the
 *    conventional choice for this header style);
 *  - inbound verification accepts the same MAC bytes in hex OR base64
 *    encoding (and an optional "sha256=" prefix), compared in constant time.
 *    Accepting both encodings of the identical MAC is a representation
 *    tolerance, not a weakening: a caller must still know the secret.
 */

export function signBody(secret: string, rawBody: string | Buffer): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

function macBytes(secret: string, rawBody: string | Buffer): Buffer {
  return crypto.createHmac("sha256", secret).update(rawBody).digest();
}

function decodeCandidate(headerValue: string): Buffer | null {
  let v = headerValue.trim();
  if (v.toLowerCase().startsWith("sha256=")) v = v.slice("sha256=".length).trim();
  // hex (64 chars) first, then base64.
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, "hex");
  try {
    const b = Buffer.from(v, "base64");
    if (b.length === 32) return b;
  } catch {
    /* fall through */
  }
  return null;
}

export function verifyBodySignature(
  secret: string,
  rawBody: string | Buffer,
  headerValue: string | undefined | null,
): boolean {
  if (!secret || !headerValue) return false;
  const candidate = decodeCandidate(headerValue);
  if (!candidate) return false;
  const expected = macBytes(secret, rawBody);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/**
 * Deterministic per-task salt for the gatekeeper circuit's private `salt`
 * input: HMAC(secret, "gatekeeper-salt:" + task_id) reduced mod the BN128
 * scalar field prime. Deterministic so a redelivered task reproduces the
 * same proof inputs; secret-bound so it is not predictable to third parties.
 */
export const BN128_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function deriveSalt(secret: string, taskId: string): bigint {
  const digest = crypto
    .createHmac("sha256", secret || "gatekeeper-local-dev")
    .update(`gatekeeper-salt:${taskId}`)
    .digest();
  return BigInt("0x" + digest.toString("hex")) % BN128_PRIME;
}
