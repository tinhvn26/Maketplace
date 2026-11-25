import { Avatar } from "@/components/ui";
import { requireMe } from "@/lib/session";
import { AccountNav } from "./account-nav";

export default async function AccountLayout({ children }: LayoutProps<"/account">) {
  const me = await requireMe("/account");
  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 md:grid-cols-[14rem_1fr] md:gap-6">
      <aside className="space-y-4">
        <div className="hidden items-center gap-3 border-b border-zinc-200 pb-4 md:flex">
          <Avatar name={me.fullName} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{me.fullName}</p>
            <p className="truncate text-xs text-zinc-500">{me.email}</p>
          </div>
        </div>
        <AccountNav />
      </aside>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}
