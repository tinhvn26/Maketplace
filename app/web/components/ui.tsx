import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

const buttonTones = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  outline: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
} as const;

export type ButtonTone = keyof typeof buttonTones;

export function buttonClass(tone: ButtonTone = "primary", extra = "") {
  return `inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60 ${buttonTones[tone]} ${extra}`;
}

export function Button({ tone, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return <button className={buttonClass(tone, className)} {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`block min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-zinc-100 disabled:text-zinc-500 user-invalid:border-red-600 ${className}`}
      {...props}
    />
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-700">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function Card({ title, description, children, className = "" }: { title?: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg bg-white p-5 shadow-sm sm:p-6 ${className}`}>
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {description && <div className="mt-1 text-sm text-zinc-600">{description}</div>}
      <div className={title || description ? "mt-5" : ""}>{children}</div>
    </section>
  );
}

const alertTones = {
  error: "border-red-200 bg-red-50 text-red-800",
  success: "border-green-200 bg-green-50 text-green-800",
  info: "border-amber-200 bg-amber-50 text-amber-900",
} as const;

export function Alert({ tone = "info", children }: { tone?: keyof typeof alertTones; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2.5 text-sm ${alertTones[tone]}`}>
      {children}
    </div>
  );
}

/** Vietnamese names put the given name last, so "Nguyễn Văn An" shows "A". */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initial = name.trim().split(/\s+/).at(-1)?.charAt(0).toLocaleUpperCase("vi") || "?";
  const sizes = { sm: "size-8 text-sm", md: "size-10 text-base", lg: "size-16 text-2xl" };
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand ring-2 ring-white ${sizes[size]}`}>
      {initial}
    </span>
  );
}
