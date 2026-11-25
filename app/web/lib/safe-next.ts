/** Only same-site paths: "//host", "/\host" and control characters (browsers strip tabs/newlines) would leave the site. */
export function safeNext(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return /[\\\u0000-\u001f\u007f]/.test(value) ? fallback : value;
}
