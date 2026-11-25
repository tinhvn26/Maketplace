import { tokenExp } from "./jwt";
import type { TokenPair } from "./refresh";

export const ACCESS_COOKIE = "mp_at";
export const REFRESH_COOKIE = "mp_rt";

const SESSION_FALLBACK_SECONDS = 7 * 24 * 60 * 60;

export interface SessionCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    path: "/";
    secure: boolean;
    expires: Date;
  };
}

/** Each cookie lives exactly as long as its token, so the refresh cookie never outlives the session. */
export function sessionCookies(tokens: TokenPair, now = Date.now()): SessionCookie[] {
  const expires = (token: string, fallbackSeconds: number) => {
    const exp = tokenExp(token);
    return new Date(exp === null ? now + fallbackSeconds * 1000 : exp * 1000);
  };
  const options = { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } as const;
  return [
    { name: ACCESS_COOKIE, value: tokens.accessToken, options: { ...options, expires: expires(tokens.accessToken, tokens.expiresIn) } },
    { name: REFRESH_COOKIE, value: tokens.refreshToken, options: { ...options, expires: expires(tokens.refreshToken, SESSION_FALLBACK_SECONDS) } },
  ];
}
