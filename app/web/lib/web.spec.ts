import { describe, expect, it, vi } from "vitest";
import { expiresWithin, tokenExp } from "./jwt";
import { safeNext } from "./safe-next";
import { errorMessage, type ApiFailure } from "./errors";
import { createRefresher, type RefreshResult } from "./refresh";
import { sessionCookies } from "./session-cookies";

const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
const failure = (status: number, extra: Partial<ApiFailure> = {}): ApiFailure => ({
  ok: false,
  status,
  validation: null,
  retryAfter: null,
  ...extra,
});

describe("tokenExp", () => {
  it("reads exp and rejects malformed tokens", () => {
    expect(tokenExp(jwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000);
    expect(tokenExp("not-a-jwt")).toBeNull();
    expect(tokenExp("a.%%%.c")).toBeNull();
    expect(tokenExp(jwt({ exp: "soon" }))).toBeNull();
  });

  it("treats unreadable or near-expiry tokens as expiring", () => {
    const now = 1_000_000_000_000;
    expect(expiresWithin(jwt({ exp: now / 1000 + 30 }), 60, now)).toBe(true);
    expect(expiresWithin(jwt({ exp: now / 1000 + 600 }), 60, now)).toBe(false);
    expect(expiresWithin("garbage", 60, now)).toBe(true);
  });
});

describe("safeNext", () => {
  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "/\t/evil.com", "account", "", null, 42])(
    "falls back for %j",
    (value) => expect(safeNext(value)).toBe("/account"),
  );

  it("keeps same-site paths with query strings", () => {
    expect(safeNext("/account/sessions?x=1")).toBe("/account/sessions?x=1");
  });
});

describe("errorMessage", () => {
  it("maps statuses per form", () => {
    expect(errorMessage(failure(401), "login")).toBe("Email hoặc mật khẩu không đúng.");
    expect(errorMessage(failure(409), "register")).toBe("Email đã được sử dụng.");
    expect(errorMessage(failure(400), "otp")).toBe("Mã không đúng hoặc đã hết hạn.");
    expect(errorMessage(failure(429, { retryAfter: 42 }))).toContain("42 giây");
    expect(errorMessage(failure(0))).toContain("Không kết nối");
    expect(errorMessage(failure(500))).toBe("Có lỗi, vui lòng thử lại.");
  });

  it("prefers the API's own validation messages", () => {
    expect(errorMessage(failure(400, { validation: ["email phải là địa chỉ email hợp lệ"] }), "otp")).toBe(
      "email phải là địa chỉ email hợp lệ",
    );
  });
});

describe("createRefresher", () => {
  const ok: RefreshResult = { kind: "ok", tokens: { accessToken: "a2", refreshToken: "r2", expiresIn: 900 } };

  it("sends one refresh for concurrent requests with the same token", async () => {
    let release!: (value: RefreshResult) => void;
    const call = vi.fn(() => new Promise<RefreshResult>((resolve) => (release = resolve)));
    const refresh = createRefresher(call);
    const results = Promise.all(Array.from({ length: 5 }, () => refresh("r1", null)));
    release(ok);
    expect(await results).toEqual(Array(5).fill(ok));
    expect(await refresh("r1", null)).toBe(ok);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("retries after an unavailable result or a thrown error", async () => {
    const call = vi
      .fn<() => Promise<RefreshResult>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({ kind: "unavailable" })
      .mockResolvedValueOnce(ok);
    const refresh = createRefresher(call);
    expect(await refresh("r1", null)).toEqual({ kind: "unavailable" });
    expect(await refresh("r1", null)).toEqual({ kind: "unavailable" });
    expect(await refresh("r1", null)).toBe(ok);
  });
});

describe("sessionCookies", () => {
  it("expires each cookie with its own token", () => {
    const [access, refresh] = sessionCookies({
      accessToken: jwt({ exp: 1_800_000_900 }),
      refreshToken: jwt({ exp: 1_800_600_000 }),
      expiresIn: 900,
    });
    expect(access.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(access.options.expires.getTime()).toBe(1_800_000_900_000);
    expect(refresh.options.expires.getTime()).toBe(1_800_600_000_000);
  });
});
