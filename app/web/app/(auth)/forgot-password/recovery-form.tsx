"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { recoverPassword } from "@/lib/actions/auth";

export function RecoveryForm() {
  const [state, action, pending] = useActionState(recoverPassword, {});
  const email = state.values?.email ?? "";

  if (state.step !== "reset") {
    return (
      <form action={action} className="space-y-4">
        <FormMessage state={state} />
        <input type="hidden" name="intent" value="request" />
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={email} />
        </Field>
        <SubmitButton>Gửi mã</SubmitButton>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="email" value={email} />
      <p className="text-sm text-zinc-600">
        Đặt lại mật khẩu cho <span className="font-medium text-zinc-900">{email}</span>
      </p>
      <Field label="Mã xác nhận" htmlFor="otp">
        <Input
          id="otp"
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          placeholder="6 chữ số"
          className="tracking-[0.4em]"
        />
      </Field>
      <Field label="Mật khẩu mới" htmlFor="newPassword" hint="Từ 8 đến 128 ký tự.">
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
      </Field>
      <SubmitButton>Đặt lại mật khẩu</SubmitButton>
      <button
        type="submit"
        name="intent"
        value="request"
        formNoValidate
        disabled={pending}
        className="w-full text-sm text-brand hover:underline disabled:opacity-60"
      >
        Gửi lại mã
      </button>
    </form>
  );
}
