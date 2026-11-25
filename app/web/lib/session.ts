import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { api } from "./api";
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

/** The signed-in user, or null. Deduplicated per request. */
export const getMe = cache(async (): Promise<Me | null> => {
  if (!(await cookies()).has(ACCESS_COOKIE)) return null;
  const result = await api<Me>("/user/me");
  return result.ok ? result.data : null;
});

/**
 * For pages under /account. A cookie whose session was revoked elsewhere still looks valid to the proxy,
 * so send the browser to a route that can clear it instead of bouncing between /login and /account.
 */
export async function requireMe(next: string): Promise<Me> {
  const me = await getMe();
  if (!me) redirect(`/session-expired?next=${encodeURIComponent(next)}`);
  return me;
}
