# Cài đặt và chạy

Hướng dẫn từng bước trên Windows PowerShell. Đường dẫn `D:\Project\Marketplate` chỉ là ví dụ. Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd`. Sau khi chạy được, đọc tiếp [backend.md](./backend.md).

## 1. Chuẩn bị

Cần Git, Node.js 24.x kèm npm, và một trình soạn thảo. Kiểm tra bằng `git --version`, `node --version`, `npm --version`. Backend dùng SQLite, nên không cần MySQL, PostgreSQL, Redis hay Docker; mỗi người có database riêng trên máy mình.

```powershell
git clone https://github.com/tinhvn26/Maketplace.git Marketplate
cd Marketplate
```

`app/api` (backend) và `app/web` (frontend) có `package.json` riêng. Luôn chạy npm bên trong từng thư mục; thư mục gốc không có script chung.

## 2. Cấu hình backend

```powershell
cd app/api
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"   # chạy 2 lần
```

Dán kết quả lần đầu vào `JWT_ACCESS_SECRET`, lần sau vào `JWT_REFRESH_SECRET`. Hai giá trị phải khác nhau và dài ít nhất 32 byte. Nếu máy đã có `.env` riêng thì giữ nguyên.

| Biến | Giá trị local | Ghi chú |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | Luôn chạy backend và lệnh Prisma từ `app/api` |
| `PORT` | `3000` | Đổi cổng thì sửa cả `MEDIA_PUBLIC_BASE_URL` |
| `IDENTITY_MAIL_TRANSPORT` | `outbox` | Không cần tài khoản gửi email |
| `IDENTITY_PUBLIC_APP_URL` | trống | Chỉ đặt khi frontend đã có màn hình xác minh/đổi email |
| `MEDIA_STORAGE_PATH` | `./var/media` | Nơi lưu ảnh upload |
| `MEDIA_PUBLIC_BASE_URL` | `http://localhost:3000` | Dùng để tạo URL ảnh trả cho client |
| `INVENTORY_RESERVATION_TTL_SECONDS`, `INVENTORY_EXPIRY_SWEEP_MS` | `900`, `30000` | Thời gian giữ hàng, chu kỳ worker |

`.env`, database, ảnh và client sinh tự động đều đã nằm trong `.gitignore`.

## 3. Cài dependency và tạo database

```powershell
npm ci
npm run db:generate
if (-not (Test-Path -LiteralPath dev.db)) { New-Item -ItemType File -Path dev.db | Out-Null }
npm run db:deploy
```

- `npm ci` cài đúng phiên bản trong lockfile; `postinstall` tự chạy `prisma generate`.
- Lệnh tạo file rỗng `dev.db` tránh lỗi schema engine trên Windows khi dùng URL tương đối. Lệnh này không ghi đè database đã có.
- `db:deploy` áp các migration còn thiếu.
- Chưa có dữ liệu mẫu hay script seed, nên danh sách rỗng là bình thường.

## 4. Chạy và thử backend

```powershell
npm run start:dev
```

Mở terminal thứ hai:

```powershell
$baseUrl = 'http://localhost:3000'
Invoke-RestMethod "$baseUrl/catalog/products"     # 200, danh sách rỗng

$profile = Invoke-RestMethod -Method Post "$baseUrl/auth/register" -ContentType 'application/json' `
  -Body (@{ fullName='Local Developer'; email='developer@example.com'; password='LocalDev123!' } | ConvertTo-Json)
$tokens = Invoke-RestMethod -Method Post "$baseUrl/auth/login" -ContentType 'application/json' `
  -Body (@{ email='developer@example.com'; password='LocalDev123!' } | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($tokens.accessToken)" }
Invoke-RestMethod "$baseUrl/user/me" -Headers $headers
```

- Đăng ký trả `201` kèm hồ sơ role `CUSTOMER`, nhưng không trả token. Đăng nhập trả `200` kèm token.
- Không có route `/`, `/health` hay Swagger, nên `GET /` trả 404 là bình thường. Không có tiền tố `/api`.

Tạo admin đầu tiên (đăng nhập lại sau khi chạy):

```powershell
npm run identity:bootstrap-admin -- developer@example.com
```

## 5. Chạy web

Trong một terminal khác:

```powershell
cd app/web
npm ci
npm run dev -- --port 3001
```

Mở http://localhost:3001. Web hiện là trang khởi tạo của Next.js, chưa gọi API và chưa cần biến `NEXT_PUBLIC_*`. Backend chưa bật CORS, nên khi web gọi API từ trình duyệt sẽ cần cấu hình origin được phép hoặc proxy qua Next.js.

## 6. Email và OTP local

Ở chế độ `outbox`, email chỉ được lưu vào bảng `IdentityMail` và **không gửi đi**. Để xem OTP hay link xác minh: chạy `npm run db:studio`, mở bảng `IdentityMail`, đọc cột `text` của email mới nhất. OTP là chuỗi 6 chữ số, giữ nguyên số 0 ở đầu. Muốn gửi email thật, xem [app/api/README.md](../app/api/README.md#gửi-email-thật).

## 7. Kiểm tra trước khi gửi thay đổi

```powershell
# app/api
npx tsc --noEmit -p tsconfig.json; npm run lint; npm test; npm run test:e2e; npm run build
# app/web
npm run lint; npm run build
```

- Test dùng database tạm, không cần xoá `dev.db`. Test SMTP dùng server giả.
- Test phải chạy từ đường dẫn có chữ ổ đĩa viết hoa (`D:\...`); nếu đang ở `d:\...`, vitest báo `Cannot read properties of undefined (reading 'config')`.
- Chạy bản build: `npm run start:prod` (api) và `npm run start -- --port 3001` (web). `start:prod` không tự đặt `NODE_ENV=production`. Production còn cần SMTP có TLS, HTTPS và nơi lưu database/ảnh bền vững.

## 8. Cập nhật source

Trong `app/api`, chạy `npm ci`, `npm run db:generate`, `npm run db:deploy`, rồi `npm run start:dev`. Trong `app/web`, chạy `npm ci` khi lockfile đổi.

Trước khi áp migration: dừng server và sao lưu database nếu có dữ liệu cần giữ. Không dùng `prisma migrate reset` hay xoá database để chữa lỗi.

## 9. Lỗi thường gặp

| Triệu chứng | Cách xử lý |
|---|---|
| Không chạy được `npm.ps1` | Dùng `npm.cmd` |
| Không tìm thấy `package.json` | `cd` vào `app/api` hoặc `app/web` |
| `JWT_*_SECRET must contain at least 32 bytes`, hoặc hai secret giống nhau | Tạo lại theo bước 2, rồi restart |
| `no such table`, thiếu Prisma Client | Đứng ở `app/api`, kiểm tra `DATABASE_URL`, chạy lại `db:generate` và `db:deploy` |
| `Schema engine error` với database mới | Tạo file rỗng như bước 3, hoặc dùng URL tuyệt đối `file:D:/.../app/api/dev.db` |
| Không cài được `better-sqlite3`/`sharp` | Dùng Node 24.x và `npm ci`. Native module có thể cần bộ build C++/Python. Không chép `node_modules` từ máy khác |
| `EADDRINUSE` | Cổng đang bị dùng: web chạy ở 3001; đổi cổng API thì sửa cả `PORT` và `MEDIA_PUBLIC_BASE_URL` |
| `401` | Đăng nhập lại; gửi access token (không phải refresh token). Đổi mật khẩu hay quyền sẽ thu hồi phiên |
| `403` | Kiểm tra quyền ADMIN hoặc quyền sở hữu shop |
| `409` | Trùng email/slug/SKU hoặc version đã cũ; tải lại dữ liệu rồi gửi lại |
| `429` | Chờ theo header `Retry-After` |
| Trình duyệt báo lỗi CORS | Xem bước 5 |
| Không nhận được email | Kiểm tra đang dùng outbox hay SMTP (bước 6) |
| Test lỗi `reading 'config'` | Chạy lại từ đường dẫn `D:\...` |
