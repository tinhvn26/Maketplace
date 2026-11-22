# Catalog

Catalog sở hữu nội dung bán hàng: category, brand, product, variant (SKU, giá, thuộc tính) và ảnh. Catalog **không giữ tồn kho**; tồn kho thuộc Inventory. Shops sở hữu quyền bán và trạng thái shop; Media sở hữu file ảnh. Cả bốn chạy trong cùng ứng dụng NestJS và cùng database, gọi nhau qua `contracts/`.

## 1. Mô hình

Ví dụ: **Áo thun basic** là một Product; **Đen / M** và **Trắng / L** là hai Variant, mỗi cái có SKU, giá và trạng thái bán riêng; **Áo thun** là Category.

- **Product là aggregate root.** Variant chỉ được thêm hoặc sửa qua Product (`addVariant`, `updateVariant`); không có repository riêng cho variant. Một product có tối đa 50 variant.
- **Money** là value object: chỉ hỗ trợ VND, số nguyên từ 0 đến 2.147.483.647, không dùng số thực. Giá 0 chỉ được phép khi sản phẩm còn nháp hoặc variant đang tắt.
- **SKU:** chuyển thành chữ hoa, duy nhất toàn hệ thống, không sửa được sau khi tạo.
- **ID variant** không đổi theo thời gian để Inventory và Orders tham chiếu. Muốn ngừng bán thì đặt `isActive=false`; không có API xoá variant.
- **Slug:** duy nhất toàn hệ thống, chỉ gồm chữ thường ASCII, số và `-`. Tên sản phẩm nhận Unicode.
- **Thuộc tính variant** (`attributes`), ví dụ `{"color":"Đen","size":"M"}`:
  - Tối đa 10 thuộc tính.
  - Key được trim, chuẩn hoá Unicode và chuyển chữ thường; value được trim nhưng giữ nguyên hoa/thường.
  - Hai variant trong cùng product không được có cùng tổ hợp thuộc tính (không phân biệt thứ tự key hay hoa/thường). Attributes rỗng `{}` vẫn hợp lệ.
- **Ảnh:**
  - Mỗi ảnh có `url` và `alt`, tối đa 10 ảnh; ảnh đầu tiên là ảnh bìa.
  - URL phải là HTTP(S) và không chứa thông tin đăng nhập.
  - Ảnh của shop gửi kèm `assetId`; server lấy lại URL chuẩn từ Media thay vì tin URL client gửi.
  - PATCH `images` thay cả bộ ảnh; gửi `[]` để xoá hết.
- **Category:**
  - Có version và có thể có category cha (`parentId`), nhưng không được tạo vòng lặp.
  - Chỉ xoá được khi không còn category con hay product nào tham chiếu, kể cả product đã lưu trữ.
  - `attributeDefinitions`, ví dụ `[{key:"size", values:["M","L"], required:true}]`: tối đa 10 định nghĩa, mỗi định nghĩa tối đa 50 giá trị. Variant phải dùng đúng các giá trị này và có đủ key bắt buộc.
  - Định nghĩa không kế thừa từ category cha. Schema rỗng nghĩa là không ràng buộc.
- **Brand:** có version, chỉ xoá được khi không còn product nào dùng. `brandId` của product là tuỳ chọn; gửi null để bỏ liên kết.
- **Shop của product:** `shopId` không đổi sau khi tạo. Product có `shopId = null` là sản phẩm của platform, chỉ ADMIN quản lý.

## 2. Vòng đời và invariant

```text
DRAFT --publish--> PUBLISHED --unpublish--> DRAFT
DRAFT/PUBLISHED --archive--> ARCHIVED --restore--> DRAFT
```

- Product mới luôn là `DRAFT`, `version=0` và chưa có variant.
- Muốn `PUBLISHED` phải có ít nhất một variant đang bán, và mọi variant đang bán đều có giá > 0. Quy tắc này được kiểm tra lại sau **mọi** thay đổi. Vì vậy không thể tắt variant cuối cùng đang bán của một sản phẩm đã publish.
- `unpublish` và `restore` đưa sản phẩm về nháp và xoá `publishedAt`.
- Sản phẩm `ARCHIVED` không sửa được, phải restore trước; SKU và slug của nó vẫn bị giữ chỗ.
- Domain kiểm tra trên một bản sao trước khi đổi trạng thái thật, nên một thao tác thất bại không làm hỏng object đang có.

## 3. Version và transaction

- Mọi thao tác sửa đều gửi kèm `version` đã đọc. Repository chỉ ghi khi version trong DB còn khớp (`UPDATE ... WHERE id = ? AND version = ?`). Ai ghi sau sẽ nhận **409 `CATALOG_VERSION_CONFLICT`** và phải đọc lại dữ liệu; không được tự retry bằng dữ liệu cũ.
- Product và các variant được lưu trong cùng một transaction: trùng SKU/slug hoặc lỗi ở bất kỳ bước nào sẽ rollback toàn bộ. Chỉ những variant thực sự thay đổi mới được ghi.
- SQLite có thể báo `SQLITE_BUSY`/`SQLITE_LOCKED` khi nhiều kết nối cùng ghi. Khi đó adapter tự thử lại tối đa 3 lần với cùng version ban đầu. Lỗi version cũ thì không bao giờ được retry.
- Unique constraint và khoá ngoại (FK) trong database là lớp chặn cuối cùng khi có nhiều request đồng thời (ví dụ trùng SKU, hay xoá category đúng lúc đang tạo product).
- `minPriceAmount` là giá thấp nhất trong các variant đang bán, được tính lại và lưu cùng transaction với product. Không có variant nào đang bán thì giá trị là null. Public trả nó dưới tên `priceFromAmount`.
- `searchText` là bản đã chuẩn hoá (bỏ hoa/thường, bỏ dấu tiếng Việt, đ thành d) dùng để tìm kiếm. Đây là tìm chuỗi, không có xếp hạng hay sửa lỗi chính tả.
- Seller, approve và upload ảnh đều kiểm tra lại actor, trạng thái shop và việc ảnh đang được dùng (`MediaUsage`) trong cùng transaction ghi, tại `infrastructure/integrations/catalog-integrity.ts`.

## 4. Seller, revision và phê duyệt

- Vai trò seller đến từ việc **sở hữu shop**, không phải một role riêng. CUSTOMER hay EMPLOYER đều cần có shop. Shop luôn lấy từ route, không tin `shopId` trong body.
- Seller không publish trực tiếp được.
  - Sản phẩm nháp chưa có revision thì sửa thẳng.
  - Sửa sản phẩm đang bán sẽ tạo một **revision** `DRAFT`; bản đang công khai vẫn giữ nguyên.
- Các lần sửa tiếp theo gửi cả `version` của product và `revisionVersion` của revision (lấy từ response gần nhất).
  - `submit` đẩy revision sang `PENDING`.
  - Revision `PENDING` không sửa được; muốn sửa thì `withdraw` về `DRAFT`.
- Khi ADMIN approve:
  - Revision được nhận xử lý, product và audit được ghi trong cùng một transaction.
  - Hệ thống kiểm tra lại schema của category, trạng thái shop, giá và ảnh, vì chúng có thể đã đổi từ lúc submit.
  - Product đã bị thay đổi hoặc revision đã được quyết định thì trả 409.
  - ADMIN sửa product trực tiếp sẽ làm revision cũ mất hiệu lực.
- Audit ghi lại actor, hành động, dữ liệu trước/sau và thời điểm. Audit không thay cho snapshot giá của đơn hàng.

## 5. Kiến trúc

```text
Controller + DTO + Guard -> Service (application) -> Product/Money/policy (domain)
                                                   -> port -> Prisma adapter -> SQLite
```

- **Domain** trả lời "điều gì được phép": invariant, Money, policy. Không import NestJS hay Prisma.
- **Application** điều phối thứ tự các bước: đọc, kiểm tra version, gọi entity, lưu. Port được tách theo nhu cầu của từng nơi dùng; ví dụ `PublicCatalogReader` chỉ có các thao tác đọc.
- **Infrastructure** biết SQL, unique/FK và transaction.
- **Presentation** gồm DTO, guard (yêu cầu ADMIN hoặc chủ shop) và filter đổi lỗi sang 400/404/409.
- DTO validate để trả lỗi sớm cho người gọi. Domain/application vẫn validate lại để CLI hay job không bỏ qua được quy tắc.

## 6. API

Route admin và seller cần Bearer token, và response của chúng có `Cache-Control: no-store`. Mọi thao tác sửa trả về version mới; dùng version đó cho lần gửi tiếp theo.

### Public

| Route | Ghi chú |
|---|---|
| `GET /catalog/categories`, `/catalog/categories/tree`, `/catalog/brands` | Không trả version |
| `GET /catalog/products` | `page`, `limit` (≤100), `q`, `categoryId`, `shopId`, `brandId`, `minPrice`, `maxPrice`, `attributes` (JSON, ≤5 key), `sort` = `newest` / `price-asc` / `price-desc` / `name-asc`. Trả **summary**: id, shop/category/brand, tên, slug, coverImage, `priceFromAmount`, các mốc thời gian |
| `GET /catalog/products/:slug` | Chi tiết đầy đủ kèm các variant đang bán. Sản phẩm nháp hoặc lưu trữ trả 404 |
| `GET /catalog/browse?limit=20&cursor=` | Sắp xếp mới nhất trước, phân trang bằng cursor (createdAt + id), trả `{items, hasNext, nextCursor}`, không đếm tổng. Cursor gắn với bộ lọc: đổi filter thì phải bắt đầu lại từ đầu |
| `POST /catalog/quote` | Báo giá hiện tại, xem bên dưới |

- Public chỉ thấy sản phẩm `PUBLISHED` có variant đang bán.
- `minPrice`/`maxPrice` (VND, tính cả hai đầu) so với **giá thấp nhất** của sản phẩm. Ví dụ sản phẩm có giá 100k và 300k không lọt vào khoảng 200k–400k.
- Mọi điều kiện trong `attributes` phải khớp trên **cùng một** variant đang bán.
- Khi sort, các bản ghi bằng nhau được xếp tiếp theo id để phân trang ổn định.

### Quản trị (`/admin/catalog`, ADMIN)

| Route | Body |
|---|---|
| `POST /categories` | `{name, slug, parentId?, attributeDefinitions?}` |
| `GET /categories`, `GET /categories/:id` | Trả kèm version |
| `PATCH /categories/:id` | `{version, name?, slug?, parentId?, attributeDefinitions?}` |
| `DELETE /categories/:id` | `{version}`; trả 409 nếu category còn được dùng |
| `GET/POST/PATCH/DELETE /brands` | Có version |
| `POST /products` | `{categoryId, name, slug, description?, brandId?, images?}` |
| `GET /products?page&limit&status`, `GET /products/:id` | Gồm cả nháp và lưu trữ; khi sort theo giá, sản phẩm không có giá xếp cuối |
| `PATCH /products/:id` | `{version}` + ít nhất một trong name, slug, description, categoryId, brandId, images |
| `POST /products/:id/variants` | `{version, sku, name, priceAmount, isActive?, attributes?, images?}` |
| `PATCH /products/:id/variants/:variantId` | `{version}` + name, priceAmount, isActive, attributes, images. Không sửa được SKU hay currency. Gửi attributes là thay toàn bộ object |
| `POST /products/:id/{publish,unpublish,archive,restore}` | `{version}` |
| `GET /reviews?status=PENDING&limit=20` | status: PENDING, APPROVED hoặc REJECTED; limit ≤ 100 |
| `POST /reviews/:id/{approve,reject}` | `{version, note?}`. `:id` và `version` là của **review**, không phải của product |
| `GET /products/:id/audit?limit=20` | Lịch sử actor và dữ liệu trước/sau |

### Seller (`/seller/shops/:shopId/catalog/products`, chủ shop)

| Route | Body |
|---|---|
| `GET /`, `GET /:id` | `/:id` trả `{product, revision}`; `revision` là null nếu không có |
| `POST /` | Giống body tạo product của admin; shop lấy từ route |
| `PATCH /:id` | `{version, revisionVersion?, name?, slug?, categoryId?, brandId?, description?, images?}` |
| `POST /:id/variants`, `PATCH /:id/variants/:variantId` | Giống admin, cộng thêm `revisionVersion?` |
| `POST /:id/submit`, `/withdraw` | `{version, revisionVersion}` (submit có thể bỏ `revisionVersion`) |
| `POST /:id/{unpublish,archive,restore}` | `{version}`. Muốn công khai lại phải submit và được duyệt |

### Shops

| Route | Quyền | Body |
|---|---|---|
| `POST /shops` | Đăng nhập | `{name, slug}` |
| `GET /shops/me` | Đăng nhập | Các shop của mình |
| `GET /shops/:id` | Public | Chỉ trả shop đang hoạt động |
| `PATCH /shops/:id` | Chủ shop / ADMIN | `{version, name?, slug?}` |
| `PATCH /admin/shops/:id/status` | ADMIN | `{version, status: ACTIVE / SUSPENDED}` |

Khi shop bị SUSPENDED hoặc chủ shop bị khoá/xoá, sản phẩm của shop biến mất khỏi kết quả bán, không báo giá được, và mọi thao tác quản lý shop đều bị chặn.

### Media

- `POST /media/assets`: multipart gồm `file` và `shopId?`.
  - Có `shopId`: ảnh của shop, cần là chủ shop hoặc ADMIN.
  - Không có `shopId`: ảnh của platform, chỉ ADMIN.
  - Định dạng PNG, JPEG hoặc WebP, tối đa 5 MiB. Server giải mã ảnh thật và tạo thumbnail.
  - Trả `{id, url, thumbnailUrl, ...metadata}`.
- `GET /media/assets/:id/original`, `/thumbnail`: public.
- `DELETE /media/assets/:id`: chỉ xoá được khi không còn product hoặc revision nào dùng ảnh.
- Tên file lưu trữ do server tự sinh; tên file client gửi không bao giờ thành đường dẫn.
- Ảnh lưu local tại `MEDIA_STORAGE_PATH`. Chạy nhiều instance thì phải dùng storage dùng chung.

### Báo giá (`POST /catalog/quote` và contract `CATALOG_PRICING`)

```json
{"lines":[{"variantId":"<uuid>","quantity":2,"expectedProductVersion":3,"expectedUnitPriceAmount":150000}]}
```

- Nhận tối đa 100 variant khác nhau, mỗi dòng quantity 1–999. Giá luôn lấy từ database.
- `expected*` dùng để phát hiện dữ liệu đã đổi kể từ lần xem trước: lệch thì trả 409.
- Variant đã tắt, sản phẩm chưa công khai hoặc shop không được bán thì trả 404.
- Response gồm tên, SKU, `shopId`, giá đơn vị, số lượng, thành tiền từng dòng, version và thời điểm báo giá.
- Báo giá **không giữ hàng** và không khoá giá cho lần mua sau. Orders phải lưu snapshot giá; giữ hàng là việc của Inventory.

### Mã lỗi

| Mã | Khi nào |
|---|---|
| 400 | Input sai |
| 401 | Chưa có phiên hợp lệ |
| 403 | Không có quyền |
| 404 | Không tìm thấy hoặc không được phép xem |
| 409 | Version cũ, trùng slug/SKU/tổ hợp thuộc tính, category còn được dùng, thao tác không hợp với trạng thái hiện tại |

## 7. Đọc code theo thứ tự nào

```text
src/modules/catalog/
├── domain/        entities/{product,category,brand}.ts · value-objects/{money,product-image,variant-attributes}.ts
│                  policies/{catalog-input,catalog-search,category-attributes}.policy.ts · errors/
├── application/   admin/ · query/ (query service, cursor, projection public) · seller/ · review/
│                  quote/ · taxonomy/ (brand) · shared/ (input, CatalogPage, policy query/version) · ports/
├── contracts/     catalog-pricing.api.ts (CATALOG_PRICING) · catalog-variants.api.ts (CATALOG_VARIANTS)
├── infrastructure/ persistence/ (Prisma, CAS, transaction) · integrations/catalog-integrity.ts
└── presentation/http/ controllers/ · dto/ · filters/ · guards/ · middleware/
```

Đọc `Product.publish()` trước, rồi `CatalogAdminService.publishProduct()`, rồi `PrismaCatalogRepository.saveProduct()`, cuối cùng mới tới controller. Luồng marketplace: `seller/catalog-seller.service.ts`, sau đó `review/catalog-review.service.ts`.

## 8. Tự ôn

- **SOLID trong module này:**
  - S: Product giữ invariant, service điều phối, repository lưu.
  - O, L: adapter mới phải giữ đúng hợp đồng (public chỉ thấy bản đã publish, kiểm tra version nguyên tử, lỗi thì rollback cả aggregate).
  - I: port tách theo nơi dùng.
  - D: core định nghĩa hợp đồng, module ngoài cung cấp implementation.
- **Câu hỏi:**
  1. Vì sao không thêm `stockQuantity` vào Product?
  2. Product đang publish có hai variant: tắt một cái được không? Nếu chỉ còn một thì sao?
  3. Hai request cùng gửi version 3: vì sao chỉ kiểm tra ở application là chưa đủ?
  4. Thêm tiền USD thì phải sửa những gì?
  5. Vì sao không tin `shopId` trong body JSON?
