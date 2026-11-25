import { NextResponse, type NextRequest } from "next/server";
import { callApi } from "@/lib/api";
import { expiresWithin } from "@/lib/jwt";
import { createRefresher, type TokenPair } from "@/lib/refresh";
import { ACCESS_COOKIE, REFRESH_COOKIE, sessionCookies } from "@/lib/session-cookies";

const refreshTokens = createRefresher(async (refreshToken, forwardedFor) => {
  const result = await callApi<TokenPair>("/auth/refresh", {
    method: "POST",
    body: { refreshToken },
    forwardedFor,
  });
  if (result.ok) return { kind: "ok", tokens: result.data };
  return result.status === 400 || result.status === 401 ? { kind: "invalid" } : { kind: "unavailable" };
});

const SIGNED_IN_ONLY = /^\/account(\/|$)/;
const GUESTS_ONLY = new Set(["/login", "/register"]);

export async function proxy(request: NextRequest) {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  let signedIn = access !== undefined && !expiresWithin(access, 60);
  let renewed: TokenPair | null = null;
  let ended = false;

  if (!signedIn && refresh) {
    const result = await refreshTokens(refresh, request.headers.get("x-forwarded-for"));
    if (result.kind === "ok") {
      renewed = result.tokens;
      signedIn = true;
    } else if (result.kind === "invalid") {
      ended = true;
    } else {
      signedIn = access !== undefined;
    }
  }

  // Server Actions are POSTs to the page route: let them run and report errors themselves.
  const isAction = request.headers.has("next-action");
  const { pathname, search } = request.nextUrl;
  let response: NextResponse;
  if (!isAction && !signedIn && SIGNED_IN_ONLY.test(pathname)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname + search);
    response = NextResponse.redirect(login);
  } else if (!isAction && signedIn && GUESTS_ONLY.has(pathname)) {
    response = NextResponse.redirect(new URL("/account", request.url));
  } else {
    response = NextResponse.next();
  }

  // Cookies set here are also visible to cookies() in the page or action handling this request.
  if (renewed) for (const cookie of sessionCookies(renewed)) response.cookies.set(cookie.name, cookie.value, cookie.options);
  if (ended) {
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
