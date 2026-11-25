import Link from "next/link";
import { Suspense } from "react";
import { logout } from "@/lib/actions/account";
import { getMe } from "@/lib/session";
import { Avatar } from "./ui";

export function SiteHeader() {
  return (
    <header className="bg-brand text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          Marketplate
        </Link>
        <div className="ml-auto sm:order-last sm:ml-0">
          <Suspense fallback={<span className="block h-10 w-28" />}>
            <AccountArea />
          </Suspense>
        </div>
        <form role="search" className="w-full sm:w-auto sm:flex-1" action="/">
          <label htmlFor="site-search" className="sr-only">
            Tìm kiếm sản phẩm
          </label>
          <input
            id="site-search"
            type="search"
            disabled
            placeholder="Tìm kiếm sản phẩm (sắp ra mắt)"
            className="min-h-11 w-full rounded-md bg-white px-3 text-base text-zinc-900 placeholder:text-zinc-500 disabled:cursor-not-allowed"
          />
        </form>
      </div>
    </header>
  );
}

async function AccountArea() {
  const me = await getMe();
  if (!me) {
    return (
      <nav className="flex items-center gap-1 text-sm font-medium">
        <Link href="/login" className="rounded px-2 py-2 hover:bg-white/15">
          Đăng nhập
        </Link>
        <span aria-hidden className="text-white/60">|</span>
        <Link href="/register" className="rounded px-2 py-2 hover:bg-white/15">
          Đăng ký
        </Link>
      </nav>
    );
  }

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-white/15 [&::-webkit-details-marker]:hidden">
        <Avatar name={me.fullName} size="sm" />
        <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{me.fullName}</span>
        <span className="sr-only">Mở menu tài khoản</span>
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-md bg-white text-sm text-zinc-800 shadow-lg ring-1 ring-black/5">
        <p className="truncate border-b border-zinc-100 px-4 py-3 text-xs text-zinc-500">{me.email}</p>
        <Link href="/account" className="block px-4 py-3 hover:bg-zinc-50">
          Tài khoản của tôi
        </Link>
        <Link href="/account/sessions" className="block px-4 py-3 hover:bg-zinc-50">
          Thiết bị đăng nhập
        </Link>
        <form action={logout}>
          <button type="submit" className="block w-full px-4 py-3 text-left hover:bg-zinc-50">
            Đăng xuất
          </button>
        </form>
      </div>
    </details>
  );
}
