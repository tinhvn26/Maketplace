import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { requireMe } from "@/lib/session";
import { ChangeEmailForm, ChangePasswordForm, DeleteAccount } from "./security-forms";

export const metadata: Metadata = { title: "Bảo mật" };

export default async function SecurityPage() {
  const me = await requireMe("/account/security");
  return (
    <>
      <Card title="Đổi mật khẩu" description="Sau khi đổi, mọi thiết bị sẽ được đăng xuất và bạn cần đăng nhập lại.">
        <ChangePasswordForm />
      </Card>
      <Card
        title="Đổi email"
        description={
          <>
            Email hiện tại: <strong className="text-zinc-900">{me.email}</strong>. Các thiết bị khác sẽ được đăng xuất.
          </>
        }
      >
        <ChangeEmailForm />
      </Card>
      <Card title="Xoá tài khoản" description="Tài khoản sẽ bị vô hiệu hoá và không thể đăng ký lại bằng email này.">
        <DeleteAccount />
      </Card>
    </>
  );
}
