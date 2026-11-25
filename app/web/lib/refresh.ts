export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type RefreshResult =
  | { kind: "ok"; tokens: TokenPair }
  /** The API rejected the refresh token: the session is over. */
  | { kind: "invalid" }
  /** Rate limited or unreachable: keep the cookies and try again later. */
  | { kind: "unavailable" };

/**
 * The API revokes the whole session when one refresh token is used twice, so concurrent
 * requests carrying the same token must share one refresh call and its result.
 * shortcut: in-memory, so only correct for a single Next.js process; use a shared store (Redis) for several instances.
 */
export function createRefresher(
  call: (refreshToken: string, forwardedFor: string | null) => Promise<RefreshResult>,
  holdMs = 10_000,
) {
  const results = new Map<string, Promise<RefreshResult>>();
  return (refreshToken: string, forwardedFor: string | null): Promise<RefreshResult> => {
    const existing = results.get(refreshToken);
    if (existing) return existing;
    const pending = call(refreshToken, forwardedFor).catch((): RefreshResult => ({ kind: "unavailable" }));
    results.set(refreshToken, pending);
    void pending.then((result) => {
      if (result.kind === "unavailable") results.delete(refreshToken);
      else setTimeout(() => results.delete(refreshToken), holdMs).unref?.();
    });
    return pending;
  };
}
