import Link from "next/link";
import { Alert, buttonClass } from "@/components/ui";

export default async function Home({ searchParams }: PageProps<"/">) {
  const { deleted } = await searchParams;
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      {deleted === "1" && <Alert tone="success">Tài khoản của bạn đã được xoá.</Alert>}
      <section className="overflow-hidden rounded-lg bg-gradient-to-br from-brand-light to-brand px-6 py-12 text-white sm:px-10 sm:py-16">
        <p className="text-sm font-medium uppercase tracking-wide text-white/90">Sắp ra mắt</p>
        <h1 className="mt-2 max-w-xl text-3xl font-bold leading-tight sm:text-4xl">Sàn Marketplate đang được xây dựng</h1>
        <p className="mt-3 max-w-xl text-white/95">
          Tạo tài khoản ngay hôm nay để sẵn sàng mua sắm và mở shop khi sàn chính thức hoạt động.
        </p>
        <Link href="/register" className={buttonClass("outline", "mt-6 border-white text-brand")}>
          Đăng ký miễn phí
        </Link>
      </section>
    </div>
  );
}
