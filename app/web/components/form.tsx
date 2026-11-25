"use client";

import { useFormStatus } from "react-dom";
import { Alert, Button, type ButtonTone } from "./ui";
import type { FormState } from "@/lib/form-state";

export function SubmitButton({ children, tone, className = "w-full" }: { children: string; tone?: ButtonTone; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" tone={tone} disabled={pending} aria-busy={pending} className={className}>
      {pending ? "Đang xử lý…" : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.success) return <Alert tone="success">{state.success}</Alert>;
  return null;
}
