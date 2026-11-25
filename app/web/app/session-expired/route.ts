import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/session-cookies";

/** Drops cookies of a session the API no longer accepts (revoked elsewhere), then asks the user to sign in again. */
export function GET(request: NextRequest) {
  const login = new URL("/login", request.url);
  login.searchParams.set("next", safeNext(request.nextUrl.searchParams.get("next")));
  login.searchParams.set("expired", "1");
  const response = NextResponse.redirect(login);
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
