"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/lib/form-state";
import { FormMessage, SubmitButton } from "./form";
import { buttonClass } from "./ui";

/**
 * Confirms a one-time email token only when the user presses the button:
 * mail scanners open links ahead of the user and would otherwise spend the token.
 */
export function TokenConfirm({
  action,
  token,
  label,
  doneHref,
  doneLabel,
  failed,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  token: string;
  label: string;
  doneHref: string;
  doneLabel: string;
  failed?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, {});
  if (state.step === "done") {
    return (
      <div className="space-y-4">
        <FormMessage state={state} />
        <Link href={doneHref} className={buttonClass("primary", "w-full")}>
          {doneLabel}
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      {state.step === "failed" ? (
        failed
      ) : (
        <form action={formAction}>
          <input type="hidden" name="token" value={token} />
          <SubmitButton>{label}</SubmitButton>
        </form>
      )}
    </div>
  );
}
