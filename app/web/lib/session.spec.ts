import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, hasCookie } = vi.hoisted(() => ({ apiMock: vi.fn(), hasCookie: { value: true } }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ has: () => hasCookie.value }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("./api", () => ({ api: apiMock }));

const { requireMe } = await import("./session");

describe("requireMe", () => {
  beforeEach(() => {
    apiMock.mockReset();
    hasCookie.value = true;
  });

  it("returns the user", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: { id: "u1" } });
    await expect(requireMe("/account")).resolves.toEqual({ id: "u1" });
  });

  it("ends the session only on 401 or a missing cookie", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 401, validation: null, retryAfter: null });
    await expect(requireMe("/account/security")).rejects.toThrow("redirect:/session-expired?next=%2Faccount%2Fsecurity");
    hasCookie.value = false;
    await expect(requireMe("/account")).rejects.toThrow("redirect:/session-expired");
  });

  it.each([0, 429, 500])("keeps the session when the API answers %i", async (status) => {
    apiMock.mockResolvedValue({ ok: false, status, validation: null, retryAfter: null });
    await expect(requireMe("/account")).rejects.toThrow(`status ${status}`);
  });
});
