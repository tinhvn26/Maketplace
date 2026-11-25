"use server";

import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { field, type FormState } from "@/lib/form-state";
import type { TokenPair } from "@/lib/refresh";
import { safeNext } from "@/lib/safe-next";
import { clearSession, setSession } from "@/lib/session";

export async function login(_state: FormState, form: FormData): Promise<FormState> {
  const email = field(form, "email").trim();
  const result = await api<TokenPair>("/auth/login", {
    method: "POST",
    body: { email, password: field(form, "password") },
    auth: false,
  });
  if (!result.ok) return { error: errorMessage(result, "login"), values: { email } };
  await setSession(result.data);
  redirect(safeNext(field(form, "next")));
}

export async function register(_state: FormState, form: FormData): Promise<FormState> {
  const fullName = field(form, "fullName").trim();
  const email = field(form, "email").trim();
  const phoneNumber = field(form, "phoneNumber").trim();
  const password = field(form, "password");
  const values = { fullName, email, phoneNumber };

  const created = await api("/auth/register", {
    method: "POST",
    body: { fullName, email, password, ...(phoneNumber ? { phoneNumber } : {}) },
    auth: false,
  });
  if (!created.ok) return { error: errorMessage(created, "register"), values };

  const signedIn = await api<TokenPair>("/auth/login", { method: "POST", body: { email, password }, auth: false });
  if (!signedIn.ok) redirect("/login?registered=1");
  await setSession(signedIn.data);
  redirect("/account?welcome=1");
}

/** One form, two steps: request a code, then reset with it. */
export async function recoverPassword(_state: FormState, form: FormData): Promise<FormState> {
  const email = field(form, "email").trim();
  if (field(form, "intent") === "request") {
    const result = await api("/auth/forgot-password", { method: "POST", body: { email }, auth: false });
    if (!result.ok) return { error: errorMessage(result), values: { email } };
    return {
      step: "reset",
      values: { email },
      success: "Nếu email đã đăng ký, mã gồm 6 số đã được gửi tới hộp thư. Mã có hiệu lực 15 phút.",
    };
  }

  const result = await api("/auth/reset-password", {
    method: "POST",
    body: { email, otp: field(form, "otp").trim(), newPassword: field(form, "newPassword") },
    auth: false,
  });
  if (!result.ok) return { step: "reset", values: { email }, error: errorMessage(result, "otp") };
  redirect("/login?reset=1");
}

export async function confirmEmailVerification(_state: FormState, form: FormData): Promise<FormState> {
  const result = await api("/auth/verification/confirm", {
    method: "POST",
    body: { token: field(form, "token") },
    auth: false,
  });
  if (!result.ok) return { step: "failed", error: errorMessage(result, "token") };
  return { step: "done", success: "Email của bạn đã được xác minh." };
}

export async function requestEmailVerification(_state: FormState, form: FormData): Promise<FormState> {
  const email = field(form, "email").trim();
  const result = await api("/auth/verification/request", { method: "POST", body: { email }, auth: false });
  if (!result.ok) return { error: errorMessage(result), values: { email } };
  return { success: "Nếu email cần xác minh, chúng tôi đã gửi liên kết mới. Liên kết có hiệu lực 24 giờ.", values: { email } };
}

export async function confirmEmailChange(_state: FormState, form: FormData): Promise<FormState> {
  const result = await api("/auth/email-change/confirm", {
    method: "POST",
    body: { token: field(form, "token") },
    auth: false,
  });
  if (!result.ok) return { step: "failed", error: errorMessage(result, "token") };
  // The API revoked every session of the account.
  await clearSession();
  return { step: "done", success: "Email đã được đổi và xác minh. Vui lòng đăng nhập lại." };
}
