# Test design — receipts (goods received)

Oracle: `docs/API.md` (Purchase orders, The purchase-to-pay flow, Business rules #2 and #10, Seed data, Errors, Basics) and OpenAPI path `POST /purchase-orders/{poId}/receive` (schemas `ReceiveRequest`, `PurchaseOrder`). Assumed gaps from `docs/QUESTIONS.md` are called out below.

Precondition for every case: data is at seed state (`POST /admin/reset` in `tests/api/reset.setup.ts` only — not inside individual tests).

**Setup unless a row says otherwise:** create a draft PO on active vendor `vnd-001`, then `POST /purchase-orders/{poId}/submit` so the PO is `submitted`. Use seed SKUs and PO line prices from API.md examples where helpful.

| Helper PO | Create body (summary) | After submit |
| --- | --- | --- |
| `PO-1L` | One line: `LUM-2X4-8`, `quantity` 10, `unit_price` 4.75 | `ordered_value` 47.5 |
| `PO-2L` | API.md two-line example (`LUM-2X4-8` ×10 @4.75, `CEM-30KG` ×4 @11.9) | `ordered_value` 95.1 |
| `PO-MAX` | One line: `LUM-2X4-8`, `quantity` 10000, `unit_price` 4.75 | `ordered_value` 47500 |

Success responses are **200** with an updated `PurchaseOrder` (OpenAPI), not 201.

---

## POST /purchase-orders/{poId}/receive

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| RCV-01 | positive | Setup `PO-1L`, body `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 10 }] }` (API.md receive example) | 200 | `status` `closed`; `fully_received` true; line `LUM-2X4-8` `received_quantity` 10; `received_value` 47.5; `ordered_value` 47.5 | API.md Endpoints → Purchase orders (receive JSON); flow step 4 (closes when fully received) | happy path — full receipt |
| RCV-02 | positive | Setup `PO-2L`, body `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 10 }, { "sku": "CEM-30KG", "quantity": 4 }] }` | 200 | `status` `closed`; `fully_received` true; both lines fully received; `received_value` 95.1 | API.md two-line PO example; OpenAPI description (closes when every line fully received) | happy path — multi-SKU one delivery |
| RCV-03 | positive | Setup `PO-1L`, body `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 4 }] }` | 200 | `status` `submitted`; `fully_received` false; line `received_quantity` 4; `received_value` 19 (`4 × 4.75`) | API.md flow (deliveries can be partial); OpenAPI `PurchaseOrder` | partial delivery |
| RCV-04 | positive | Setup `PO-1L`, receive 4 (as RCV-03), then `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 6 }] }` | 200 on second call | After second: `status` `closed`; `fully_received` true; line `received_quantity` 10; `received_value` 47.5 | API.md rule #2 (across all deliveries); flow step 4 | state — split partials complete the line |
| RCV-05 | positive | Setup `PO-2L`, body `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 10 }] }` only | 200 | `status` `submitted`; `fully_received` false; `LUM-2X4-8` fully received; `CEM-30KG` `received_quantity` 0; `received_value` 47.5 | API.md (partial deliveries); multi-line PO | partial — one line complete, one untouched |
| RCV-06 | positive | Create PO with one line `SCR-DECK-1LB`, `quantity` 1, `unit_price` 9.99; submit; `{ "items": [{ "sku": "SCR-DECK-1LB", "quantity": 1 }] }` | 200 | `status` `closed`; line `received_quantity` 1; `received_value` 9.99 | API.md / OpenAPI quantity &gt; 0 (same limits on deliveries) | boundary — smallest valid receive quantity |
| RCV-07 | positive | Setup `PO-1L`, receive 9, then `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 1 }] }` | 200 on second call | `status` `closed`; line `received_quantity` 10 (exactly fills order) | API.md rule #2 (cumulative cap equals ordered) | boundary — last unit completes order |
| RCV-08 | positive | Setup `PO-1L`, receive 10 (full) | 200 | Body validates as OpenAPI schema `PurchaseOrder` | OpenAPI `POST .../receive` 200 | schema validation (`expectSchema`) |
| RCV-09 | positive | Setup `PO-1L`, partial receive 4, then `GET /purchase-orders/{poId}` | 200 on GET | GET matches last receive response for `received_quantity`, `received_value`, `fully_received`, `status` | API.md (GET same shape as PO) | receive-then-get |
| RCV-10 | positive | Setup `PO-MAX`, `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 10000 }] }` | 200 | `status` `closed`; line `received_quantity` 10000; `received_value` 47500 | API.md (quantity at most 10,000 on deliveries); OpenAPI receive line schema | boundary — maximum valid receive quantity |
| RCV-N01 | negative | Create `PO-1L` but do **not** submit; `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 1 }] }` | 400 | `rule` `workflow_gate`; non-empty `detail` | API.md Business rules #10; OpenAPI description | state — receive on draft |
| RCV-N02 | negative | Setup `PO-1L`, full receive to `closed`, then `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 1 }] }` | 400 | `rule` `workflow_gate` | API.md #10 (receive only on submitted); status flow `submitted` → `closed` | state — receive on closed |
| RCV-N03 | negative | Setup `PO-1L`, `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 11 }] }` (ordered 10) | 400 | `rule` `receive_quantity_limit` | API.md Business rules #2; OpenAPI description | boundary — one shipment over ordered |
| RCV-N04 | negative | Setup `PO-1L`, receive 6, then `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 6 }] }` (6+6 &gt; 10) | 400 on second | `rule` `receive_quantity_limit` | API.md #2 (across all deliveries) | state — cumulative over-receipt |
| RCV-N05 | negative | Setup `PO-1L`, receive 5, then `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 6 }] }` (5+6 &gt; 10) | 400 on second | `rule` `receive_quantity_limit` | API.md #2 | boundary — one unit over cumulative limit |
| RCV-N06 | negative | Setup `PO-1L`, `{ "items": [{ "sku": "SKU-NOT-ON-PO", "quantity": 1 }] }` | 400 | `rule` `validation_error`; non-empty `detail` | API.md (every SKU must be on the PO); OpenAPI 400 | equivalence class — SKU not on PO |
| RCV-N07 | negative | Setup `PO-1L`, `{ "items": [] }` | 400 | `rule` `validation_error` | OpenAPI `ReceiveRequest` (`items` min 1) | equivalence class — empty items |
| RCV-N08 | negative | Setup `PO-1L`, body `{}` | 400 | `rule` `validation_error` | OpenAPI `ReceiveRequest` | equivalence class — missing `items` |
| RCV-N09 | negative | Setup `PO-1L`, `{ "items": [{ "quantity": 1 }] }` | 400 | `rule` `validation_error` | OpenAPI receive item (`sku` required) | equivalence class — missing `sku` |
| RCV-N10 | negative | Setup `PO-1L`, `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 0 }] }` | 400 | `rule` `validation_error` | API.md (quantity greater than 0 on deliveries); OpenAPI quantity | boundary — zero quantity |
| RCV-N11 | negative | Setup `PO-1L`, `{ "items": [{ "sku": "LUM-2X4-8", "quantity": -1 }] }` | 400 | `rule` `validation_error` | OpenAPI receive quantity | equivalence class — negative quantity |
| RCV-N12 | negative | Setup `PO-1L`, `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 10001 }] }` | 400 | `rule` `validation_error` | API.md (at most 10,000); OpenAPI | boundary — over schema max per delivery line |
| RCV-N13 | negative | Setup `PO-1L`, `{ "items": [{ "sku": "", "quantity": 1 }] }` | 400 | `rule` `validation_error` | OpenAPI (`sku` minLength) | boundary — empty `sku` |
| RCV-N14 | negative | Setup `PO-1L`, `{ "items": [{ "sku": "LUM-2X4-8", "quantity": "1" }] }` | 400 | `rule` `validation_error` | OpenAPI receive item types | equivalence class — wrong type |
| RCV-N15 | negative | Setup `PO-1L`, body that is not JSON, or without `Content-Type: application/json` | 400 | `rule` `validation_error` | API.md Basics; API.md Errors | equivalence class — malformed body |
| RCV-E01 | error | `POST /purchase-orders/po-does-not-exist/receive` with valid items body | 404 | JSON `detail`; no `rule` | OpenAPI 404; API.md Errors | unknown id |
| RCV-E02 | error | `POST /purchase-orders/po-001/receive/extra` | 404 | JSON `detail`; no `rule` | API.md Errors | unknown route |
| RCV-A01 | assumed — ask | `{ "items": [{ "sku": "LUM-2X4-8", "quantity": 10.5 }] }` on a submitted PO | — | — | QUESTIONS.md §4 (fractional quantities) | — |
| RCV-A02 | assumed — ask | Same receive `POST` sent twice with identical body on a partial PO (e.g. after RCV-03 state) | — | — | QUESTIONS.md §4 (duplicate POST / idempotency) | — |
| RCV-A03 | assumed — ask | One request with two `items` entries for the same `sku` (e.g. two `{ "sku": "LUM-2X4-8", "quantity": 3 }`) — sum, reject, or last-wins? | — | — | Not stated in API.md or OpenAPI | — |
| RCV-A04 | assumed — ask | Receive request includes a PO line with `quantity` 0 in `items` alongside valid lines | — | — | QUESTIONS.md §4 (zero-quantity edge cases) | — |

Business rules **#2** (`receive_quantity_limit`) is covered by RCV-N03, RCV-N04, and RCV-N05. Rule **#10** (`workflow_gate`) is covered by RCV-N01 and RCV-N02. Rules **#1** and **#3–#9** and **#11** do not apply to receive itself.

**Note on RCV-N05 vs RCV-N04:** RCV-N04 uses 6+6; RCV-N05 uses 5+6 (one unit over 10). Both exercise rule #2; keep both for boundary vs round-number cumulative.

Do not assert trimmed `sku` storage unless API.md or OpenAPI requires it.

---

## Coverage notes

| Endpoint | positive | negative | error (404) | assumed — ask | business rules |
| --- | --- | --- | --- | --- | --- |
| POST /purchase-orders/{poId}/receive | 10 | 15 | 2 | 4 | #2, #10 |

**Out of scope for this area file:** `POST /purchase-orders` (create), submit, GET PO, invoices, match, approve, vendor exposure. Those may appear only as **setup** for receive tests.

**Cross-endpoint setup:** create and submit are prerequisites, not assertions under test (except workflow negatives on draft/closed).

**Dropped from drafts (on purpose):**
- `overpayment_protection` and invoice rules — invoicing is a separate area.
- Unknown query params on POST — not in QUESTIONS.md §4.
- Asserting `partial_receipt_flag` here — that rule applies at invoice match, not on receive.

**Related approved design:** `docs/test-design/purchase-orders.md` (create/get/submit); `PO-SUB-N03` already uses receive as setup only.

---

**Status:** **approved** — Playwright tests in `tests/api/receipts.spec.ts`.
