import "server-only";
import { cookies, headers } from "next/headers";
import type { ApiFailure } from "./errors";
import { ACCESS_COOKIE } from "./session-cookies";

const API_URL = (process.env.API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export type ApiResult<T> = { ok: true; status: number; data: T } | ApiFailure;

interface CallOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
  /** The browser's X-Forwarded-For, so the API rate-limits the real client instead of this server. */
  forwardedFor?: string | null;
}

export async function callApi<T = undefined>(path: string, options: CallOptions = {}): Promise<ApiResult<T>> {
  const requestHeaders: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) requestHeaders["content-type"] = "application/json";
  if (options.token) requestHeaders.authorization = `Bearer ${options.token}`;
  if (options.forwardedFor) requestHeaders["x-forwarded-for"] = options.forwardedFor;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers: requestHeaders,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, validation: null, retryAfter: null };
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (response.ok) return { ok: true, status: response.status, data: json as T };

  const message = (json as { message?: unknown } | undefined)?.message;
  const retryAfter = Number(response.headers.get("retry-after"));
  return {
    ok: false,
    status: response.status,
    validation: Array.isArray(message) ? message.map(String) : null,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : null,
  };
}

/** For Server Components and Server Actions: adds the session token and the client's forwarded address. */
export async function api<T = undefined>(
  path: string,
  options: Omit<CallOptions, "token" | "forwardedFor"> & { auth?: boolean } = {},
): Promise<ApiResult<T>> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return callApi<T>(path, {
    ...options,
    token: options.auth === false ? undefined : cookieStore.get(ACCESS_COOKIE)?.value,
    forwardedFor: headerStore.get("x-forwarded-for"),
  });
}
