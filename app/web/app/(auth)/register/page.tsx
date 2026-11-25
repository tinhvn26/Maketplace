import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Đăng ký" };

export default function RegisterPage() {
  return (
    <Card title="Tạo tài khoản" description="Chỉ mất một phút để bắt đầu với Marketplate.">
      <div className="space-y-4">
        <RegisterForm />
        <p className="text-center text-sm text-zinc-600">
          Đã có tài khoản?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Đăng nhập
          </Link>
        </p>
      </div>
    </Card>
  );
}
