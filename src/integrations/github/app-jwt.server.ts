import { createSign } from "node:crypto";

/** Sign a GitHub App JWT (RS256), valid ~10 minutes. */
export function signAppJwt(): string {
  const appId = process.env.GITHUB_APP_ID;
  const pem = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !pem) throw new Error("GitHub App is not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY missing).");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 30, exp: now + 9 * 60, iss: appId };

  const b64u = (s: string | Buffer) =>
    (typeof s === "string" ? Buffer.from(s) : s)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const unsigned = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  // Normalize PEM newlines (env vars often have literal "\n" sequences)
  const normalizedPem = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
  const sig = signer.sign(normalizedPem);
  return `${unsigned}.${b64u(sig)}`;
}

export function appJwtHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Cortex-Dev-Platform",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${signAppJwt()}`,
  };
}