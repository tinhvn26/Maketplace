"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/account", label: "Hồ sơ" },
  { href: "/account/security", label: "Bảo mật" },
  { href: "/account/sessions", label: "Thiết bị đăng nhập" },
] as const;

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Tài khoản" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex gap-2 md:flex-col md:gap-1">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <li key={link.href} className="shrink-0">
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-md px-3 py-2.5 text-sm font-medium whitespace-nowrap ${
                  active ? "bg-brand-soft text-brand" : "bg-white text-zinc-700 hover:text-brand md:bg-transparent"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
