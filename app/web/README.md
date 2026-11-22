# Marketplate Web

Frontend Next.js 16 + React 19 + Tailwind CSS 4. Hiện mới là khung do `create-next-app` tạo, chưa có màn hình nghiệp vụ nào.

## Chạy

Chạy trong `app/web`. Dùng cổng `3001`, vì backend đã chiếm `3000`.

```bash
npm ci
npm run dev -- --port 3001
```

Mở http://localhost:3001.

Bản build:

```bash
npm run build
npm run start -- --port 3001
```

Kiểm tra lint: `npm run lint`.

## Ghi chú

- Backend chạy ở http://localhost:3000. Xem [app/api/README.md](../api/README.md).
- Next.js bản này có thay đổi so với các bản trước. Đọc [AGENTS.md](AGENTS.md) và tài liệu trong `node_modules/next/dist/docs/` trước khi viết code.
