# Orders

Orders sở hữu đơn hàng: vòng đời, snapshot giá và địa chỉ, và việc giữ/xuất tồn kho cho từng đơn. Orders không giữ số lượng tồn (Inventory) hay giá niêm yết (Catalog); nó gọi `CATALOG_PRICING` và `INVENTORY_RESERVATIONS` qua `contracts/`. Chưa có thanh toán: đơn đi từ đặt hàng đến giao mà không có bước trả tiền.

## 1. Mô hình

- **Checkout** là một lần đặt hàng, định danh theo `(buyerId, idempotencyKey)`. Một checkout tạo **một order cho mỗi shop** có hàng trong giỏ. Variant không thuộc shop nào (`shopId = null`) gom vào một order **platform**.
- **Order** giữ snapshot: dòng hàng (tên, SKU, giá, thành tiền), `subtotalAmount`, địa chỉ nhận, ghi chú. Đổi giá hay tên ở Catalog sau đó không ảnh hưởng đơn. Tiền là số nguyên VND, `currency` luôn là `VND`. Không có phí ship hay giảm giá.
- Mỗi order có đúng một reservation ở Inventory: key `order:<orderId>`, reference `<orderId>`. Response không lộ `reservationId` và `productVersion`.
- Order có `version` (khoá lạc quan). Mọi thao tác ghi gửi kèm version mới nhất.

## 2. Vòng đời

```text
PLACED --confirm--> CONFIRMED --ship--> SHIPPED --deliver--> DELIVERED
   |                    |
   +-- cancel ----------+--> CANCELLED
```

| Từ | Hành động | Ai | Tác động tồn kho |
|---|---|---|---|
| (đặt hàng) | tạo order PLACED | người mua | giữ hàng, rồi `confirm` ngay (reservation `ALLOCATED`) |
| PLACED | confirm | chủ shop, ADMIN | `confirm` reservation |
| CONFIRMED | ship | chủ shop, ADMIN | `ship` từng kho còn chưa xuất |
| SHIPPED | deliver | chủ shop, ADMIN | không |
| PLACED | cancel | người mua, chủ shop, ADMIN | `release` |
| CONFIRMED | cancel | chủ shop, ADMIN (người mua không được) | `release` |

- SHIPPED và DELIVERED không huỷ được. Huỷ còn bị từ chối (`409 ORDER_STATE_CONFLICT`) khi **bất kỳ phần nào của đơn đã xuất kho**, kể cả khi order chưa SHIPPED (ship nhiều kho bị dở dang). Kiểm tra này chạy trong chính transaction `release` của Inventory (`release(id, { refuseIfShipped: true })`), nên một lần ship chen vào giữa lúc huỷ không thể lọt qua: huỷ bị từ chối và không trả phần hàng nào.
- Huỷ khi hold đã **EXPIRED** vẫn thực hiện được: hàng đã tự trả về kho.
- **Lặp lại hành động đã áp dụng** (confirm order đã CONFIRMED, cancel order đã CANCELLED...) trả `200` với order hiện tại, kể cả khi gửi version cũ. Hành động không áp dụng được từ trạng thái hiện tại thì `409 ORDER_STATE_CONFLICT`.
- Order có `confirmedAt`, `shippedAt`, `deliveredAt`, `cancelledAt`; huỷ ghi thêm `cancelledBy` (`BUYER`, `SELLER`, `ADMIN`, `SYSTEM`) và `cancelReason`.
- Hold chưa confirm hết hạn sau TTL của Inventory (mặc định 900 giây, `INVENTORY_RESERVATION_TTL_SECONDS`). Checkout confirm hold ngay sau khi lưu order nên bình thường không dính TTL.

## 3. Luồng đặt hàng

1. Validate input; tính hash của `{lines, shippingAddress, note}`.
2. Đã có checkout cùng key: trả lại nó (xem Idempotency).
3. Báo giá (`CATALOG_PRICING.quote`), nhóm dòng theo shop.
4. Với mỗi nhóm: `reserve` (key `order:<orderId>`), tạo order PLACED.
5. Báo giá lần hai (với giá và `productVersion` vừa thấy) để bắt variant bị gỡ giữa chừng.
6. Một transaction: kiểm tra lại tài khoản còn hoạt động, ghi checkout cùng mọi order.
7. `confirm` từng reservation. Lỗi ở bước này: huỷ các order (`cancelledBy = SYSTEM`, lý do "Không giữ được hàng"), trả hold và báo `409 ORDER_OUT_OF_STOCK`.

Lỗi ở bước 4-6 thì hold đã giữ được trả lại (`release`, best effort; hold không trả được vẫn tự hết hạn theo TTL).

**Idempotency.** Cùng `idempotencyKey` và cùng nội dung: trả lại đúng checkout cũ (`200`, `orders` như lần đầu) và không giữ thêm hàng. Cùng key nhưng khác `lines`, `shippingAddress` hoặc `note`: `409 ORDER_IDEMPOTENCY_CONFLICT`. Double submit đồng thời: request thua cuộc trả lại kết quả của request thắng thay vì báo hết hàng. Sau khi checkout lỗi `409` (ví dụ `ORDER_OUT_OF_STOCK` ở bước 7), client phải dùng **`idempotencyKey` mới** để đặt lại: gửi lại key cũ chỉ trả `200` với các order đã bị huỷ.

## 4. API

Base URL và quy ước chung: [API.md](./API.md), [backend.md](./backend.md#3-quy-ước-http-cho-người-gọi-api). Mọi route cần `Authorization: Bearer`, response có `Cache-Control: no-store`. Mọi tài khoản đang hoạt động, bất kể role, đều đặt và xem được đơn của mình.

### Người mua

| Method | Path | Body / query | Kết quả |
|---|---|---|---|
| POST | /orders | idempotencyKey, lines[], shippingAddress, note? | 201 tạo mới, 200 lặp lại: `{checkoutId, orders[]}` |
| GET | /orders | status?, page?, limit? | 200 trang order của mình |
| GET | /orders/:id | | 200 order |
| POST | /orders/:id/cancel | version, reason? | 200 order |

### Chủ shop (và ADMIN)

Chủ shop hoặc ADMIN thao tác trên `/seller/shops/:shopId/orders`; order của shop khác trả `404`.

| Method | Path | Body / query | Kết quả |
|---|---|---|---|
| GET | /seller/shops/:shopId/orders | status?, page?, limit? | 200 trang |
| GET | /seller/shops/:shopId/orders/:id | | 200 order |
| POST | /seller/shops/:shopId/orders/:id/confirm | version | 200 order |
| POST | /seller/shops/:shopId/orders/:id/ship | version | 200 order |
| POST | /seller/shops/:shopId/orders/:id/deliver | version | 200 order |
| POST | /seller/shops/:shopId/orders/:id/cancel | version, reason | 200 order |

### ADMIN

Xử lý mọi order, gồm order platform và order của shop đang bị khoá.

| Method | Path | Body / query | Kết quả |
|---|---|---|---|
| GET | /admin/orders | status?, shopId?, buyerId?, page?, limit? | 200 trang |
| GET | /admin/orders/:id | | 200 order |
| POST | /admin/orders/:id/confirm | version | 200 order |
| POST | /admin/orders/:id/ship | version | 200 order |
| POST | /admin/orders/:id/deliver | version | 200 order |
| POST | /admin/orders/:id/cancel | version, reason | 200 order |

`shopId` ở danh sách admin là UUID v4 hoặc `platform` (chỉ order không thuộc shop). Danh sách sắp xếp mới nhất trước.

### Giới hạn input

| Field | Quy tắc |
|---|---|
| `idempotencyKey` | `^[A-Za-z0-9_-]{8,100}$` |
| `lines` | 1-100 phần tử, không trùng `variantId` |
| `lines[].variantId` | UUID v4 |
| `lines[].quantity` | số nguyên 1-999 |
| `lines[].expectedUnitPriceAmount` | tuỳ chọn, số nguyên ≥ 0; lệch giá hiện tại thì `ORDER_PRICE_CHANGED` |
| `shippingAddress.recipientName` | 1-100 ký tự (sau trim) |
| `shippingAddress.phoneNumber` | `^\+?[0-9]{7,15}$` |
| `shippingAddress.addressLine` | 5-300 ký tự (sau trim) |
| `note` | ≤ 500 ký tự; rỗng thành `null` |
| `reason` | ≤ 200 ký tự; tuỳ chọn khi người mua huỷ, **bắt buộc ≥ 1 ký tự** khi chủ shop/ADMIN huỷ |
| `version` | số nguyên 0-2147483646 |
| `status` | `PLACED`, `CONFIRMED`, `SHIPPED`, `DELIVERED`, `CANCELLED` |
| `page`, `limit` | `page` ≥ 1 (mặc định 1); `limit` 1-100 (mặc định 20) |

### Response

Order:

```json
{"id":"...","checkoutId":"...","buyerId":"...","shopId":"...","status":"PLACED",
 "lines":[{"variantId":"...","productId":"...","productName":"Áo thun basic","variantName":"Đen / M",
           "sku":"AT-DEN-M","quantity":2,"unitPriceAmount":150000,"lineTotalAmount":300000}],
 "subtotalAmount":300000,"currency":"VND",
 "shippingAddress":{"recipientName":"...","phoneNumber":"+84900000000","addressLine":"..."},
 "note":null,"cancelReason":null,"cancelledBy":null,"version":0,
 "createdAt":"...","confirmedAt":null,"shippedAt":null,"deliveredAt":null,"cancelledAt":null}
```

Trang: `{items, total, page, limit, pages}`. `shopId` là `null` với order platform.

## 5. Quyền

- Người mua chỉ thấy order của mình; order người khác trả `404`, không phải `403`.
- Chủ shop qua `SHOP_ACCESS.requireManageable`: không phải chủ shop `403`, shop không tồn tại `404`, shop bị SUSPENDED `409 SHOP_UNAVAILABLE`. ADMIN vào được mọi shop. Người mua vẫn huỷ được order PLACED của shop đó.
- `/admin/orders` chỉ cho role ADMIN.
- Mọi thao tác ghi kiểm tra lại tài khoản (và shop, với `/seller`) **trong transaction ghi**, nên shop bị khoá hoặc tài khoản bị vô hiệu giữa chừng thì lệnh ghi bị chặn.
- Người mua được mua hàng của chính shop mình.

## 6. Mã lỗi

Dạng `{statusCode, message, error, code}`. Lỗi validation của DTO có `message` là mảng và không có `code`.

| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `ORDER_INVALID_INPUT` | Input sai ở domain (message tiếng Anh), hoặc Catalog/Inventory từ chối input |
| 403 | `ORDER_ACCESS_DENIED` | Không phải ADMIN ở `/admin`; tài khoản không còn hoạt động khi ghi |
| 403 / 404 | (lỗi của Shops) | Không phải chủ shop / shop không tồn tại |
| 404 | `ORDER_NOT_FOUND` | Order không tồn tại, của người khác, hoặc ngoài phạm vi shop |
| 409 | `ORDER_VERSION_CONFLICT` | Version cũ, hoặc Inventory/Catalog mất race ghi (`Inventory is busy; retry`): tải lại order rồi thử lại |
| 409 | `ORDER_STATE_CONFLICT` | Chuyển trạng thái không hợp lệ; huỷ khi hàng đã xuất kho |
| 409 | `ORDER_IDEMPOTENCY_CONFLICT` | Cùng `idempotencyKey` nhưng khác nội dung |
| 409 | `ORDER_PRICE_CHANGED` | Giá hoặc phiên bản sản phẩm đã đổi so với `expectedUnitPriceAmount` |
| 409 | `ORDER_ITEM_UNAVAILABLE` | Variant không còn bán (hoặc không tồn tại) |
| 409 | `ORDER_OUT_OF_STOCK` | Không đủ hàng; cũng khi confirm hold thất bại lúc đặt hàng |
| 409 | `ORDER_STOCK_EXPIRED` | Hold của order đã hết hạn hoặc không còn (confirm, ship) |
| 409 | `SHOP_UNAVAILABLE` | Shop bị SUSPENDED (chủ shop thao tác) |

## 7. Khe hở đã biết

Các điểm sau được chấp nhận có chủ đích, đánh dấu `shortcut:` trong code.

- **Race huỷ và confirm** (`application/shared/order-transition.ts`). Bước gọi Inventory chạy trước compare-and-set của order. Nếu người mua huỷ và `release` xong, rồi chủ shop confirm commit trước khi người mua ghi, order thành CONFIRMED trong khi hàng đã được trả. Khi đó `ship` lỗi `ORDER_STOCK_EXPIRED`; chủ shop/ADMIN huỷ order để sửa. Nâng cấp bằng khoá theo order hoặc job đối soát nếu gặp thực tế.
- **Crash giữa lúc đặt hàng** (`application/checkout/order-checkout.service.ts`). Process chết sau khi lưu order và trước khi confirm hold để lại order PLACED với hold ACTIVE. Hold hết hạn sau TTL, chủ shop confirm gặp `ORDER_STOCK_EXPIRED` và phải huỷ. Nâng cấp bằng job quét order PLACED có hold hết hạn.
- Huỷ nội bộ khi confirm hold lỗi (mục 3, bước 7): nếu không trả được hold thì order vẫn PLACED, huỷ sau đó sẽ trả hàng; nếu đã trả hold nhưng không lưu được order thì order vẫn PLACED với hàng đã về kho, huỷ sau đó chỉ cập nhật order.
