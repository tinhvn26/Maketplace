"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { field, type FormState } from "@/lib/form-state";
import { clearSession, getMe } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function logout(): Promise<void> {
  // Clear locally even if the API is unreachable; the session then just expires.
  await api("/auth/logout", { method: "POST" });
  await clearSession();
  redirect("/");
}

export async function updateProfile(_state: FormState, form: FormData): Promise<FormState> {
  const fullName = field(form, "fullName").trim();
  const phoneNumber = field(form, "phoneNumber").trim();
  const values = { fullName, phoneNumber };
  const result = await api("/user/me", {
    method: "PATCH",
    body: { fullName, phoneNumber: phoneNumber || null },
  });
  if (!result.ok) return { error: errorMessage(result), values };
  refresh();
  return { success: "Đã lưu hồ sơ.", values };
}

export async function resendVerification(): Promise<FormState> {
  const me = await getMe();
  if (!me) return { error: errorMessage({ ok: false, status: 401, validation: null, retryAfter: null }) };
  const result = await api("/auth/verification/request", { method: "POST", body: { email: me.email }, auth: false });
  if (!result.ok) return { error: errorMessage(result) };
  return { success: `Đã gửi liên kết xác minh tới ${me.email}. Liên kết có hiệu lực 24 giờ.` };
}

export async function changePassword(_state: FormState, form: FormData): Promise<FormState> {
  const result = await api("/user/me/change-password", {
    method: "POST",
    body: { currentPassword: field(form, "currentPassword"), newPassword: field(form, "newPassword") },
  });
  if (!result.ok) return { error: errorMessage(result, "currentPassword") };
  // The API revoked every session, including this one.
  await clearSession();
  redirect("/login?password=1");
}

export async function changeEmail(_state: FormState, form: FormData): Promise<FormState> {
  const newEmail = field(form, "newEmail").trim().toLowerCase();
  const result = await api("/user/me/change-email", {
    method: "POST",
    body: { newEmail, currentPassword: field(form, "currentPassword") },
  });
  if (!result.ok) return { error: errorMessage(result, "email"), values: { newEmail } };
  // The new address starts unverified and the API sends nothing on its own.
  await api("/auth/verification/request", { method: "POST", body: { email: newEmail }, auth: false });
  refresh();
  return { success: `Email đã đổi thành ${newEmail}. Kiểm tra hộp thư mới để xác minh.` };
}

export async function deleteAccount(_state: FormState, form: FormData): Promise<FormState> {
  const result = await api("/user/me", {
    method: "DELETE",
    body: { currentPassword: field(form, "currentPassword") },
  });
  if (!result.ok) return { error: errorMessage(result, "currentPassword") };
  await clearSession();
  redirect("/?deleted=1");
}

export async function revokeSession(form: FormData): Promise<void> {
  const id = field(form, "sessionId");
  if (!UUID.test(id)) return;
  await api(`/auth/sessions/${id}`, { method: "DELETE" });
  if (field(form, "current") === "true") {
    await clearSession();
    redirect("/login");
  }
  refresh();
}

export async function logoutEverywhere(): Promise<void> {
  await api("/auth/logout-all", { method: "POST" });
  await clearSession();
  redirect("/login");
}
