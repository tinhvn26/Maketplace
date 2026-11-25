import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { Suspense } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const beVietnam = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Marketplate", template: "%s | Marketplate" },
  description: "Sàn thương mại điện tử Marketplate",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${beVietnam.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <SiteHeader />
        <main className="flex-1">
          {/* Pages read cookies and search params at request time, so they stream in here. */}
          <Suspense fallback={<p className="mx-auto max-w-6xl px-4 py-10 text-sm text-zinc-500">Đang tải…</p>}>
            {children}
          </Suspense>
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
