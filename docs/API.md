# API: Identity và Inventory

Base URL `http://localhost:3000`, không có tiền tố `/api`. Body là JSON. Route cần đăng nhập nhận `Authorization: Bearer <accessToken>`; refresh token không dùng thay access token được. Field không khai báo trong DTO bị trả `400`. Catalog, Shops và Media nằm trong [Catalog.md](./Catalog.md#6-api); Orders trong [Orders.md](./Orders.md#4-api).

## Identity

### Endpoint

| Method | Path | Quyền | Body / query | Kết quả |
|---|---|---|---|---|
| POST | /auth/register | Public | fullName, email, password, phoneNumber?, avatarUrl? | 201 profile |
| POST | /auth/login | Public | email, password | 200 tokens |
| POST | /auth/refresh | Public | refreshToken | 200 tokens mới |
| POST | /auth/logout | Đăng nhập | | 204 |
| POST | /auth/logout-all | Đăng nhập | | 204 |
| GET | /auth/sessions | Đăng nhập | | 200 danh sách phiên |
| DELETE | /auth/sessions/:sessionId | Đăng nhập | UUID v4 | 204 |
| GET | /user/me | Đăng nhập | | 200 profile |
| PATCH | /user/me | Đăng nhập | fullName?, phoneNumber?, avatarUrl? | 200 profile |
| POST | /user/me/change-password | Đăng nhập | currentPassword, newPassword | 204 |
| POST | /user/me/change-email | Đăng nhập | newEmail, currentPassword | 204 |
| DELETE | /user/me | Đăng nhập | currentPassword | 204 |
| POST | /auth/forgot-password | Public | email | 202 |
| POST | /auth/reset-password | Public | email, otp, newPassword | 204 |
| POST | /auth/verification/request | Public | email | 202 |
| POST | /auth/verification/confirm | Public | token | 204 |
| POST | /auth/email-change/confirm | Public | token | 204 |
| GET | /admin/users | ADMIN | q?, page?, limit?, role?, status? | 200 trang |
| GET | /admin/users/:id | ADMIN | | 200 profile |
| PATCH | /admin/users/:id/status | ADMIN | status: ACTIVE / LOCKED | 200 profile |
| PATCH | /admin/users/:id/role | ADMIN | role: ADMIN / EMPLOYER / CUSTOMER | 200 profile |
| DELETE | /admin/users/:id | ADMIN | | 204 |

### Response

Profile:

```json
{"id":"f985875b-...","fullName":"Nguyen Van A","email":"a@example.com","phoneNumber":null,"avatarUrl":null,
 "status":"ACTIVE","role":"CUSTOMER","emailVerifiedAt":null,"isEmailVerified":false,
 "createdAt":"2026-10-03T00:00:00.000Z","updatedAt":"2026-10-03T00:00:00.000Z"}
```

- Không bao giờ trả passwordHash, emailNormalized, authVersion, deletedAt hay refreshTokenHash.
- `isEmailVerified` suy ra từ `emailVerifiedAt`, chỉ đọc.
- `updatedAt` là thời điểm mới hơn giữa tài khoản và hồ sơ.
- Avatar lưu ở bảng `UserProfile` riêng nhưng vẫn trả dưới tên `avatarUrl`.

Tokens: `{"accessToken","refreshToken","tokenType":"Bearer","expiresIn":900}`. `expiresIn` tính bằng giây, tối đa 900 và không vượt hạn phiên. Response `204` không có body.

Response `202` của forgot-password và verification-request luôn là `{"message":"If the account is eligible, an email will be sent with further instructions"}`, kể cả khi email không tồn tại, tài khoản bị khoá/xoá, đang cooldown hoặc đã xác minh. `202` không chứng minh email đã được gửi.

### Đăng ký, đăng nhập, phiên

- Email được trim và chuyển chữ thường. Đăng ký công khai luôn tạo `CUSTOMER`/`ACTIVE`, không nhận role/status.
- Đăng ký xếp sẵn email xác minh. Nếu xếp lỗi, tài khoản vẫn được tạo; gọi verification/request để thử lại. Được đăng nhập trước khi xác minh.
- Mỗi lần login tạo một phiên với hạn tuyệt đối 7 ngày. Mỗi request kiểm tra cả tài khoản và phiên trong database, ngoài chữ ký JWT. Tài khoản bị khoá/xoá không login được và không dùng được phiên cũ.
- Refresh trả **cả hai** token mới và không kéo dài phiên. Client phải tuần tự hoá refresh: dùng lại token cũ, hoặc refresh đồng thời, sẽ thu hồi cả phiên đó (kể cả token vừa cấp). Phiên khác không bị ảnh hưởng.
- Logout thu hồi phiên hiện tại; logout-all thu hồi mọi phiên.
- `GET /auth/sessions` trả các phiên còn hoạt động: `[{id, createdAt, lastUsedAt, expiresAt, current}]`. `lastUsedAt` cập nhật khi refresh.
- `DELETE /auth/sessions/:id` chỉ tác động phiên của chính mình; phiên không tồn tại hoặc của người khác vẫn trả 204 mà không xoá gì.

### Hồ sơ và thông tin đăng nhập

- `PATCH /user/me`: field bỏ qua giữ nguyên; `phoneNumber: null` hoặc `avatarUrl: null` để xoá; body rỗng bị từ chối. Tài khoản và avatar cùng commit hoặc cùng rollback. Không thu hồi phiên.
- Đổi mật khẩu thu hồi mọi phiên.
- Xoá tài khoản là xoá mềm, thu hồi phiên, và email vẫn bị giữ chỗ. Không xoá được admin hoạt động cuối cùng.
- `change-email` đổi email ngay sau khi kiểm tra mật khẩu. Phiên hiện tại giữ nguyên; các phiên khác và mọi token khôi phục cũ bị vô hiệu. Email mới ở trạng thái chưa xác minh.
- `/auth/email-change/confirm` vẫn nhận token của luồng xác nhận cũ: thành công thì đổi email, đánh dấu đã xác minh và thu hồi mọi phiên.

### Khôi phục mật khẩu và xác minh email

- **OTP reset mật khẩu:**
  - Gồm 6 chữ số, phải gửi dạng **chuỗi** để giữ số 0 đầu.
  - Hết hạn sau 15 phút, dùng một lần.
  - Mỗi mã cho thử tối đa 5 lần, tính chung mọi IP.
  - Sai, hết hạn hay hết lượt đều trả 400 và không tiết lộ tài khoản có tồn tại hay không.
- **Token xác minh / đổi email:** dài 43 ký tự, dùng một lần, đúng mục đích. Token xác minh hết hạn sau 24 giờ, token đổi email sau 15 phút.
- **Cooldown:** 60 giây cho mỗi tài khoản và mục đích. Yêu cầu trong cooldown vẫn nhận 202 nhưng không gửi mã mới. Mã mới làm mã cũ cùng mục đích mất hiệu lực.
- **Sau khi reset thành công:** mọi phiên và mã cũ bị thu hồi.
- **Email chờ gửi:**
  - Mỗi email gắn với đúng lần cấp mã; xin mã mới hoặc dùng mã thì email cũ bị huỷ trong cùng transaction.
  - Worker kiểm tra lại hiệu lực ngay trước khi gửi SMTP, nhưng email đã bắt đầu gửi thì không thu hồi được.
- **Chế độ outbox (mặc định local):** email chỉ nằm trong bảng `IdentityMail` (xem bằng Prisma Studio); không có API nào đọc được OTP/token. Cấu hình SMTP: [app/api/README.md](../app/api/README.md#gửi-email-thật).

### Quản trị

- **Admin đầu tiên:** chạy `npm run identity:bootstrap-admin -- email@example.com`. Lệnh chỉ nâng quyền một tài khoản đang hoạt động khi chưa có admin nào, không tạo tài khoản; đăng nhập lại sau đó.
- **`GET /admin/users`:**
  - `page` mặc định 1; `limit` mặc định 20, tối đa 100; `q` tối đa 100 ký tự.
  - Không trả user đã xoá.
  - Response: `{"users":[],"total":0,"page":1,"limit":20,"pages":0}`.
- **Đổi status/role:** thu hồi các phiên cũ; mở khoá không khôi phục phiên đã thu hồi. Không thể khoá, hạ quyền hoặc xoá admin hoạt động cuối cùng.
- **EMPLOYER:** không có quyền quản trị. Quyền quản lý shop luôn dựa trên việc sở hữu shop. Role `USER` cũ không còn hợp lệ.

### Validation, lỗi, giới hạn

- **fullName:** trim, 1–100 ký tự.
- **email/newEmail:** email hợp lệ, tối đa 254 ký tự, trim và chữ thường.
- **Mật khẩu:** mật khẩu mới 8–128 ký tự; mật khẩu hiện tại không rỗng, tối đa 128 ký tự.
- **otp:** chuỗi đúng 6 chữ số ASCII.
- **avatarUrl:** URL HTTP(S) tối đa 2048 ký tự, hoặc null.
- **phoneNumber:** chuỗi khớp `^\+?[0-9]{7,15}$` sau khi trim, hoặc null. Không nhận kiểu số; chuỗi rỗng, dấu cách, chữ hay gạch ngang đều bị từ chối.

| Mã | Khi nào |
|---|---|
| 400 | Validation, OTP/token sai, email mới trùng email hiện tại |
| 401 | Sai thông tin đăng nhập, token/phiên không hợp lệ, tài khoản không hoạt động |
| 403 | Thiếu quyền ADMIN, hoặc quyền thay đổi trong lúc xử lý |
| 404 | User không tồn tại hoặc đã xoá (API admin) |
| 409 | Email đã dùng, sửa đồng thời, vi phạm bảo vệ admin cuối cùng |
| 429 | Vượt rate limit, kèm header `Retry-After` |

- **Dạng lỗi:** `{"statusCode":400,"message":"...","error":"Bad Request"}`. Lỗi validation có thể trả `message` là mảng. Không bao giờ trả stack trace hay chi tiết SQL.
- **Rate limit** (theo IP và handler, lưu trong SQLite):

  | Handler | Giới hạn |
  |---|---|
  | register | 5/phút |
  | login, đổi mật khẩu, xoá tài khoản | 10/phút |
  | refresh | 30/phút |
  | recovery, verification, change-email | 5/15 phút |
  | Identity còn lại | 120/phút |

- **Proxy:** mặc định không tin `X-Forwarded-For`; chạy sau reverse proxy thì phải cấu hình trusted proxy.
- **Cache:** response Identity có `Cache-Control: no-store`.

## Inventory

### Endpoint

Quyền:
- **Seller** (`/seller/shops/:shopId/inventory`): chủ shop hoặc ADMIN.
- **Admin** (`/admin/inventory`): chỉ ADMIN, thao tác trên kho platform (không thuộc shop nào).

Hai prefix có cùng các route sau:

| Method | Path | Body / query | Kết quả |
|---|---|---|---|
| POST | /warehouses | name, code, priority? | 201 warehouse |
| GET | /warehouses | | 200 danh sách |
| PATCH | /warehouses/:id | version, name?, priority?, isActive? | 200 warehouse |
| GET | /stocks | warehouseId?, variantId?, page?, limit? | 200 trang |
| POST | /stocks/receive | warehouseId, variantId, quantity, reason | 201 stock |
| POST | /stocks/adjust | warehouseId, variantId, quantityDelta, reason, version | 201 stock |
| POST | /stocks/transfer | fromWarehouseId, toWarehouseId, variantId, quantity, reason | 201 {from, to, transferId} |
| GET | /movements | warehouseId?, variantId?, page?, limit? | 200 trang |

Public: `GET /inventory/availability?variantIds=a,b` trả `[{variantId, inStock}]`, nhận tối đa 100 id. Không trả số lượng.

Stock: `{id, warehouseId, variantId, onHand, reserved, available, version, updatedAt}`, trong đó `available = onHand − reserved`. Trang: `{items, total, page, limit, pages}`.

### Quy tắc

- **Kho:**
  - Mỗi kho thuộc một shop, hoặc thuộc platform (`shopId = null`).
  - Mã kho gồm 1–32 ký tự chữ, số, `-` hoặc `_`, tự chuyển chữ hoa, và không trùng trong cùng shop (hoặc trong platform).
  - `priority` từ 0 đến 1000, mặc định 100; giá trị nhỏ được lấy hàng trước.
  - Không có API xoá kho, chỉ có `isActive: false`. Kho tắt không nhận reservation mới và không được tính vào `inStock`.
- **Variant:** chỉ nhập được variant thuộc cùng shop với kho. Kho platform chỉ nhận variant của sản phẩm platform. Sai thì trả 404.
- **Phạm vi:** kho hoặc stock của shop khác được trả 404 (giả như không tồn tại), không trả 403.
- **Số lượng:**
  - `quantity` là số nguyên 1–1.000.000.000.
  - `quantityDelta` là số nguyên khác 0.
  - `reason` dài 1–200 ký tự.
- **Điều chỉnh và chuyển kho:**
  - Điều chỉnh phải gửi `version` đang có của stock; sai version trả 409 `INVENTORY_STALE_VERSION`.
  - Không thể làm `onHand` thấp hơn số đang giữ (`reserved`): trả 409 `INSUFFICIENT_STOCK`.
  - Chuyển kho cũng tuân theo quy tắc đó, và hai kho phải khác nhau.
- **Lịch sử:** mỗi thay đổi ghi thêm một dòng movement (`RECEIPT`, `ADJUSTMENT`, `TRANSFER_OUT`/`TRANSFER_IN` dùng chung `transferId`, `RESERVE`, `RELEASE`, `EXPIRE`, `SHIP`). Movement không bao giờ bị sửa.
- **Shop bị SUSPENDED:** không đọc và không sửa được inventory của shop đó (409 `SHOP_UNAVAILABLE`), vì quy tắc của Shops áp dụng cho mọi thao tác quản lý shop.

### Reservation (contract cho Orders)

Token `INVENTORY_RESERVATIONS`, import từ `inventory/contracts/inventory.api.ts`. Chưa có endpoint HTTP cho các thao tác này. Module [Orders](./Orders.md) là bên gọi.

- **`reserve({idempotencyKey, reference, lines:[{variantId, quantity}]})`:**
  - Nhận 1–100 variant khác nhau, mỗi dòng số lượng 1–999.
  - Kiểm tra qua `CATALOG_PRICING` rằng variant còn bán được.
  - Chọn kho theo `priority`, rồi kho còn nhiều hàng hơn, rồi theo id. Một dòng có thể được tách ra nhiều kho.
  - Đủ hàng cho mọi dòng thì giữ hết, thiếu một dòng thì không giữ gì.
  - Trạng thái `ACTIVE`, tự hết hạn sau `INVENTORY_RESERVATION_TTL_SECONDS` (mặc định 900).
- **Idempotency:** gửi lại cùng key với cùng nội dung thì nhận lại đúng kết quả cũ; cùng key mà nội dung khác thì trả `IDEMPOTENCY_CONFLICT`.
- **`get(id)`:** đọc trạng thái và phân bổ hiện tại, không đổi gì.
- **`confirm(id)`:** chuyển sang `ALLOCATED`, không còn hết hạn. Gọi lại an toàn; gọi khi đã hết hạn thì trả `INVALID_RESERVATION_STATE`.
- **`ship(id, warehouseId)`:**
  - Xuất phần hàng của một kho: `onHand` và `reserved` cùng giảm.
  - Khi mọi kho đã xuất, trạng thái thành `SHIPPED`.
  - Chỉ dùng được sau `confirm`.
- **`release(id, { refuseIfShipped? })`:** trả lại phần chưa xuất và chuyển sang `RELEASED`. Gọi lại an toàn. Với `refuseIfShipped: true`, nếu đã có kho nào xuất thì trả `INVALID_RESERVATION_STATE` và không trả hàng; kiểm tra nằm trong cùng transaction với việc trả hàng (Orders dùng khi huỷ).
- **Hết hạn:** worker chạy mỗi `INVENTORY_EXPIRY_SWEEP_MS` (mặc định 30 giây), chuyển reservation `ACTIVE` quá hạn sang `EXPIRED` và trả hàng lại kho.
- **Kết quả:** `{reservationId, reference, status, expiresAt, allocations:[{variantId, warehouseId, quantity, shipped}]}`.

### Mã lỗi Inventory

| Mã HTTP | `code` |
|---|---|
| 400 | `INVALID_INVENTORY_INPUT` |
| 403 | `INVENTORY_ACCESS_DENIED`, `SHOP_ACCESS_DENIED` |
| 404 | `INVENTORY_NOT_FOUND`, `SHOP_NOT_FOUND` |
| 409 | `INVENTORY_CONFLICT`, `INVENTORY_VERSION_CONFLICT`, `INVENTORY_STALE_VERSION`, `INSUFFICIENT_STOCK`, `INVALID_RESERVATION_STATE`, `IDEMPOTENCY_CONFLICT`, `SHOP_UNAVAILABLE` |
