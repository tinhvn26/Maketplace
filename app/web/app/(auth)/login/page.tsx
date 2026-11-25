import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card } from "@/components/ui";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Đăng nhập" };

const notices: Record<string, string> = {
  reset: "Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.",
  password: "Đã đổi mật khẩu. Vì an toàn, mọi thiết bị đã được đăng xuất.",
  registered: "Tài khoản đã được tạo. Hãy đăng nhập để tiếp tục.",
  expired: "Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const notice = Object.keys(notices).find((key) => params[key] === "1");
  return (
    <Card title="Đăng nhập" description="Chào mừng bạn quay lại Marketplate.">
      <div className="space-y-4">
        {notice && <Alert tone="success">{notices[notice]}</Alert>}
        <LoginForm next={safeNext(params.next)} />
        <div className="flex justify-between text-sm">
          <Link href="/forgot-password" className="text-brand hover:underline">
            Quên mật khẩu?
          </Link>
          <span className="text-zinc-600">
            Chưa có tài khoản?{" "}
            <Link href="/register" className="font-medium text-brand hover:underline">
              Đăng ký
            </Link>
          </span>
        </div>
      </div>
    </Card>
  );
}
