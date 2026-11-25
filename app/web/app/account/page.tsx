import type { Metadata } from "next";
import { Alert, Avatar, Card } from "@/components/ui";
import { requireMe } from "@/lib/session";
import { ProfileForm, VerifyEmailBanner } from "./profile-forms";

export const metadata: Metadata = { title: "Hồ sơ của tôi" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const [me, { welcome }] = await Promise.all([requireMe("/account"), searchParams]);
  return (
    <>
      {welcome === "1" && (
        <Alert tone="success">Chào mừng bạn đến với Marketplate! Chúng tôi đã gửi email xác minh tới {me.email}.</Alert>
      )}
      {!me.isEmailVerified && <VerifyEmailBanner email={me.email} />}
      <Card title="Hồ sơ của tôi" description="Quản lý thông tin hiển thị của bạn.">
        <div className="flex flex-col gap-6 sm:flex-row-reverse sm:items-start">
          <div className="flex items-center gap-3 sm:w-48 sm:flex-col sm:text-center">
            <Avatar name={me.fullName} size="lg" />
            <p className="text-xs text-zinc-500">Ảnh đại diện lấy theo chữ cái đầu của tên.</p>
          </div>
          <div className="flex-1">
            <ProfileForm email={me.email} fullName={me.fullName} phoneNumber={me.phoneNumber ?? ""} />
          </div>
        </div>
      </Card>
    </>
  );
}
