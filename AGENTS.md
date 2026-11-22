# AGENTS.md

Hướng dẫn cho agent làm việc trong repo này. Tài liệu chi tiết nằm trong `docs/` (tiếng Việt).

## Repo

- `app/api`: backend NestJS 12 + Prisma 7 + SQLite. Gần như mọi việc diễn ra ở đây.
- `app/web`: Next.js 16, hiện mới là khung. Trước khi sửa, đọc `app/web/AGENTS.md`: Next.js bản này khác dữ liệu huấn luyện của bạn.
- Hai app có `package.json` riêng, không có script chung ở thư mục gốc. Chạy lệnh trong đúng thư mục app.

## Lệnh (chạy trong `app/api`)

```bash
npx tsc --noEmit -p tsconfig.json   # typecheck, gồm cả test/
npm run lint                        # oxlint
npm test                            # unit + integration + test kiến trúc
npm run test:e2e                    # e2e (khoảng 30 giây trở lên)
npm run build
npm run db:generate                 # sau khi sửa prisma/schema.prisma
```

- **Windows:** vitest chỉ chạy đúng khi thư mục hiện tại có chữ ổ đĩa viết hoa (`D:\...`). Nếu cwd là `d:\...`, mọi spec import `vitest` đều lỗi `Cannot read properties of undefined (reading 'config')`. Gõ `cd D:/...` trước khi chạy test.
- Trên PowerShell, dùng `npm.cmd` nếu `npm.ps1` bị chặn.
- Xong một thay đổi thì chạy typecheck, lint và `npm test`. Chạy thêm `test:e2e` nếu đụng tới HTTP, module wiring hoặc schema.

## Kiến trúc backend

Mỗi module trong `src/modules/<tên>/` theo cùng một bố cục:

```text
contracts/       # API công khai cho module khác: token DI, interface, re-export lỗi
domain/          # entities/, policies/, errors/, value-objects/: TypeScript thuần
application/     # services theo nhóm nghiệp vụ, ports/ (interface + Symbol token), shared/
infrastructure/  # persistence/ (Prisma), mail/, jobs/...: hiện thực các port
presentation/    # http/{controllers,dto,filters,guards,decorators}/, cli/
<tên>.module.ts  # wiring
```

Quy tắc bắt buộc. `test/architecture.spec.ts` kiểm tra tự động các quy tắc 1 và 2:

1. `domain/` và `application/` không import `@nestjs/*`, `@prisma/*`, `src/config`, `src/platform`, tầng ngoài, và không đọc `process.env`.
2. Code trong một module chỉ được import module khác qua `contracts/` của module đó. Ví dụ guard của identity lấy từ `identity/contracts/identity.http.ts`, không import sâu vào `presentation/`.
3. Service ở application là class thường, không có `@Injectable`. Module nối chúng bằng `useFactory`, và truyền `{ next: randomUUID }` cùng `{ now: () => new Date() }` cho id và clock.
4. Quy tắc nghiệp vụ nằm ở domain/application. Repository chỉ map dữ liệu và lưu theo compare-and-set (`updateMany where { id, version }`, sai số dòng thì ném lỗi conflict). Đừng nhét điều kiện nghiệp vụ mới vào query Prisma.
5. Lỗi nghiệp vụ là class trong `domain/errors/` có thuộc tính `code`. Mỗi module có một exception filter đổi lỗi sang HTTP: validation 400, access 403, not found 404, conflict 409.
6. DTO dùng class-validator, message tiếng Việt, theo mẫu `src/modules/shops/presentation/http/dto/shops.requests.ts`. `ValidationPipe` toàn cục bật `whitelist` và `forbidNonWhitelisted`, nên mọi field phải được khai báo.
7. Muốn dùng chức năng của module khác: thêm interface và token vào `contracts/` của module đó, cung cấp bằng `useExisting`, rồi thêm vào `exports` của module. Không tạo phụ thuộc vòng. Ví dụ Inventory phụ thuộc Catalog, nên Catalog không được import Inventory.

## Database

- Prisma client được sinh vào `src/platform/database/generated/`. Không sửa tay thư mục này, và nó bị gitignore.
- Migration **viết tay** trong `prisma/migrations/<timestamp>_<tên>/migration.sql`, có `CHECK` cho invariant. Xem mẫu `20261122000000_inventory`.
- Sau khi viết migration, kiểm tra nó khớp schema. Diff phải là `-- This is an empty migration.`:
  ```bash
  DATABASE_URL="file:<db tạm>" npx prisma migrate deploy
  DATABASE_URL="file:<db tạm>" npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
  ```
- Không reset hay xoá `dev.db` của người dùng. Nâng cấp dữ liệu luôn bằng migration.
- Không có API xoá cứng product/variant. Bảng inventory tham chiếu chúng bằng `ON DELETE RESTRICT`.

## Test

- Unit spec đặt cạnh code (`*.spec.ts`). Spec của adapter Prisma tự tạo SQLite tạm và áp toàn bộ migration. Mẫu: `src/modules/shops/infrastructure/persistence/prisma-shop.repository.spec.ts`.
- Đường dẫn tới migrations trong spec là `new URL('../'.repeat(n) + 'prisma/migrations/', import.meta.url)`. Chuyển file sang thư mục khác thì phải sửa lại số cấp `../`.
- E2e đặt ở `test/*.e2e-spec.ts` và dùng `createIdentityTestApp([Module...])` trong `test/support/identity-app.ts`. Thêm bảng mới có khoá ngoại thì cập nhật `reset()` để xoá bảng con trước.
- Fake và helper chỉ dùng cho test đặt trong `test/support/`, không đặt trong `src/`, để không lọt vào bản build.

## An toàn

- Không commit `.env`, `dev.db` hay `var/media`.
- Không log secret, OTP, token, địa chỉ người nhận hay nội dung email.
- Mặc định `IDENTITY_MAIL_TRANSPORT=outbox`: email không được gửi thật.

## Git

- Commit theo dạng `feat(scope): ...`, `refactor(scope): ...`, `test(scope): ...`, `docs: ...`, với scope là tên module.
- Chỉ commit khi người dùng yêu cầu.
