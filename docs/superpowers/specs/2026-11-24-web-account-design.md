# Frontend đợt 1: phần tài khoản (app/web)

## Bối cảnh

Thư mục `app/web` hiện chỉ là trang mẫu của create-next-app (Next 16.4.6, React 19.3, Tailwind 4). Backend identity đã có đủ API.

Người dùng đã chốt:

- Web dành cho người dùng thật. Đợt 1 chỉ làm phần tài khoản.
- Giao diện kiểu sàn TMĐT Việt Nam, tên **Marketplate**, màu cam, thiết kế cho mobile trước.
- Trang chủ là khung sàn với nội dung tạm.
- Các trang cần làm: đăng nhập, đăng ký, quên mật khẩu, xác minh email, hồ sơ, đổi mật khẩu và email, quản lý phiên đăng nhập, xoá tài khoản.
- Web nối với API theo cách A: server Next giữ token trong cookie httpOnly.
- Avatar hiển thị chữ cái đầu của tên. Đợt này chưa có upload ảnh.

Mục tiêu: người dùng tự làm được mọi việc với tài khoản trên điện thoại và máy tính, và JavaScript trong trình duyệt không bao giờ đọc được token.

## Các cách đã cân nhắc

| Cách | Ưu | Nhược | Kết quả |
|---|---|---|---|
| **A. Server Next giữ token**: Server Actions, `proxy.ts`, cookie httpOnly | Token không lộ ra trình duyệt. Chỉ refresh ở một chỗ. Không phải sửa backend | Mỗi request đi thêm một chặng Next → API | **Đã chọn.** Đây là cách tài liệu Next 16 hướng dẫn (`next/dist/docs/01-app/02-guides/authentication.md`) |
| B. Trình duyệt gọi thẳng API | Mô hình quen thuộc | Phải bật CORS. Token nằm trong JS nên lộ khi bị XSS. Mỗi tab tự refresh, dễ làm mất phiên | Loại |
| C. Next chuyển tiếp `/api/*` sang API | Token vẫn nằm trong cookie | Trang chạy nhiều JS phía trình duyệt hơn | Loại |

Avatar cũng có ba phương án:

- **Chữ cái đầu**: đã chọn.
- **Thêm loại media cá nhân**: phải đổi quyền của module Media. Hiện chỉ ADMIN được upload ảnh không gắn shop, xem `media.service.ts:150` và `test/media.e2e-spec.ts:283`.
- **Ô nhập link ảnh**: loại, vì người dùng thật hiếm khi có sẵn link.

## Ràng buộc từ backend

Phần này đã kiểm tra trong code.

- **Link trong email** do `account-action-message.builder.ts` tạo từ biến `IDENTITY_PUBLIC_APP_URL`:
  - Xác minh email: `<web>/verify-email?token=…`.
  - Đổi email: `<web>/change-email?token=…`.
  - Quên mật khẩu không có link mà gửi mã OTP 6 số.
- **Đổi email**: `/user/me/change-email` đổi ngay và **không gửi email** (`users.service.ts:118-146`). Trang `/change-email?token=` chỉ dùng cho token còn sót từ luồng cũ.
- **Token**:
  - Access token sống tối đa 900 giây.
  - Mỗi lần refresh, API trả về **cả hai** token mới.
  - Refresh chồng nhau, hoặc dùng lại refresh token cũ, sẽ thu hồi **cả phiên**.
  - Refresh không kéo dài phiên: phiên hết hạn tuyệt đối sau 7 ngày (`auth.service.ts:175`).
  - Được đăng nhập khi email chưa xác minh.
  - JWT có trường `exp`.
- **Lỗi** trả về dạng `{statusCode, message, error}`. `message` có thể là mảng. Lỗi 429 kèm header `Retry-After`. Message lỗi nghiệp vụ là tiếng Anh, nên web tự dịch theo mã HTTP.
- **Rate limit tính theo IP**:
  - Nếu Next không chuyển IP thật sang API, mọi người dùng chung một bucket, chẳng hạn cả sàn chỉ được 10 lần login mỗi phút.
  - Next tự gán `x-forwarded-for` khi header này chưa có (`base-server.js:604`, chạy trước proxy). Web phải gửi tiếp header đó sang API.
  - API mặc định `TRUST_PROXY=loopback`. Bản sửa này chưa commit.
  - Khi lên production, Next phải đứng sau nginx (hoặc proxy tương tự) có ghi `X-Forwarded-For`. Nếu không, khách có thể tự khai IP giả.

## Thiết kế

### 0. Sửa tài liệu backend

`docs/API.md:125` còn ghi "mặc định không tin X-Forwarded-For". Sửa thành mô tả `TRUST_PROXY` theo `app/api/src/config/app.config.ts`, ghi rõ mặc định `loopback` và cách đặt khi chạy sau nginx. Thêm dòng gợi ý `IDENTITY_PUBLIC_APP_URL=http://localhost:3001` vào `app/api/.env.example`.

### 1. Hạ tầng web (`app/web`)

**Cổng**:

- API giữ cổng 3000.
- Web chạy cổng **3001**: sửa script `dev` và `start` trong `package.json` thành `-p 3001`.
- Env của web: `API_URL`, mặc định `http://localhost:3000`, chỉ server dùng. Ghi vào `app/web/.env.example`.

**Dependency**:

- `server-only`: theo tài liệu Next.
- `vitest`: đặt ở devDependencies.
- Không thêm thư viện UI.

**`lib/api.ts`** (có `import 'server-only'`):

- `api(path, {method, body, token, forwardedFor})` gọi `${API_URL}`.
- Kết quả trả về là `{ok: true, data}` hoặc `{ok: false, status, message, retryAfter}`. Response 204 cho `data` là `undefined`.
- Trong Server Action và Server Component, `forwardedFor` lấy từ `(await headers()).get('x-forwarded-for')`.

**`lib/session.ts`**:

- Hai cookie `mp_at` và `mp_rt`, đều `httpOnly`, `sameSite: 'lax'`, `path: '/'`, `secure` khi chạy production.
- Hạn của mỗi cookie lấy từ `exp` của chính JWT đó. Như vậy `mp_rt` hết hạn đúng lúc phiên hết, không bị gia hạn thêm 7 ngày sau mỗi lần refresh.
- Các hàm: `setSession(tokens)`, `clearSession()` (chỉ gọi được từ Server Action), `getAccessToken()`.
- `getMe` được bọc bằng `cache()` của React và gọi `/user/me`. Nếu API trả 401, coi như người dùng chưa đăng nhập. Server Component không xoá được cookie, nên chỉ render ở trạng thái chưa đăng nhập.

**`lib/jwt.ts`**: hàm `tokenExp(jwt)` decode phần payload bằng base64url để đọc `exp`. Hàm không verify chữ ký; API vẫn là nơi xác thực.

**`proxy.ts`** (đặt ở gốc `app/web`):

- Matcher bỏ qua `_next/*` và file tĩnh.
- **Refresh**:
  - Chỉ chạy khi `mp_at` không còn hoặc còn dưới 60 giây, và vẫn có `mp_rt`.
  - Gọi `POST /auth/refresh {refreshToken}`, kèm `x-forwarded-for` lấy từ `request.headers`.
  - Thành công: đặt `response.cookies.set(...)`. Trong bản 16.4, `cookies()` của Server Component và Server Action thấy giá trị mới ngay (`x-middleware-set-cookie`), nên không cần ghi đè header Cookie của request.
  - API trả 401: xoá cookie.
  - API trả 429 hoặc lỗi mạng: giữ nguyên cookie.
- **Chống refresh chồng nhau**: dùng một `Map<refreshToken, Promise<result>>` trong bộ nhớ, giữ mỗi kết quả khoảng 10 giây. Ghi chú trong code: `shortcut: chỉ đúng khi chạy một process Next; nhiều instance cần store chung (Redis)`.
- **Chặn trang cần đăng nhập**:
  - Vào `/account/*` khi không có phiên thì chuyển sang `/login?next=…`. Riêng request có header `next-action` (Server Action POST) thì **không** chuyển hướng, để action tự trả lỗi.
  - Đã đăng nhập mà vào `/login` hoặc `/register` thì chuyển sang `/account`.
  - Response chuyển hướng phải mang theo cookie vừa refresh.
- **Chống open redirect**: hàm `safeNext(next)` chỉ nhận chuỗi bắt đầu bằng `/` nhưng không bắt đầu bằng `//` hoặc `/\`. Trường hợp còn lại trả về `/account`.

**Form**:

- Dùng Server Action với `useActionState` (import từ `react`).
- Kiểm tra trước bằng thuộc tính HTML, khớp rule trong `docs/API.md`:
  - Mật khẩu 8–128 ký tự.
  - `fullName` 1–100 ký tự.
  - Số điện thoại theo `pattern="\+?[0-9]{7,15}"`.
  - `type=email` cho ô email.
  - OTP: `inputMode="numeric"`, `pattern="[0-9]{6}"`, gửi đi dưới dạng chuỗi.
- Lỗi từ API hiện ở đầu form, bằng tiếng Việt. `lib/errors.ts` ánh xạ theo mã lỗi và theo từng form:
  - 401 ở form login: "Email hoặc mật khẩu không đúng".
  - 401 ở các form có mật khẩu hiện tại: "Mật khẩu hiện tại không đúng".
  - 409 ở form đăng ký hoặc đổi email: "Email đã được sử dụng".
  - 400 ở form OTP: "Mã không đúng hoặc đã hết hạn".
  - 429: "Bạn thử quá nhiều lần, thử lại sau N giây".
  - Các lỗi khác: "Có lỗi, vui lòng thử lại".

**UI**:

- Tailwind thuần, cộng vài component nhỏ trong `components/ui/`: `Button`, `Input`, `Field` (gồm label và dòng lỗi), `Card`, `Alert`, `Avatar` (chữ cái đầu trên nền cam).
- Hộp xác nhận dùng thẻ `<dialog>` có sẵn của trình duyệt.
- Màu thương hiệu đặt bằng `@theme` trong `globals.css`, ví dụ `--color-brand: #ee4d2d`.
- Font Be Vietnam Pro qua `next/font/google`, subset `vietnamese`. Thẻ gốc là `<html lang="vi">`.

### 2. Bố cục chung

- **Header**: dải màu cam. Trong dải có logo "Marketplate", ô tìm kiếm (disabled, placeholder "Sắp ra mắt") và khu tài khoản.
  - Khách chưa đăng nhập thấy "Đăng nhập | Đăng ký".
  - Người đã đăng nhập thấy Avatar kèm tên, cùng một menu có "Tài khoản" và "Đăng xuất".
- **Header trên mobile**: hàng trên là logo và icon tài khoản, hàng dưới là ô tìm kiếm.
- **Footer**: đơn giản.
- **Trang chủ `/`**: banner "Sàn đang được xây dựng" và lời mời đăng ký.
- **Các trang `/account/*`**:
  - Desktop có menu bên trái: Hồ sơ, Bảo mật, Thiết bị đăng nhập.
  - Mobile đổi menu này thành hàng tab cuộn ngang.

### 3. Các trang

| Route | Nội dung | API |
|---|---|---|
| `/login` | Ô email và mật khẩu. Thành công thì lưu cookie, rồi chuyển tới `safeNext(next)`. Có link sang quên mật khẩu và đăng ký | `POST /auth/login` |
| `/register` | Họ tên, email, mật khẩu, số điện thoại (không bắt buộc). Thành công thì tự đăng nhập, vào `/account` và hiện thông báo "Kiểm tra email để xác minh" | `/auth/register`, rồi `/auth/login` |
| `/forgot-password` | Bước 1: nhập email, sau đó luôn báo "Nếu email hợp lệ, mã đã được gửi". Bước 2, cùng trang: nhập OTP và mật khẩu mới, email giữ trong ô ẩn. Thành công thì về `/login?reset=1` kèm thông báo | `/auth/forgot-password`, `/auth/reset-password` |
| `/verify-email?token=` | Chỉ gửi khi người dùng bấm nút "Xác minh email". **Không tự gọi API khi mở link**, vì trình quét email có thể mở link trước và đốt token dùng một lần. Nếu token hỏng hoặc hết hạn, hiện ô nhập email để xin gửi lại | `/auth/verification/confirm`, `/auth/verification/request` |
| `/change-email?token=` | Cũng bấm nút mới gửi. Thành công thì xoá cookie (API đã thu hồi mọi phiên) và về `/login` | `/auth/email-change/confirm` |
| `/account` | Sửa họ tên và số điện thoại. Avatar hiển thị chữ cái đầu. Nếu email chưa xác minh thì có banner và nút "Gửi lại email xác minh" | `GET/PATCH /user/me`, `/auth/verification/request` |
| `/account/security` | **Đổi mật khẩu**: thành công thì xoá cookie, về `/login` kèm thông báo, vì API đã thu hồi mọi phiên. **Đổi email**: thành công thì gọi `/auth/verification/request` cho địa chỉ mới và báo "Kiểm tra hộp thư mới để xác minh". **Xoá tài khoản**: đặt cuối trang, mở dialog nhập mật khẩu; xoá xong thì xoá cookie và về `/` | `/user/me/change-password`, `/user/me/change-email`, `DELETE /user/me` |
| `/account/sessions` | Danh sách phiên, mỗi phiên có thời điểm tạo, lần dùng gần nhất và hạn. Đánh dấu "Thiết bị này" ở phiên hiện tại. Mỗi phiên có nút "Đăng xuất"; nếu là phiên hiện tại thì xoá cookie luôn. Có thêm nút "Đăng xuất tất cả" | `/auth/sessions`, `DELETE /auth/sessions/:id`, `/auth/logout-all` |
| Đăng xuất (Server Action) | Gọi API, xoá cookie, về `/` | `/auth/logout` |

Ngày giờ hiển thị bằng `Intl.DateTimeFormat('vi-VN', …)`.

### 4. Test

Dùng vitest cho phần logic thuần:

- `tokenExp`.
- `safeNext`: chặn `//evil.com`, `/\evil.com`, `https://x`.
- Chống refresh chồng nhau: 5 lời gọi song song chỉ được fetch 1 lần.
- `lib/errors.ts`.

Code cần test phải tách khỏi file có `import 'server-only'`, hoặc alias `server-only` trong config của vitest.

Chưa làm Playwright cho web; phần còn lại kiểm tra bằng tay (xem bên dưới).

## Ngoài phạm vi

- Upload avatar: cần thêm loại media cá nhân ở backend, làm như một việc riêng.
- Trang sản phẩm, giỏ hàng, trang quản trị.
- Tìm kiếm thật.
- Đa ngôn ngữ, dark mode, đăng nhập Google.
- Store chung khi chạy nhiều instance Next.

## File chính

- **Backend (tài liệu)**: `docs/API.md`, `app/api/.env.example`.
- **Web**:
  - Cấu hình: `app/web/package.json`, `proxy.ts`, `.env.example`.
  - Thư viện: `lib/{api,session,jwt,errors,refresh}.ts` và các file `*.spec.ts` đi kèm.
  - Giao diện chung: `app/layout.tsx`, `app/globals.css`, `components/ui/*`, `components/site-header.tsx`, `components/site-footer.tsx`.
  - Trang: `app/(auth)/{login,register,forgot-password}/page.tsx` cùng `actions.ts`, `app/verify-email/`, `app/change-email/`, `app/account/{layout,page}.tsx`, `app/account/security/`, `app/account/sessions/`.
- Trước khi code, đọc `node_modules/next/dist/docs` cho phần proxy, cookies, forms và server actions, như `app/web/AGENTS.md` yêu cầu.
- **Spec thiết kế**: `docs/superpowers/specs/2026-11-24-web-account-design.md`, chép từ plan này.
- **Commit**: không commit. Chỉ liệt kê lệnh git để người dùng tự chạy, không thêm dòng co-author.

## Kiểm tra

1. **Web** (chạy trong `app/web`, sau `npm install`):
   - `npx tsc --noEmit`
   - `npm run lint`
   - `npx vitest run`
   - `npm run build`
2. **Backend**: chỉ đổi tài liệu và `.env.example`, không cần chạy lại test.
3. **Chạy thật** qua browser pane:
   - Tạo `.claude/launch.json` với 2 cấu hình: API (`npm run start:dev`, cổng 3000) và web (`npm run dev`, cổng 3001). Mở cả hai bằng `preview_start`.
   - Ghi log một lần để xác nhận `x-forwarded-for` có mặt trong `request.headers` của proxy, rồi xoá log đó.
   - Đi hết một luồng: đăng ký → xác minh → đăng xuất → đăng nhập → sửa hồ sơ → đổi email → đổi mật khẩu (bị đưa về `/login`) → quên mật khẩu bằng OTP → xem phiên và thu hồi phiên → xoá tài khoản.
     - Token xác minh và mã OTP đọc từ bảng `IdentityMail` bằng một script nhỏ, không in ra log chung.
   - Kiểm tra lại các trang ở viewport 375px.
   - Kiểm tra refresh: xoá cookie `mp_at` rồi tải lại trang. Trang phải vẫn ở trạng thái đăng nhập, và `/account/sessions` vẫn còn đủ các phiên.
   - Chạy `document.cookie` trong console và xác nhận không thấy `mp_at` hay `mp_rt`.
