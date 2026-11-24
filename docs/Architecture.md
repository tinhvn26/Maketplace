# Kiến trúc

Marketplate là một **modular monolith** viết bằng NestJS: một ứng dụng, một database (SQLite qua Prisma), chia thành các module theo nghiệp vụ. Bên trong mỗi module áp dụng **Clean Architecture**.

Mục tiêu:
- Quy tắc nghiệp vụ không phụ thuộc NestJS, Express hay database, nên thay database không phải sửa business rule.
- HTTP API và background worker chạy chung một codebase.
- Mỗi module có ranh giới rõ ràng, để sau này có thể tách thành service riêng khi cần.

## 1. Hướng phụ thuộc

```text
presentation  ─┐
               ├─> application ─> domain
infrastructure ┘
```

| Tầng | Chứa gì | Không được import |
|---|---|---|
| `domain/` | entity, value object, policy, lỗi nghiệp vụ | application, infrastructure, presentation, `@nestjs/*`, `@prisma/*`, `src/config`, `src/platform`, `process.env` |
| `application/` | service theo nhóm nghiệp vụ, input/result, port (interface + `Symbol` token) | infrastructure, presentation, `@nestjs/*`, `@prisma/*`, config, `process.env` |
| `infrastructure/` | hiện thực port: Prisma, JWT, scrypt, SMTP, filesystem, worker | |
| `presentation/` | controller, DTO, guard, filter, decorator, CLI | |
| `contracts/` | API công khai cho module khác: token, interface, re-export lỗi | |

`test/architecture.spec.ts` kiểm tra tự động: domain/application vi phạm bảng trên, hoặc import code riêng (ngoài `contracts/`) của module khác, thì test fail.

Ví dụ phụ thuộc sai: entity gọi `PrismaService`; service import controller; domain đọc `ConfigService`.

## 2. Module

```text
src/
├── main.ts            # bootstrap, ValidationPipe toàn cục (transform, whitelist, forbidNonWhitelisted)
├── app.module.ts      # Config + Identity + Catalog + InventoryHttp + InventoryWorker
├── config/            # registerAs: auth, identity-mail, inventory
├── platform/database/ # PrismaService, generated client
└── modules/
    ├── identity/      # tài khoản, phiên, khôi phục, quản trị
    ├── shops/         # shop, chủ shop, trạng thái bán
    ├── catalog/       # category, brand, product/variant, duyệt, báo giá
    ├── media/         # upload ảnh, thumbnail
    └── inventory/     # kho, tồn kho, reservation
```

Mỗi module có các thư mục `contracts/ domain/ application/ infrastructure/ presentation/` và file `<tên>.module.ts`. Chỉ tạo thư mục con khi thực sự có code. Inventory tách wiring thành `inventory.module.ts` (core), `inventory.http.module.ts` (controller) và `inventory.worker.module.ts` (job), dùng chung application/domain.

**Contract hiện có:**

| Contract | Module cung cấp | Dùng để |
|---|---|---|
| `identity.http.ts` | Identity | `AccessTokenGuard`, `AdminRoleGuard`, `AuthenticatedRequest` |
| `identity.roles.ts` | Identity | `USER_ROLES`, `UserRole`, `isUserRole`: danh sách role duy nhất, không viết tay ở module khác |
| `identity.persistence.ts` | Identity | `findActiveAccount`, `lockAccount`, `activeAccountWhere`: kiểm tra tài khoản trong transaction của module khác |
| `shops.persistence.ts` | Shops | `findShopState`, `sellableShopWhere`, `sellableShopIdsSql`: kiểm tra shop trong transaction, lọc shop còn bán |
| `media.persistence.ts` | Media | `bindMediaUsages`, `releaseMediaUsages`: ghi ảnh đang được dùng trong transaction của module khác |
| `SHOP_ACCESS` | Shops | `requireManageable`, `assertSellable` |
| `MEDIA_ASSETS` | Media | `resolveForShop`: kiểm tra quyền, lấy URL chuẩn của ảnh theo `assetId` |
| `CATALOG_PRICING` | Catalog | Báo giá hiện tại theo variant |
| `CATALOG_VARIANTS` | Catalog | Cho biết variant thuộc shop nào |
| `INVENTORY_RESERVATIONS` | Inventory | Giữ, xác nhận, xuất, huỷ hàng |

Các file `contracts/*.persistence.ts` chỉ dành cho tầng `infrastructure/` của module khác, vì chúng nhận `Prisma.TransactionClient`. Nhờ đó Catalog và Media không đọc thẳng bảng `User`, `Shop`, `MediaAsset`, `MediaUsage`: module sở hữu bảng viết truy vấn và luật, module gọi chỉ truyền transaction của mình vào.

Không được có phụ thuộc vòng. Inventory phụ thuộc Catalog và Shops, nên Catalog không import Inventory; trạng thái còn/hết hàng vì vậy là một endpoint riêng của Inventory.

**Trách nhiệm từng module:**
- **Identity:** user, phiên và role. Không giữ thông tin shop hay đơn hàng; module khác chỉ tham chiếu `userId`.
- **Shops:** chủ shop và trạng thái ACTIVE/SUSPENDED. Quyền bán xác định qua việc sở hữu shop, không phải một role toàn hệ thống.
- **Catalog:** nội dung bán và giá niêm yết. Không giữ tồn kho.
- **Media:** file ảnh và việc ảnh đang được dùng ở đâu.
- **Inventory:** nguồn sự thật duy nhất cho số lượng tồn.
- **Chưa làm:** Cart (snapshot tạm, giá xác nhận lại khi đặt), Orders (vòng đời đơn, snapshot giá/địa chỉ), Payment (payment intent, webhook, đối soát; SDK của nhà cung cấp không lọt vào Orders), Notifications (gửi theo sự kiện, không đổi trạng thái đơn).

### Phong cách domain

Domain có hai cách viết, mỗi module chọn một và giữ nhất quán:

- **Hàm thuần trên dữ liệu bất biến** (Inventory, Shops: `reserveStock(stock, qty, now)` trả về bản ghi mới). Dùng khi aggregate là bản ghi số liệu có bất biến chặt (`0 ≤ reserved ≤ onHand`) và service cần so sánh trạng thái cũ/mới để ghi compare-and-set và sổ biến động. Đây là cách mặc định cho module mới.
- **Class có method** (Catalog: `Product.publish()`). Dùng khi aggregate có máy trạng thái nhiều bước và nhiều quy tắc gắn vào hành vi. Catalog giữ cách này vì đã viết như vậy; không chuyển đổi chỉ để thống nhất.

Cả hai đều không import framework, không giữ tham chiếu tới repository, và repository chỉ nhận/trả snapshot.

## 3. Wiring

Chỉ file module biết implementation cụ thể. Service ở application là class thường, không có decorator, nhận port qua constructor:

```ts
{ provide: CATALOG_REPOSITORY, useClass: PrismaCatalogRepository },
{
  provide: CatalogQueryService,
  inject: [CATALOG_REPOSITORY],
  useFactory: (reader: PublicCatalogReader) => new CatalogQueryService(reader),
},
{ provide: CATALOG_PRICING, useExisting: CatalogQuoteService },  // công khai qua contract
```

Id và clock được truyền vào dưới dạng `{ next: randomUUID }` và `{ now: () => new Date() }` để test có thể thay. `AppModule` chỉ ghép các module, không chứa logic.

## 4. HTTP

```text
request -> middleware -> guard -> pipe (DTO) -> controller -> service -> domain/port -> adapter
lỗi ở bất kỳ bước nào -> exception filter của module
```

- **Guard** chỉ trả lời "request này có được đi tiếp không". Nghiệp vụ không đặt trong guard.
- **Kiểm tra lại khi ghi:** quyền và trạng thái được kiểm tra lại trong transaction ghi. Guard cho qua chưa đủ, vì giữa lúc kiểm tra và lúc ghi trạng thái có thể đã đổi.
- **Lỗi nghiệp vụ:** là class có `code` ổn định, không chứa HTTP status. Filter đổi sang status: validation 400, access 403, not found 404, conflict 409.
- **Dạng lỗi:** `{statusCode, message, error, code}`. Lỗi validation của Nest có `message` là mảng và không có `code`. Không bao giờ trả stack trace, chi tiết SQL hay secret.
- **Chưa có:** Swagger, health check, CORS, request ID/trace ID. Đây là việc làm sau.

## 5. Persistence và đồng thời

- **Ba loại model tách riêng:** domain entity, record Prisma, response DTO. Adapter map tường minh từng cột; controller không bao giờ trả object Prisma.
- **Optimistic locking (khoá lạc quan):**
  - Aggregate có `version`, và repository ghi bằng `updateMany where {id, version}`.
  - Không cập nhật được dòng nào thì ném lỗi conflict.
  - Version cũ do client gửi trả về 409. Thua race (ghi đồng thời) ở Inventory thì service retry cả unit of work tối đa 3 lần.
- **Transaction:**
  - Aggregate cùng các bảng phụ (audit, `MediaUsage`, lịch sử tồn kho) commit cùng nhau.
  - Thao tác chạm tới nhiều module được điều phối ở adapter tích hợp, dưới một transaction của monolith (ví dụ `catalog-integrity.ts` gọi `contracts/*.persistence.ts` của Identity, Shops, Media). Không gọi HTTP nội bộ.
  - Inventory dùng port `InventoryUnitOfWork.run()`. Adapter chiếm write lock của SQLite ngay đầu transaction để các writer xếp hàng.
- **SQLite busy:** adapter tự thử lại khi gặp `SQLITE_BUSY`/`SQLITE_LOCKED`.
- **Lớp chặn cuối:** unique constraint, FK và `CHECK` trong database, ví dụ `0 ≤ reserved ≤ onHand`.
- **Migration** viết tay, nâng cấp dữ liệu cũ, không reset database. Xem [backend.md](./backend.md#5-đổi-database).

## 6. Worker và sự kiện

Hiện có:
- **Worker email (Identity):** gửi SMTP mỗi 5 giây; nhận email theo lease (một lần nhận có thời hạn); lỗi thì thử lại, chờ tăng dần từ 30 giây, tối đa 8 lần.
- **Worker hết hạn reservation (Inventory):** mặc định chạy mỗi 30 giây.

Cả hai chạy trong cùng tiến trình với API, an toàn khi nhiều instance cùng chạy nhờ compare-and-set và lease.

Định hướng khi có Orders/Notifications:
- Phân biệt domain event, integration event và command/job.
- Handler phải idempotent (nhận lặp lại không gây hậu quả).
- Mỗi event cần có `eventId`, `eventType`, `version`, `occurredAt`, `aggregateId`, `payload`.
- Thao tác chạm nhiều context ưu tiên outbox cộng retry, không dùng distributed transaction.

## 7. Luồng đặt hàng (dự kiến)

```text
OrdersController -> CreateOrder
  -> CartReader -> CATALOG_PRICING (báo giá) -> INVENTORY_RESERVATIONS.reserve (idempotency key)
  -> OrderRepository (lưu snapshot giá) -> Payment port
  thanh toán xong -> confirm;  giao hàng -> ship(warehouseId);  huỷ -> release
  -> OrderCreated event -> Notifications
```

Ràng buộc:
- Orders không đọc database của Cart hay Inventory.
- Inventory không import Orders.
- Reservation phải có hạn và có cơ chế trả hàng.
- Giá, giảm giá và phí ship được snapshot vào đơn.
- Webhook thanh toán idempotent theo event ID của nhà cung cấp.
- Command quan trọng phải có idempotency key.

## 8. Test

| Loại | Ở đâu | Cách |
|---|---|---|
| Domain | `*.spec.ts` cạnh code | Unit thuần, không khởi động Nest |
| Application | cạnh code, hoặc `test/*.spec.ts` | Port giả, ví dụ `test/support/in-memory-inventory.ts` |
| Adapter | `infrastructure/**/*.spec.ts` | SQLite tạm, áp toàn bộ migration |
| Kiến trúc | `test/architecture.spec.ts` | Quét import |
| E2E | `test/*.e2e-spec.ts` | Ứng dụng thật qua HTTP (Supertest) |

Ưu tiên test các invariant: email trùng, mật khẩu không bao giờ lộ ra response, refresh token bị dùng lại, admin cuối cùng, version cũ, không bán vượt tồn khi có nhiều request đồng thời, idempotency.

## 9. Trạng thái và lộ trình

**Đã có:**
- Identity: phiên lưu DB, JWT, scrypt, OTP, outbox email, rate limit.
- Shops.
- Catalog: category dạng cây, brand, thuộc tính theo schema, revision và duyệt, audit, tìm kiếm tiếng Việt, cursor, báo giá.
- Media: kiểm tra ảnh thật, thumbnail.
- Inventory: nhiều kho, sổ biến động, reservation có TTL và idempotency, ship theo kho, worker hết hạn.
- Test kiến trúc, integration trên SQLite, e2e.

**Tiếp theo:**
1. Cart và Orders, dựa trên `CATALOG_PRICING` và `INVENTORY_RESERVATIONS`.
2. Payment qua port: webhook idempotent, đối soát.
3. Integration events, Notifications, request ID và tracing.
4. Object storage/CDN cho ảnh, xếp hạng tìm kiếm, cache khi đo tải thấy cần.
5. Đo tải trên staging (`npm run benchmark:catalog` chỉ là benchmark local) trước khi chọn database và storage cho production.
