export interface FormState {
  error?: string;
  success?: string;
  /** Non-secret values to put back into the form after React resets it. */
  values?: Record<string, string>;
  /** Multi-step forms (password recovery) and one-shot pages (email confirmation). */
  step?: string;
}

export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
