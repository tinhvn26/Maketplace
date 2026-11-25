"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { register } from "@/lib/actions/auth";

export function RegisterForm() {
  const [state, action] = useActionState(register, {});
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Họ và tên" htmlFor="fullName">
        <Input id="fullName" name="fullName" autoComplete="name" required maxLength={100} defaultValue={state.values?.fullName} />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={state.values?.email} />
      </Field>
      <Field label="Số điện thoại (không bắt buộc)" htmlFor="phoneNumber" hint="Từ 7 đến 15 chữ số, có thể bắt đầu bằng +.">
        <Input
          id="phoneNumber"
          name="phoneNumber"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          pattern="\+?[0-9]{7,15}"
          defaultValue={state.values?.phoneNumber}
        />
      </Field>
      <Field label="Mật khẩu" htmlFor="password" hint="Từ 8 đến 128 ký tự.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
      </Field>
      <SubmitButton>Đăng ký</SubmitButton>
    </form>
  );
}
