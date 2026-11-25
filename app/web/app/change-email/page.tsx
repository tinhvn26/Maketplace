import type { Metadata } from "next";
import Link from "next/link";
import { TokenConfirm } from "@/components/token-confirm";
import { Alert, Card } from "@/components/ui";
import { confirmEmailChange } from "@/lib/actions/auth";

export const metadata: Metadata = { title: "Xác nhận đổi email" };

export default async function ChangeEmailPage({ searchParams }: PageProps<"/change-email">) {
  const { token } = await searchParams;
  const backToSecurity = (
    <Link href="/account/security" className="block text-center text-sm text-brand hover:underline">
      Đổi email trong trang Bảo mật
    </Link>
  );
  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
      <Card title="Xác nhận đổi email" description="Sau khi xác nhận, mọi thiết bị sẽ được đăng xuất.">
        {typeof token === "string" && token ? (
          <TokenConfirm
            action={confirmEmailChange}
            token={token}
            label="Xác nhận đổi email"
            doneHref="/login"
            doneLabel="Đăng nhập"
            failed={backToSecurity}
          />
        ) : (
          <div className="space-y-4">
            <Alert tone="error">Liên kết không đầy đủ. Hãy mở lại liên kết trong email.</Alert>
            {backToSecurity}
          </div>
        )}
      </Card>
    </div>
  );
}
