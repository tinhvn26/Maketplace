/** Reads `exp` (seconds) without verifying the signature: only the API decides whether a token is valid. */
export function tokenExp(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const exp = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))?.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

export function expiresWithin(token: string, seconds: number, now = Date.now()): boolean {
  const exp = tokenExp(token);
  return exp === null || exp * 1000 - now < seconds * 1000;
}
