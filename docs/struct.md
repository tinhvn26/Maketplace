# Cấu trúc thư mục

Mọi module trong `app/api/src/modules/` có cùng bố cục `contracts/ domain/ application/ infrastructure/ presentation/` cộng file `<tên>.module.ts`. Unit test (`*.spec.ts`) đặt cạnh code; e2e đặt ở `app/api/test/`. Quy tắc phụ thuộc giữa các tầng xem [Architecture.md](./Architecture.md).

```text
Marketplate/
├── README.md, AGENTS.md, CLAUDE.md
├── docs/
└── app/
    ├── web/                    # Next.js 16 (khung)
    └── api/
        ├── prisma/             # schema.prisma, migrations/ (SQL viết tay)
        ├── scripts/            # benchmark-catalog.mjs
        ├── src/
        │   ├── main.ts, app.module.ts
        │   ├── config/         # auth, identity-mail, inventory (registerAs)
        │   ├── platform/database/   # PrismaService, generated/ (gitignore)
        │   └── modules/        # 6 module bên dưới
        └── test/               # *.e2e-spec.ts, architecture.spec.ts, inventory-*.spec.ts, orders-*.spec.ts, support/
```

## Identity

```text
identity/
├── contracts/identity.http.ts        # AccessTokenGuard, AdminRoleGuard, AuthenticatedRequest
├── contracts/identity.roles.ts       # USER_ROLES, UserRole, isUserRole
├── contracts/identity.persistence.ts # findActiveAccount, lockAccount cho adapter module khác
├── domain/
│   ├── entities/user.ts              # Interface User + isUserActive/isUserDeleted
│   ├── errors/                       # auth, users, account-actions
│   ├── policies/                     # user-input, profile-input, user-security (admin cuối), account-action
│   └── types/                        # user-role (ADMIN/EMPLOYER/CUSTOMER), user-status, account-action-purpose
├── application/
│   ├── auth/                         # AuthService: register, login, refresh, logout; input, tokens
│   ├── users/                        # UsersService (hồ sơ, credential, xoá), AdminUsersService; record/result
│   ├── account-actions/              # AccountActionsService: xác minh, reset OTP, đổi email
│   └── ports/                        # user, session, account-action repository; password-hasher, token-issuer,
│                                     # identity-mailer, message-builder, rate-limit-store, logger, email-verification-requester
├── infrastructure/
│   ├── persistence/                  # prisma-user, -session, -account-action repository; prisma-rate-limit.store
│   ├── security/                     # jwt-token.issuer, scrypt-password.hasher
│   └── mail/                         # smtp-identity.mailer, account-action-message.builder, identity-mail.worker
└── presentation/
    ├── cli/bootstrap-admin.ts        # npm run identity:bootstrap-admin
    └── http/
        ├── controllers/              # auth, users, admin-users, account-actions
        ├── dto/{auth,users,account-actions}/
        ├── guards/                   # access-token, admin-role, identity-rate-limit
        ├── decorators/               # current-user-id, current-session-id, identity-rate-limit
        └── filters/                  # auth, users, account-actions
```

`User` chứa credential nên không bao giờ được trả thẳng ra ngoài. Hồ sơ trả về đi qua `UserProfileResult`, ghép từ `User` và bảng `UserProfile` (avatar).

## Shops

```text
shops/
├── contracts/shops.api.ts            # SHOP_ACCESS: requireManageable, assertSellable; ShopActor; lỗi
├── contracts/shops.persistence.ts    # findShopState, sellableShopWhere/-IdsSql cho adapter module khác
├── domain/                           # entities/shop.ts, errors/, policies/shop-access.policy.ts
├── application/                      # shops.service.ts (luật phân quyền, hiện thực SHOP_ACCESS), ports/shop.repository.ts
├── infrastructure/persistence/       # prisma-shop.repository.ts (chỉ đọc/ghi + transaction), shop.persistence.ts
└── presentation/http/                # shops, admin-shops controller; dto, guard, decorator, filter
```

## Catalog

```text
catalog/
├── contracts/                        # catalog-pricing.api.ts (CATALOG_PRICING), catalog-variants.api.ts (CATALOG_VARIANTS)
├── domain/
│   ├── entities/                     # product (aggregate), category, brand
│   ├── value-objects/                # money, product-image, variant-attributes
│   ├── policies/                     # catalog-input, catalog-search, category-attributes
│   └── errors/
├── application/
│   ├── admin/                        # Quản trị category, product, variant
│   ├── query/                        # Truy vấn public, cursor, projection public
│   ├── seller/                       # Sản phẩm theo shop, revision, submit
│   ├── review/                       # Duyệt revision, audit
│   ├── quote/                        # Báo giá (hiện thực CatalogPricing)
│   ├── taxonomy/                     # Brand
│   ├── shared/                       # Input dùng chung, CatalogPage, policy query/version
│   └── ports/                        # catalog, seller, taxonomy, workflow repository; purchasing reader; actor; runtime
├── infrastructure/
│   ├── persistence/                  # prisma-category, -brand, -product repository (prisma-catalog là facade gộp port);
│   │                                 # catalog-persistence.shared (mapper, retry); -catalog-workflow; -catalog-purchasing.reader
│   └── integrations/catalog-integrity.ts   # Kiểm tra actor/shop và MediaUsage qua contracts/*.persistence.ts, trong cùng transaction
└── presentation/http/                # controllers (public, discovery, quote, seller, admin, brands, review),
                                      # dto, filter, guards, middleware (thuộc tính), catalog-actor
```

## Media

```text
media/
├── contracts/media.api.ts            # MEDIA_ASSETS: resolveForShop; lỗi
├── contracts/media.persistence.ts    # bindMediaUsages, releaseMediaUsages cho adapter module khác
├── domain/                           # entities/media-asset.ts, errors/
├── application/                      # media.service.ts, ports/media.ports.ts
├── infrastructure/
│   ├── persistence/                  # prisma-media.repository.ts
│   ├── storage/                      # local-media.storage.ts
│   └── image/                        # sharp-image.processor.ts
└── presentation/http/                # controllers, filters, guards
```

## Inventory

```text
inventory/
├── inventory.module.ts               # Core: wiring, export INVENTORY_RESERVATIONS và các service
├── inventory.http.module.ts          # Controller, guard, filter
├── inventory.worker.module.ts        # ReservationExpiryWorker
├── contracts/                        # inventory.api.ts (INVENTORY_RESERVATIONS, lỗi), inventory.types.ts
├── domain/
│   ├── entities/                     # warehouse, stock (0 ≤ reserved ≤ onHand), stock-movement, reservation (máy trạng thái)
│   ├── policies/                     # stock-allocation (chọn và tách kho), inventory-input (validate)
│   └── errors/
├── application/
│   ├── warehouses/ · stock/ · reservations/ · availability/
│   ├── shared/                       # retry khi mất CAS, phân quyền theo scope, phân trang/kết quả
│   └── ports/                        # unit of work, warehouse/stock/reservation repository, clock, id
├── infrastructure/
│   ├── persistence/                  # Prisma repository; unit of work chiếm write lock SQLite
│   └── jobs/reservation-expiry.worker.ts
└── presentation/http/                # seller-inventory, admin-inventory, inventory-availability controller;
                                      # dto, decorator, guard, filter
```

Trạng thái reservation: `ACTIVE` → (`confirm`) `ALLOCATED` → (`ship` từng kho) `SHIPPED`. `release` chuyển sang `RELEASED`; worker chuyển reservation quá hạn sang `EXPIRED`. Chi tiết xem [API.md](./API.md#inventory).

## Orders

```text
orders/
├── orders.module.ts                  # Wiring; dùng CATALOG_PRICING, INVENTORY_RESERVATIONS, SHOP_ACCESS (chưa có contracts/)
├── domain/
│   ├── entities/order.ts             # Order (máy trạng thái PLACED → CONFIRMED → SHIPPED → DELIVERED, CANCELLED)
│   ├── policies/order-input.policy.ts   # Validate input
│   └── errors/
├── application/
│   ├── checkout/                     # Đặt hàng: báo giá, giữ hàng, tách order theo shop, idempotency
│   ├── buyer/ · fulfilment/          # Người mua (xem, huỷ); chủ shop/ADMIN (confirm, ship, deliver, huỷ)
│   ├── shared/                       # transition (CAS + recheck), releaseForCancel, đổi lỗi Catalog/Inventory, view
│   └── ports/order-unit-of-work.ts   # Unit of work, store, access reader, actor
├── infrastructure/persistence/       # prisma-order.store.ts, prisma-order-unit-of-work.ts
└── presentation/http/                # orders, seller-orders, admin-orders controller; dto, decorator, guard, filter
```

Chi tiết xem [Orders.md](./Orders.md).
