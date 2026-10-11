import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Server-only AES-256-GCM cipher for sensitive per-user secrets (e.g. GitHub PATs).
 * Key is derived from SUPABASE_SERVICE_ROLE_KEY via HKDF — server-only, never shipped to the client.
 * Ciphertext format (base64): version(1) | iv(12) | authTag(16) | ciphertext(N)
 */

const VERSION = 0x01;

function getKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for token encryption");
  // HKDF-SHA256 → 32 bytes for AES-256
  const derived = hkdfSync("sha256", secret, Buffer.from("cortex.token.v1"), "user-github-token", 32);
  return Buffer.from(derived);
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]).toString("base64");
}

export function decryptToken(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 1 + 12 + 16 + 1) throw new Error("Invalid ciphertext payload");
  if (buf[0] !== VERSION) throw new Error(`Unsupported cipher version: ${buf[0]}`);
  const iv = buf.subarray(1, 13);
  const tag = buf.subarray(13, 29);
  const ct = buf.subarray(29);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}