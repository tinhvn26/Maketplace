# Marketplate API

Backend NestJS 12 + Prisma 7 + SQLite, tổ chức theo kiểu modular monolith với các module `identity`, `shops`, `catalog`, `media`, `inventory` và `orders`. Tổng quan dự án ở [README gốc](../../README.md). Hướng dẫn từng bước cho PowerShell ở [docs/installation.md](../../docs/installation.md).

## Cài và chạy

Chạy mọi lệnh trong `app/api`. Cần Node.js 24 trở lên. Trên PowerShell, dùng `npm.cmd` nếu `npm.ps1` bị chặn.

1. Tạo `.env` từ `.env.example`, rồi điền `JWT_ACCESS_SECRET` và `JWT_REFRESH_SECRET`. Hai giá trị phải khác nhau và dài ít nhất 32 byte; chạy lệnh dưới đây hai lần để sinh:
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```
2. Cài dependency, sinh Prisma client và tạo database:
   ```bash
   npm ci
   npm run db:generate
   npm run db:deploy
   ```
3. Chạy:
   ```bash
   npm run start:dev
   ```

API chạy ở http://localhost:3000 (đổi bằng `PORT`), không có tiền tố `/api` và không có route `/`. Thử `GET /catalog/products`: database mới trả danh sách rỗng. Xem dữ liệu bằng `npm run db:studio`.

Bản build: `npm run build`, rồi `npm run start:prod`. Khi triển khai, đặt `NODE_ENV=production`; production bắt buộc SMTP có TLS và HTTPS.

Khi lấy code mới về, chạy lại `npm run db:generate` và `npm run db:deploy`. Nên backup database trước khi áp migration. Không reset database.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | bắt buộc | Khoá ký token |
| `DATABASE_URL` | `file:./dev.db` | File SQLite |
| `PORT` | `3000` | Cổng HTTP |
| `IDENTITY_MAIL_TRANSPORT` | `outbox` | `outbox` chỉ lưu email vào bảng `IdentityMail`, không gửi; `smtp` gửi thật |
| `IDENTITY_PUBLIC_APP_URL` | trống | URL frontend cho link xác minh/đổi email |
| `MEDIA_STORAGE_PATH` | `./var/media` | Thư mục lưu ảnh upload |
| `MEDIA_PUBLIC_BASE_URL` | `http://localhost:3000` | Origin dùng trong URL ảnh trả về |
| `INVENTORY_RESERVATION_TTL_SECONDS` | `900` | Thời gian giữ hàng khi chưa xác nhận |
| `INVENTORY_EXPIRY_SWEEP_MS` | `30000` | Chu kỳ worker giải phóng hàng giữ quá hạn |
| `INVENTORY_EMBEDDED_WORKER` | `true` | `false` thì API không tự chạy worker; chạy riêng bằng `npm run start:worker` sau `npm run build` |

## Admin đầu tiên

Đăng ký một tài khoản qua API, rồi chạy lệnh dưới đây trên máy chủ:

```bash
npm run identity:bootstrap-admin -- existing-user@example.com
```

Lệnh chỉ nâng quyền khi hệ thống chưa có admin nào đang hoạt động. Sau khi nâng quyền, mọi phiên của tài khoản đó bị thu hồi, nên cần đăng nhập lại.

## Gửi email thật

Mặc định (outbox), OTP và link xác minh chỉ nằm trong bảng `IdentityMail`; mở bằng `npm run db:studio`. Để gửi thật, sửa `.env` rồi khởi động lại API:

```dotenv
IDENTITY_MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_FROM="Marketplate <your-sender@gmail.com>"
SMTP_USER=your-sender@gmail.com
SMTP_PASSWORD=your-google-app-password
```

- Với Gmail, bật xác minh 2 bước rồi tạo [App Password](https://support.google.com/accounts/answer/185833). Không dùng mật khẩu Google thường.
- Cổng 465 dùng `SMTP_SECURE=true`; cổng 587 dùng STARTTLS.
- `SMTP_USER` và `SMTP_PASSWORD` phải đặt cùng nhau, hoặc bỏ trống cả hai nếu dùng relay nội bộ.

## Kiểm tra

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
npm test            # unit, integration và kiểm tra ranh giới kiến trúc
npm run test:e2e    # e2e qua HTTP
```

Test database dùng file SQLite tạm, không đụng tới `dev.db`. Test SMTP dùng server giả, không gửi email ra ngoài.

Trên Windows, chạy test từ đường dẫn có chữ ổ đĩa viết hoa (`D:\...`). Nếu terminal mở ở `d:\...`, vitest báo lỗi `Cannot read properties of undefined (reading 'config')` ở mọi spec.

## Tài liệu

- [docs/API.md](../../docs/API.md): endpoint Identity
- [docs/Catalog.md](../../docs/Catalog.md): Catalog
- [docs/Orders.md](../../docs/Orders.md): Orders
- [docs/struct.md](../../docs/struct.md): cấu trúc module, gồm Inventory
- [docs/Architecture.md](../../docs/Architecture.md): kiến trúc và lộ trình
