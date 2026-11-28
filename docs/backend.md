# Làm việc với backend

Dành cho người mới vào nhóm: đọc code ở đâu, gọi API ra sao, thêm tính năng và đổi database thế nào. Cài môi trường xem [installation.md](./installation.md). Endpoint xem [API.md](./API.md) (Identity, Inventory), [Catalog.md](./Catalog.md) (Catalog, Shops, Media) và [Orders.md](./Orders.md) (Orders).

## 1. Tổng quan

Backend nằm ở `app/api`: NestJS 12, TypeScript ESM (NodeNext), Prisma 7, SQLite qua `better-sqlite3`. `AppModule` gồm Identity, Catalog (Catalog import thêm Shops và Media), `InventoryHttpModule`, `OrdersModule` và `InventoryWorkerModule`. Chưa có Cart, Payment.

```text
app/api/
├── prisma/schema.prisma, prisma/migrations/
├── prisma.config.ts
├── src/main.ts, src/app.module.ts
├── src/config/                 # auth, identity-mail, inventory
├── src/platform/database/      # PrismaService + generated client (không sửa tay)
├── src/modules/{identity,shops,catalog,media,inventory,orders}/
├── test/                       # e2e, test kiến trúc, test/support/
└── scripts/benchmark-catalog.mjs
```

Cây thư mục chi tiết của từng module: [struct.md](./struct.md).

## 2. Đọc code

Trong một module, tìm theo trách nhiệm:

- `domain/`: entity, value object, policy, lỗi nghiệp vụ.
- `application/`: service, input/result, `ports/`.
- `infrastructure/`: Prisma, JWT, scrypt, SMTP, filesystem, worker.
- `presentation/http/`: controller, DTO, guard, filter, decorator. CLI nằm ở `presentation/cli/`.
- `contracts/`: phần công khai cho module khác dùng.
- `*.module.ts`: wiring DI.

Đọc theo luồng request: controller, rồi service, rồi entity/policy, rồi port, rồi adapter Prisma, rồi file module. Ví dụ với Identity:
1. `presentation/http/controllers/`
2. `application/{auth,users,account-actions}/`
3. `application/ports/`
4. `infrastructure/persistence/`
5. `identity.module.ts`

Thứ tự đọc Catalog xem [Catalog.md](./Catalog.md#7-đọc-code-theo-thứ-tự-nào).

Domain và application không import NestJS, Prisma hay config, và không đọc `process.env`. Module gọi nhau qua `contracts/`. Repository kiểm tra lại quyền, trạng thái và version trong transaction ghi; guard cho qua chưa đủ. Chi tiết quy tắc: [Architecture.md](./Architecture.md).

## 3. Quy ước HTTP cho người gọi API

- **Địa chỉ:** `http://localhost:3000`, không có `/api`, không có `/`, `/health` hay Swagger.
- **Body:** JSON (`Content-Type: application/json`); riêng upload ảnh dùng multipart.
- **Token:** gửi qua header `Authorization: Bearer <accessToken>`. Backend không đặt cookie.
- **Field thừa** trong body/query trả `400`, ví dụ gửi `role` khi đăng ký.
- **`204`** không có body; đừng parse JSON.
- **Lỗi nghiệp vụ** có dạng `{statusCode, message, error, code}`. Lỗi validation có `message` là mảng và không có `code`, nên client phải xử lý cả hai dạng.
- **Version:** thao tác có version thì dùng version từ response mới nhất, đừng gửi cứng `version: 0`. Gặp `409` thì tải lại dữ liệu trước khi thử lại.
- **Tiền** là số nguyên VND (`priceAmount`).
- **Rate limit** mới áp dụng cho Identity: `429` kèm header `Retry-After`.
- **CORS** chưa bật. Web chạy khác cổng thì cần cấu hình CORS hoặc proxy. `MEDIA_PUBLIC_BASE_URL` chỉ dùng để tạo URL ảnh, không liên quan CORS.

## 4. Thêm hoặc sửa tính năng

1. Xác định module sở hữu nghiệp vụ. Đọc service, test và tài liệu liên quan.
2. Viết quy tắc trong `domain/` (entity, policy, lỗi có `code`). Cần database, mail hay clock thì khai báo port trong `application/ports/`.
3. Viết service trong `application/`: class thường, không có `@Injectable`.
4. Viết adapter trong `infrastructure/`. Repository chỉ map và lưu theo compare-and-set `updateMany where {id, version}`; quy tắc nghiệp vụ không nằm ở đây.
5. Viết DTO (class-validator, message tiếng Việt), controller, guard và filter trong `presentation/http/`. Response chỉ chứa các field được phép lộ ra.
6. Nối bằng `useFactory` trong module. Module khác cần dùng thì thêm interface và token vào `contracts/`, cung cấp bằng `useExisting` và thêm vào `exports`.
7. Đổi schema thì viết migration (mục 5). Thêm test và cập nhật tài liệu.

**Quy ước code:**
- Import nội bộ ghi đuôi `.js` dù file nguồn là `.ts`.
- Không dùng `any` để lách boundary.
- Không log secret, OTP hay token.

## 5. Đổi database

Chạy trong `app/api`:

```bash
npm run db:deploy      # áp migration đã có (sau khi pull)
npm run db:generate    # sinh lại Prisma client (sau khi schema đổi)
npm run db:studio      # xem dữ liệu local
```

Khi chính bạn sửa `prisma/schema.prisma`:

1. Viết `prisma/migrations/<YYYYMMDDHHMMSS>_<tên>/migration.sql` bằng tay theo kiểu các migration sẵn có: có `CHECK` cho invariant, chuyển dữ liệu cũ sang dạng mới. Xem mẫu `20261122000000_inventory`. Cũng có thể dùng `npm run db:migrate -- --name <tên>` để sinh khung rồi sửa lại.
2. Kiểm tra migration khớp schema trên một database tạm. Kết quả diff phải là `-- This is an empty migration.`:
   ```bash
   DATABASE_URL="file:<tmp>.db" npx prisma migrate deploy
   DATABASE_URL="file:<tmp>.db" npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
   ```
3. Commit schema, thư mục migration và code cùng một lúc.

Không dùng `db push`, `migrate reset`, và không xoá database để "sửa" dữ liệu. Trước khi nâng cấp database đang có dữ liệu: dừng API và worker, sao lưu file database, rồi `db:generate`, `db:deploy`, build và chạy bản mới. Code mới và schema mới phải lên cùng nhau.

**Các migration quan trọng:**

| Migration | Thay đổi |
|---|---|
| `20261003000000_complete_identity` | role, xác minh, version, session, action, outbox email, rate limit |
| `20261008000000_password_reset_otp` | Reset bằng OTP thay cho token; huỷ token và email reset cũ |
| `20261028000000_complete_catalog` | Version cho category, ảnh và thuộc tính, `minPriceAmount` |
| `20261029000000_link_identity_mail_actions` | Gắn email với action; huỷ email cũ chưa gửi |
| `20261103000000_marketplace_catalog`, `20261103010000_catalog_search_backfill` | Shops, Media, review và audit, cây category, brand, `searchText` |
| `20261106000000_separate_user_profile` | Chuyển avatar sang `UserProfile`, thêm `phoneNumber` |
| `20261106010000_user_roles_customer_employer` | Role `USER` thành `CUSTOMER`, thêm `EMPLOYER` |
| `20261122000000_inventory` | Kho, stock, movement, reservation, có `CHECK` |
| `20261128000000_orders` | Checkout, order, dòng hàng (snapshot giá), có `CHECK` |

## 6. Test

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
npm test                                   # unit + integration + kiến trúc
npm run test:e2e                           # e2e qua HTTP
npm test -- test/architecture.spec.ts      # chạy riêng một file
npm run test:e2e -- test/inventory.e2e-spec.ts
npm run test:cov                           # coverage
```

- **Windows:** chạy test từ đường dẫn có chữ ổ đĩa viết hoa (`D:\...`). Nếu đang ở `d:\...`, mọi spec import `vitest` sẽ lỗi `Cannot read properties of undefined (reading 'config')`.
- **Spec của adapter Prisma** tạo SQLite tạm và áp toàn bộ migration, không đụng `dev.db`. Đường dẫn tới `prisma/migrations/` tính bằng số cấp `../` từ file spec, nên di chuyển file thì phải sửa lại.
- **E2E** dùng `createIdentityTestApp([...modules])` trong `test/support/identity-app.ts`. Thêm bảng có khoá ngoại thì cập nhật `reset()` để xoá bảng con trước.
- **Nên test:** trường hợp thành công cùng các lỗi có ảnh hưởng thực tế (thiếu quyền, dữ liệu sai, trùng, version cũ, phiên bị thu hồi). Sửa transaction thì test adapter trên database thật, đừng chỉ dùng mock.
