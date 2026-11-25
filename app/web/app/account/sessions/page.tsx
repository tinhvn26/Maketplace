import type { Metadata } from "next";
import { Alert, Card } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { logoutEverywhere, revokeSession } from "@/lib/actions/account";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Thiết bị đăng nhập" };

interface AuthSession {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

const formatTime = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});

export default async function SessionsPage() {
  await requireMe("/account/sessions");
  const result = await api<AuthSession[]>("/auth/sessions");
  return (
    <Card title="Thiết bị đăng nhập" description="Các phiên đăng nhập đang hoạt động. Đăng xuất phiên bạn không nhận ra.">
      {!result.ok ? (
        <Alert tone="error">{errorMessage(result)}</Alert>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
            {result.data.map((session) => (
              <li key={session.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    Phiên đăng nhập lúc {formatTime.format(new Date(session.createdAt))}
                    {session.current && (
                      <span className="ml-2 rounded bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">Thiết bị này</span>
                    )}
                  </p>
                  <p className="text-zinc-600">Hoạt động gần nhất: {formatTime.format(new Date(session.lastUsedAt))}</p>
                  <p className="text-zinc-600">Hết hạn: {formatTime.format(new Date(session.expiresAt))}</p>
                </div>
                <form action={revokeSession}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <input type="hidden" name="current" value={String(session.current)} />
                  <SubmitButton tone="outline" className="w-full sm:w-auto">
                    Đăng xuất
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
          <form action={logoutEverywhere}>
            <SubmitButton tone="danger" className="w-full sm:w-auto">
              Đăng xuất tất cả thiết bị
            </SubmitButton>
          </form>
        </div>
      )}
    </Card>
  );
}
