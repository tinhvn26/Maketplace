import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { RecoveryForm } from "./recovery-form";

export const metadata: Metadata = { title: "Quên mật khẩu" };

export default function ForgotPasswordPage() {
  return (
    <Card title="Quên mật khẩu" description="Nhập email đã đăng ký, chúng tôi sẽ gửi mã gồm 6 số để đặt lại mật khẩu.">
      <div className="space-y-4">
        <RecoveryForm />
        <p className="text-center text-sm">
          <Link href="/login" className="text-brand hover:underline">
            Quay lại đăng nhập
          </Link>
        </p>
      </div>
    </Card>
  );
}
