# Test design — purchase orders (create, get, submit)

Oracle: `docs/API.md` (Purchase orders, Seed data, Business rules #1 and #10, Errors, Basics) and OpenAPI paths `/purchase-orders`, `/purchase-orders/{poId}`, `/purchase-orders/{poId}/submit` (schemas `PurchaseOrderCreate`, `PoLineCreate`, `PurchaseOrder`). Assumed gaps from `docs/QUESTIONS.md` are called out below.

Precondition for every case: data is at seed state (`POST /admin/reset` in `tests/api/reset.setup.ts` only — not inside individual tests).

Shared valid line (unless a case overrides): `{ "sku": "LUM-2X4-8", "quantity": 10, "unit_price": 4.75 }`. Active vendor: `vnd-001`. Inactive seed vendor: `vnd-002`.

---

## POST /purchase-orders

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| PO-POST-01 | positive | Body per API.md example: `vendor_id` `vnd-001`, two lines (`LUM-2X4-8` with description, `CEM-30KG` without) | 201 | `PurchaseOrder`: `status` `draft`; `vendor_id` `vnd-001`; `id` present and starts with `po-`; each line has `received_quantity` 0; `ordered_value` 95.1; `received_value` 0; `fully_received` false; line totals match sent `quantity` / `unit_price` / `description` (empty string where omitted) | API.md Endpoints → Purchase orders (example JSON); OpenAPI `PurchaseOrder` | happy path |
| PO-POST-02 | positive | `{ "vendor_id": "vnd-001", "line_items": [{ "sku": "SCR-DECK-1LB", "quantity": 1, "unit_price": 9.99 }] }` | 201 | Single line; `description` `""`; `ordered_value` 9.99; `status` `draft` | API.md (optional `description`); OpenAPI `PoLineCreate` | documented option — omit description |
| PO-POST-03 | positive | Same as PO-POST-02 but line includes `"description": "Deck screws, 1 lb box"` | 201 | `description` equals sent value | API.md Endpoints → Purchase orders | documented option — with description |
| PO-POST-04 | positive | One line: `quantity` 1, `unit_price` 0 | 201 | Valid `PurchaseOrder`; line `quantity` 1; `unit_price` 0; `ordered_value` 0 | API.md (quantity &gt; 0, unit_price from 0); OpenAPI `PoLineCreate` | boundary values — smallest valid quantity and minimum unit_price |
| PO-POST-05 | positive | One line: `quantity` 10000, `unit_price` 4.75 | 201 | Line `quantity` 10000; `ordered_value` 47500 | API.md (quantity at most 10,000); OpenAPI `PoLineCreate` | boundary values — maximum valid quantity |
| PO-POST-06 | positive | One line: `quantity` 10, `unit_price` 100000 | 201 | Line `unit_price` 100000; `ordered_value` 1000000 | API.md (unit_price to 100,000); OpenAPI `PoLineCreate` | boundary values — maximum valid unit_price |
| PO-POST-07 | positive | Valid create body (e.g. PO-POST-02), then `GET /purchase-orders/{id}` with returned `id` | 200 on GET | GET body matches create response for `id`, `vendor_id`, `status`, `line_items`, `ordered_value`, `received_value`, `fully_received` | API.md (GET returns same shape) | create-then-get |
| PO-POST-08 | positive | Any successful create from PO-POST-01 or PO-POST-02 | 201 | Body validates as OpenAPI schema `PurchaseOrder` | OpenAPI schema `PurchaseOrder` | schema validation (`expectSchema`) |
| PO-POST-N01 | negative | `vendor_id` `vnd-002`, one valid line | 400 | `rule` `inactive_vendor_gate`; non-empty `detail` | API.md Business rules #1; OpenAPI `POST /purchase-orders` description | business rule — inactive vendor |
| PO-POST-N02 | negative | `vendor_id` `vnd-does-not-exist`, one valid line | 404 | JSON `detail`; no `rule` | API.md Endpoints → Purchase orders (vendor must exist); API.md Errors | unknown id |
| PO-POST-N03 | negative | One line with `quantity` 0 | 400 | `rule` `validation_error` | API.md (quantity greater than 0); OpenAPI `PoLineCreate` | boundary — zero quantity |
| PO-POST-N04 | negative | One line with `quantity` -1 | 400 | `rule` `validation_error` | OpenAPI `PoLineCreate` (`exclusiveMinimum` / positive) | equivalence class — negative quantity |
| PO-POST-N05 | negative | One line with `quantity` 10001 | 400 | `rule` `validation_error` | API.md (at most 10,000); OpenAPI `PoLineCreate` | boundary — one over maximum quantity |
| PO-POST-N06 | negative | One line with `unit_price` -0.01 | 400 | `rule` `validation_error` | API.md (unit_price from 0); OpenAPI `PoLineCreate` | equivalence class — negative unit_price |
| PO-POST-N07 | negative | One line with `unit_price` 100001 | 400 | `rule` `validation_error` | API.md (to 100,000); OpenAPI `PoLineCreate` | boundary — one over maximum unit_price |
| PO-POST-N08 | negative | Two lines with the same `sku` (e.g. both `LUM-2X4-8`) | 400 | `rule` `validation_error`; non-empty `detail` | API.md (each SKU may appear once); OpenAPI `POST /purchase-orders` description | equivalence class — duplicate SKU on PO |
| PO-POST-N09 | negative | `{ "vendor_id": "vnd-001", "line_items": [] }` | 400 | `rule` `validation_error` | OpenAPI `PurchaseOrderCreate` (`line_items` min 1) | equivalence class — empty line list |
| PO-POST-N10 | negative | Body `{}` | 400 | `rule` `validation_error` | OpenAPI `PurchaseOrderCreate` | equivalence class — missing required fields |
| PO-POST-N11 | negative | `{ "vendor_id": "vnd-001" }` (no `line_items`) | 400 | `rule` `validation_error` | OpenAPI `PurchaseOrderCreate` | equivalence class — missing `line_items` |
| PO-POST-N12 | negative | Line missing `sku` | 400 | `rule` `validation_error` | OpenAPI `PoLineCreate` | equivalence class — missing field |
| PO-POST-N13 | negative | Line missing `quantity` | 400 | `rule` `validation_error` | OpenAPI `PoLineCreate` | equivalence class — missing field |
| PO-POST-N14 | negative | Line missing `unit_price` | 400 | `rule` `validation_error` | OpenAPI `PoLineCreate` | equivalence class — missing field |
| PO-POST-N15 | negative | `vendor_id` `""`, otherwise valid line | 400 | `rule` `validation_error` | OpenAPI `PurchaseOrderCreate` (`vendor_id` minLength) | boundary — empty string |
| PO-POST-N16 | negative | Line with `sku` `""` | 400 | `rule` `validation_error` | OpenAPI `PoLineCreate` | boundary — empty string |
| PO-POST-N17 | negative | Line with `quantity` `"10"` (string) | 400 | `rule` `validation_error` | OpenAPI `PoLineCreate` | equivalence class — wrong type |
| PO-POST-N18 | negative | Line with `unit_price` `"4.75"` (string) | 400 | `rule` `validation_error` | OpenAPI `PoLineCreate` | equivalence class — wrong type |
| PO-POST-N19 | negative | `line_items` not an array (e.g. object) | 400 | `rule` `validation_error` | OpenAPI `PurchaseOrderCreate` | equivalence class — wrong type |
| PO-POST-N20 | negative | Body that is not JSON, or without `Content-Type: application/json` | 400 | `rule` `validation_error` | API.md Basics (JSON in; Content-Type required); API.md Errors | equivalence class — malformed body |
| PO-POST-E01 | error | `POST /purchase-orders/not-a-route` | 404 | JSON `detail`; no `rule` | API.md Errors | unknown route |
| PO-POST-A01 | assumed — ask | One line with fractional `quantity` (e.g. 10.5) | — | — | QUESTIONS.md §4 (fractional quantities and rounding) | — |
| PO-POST-A02 | assumed — ask | Line with `sku` not in the seed catalog (e.g. `SKU-UNKNOWN`) | — | — | API.md says catalog is reference only; neither doc says create must reject unknown SKUs | — |
| PO-POST-A03 | assumed — ask | Same `POST /purchase-orders` retried after timeout (identical body twice) | — | — | QUESTIONS.md §4 (idempotency on create) | — |
| PO-POST-A04 | assumed — ask | `quantity` × `unit_price` with more than two decimal places in the product (rounding) | — | — | QUESTIONS.md §4 (rounding rule) | — |

Business rules **#1** (`inactive_vendor_gate`) is covered by PO-POST-N01. Rules **#2–#9** and **#11** do not apply to PO create. Rule **#10** applies to submit/receive/invoicing, not create.

Do not assert that padded `sku` or `vendor_id` values are stored trimmed unless API.md or OpenAPI field descriptions require it.

---

## GET /purchase-orders/{poId}

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| PO-GET-01 | positive | Create a PO (e.g. PO-POST-02), then `GET /purchase-orders/{poId}` | 200 | Same `id`, `vendor_id`, `status`, `line_items`, `ordered_value`, `received_value`, `fully_received` as at create | API.md (GET returns same shape) | create-then-get |
| PO-GET-02 | positive | `GET` after PO-POST-01 | 200 | Body validates as OpenAPI schema `PurchaseOrder` | OpenAPI `GET /purchase-orders/{poId}`, schema `PurchaseOrder` | schema validation (`expectSchema`) |
| PO-GET-03 | positive | `GET` on a freshly created draft | 200 | `status` `draft`; every line `received_quantity` 0; `received_value` 0; `fully_received` false | API.md example response; OpenAPI `PurchaseOrder` | happy path — receipt fields on draft |
| PO-GET-E01 | error | `GET /purchase-orders/po-does-not-exist` | 404 | JSON `detail`; no `rule` | OpenAPI `GET /purchase-orders/{poId}` 404; API.md Errors | unknown id |
| PO-GET-E02 | error | `GET /purchase-orders/po-001/extra` (path does not exist) | 404 | JSON `detail`; no `rule` | API.md Errors | unknown route |

No documented 400 for this path. After submit or close, GET should still return 200 with updated `status` and receipt fields; detailed receive/close behavior belongs with `POST .../receive` (out of scope here), except where submit tests need a submitted PO as setup.

---

## POST /purchase-orders/{poId}/submit

No request body (OpenAPI). Success is **200**, not 201.

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| PO-SUB-01 | positive | Create draft PO (one line), then `POST /purchase-orders/{poId}/submit` | 200 | `status` `submitted`; same `id` and `vendor_id`; line items unchanged except receipt fields still 0 on unsubmitted receipt | API.md Endpoints → Purchase orders; OpenAPI `POST .../submit` | happy path |
| PO-SUB-02 | positive | Response from PO-SUB-01 | 200 | Body validates as OpenAPI schema `PurchaseOrder` | OpenAPI schema `PurchaseOrder` | schema validation (`expectSchema`) |
| PO-SUB-03 | positive | After PO-SUB-01, `GET /purchase-orders/{poId}` | 200 | `status` `submitted` | API.md (GET same shape) | submit-then-get |
| PO-SUB-N01 | negative | `POST /purchase-orders/po-does-not-exist/submit` | 404 | JSON `detail`; no `rule` | OpenAPI 404; API.md Errors | unknown id |
| PO-SUB-N02 | negative | Create draft, submit once, `POST .../submit` again on same `poId` | 400 | `rule` `workflow_gate`; non-empty `detail` | API.md Business rules #10; OpenAPI description | state — submit when not draft |
| PO-SUB-N03 | negative | Create draft, submit, fully receive every line (via `POST .../receive` — setup only), then `POST .../submit` | 400 | `rule` `workflow_gate` | API.md Business rules #10 (submit only a draft); API.md status flow | state — submit when closed |
| PO-SUB-E01 | error | `POST /purchase-orders/po-001/submit/extra` | 404 | JSON `detail`; no `rule` | API.md Errors | unknown route |
| PO-SUB-A01 | assumed — ask | Second `submit` on the same PO after the first succeeded: is the intent strictly `workflow_gate`, or should a duplicate submit be idempotent with 200? | — | — | QUESTIONS.md §4 (duplicate POST / idempotency); API.md #10 text implies rejection when not draft | — |

Rule **#10** (`workflow_gate`) is covered by PO-SUB-N02 and PO-SUB-N03. Rule **#1** does not apply to submit.

---

## Coverage notes

| Endpoint | positive | negative | error (404) | assumed — ask | business rules |
| --- | --- | --- | --- | --- | --- |
| POST /purchase-orders | 8 | 20 | 1 | 4 | #1 (`inactive_vendor_gate`) |
| GET /purchase-orders/{poId} | 3 | — | 2 | — | — |
| POST /purchase-orders/{poId}/submit | 3 | 3 | 1 | 1 | #10 (`workflow_gate`) |

**Out of scope for this area file** (separate design): `POST /purchase-orders/{poId}/receive`, and invoice endpoints that depend on PO state.

**Cross-endpoint setup allowed:** PO-SUB-N03 uses `POST .../receive` only to reach `closed` status; assertions target submit only.

**Dropped from drafts (on purpose):**
- Asserting catalog `unit_price` must match PO line price (API.md: catalog is reference; PO carries its own price).
- Unknown query params on GET — not in QUESTIONS.md §4.
- Testing receive or invoice rules (#2, #3, #8, etc.) on create/get/submit rows.

**Existing tests:** No dedicated purchase-order spec yet; `scripts/smoke.ts` exercises create → submit → receive — inspected only, not a substitute for this table.

---

**Status:** **approved** — Playwright tests in `tests/api/purchase-orders.spec.ts`.
