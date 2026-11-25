"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { Alert, Field, Input } from "@/components/ui";
import { resendVerification, updateProfile } from "@/lib/actions/account";

export function ProfileForm({ email, fullName, phoneNumber }: { email: string; fullName: string; phoneNumber: string }) {
  const [state, action] = useActionState(updateProfile, {});
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Email" htmlFor="profile-email" hint="Đổi email trong mục Bảo mật.">
        <Input id="profile-email" value={email} disabled readOnly />
      </Field>
      <Field label="Họ và tên" htmlFor="fullName">
        <Input id="fullName" name="fullName" autoComplete="name" required maxLength={100} defaultValue={state.values?.fullName ?? fullName} />
      </Field>
      <Field label="Số điện thoại" htmlFor="phoneNumber" hint="Để trống nếu muốn xoá số điện thoại.">
        <Input
          id="phoneNumber"
          name="phoneNumber"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          pattern="\+?[0-9]{7,15}"
          defaultValue={state.values?.phoneNumber ?? phoneNumber}
        />
      </Field>
      <SubmitButton className="w-full sm:w-auto">Lưu thay đổi</SubmitButton>
    </form>
  );
}

export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, action] = useActionState(resendVerification, {});
  if (state.success || state.error) return <FormMessage state={state} />;
  return (
    <Alert tone="info">
      <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Email <strong>{email}</strong> chưa được xác minh.
        </span>
        <SubmitButton tone="outline" className="shrink-0">
          Gửi lại email xác minh
        </SubmitButton>
      </form>
    </Alert>
  );
}
