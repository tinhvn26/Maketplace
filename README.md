# Marketplate

Backend cho một sàn thương mại điện tử nhiều người bán: mỗi người bán mở shop, đăng sản phẩm chờ duyệt, quản lý tồn kho ở nhiều kho; khách xem sản phẩm và đặt hàng, đơn tự tách theo shop rồi đi qua xác nhận, giao, nhận hoặc huỷ.

Dự án cá nhân, tập trung vào **kiến trúc backend và tính đúng của nghiệp vụ**: phân quyền theo chủ sở hữu, chống ghi đè khi sửa đồng thời, không bán vượt tồn kho, và giữ ranh giới giữa các module bằng test tự động.

## Đã làm được

| Module | Chức năng |
|---|---|
| **Identity** | Đăng ký, đăng nhập, phiên đăng nhập lưu DB, refresh token xoay vòng (dùng lại token cũ sẽ thu hồi cả phiên), quên mật khẩu bằng OTP email, xác minh và đổi email, quản trị role/khoá/xoá tài khoản, giới hạn tần suất theo IP |
| **Shops** | Mở shop, kiểm tra quyền chủ shop, admin tạm khoá shop |
| **Catalog** | Danh mục dạng cây, thương hiệu, sản phẩm và biến thể (SKU, giá VND, thuộc tính), luồng người bán gửi duyệt và admin duyệt, lịch sử thay đổi, tìm kiếm tiếng Việt, phân trang bằng cursor, báo giá |
| **Media** | Upload ảnh PNG/JPEG/WebP, kiểm tra nội dung ảnh thật, tạo thumbnail, chặn xoá ảnh đang được sản phẩm dùng |
| **Inventory** | Qua HTTP: nhiều kho cho mỗi shop, nhập, điều chỉnh, chuyển kho kèm sổ biến động, xem còn/hết hàng. Contract `INVENTORY_RESERVATIONS` (không có endpoint, module Orders gọi trực tiếp): giữ hàng có hạn (TTL), tự tách một đơn ra nhiều kho, xác nhận, xuất theo từng kho, huỷ. Worker tự giải phóng hàng giữ quá hạn, có thể chạy thành tiến trình riêng |
| **Orders** | Checkout idempotent: báo giá theo giá hiện tại, giữ hàng, tách một lần đặt thành một đơn cho mỗi shop, lưu snapshot giá và địa chỉ. Vòng đời `PLACED → CONFIRMED → SHIPPED → DELIVERED`, huỷ trả hàng về kho (không huỷ được khi đã xuất kho). API riêng cho người mua, chủ shop và admin. Thanh toán COD, chưa có phí ship |

Chưa làm: Cart, Payment, Notifications và giao diện web (`app/web` mới là khung Next.js).

## Điểm kỹ thuật

- **Modular monolith + Clean Architecture trong từng module.** Mỗi module có các tầng `domain → application → infrastructure / presentation`. Module khác chỉ được gọi qua `contracts/`. `test/architecture.spec.ts` sẽ fail nếu domain/application import NestJS, Prisma, biến môi trường, tầng ngoài, hoặc code riêng của module khác.
- **Không bán vượt tồn.** Ràng buộc `0 ≤ reserved ≤ onHand` có ở ba lớp: domain, compare-and-set theo version khi ghi, và `CHECK` trong database. Có test bắn 12 yêu cầu giữ hàng cùng lúc vào 5 đơn vị tồn, và đúng 5 yêu cầu thành công.
- **Idempotency.** Giữ hàng và đặt hàng theo idempotency key: gửi lại đúng yêu cầu thì nhận lại kết quả cũ, gửi khác nội dung thì bị từ chối. Bấm cùng một thao tác trên đơn hai lần trả về đơn hiện tại, không báo lỗi.
- **Checkout kiểu saga.** Báo giá, giữ hàng từng shop, báo giá lại, rồi mới ghi đơn. Bước nào lỗi thì trả lại phần hàng đã giữ. Quyền và trạng thái tài khoản, shop được kiểm tra lại bên trong transaction ghi.
- **Bảo mật tài khoản.** Mật khẩu hash bằng scrypt theo khuyến nghị OWASP. Mỗi request kiểm tra phiên và trạng thái tài khoản ở thời điểm đó. Đổi mật khẩu hoặc role thì thu hồi mọi phiên. Không thể khoá hay xoá admin cuối cùng.
- **Email outbox.** Email được ghi cùng transaction với thao tác tạo ra nó, worker gửi qua SMTP và thử lại với thời gian chờ tăng dần.
- **Migration viết tay** có `CHECK` constraint, nâng cấp dữ liệu cũ mà không reset database.

## Công nghệ

NestJS 12 · TypeScript · Prisma 7 · SQLite (better-sqlite3) · Vitest · Supertest · class-validator · Nodemailer · sharp · Next.js 16 · React 19 · Tailwind CSS 4

## Chạy thử

Cần Node.js 24 trở lên. Backend chạy ở cổng `3000`, web ở cổng `3001`.

- Backend: [app/api/README.md](app/api/README.md)
- Frontend: [app/web/README.md](app/web/README.md)
- Hướng dẫn đầy đủ từng bước (PowerShell): [docs/installation.md](docs/installation.md)

## Kiểm thử

Khoảng 770 unit/integration test và 160 e2e test qua HTTP. Integration test chạy trên SQLite tạm, áp dụng toàn bộ migration thật.

```bash
cd app/api
npm test           # unit + integration + kiểm tra kiến trúc
npm run test:e2e   # e2e qua HTTP
```

## Tài liệu

| File | Nội dung |
|---|---|
| [docs/Architecture.md](docs/Architecture.md) | Kiến trúc, ranh giới module, lộ trình |
| [docs/backend.md](docs/backend.md) | Cách đọc code backend |
| [docs/struct.md](docs/struct.md) | Cây thư mục và vai trò từng phần |
| [docs/API.md](docs/API.md) | Endpoint Identity và ví dụ request |
| [docs/Catalog.md](docs/Catalog.md) | Thiết kế Catalog |
| [docs/Orders.md](docs/Orders.md) | Vòng đời đơn, luồng đặt hàng, API và mã lỗi của Orders |
| [docs/installation.md](docs/installation.md) | Cài đặt chi tiết |

## Cấu trúc repo

```text
app/
├── api/   # Backend NestJS: src/modules/{identity,shops,catalog,media,inventory,orders}
└── web/   # Frontend Next.js (khung)
docs/      # Tài liệu thiết kế
```
