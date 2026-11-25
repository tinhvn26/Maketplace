"use client";

import { useActionState } from "react";
import { requestEmailVerification } from "@/lib/actions/auth";
import { FormMessage, SubmitButton } from "./form";
import { Field, Input } from "./ui";

export function ResendVerificationForm() {
  const [state, action] = useActionState(requestEmailVerification, {});
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Email cần xác minh" htmlFor="resend-email">
        <Input id="resend-email" name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={state.values?.email} />
      </Field>
      <SubmitButton tone="outline">Gửi lại liên kết xác minh</SubmitButton>
    </form>
  );
}
