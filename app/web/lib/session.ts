import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api, type ApiResult } from "./api";
import type { TokenPair } from "./refresh";
import { ACCESS_COOKIE, REFRESH_COOKIE, sessionCookies } from "./session-cookies";

export interface Me {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  status: string;
  role: "ADMIN" | "EMPLOYER" | "CUSTOMER";
  emailVerifiedAt: string | null;
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Server Actions only. */
export async function setSession(tokens: TokenPair): Promise<void> {
  const store = await cookies();
  for (const cookie of sessionCookies(tokens)) store.set(cookie.name, cookie.value, cookie.options);
}

/** Server Actions and Route Handlers only. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

/** null when there is no access cookie. Deduplicated per request. */
const loadMe = cache(async (): Promise<ApiResult<Me> | null> => {
  if (!(await cookies()).has(ACCESS_COOKIE)) return null;
  return api<Me>("/user/me");
});

/** The signed-in user, or null (also when the API is unavailable). */
export async function getMe(): Promise<Me | null> {
  const result = await loadMe();
  return result?.ok ? result.data : null;
}

/**
 * For pages under /account. A cookie whose session was revoked elsewhere still looks valid to the proxy,
 * so send the browser to a route that can clear it instead of bouncing between /login and /account.
 * Only a 401 ends the session: an outage or rate limit must not delete the cookies.
 */
export async function requireMe(next: string): Promise<Me> {
  const result = await loadMe();
  if (!result || result.status === 401) redirect(`/session-expired?next=${encodeURIComponent(next)}`);
  if (!result.ok) throw new Error(`GET /user/me failed with status ${result.status}`);
  return result.data;
}
