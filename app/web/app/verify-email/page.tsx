import type { Metadata } from "next";
import { ResendVerificationForm } from "@/components/resend-verification-form";
import { TokenConfirm } from "@/components/token-confirm";
import { Alert, Card } from "@/components/ui";
import { confirmEmailVerification } from "@/lib/actions/auth";

export const metadata: Metadata = { title: "Xác minh email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
      <Card title="Xác minh email" description="Xác nhận địa chỉ email để bảo vệ tài khoản của bạn.">
        {typeof token === "string" && token ? (
          <TokenConfirm
            action={confirmEmailVerification}
            token={token}
            label="Xác minh email"
            doneHref="/account"
            doneLabel="Đến trang tài khoản"
            failed={<ResendVerificationForm />}
          />
        ) : (
          <div className="space-y-4">
            <Alert tone="error">Liên kết xác minh không đầy đủ. Hãy mở lại liên kết trong email hoặc xin liên kết mới.</Alert>
            <ResendVerificationForm />
          </div>
        )}
      </Card>
    </div>
  );
}
