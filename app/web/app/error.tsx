"use client";

import { Button, Card } from "@/components/ui";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
      <Card title="Có lỗi xảy ra" description="Máy chủ đang bận hoặc tạm thời không truy cập được. Vui lòng thử lại sau ít phút.">
        <Button onClick={() => retry()} className="w-full">
          Thử lại
        </Button>
      </Card>
    </div>
  );
}
