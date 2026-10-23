# Test design — invoices (create, get, match)

Oracle: `docs/API.md` (Invoices, The purchase-to-pay flow, Business rules #3, #5, #6, #8 and #10, Seed data, Errors, Basics) and OpenAPI paths `/invoices`, `/invoices/{invoiceId}`, `/invoices/{invoiceId}/match` (schemas `InvoiceCreate`, `InvoiceLine`, `Invoice`, `MatchResult`). Assumed gaps from `docs/QUESTIONS.md` are called out below.

Precondition for every case: data is at seed state (`POST /admin/reset` in `tests/api/reset.setup.ts` only — not inside individual tests).

**Setup unless a row says otherwise:** create POs on active vendor `vnd-001`, submit, and receive as needed. Use unique `invoice_number` values per test (e.g. suffix with case id) except where duplicate detection is under test.

| Helper PO | Create / receive (summary) | State for invoicing |
| --- | --- | --- |
| `PO-DRAFT` | One line `LUM-2X4-8` ×10 @4.75; **not** submitted | `draft` |
| `PO-SUB` | Same as `PO-1L` in receipts design; submit only | `submitted`; all lines `received_quantity` 0 |
| `PO-1L-FULL` | One line `LUM-2X4-8` ×10 @4.75; submit; receive 10 | `closed`; `received_value` 47.5 |
| `PO-2L-FULL` | API.md two-line PO; submit; receive both lines fully | `closed`; `received_value` 95.1 |
| `PO-2L-PART` | `PO-2L-FULL` create + submit; receive only `LUM-2X4-8` ×10 | `submitted`; `LUM-2X4-8` fully received; `CEM-30KG` `received_quantity` 0 |

Create success is **201**. Match success is **200** with `MatchResult` (OpenAPI), not 201.

---

## POST /invoices

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| INV-POST-01 | positive | Setup `PO-2L-FULL`, body per API.md example: `po_id`, `invoice_number` `INV-1001`, two lines (`LUM-2X4-8` ×10 @4.75, `CEM-30KG` ×4 @11.9) | 201 | `Invoice`: `status` `received`; `matched` false; `partial_receipt` null; `po_id` matches; `vendor_id` `vnd-001`; `id` present and starts with `inv-`; `total_amount` 95.1; lines match sent `sku` / `quantity` / `unit_price` | API.md Endpoints → Invoices (example JSON); OpenAPI `Invoice` | happy path |
| INV-POST-02 | positive | Setup `PO-1L-FULL`, `{ "po_id": "<id>", "invoice_number": "INV-SINGLE", "line_items": [{ "sku": "LUM-2X4-8", "quantity": 10, "unit_price": 4.75 }] }` | 201 | Single line; `total_amount` 47.5; `status` `received` | API.md flow step 5; OpenAPI `InvoiceCreate` | happy path — single SKU |
| INV-POST-03 | positive | Setup `PO-SUB` (submitted, nothing received), `{ "line_items": [{ "sku": "LUM-2X4-8", "quantity": 1, "unit_price": 4.75 }] }` with valid `po_id` and `invoice_number` | 201 | Allowed on `submitted` PO (not only `closed`); `total_amount` 4.75 | API.md Business rules #10; OpenAPI `POST /invoices` description | workflow — invoice on submitted PO |
| INV-POST-04 | positive | Setup `PO-1L-FULL`, one line `quantity` 1, `unit_price` 4.75 | 201 | Line `quantity` 1; `total_amount` 4.75 | API.md (quantity &gt; 0); OpenAPI `InvoiceLine` | boundary — smallest valid quantity |
| INV-POST-05 | positive | Setup `PO-MAX` (receipts helper: ×10000 received), one line `quantity` 10000, `unit_price` 4.75 | 201 | Line `quantity` 10000; `total_amount` 47500 | API.md (at most 10,000 on invoice lines); OpenAPI `InvoiceLine` | boundary — maximum valid quantity |
| INV-POST-06 | positive | Setup `PO-1L-FULL`, one line `quantity` 10, `unit_price` 0 | 201 | `unit_price` 0; `total_amount` 0 | API.md (unit_price from 0); OpenAPI `InvoiceLine` | boundary — minimum unit_price |
| INV-POST-07 | positive | Setup `PO-2L-PART`, `{ "line_items": [{ "sku": "LUM-2X4-8", "quantity": 10, "unit_price": 4.75 }] }` (only received SKU/qty) | 201 | Subset of PO lines allowed; `total_amount` 47.5 | API.md rule #8 (each line on PO); QUESTIONS.md §4 (subset SKUs — behavior exercised, not asserted beyond docs) | partial SKU coverage |
| INV-POST-08 | positive | Setup `PO-1L-FULL`, receive 10; create invoice for `quantity` 4 @4.75; then second create same PO `{ "line_items": [{ "sku": "LUM-2X4-8", "quantity": 6, "unit_price": 4.75 }] }` with new `invoice_number` | 201 on both | Second invoice succeeds; cumulative qty 10 equals received | API.md rule #3 (across invoices on same PO); QUESTIONS.md §4 (multiple invoices) | state — split billing on one PO |
| INV-POST-09 | positive | Any successful create from INV-POST-01 or INV-POST-02, then `GET /invoices/{id}` | 200 on GET | GET body matches create for `id`, `po_id`, `vendor_id`, `invoice_number`, `status`, `line_items`, `total_amount`, `matched`, `partial_receipt` | API.md (GET returns invoice with current status) | create-then-get |
| INV-POST-10 | positive | Any successful create from INV-POST-01 or INV-POST-02 | 201 | Body validates as OpenAPI schema `Invoice` | OpenAPI schema `Invoice` | schema validation (`expectSchema`) |
| INV-POST-N01 | negative | Setup `PO-DRAFT`, otherwise valid invoice body | 400 | `rule` `workflow_gate`; non-empty `detail` | API.md Business rules #10; OpenAPI `POST /invoices` description | state — invoice on draft PO |
| INV-POST-N02 | negative | `po_id` `po-does-not-exist`, otherwise valid line | 404 | JSON `detail`; no `rule` | OpenAPI 404; API.md Errors | unknown id |
| INV-POST-N03 | negative | Setup `PO-1L-FULL`, create invoice `invoice_number` `INV-DUP`; second create **same vendor** (another PO or same PO) with `invoice_number` `INV-DUP` | 400 on second | `rule` `duplicate_invoice_detection` | API.md Business rules #6; OpenAPI description | state — exact duplicate number |
| INV-POST-N04 | negative | Setup two POs same vendor `vnd-001`, both invoicing-ready; first invoice `invoice_number` `INV-7`; second `invoice_number` `inv-7` | 400 on second | `rule` `duplicate_invoice_detection` | API.md #6 (case-insensitive) | equivalence class — case variant |
| INV-POST-N05 | negative | Same vendor; first `INV-7`; second `invoice_number` ` INV-7 ` (spaces) | 400 on second | `rule` `duplicate_invoice_detection` | API.md #6 (ignore surrounding spaces) | equivalence class — padded number |
| INV-POST-N06 | negative | Setup `PO-1L-FULL`, line `sku` `SKU-NOT-ON-PO` | 400 | `rule` `invoice_line_validation` | API.md Business rules #8; OpenAPI description | equivalence class — SKU not on PO |
| INV-POST-N07 | negative | Setup `PO-1L-FULL`, two lines both `LUM-2X4-8` | 400 | `rule` `invoice_line_validation` | API.md #8 (each SKU once on invoice); OpenAPI | equivalence class — duplicate SKU on invoice |
| INV-POST-N08 | negative | Setup `PO-1L-FULL` with only 4 units received (partial receive 4, do not close); `{ "line_items": [{ "sku": "LUM-2X4-8", "quantity": 5, "unit_price": 4.75 }] }` | 400 | `rule` `overpayment_protection` | API.md Business rules #3 (per line quantity) | boundary — one unit over received on line |
| INV-POST-N09 | negative | Setup `PO-1L-FULL`; first invoice `quantity` 6; second invoice same PO `quantity` 6 (6+6 &gt; 10 received) | 400 on second | `rule` `overpayment_protection` | API.md #3 (across all invoices on PO) | state — cumulative quantity over received |
| INV-POST-N10 | negative | Setup `PO-1L-FULL` (received 10 @4.75 → value 47.5); `{ "line_items": [{ "sku": "LUM-2X4-8", "quantity": 10, "unit_price": 4.76 }] }` | 400 | `rule` `overpayment_protection` | API.md #3 (total value, no tolerance) | boundary — total value over received |
| INV-POST-N11 | negative | Setup `PO-1L-FULL`, `{ "line_items": [{ "sku": "LUM-2X4-8", "quantity": 0, "unit_price": 4.75 }] }` | 400 | `rule` `validation_error` | API.md (quantity greater than 0); OpenAPI `InvoiceLine` | boundary — zero quantity |
| INV-POST-N12 | negative | Setup `PO-1L-FULL`, `quantity` -1 | 400 | `rule` `validation_error` | OpenAPI `InvoiceLine` | equivalence class — negative quantity |
| INV-POST-N13 | negative | Setup `PO-1L-FULL`, `quantity` 10001 | 400 | `rule` `validation_error` | API.md (at most 10,000); OpenAPI | boundary — one over maximum quantity |
| INV-POST-N14 | negative | Setup `PO-1L-FULL`, `unit_price` -0.01 | 400 | `rule` `validation_error` | API.md (unit_price from 0); OpenAPI | equivalence class — negative unit_price |
| INV-POST-N15 | negative | Setup `PO-1L-FULL`, `unit_price` 100001 | 400 | `rule` `validation_error` | API.md (to 100,000); OpenAPI | boundary — one over maximum unit_price |
| INV-POST-N16 | negative | `{ "po_id": "<valid>", "invoice_number": "INV-X", "line_items": [] }` | 400 | `rule` `validation_error` | OpenAPI `InvoiceCreate` (`line_items` min 1) | equivalence class — empty line list |
| INV-POST-N17 | negative | Body `{}` | 400 | `rule` `validation_error` | OpenAPI `InvoiceCreate` | equivalence class — missing required fields |
| INV-POST-N18 | negative | Missing `line_items` | 400 | `rule` `validation_error` | OpenAPI `InvoiceCreate` | equivalence class — missing `line_items` |
| INV-POST-N19 | negative | Line missing `sku` / `quantity` / `unit_price` (one row each or parametrized) | 400 | `rule` `validation_error` | OpenAPI `InvoiceLine` | equivalence class — missing field |
| INV-POST-N20 | negative | `po_id` `""` or `invoice_number` `""` | 400 | `rule` `validation_error` | OpenAPI `InvoiceCreate` | boundary — empty string |
| INV-POST-N21 | negative | Line `sku` `""` | 400 | `rule` `validation_error` | OpenAPI `InvoiceLine` (`sku` minLength after trim) | boundary — empty `sku` |
| INV-POST-N22 | negative | `quantity` or `unit_price` as string | 400 | `rule` `validation_error` | OpenAPI `InvoiceLine` | equivalence class — wrong type |
| INV-POST-N23 | negative | Body not JSON, or without `Content-Type: application/json` | 400 | `rule` `validation_error` | API.md Basics; API.md Errors | equivalence class — malformed body |
| INV-POST-E01 | error | `POST /invoices/not-a-route` | 404 | JSON `detail`; no `rule` | API.md Errors | unknown route |
| INV-POST-A01 | assumed — ask | Fractional `quantity` on invoice line (e.g. 10.5) | — | — | QUESTIONS.md §4 (fractional quantities and rounding) | — |
| INV-POST-A02 | assumed — ask | Same `POST /invoices` retried after timeout (identical body twice) | — | — | QUESTIONS.md §4 (idempotency on create) | — |
| INV-POST-A03 | assumed — ask | Invoice `unit_price` differs from PO line price but quantity × price still within received value — is match supposed to fail? | — | — | QUESTIONS.md §4 (price vs quantity at match) | — |
| INV-POST-A04 | assumed — ask | Duplicate `invoice_number` on **different** vendors (same string) — allowed or rejected? | — | — | API.md #6 says per vendor; not exercised as positive in table | — |
| INV-POST-A05 | assumed — ask | `quantity` × `unit_price` with more than two decimal places in the product | — | — | QUESTIONS.md §4 (rounding rule) | — |

Business rules **#3** (`overpayment_protection`) is covered by INV-POST-N08, INV-POST-N09, and INV-POST-N10. Rule **#6** (`duplicate_invoice_detection`) by INV-POST-N03–N05. Rule **#8** (`invoice_line_validation`) by INV-POST-N06 and INV-POST-N07. Rule **#10** (`workflow_gate`) on create by INV-POST-N01. Rules **#1**, **#2**, **#4**, **#5**, **#7**, **#9**, and **#11** do not apply to invoice create itself.

Do not assert that padded `invoice_number` values are stored trimmed unless API.md or OpenAPI field descriptions require it; rule #6 governs comparison, not storage shape.

---

## GET /invoices/{invoiceId}

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| INV-GET-01 | positive | Create invoice (e.g. INV-POST-02), then `GET /invoices/{invoiceId}` | 200 | Same `id`, `po_id`, `vendor_id`, `invoice_number`, `status`, `line_items`, `total_amount`, `matched`, `partial_receipt` as at create | API.md Endpoints → Invoices | create-then-get |
| INV-GET-02 | positive | `GET` after INV-POST-01 | 200 | Body validates as OpenAPI schema `Invoice` | OpenAPI `GET /invoices/{invoiceId}`, schema `Invoice` | schema validation (`expectSchema`) |
| INV-GET-03 | positive | `GET` on freshly created invoice | 200 | `status` `received`; `matched` false; `partial_receipt` null | API.md create response; OpenAPI `Invoice` | happy path — pre-match fields |
| INV-GET-04 | positive | Create, `POST .../match`, then `GET` same id | 200 | `status` `matched`; `matched` true; `partial_receipt` boolean (not null) | API.md flow; OpenAPI `Invoice` | match-then-get |
| INV-GET-E01 | error | `GET /invoices/inv-does-not-exist` | 404 | JSON `detail`; no `rule` | OpenAPI 404; API.md Errors | unknown id |
| INV-GET-E02 | error | `GET /invoices/inv-001/extra` | 404 | JSON `detail`; no `rule` | API.md Errors | unknown route |

No documented 400 for this path. Post-approve GET behavior (status `approved`) belongs with approve tests; may appear here only as optional cross-check after match tests use approve as setup for match negative.

---

## POST /invoices/{invoiceId}/match

No request body (OpenAPI). Success is **200** with `MatchResult`.

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| INV-MAT-01 | positive | Setup `PO-2L-FULL`, create invoice INV-POST-01 body, then `POST /invoices/{invoiceId}/match` | 200 | `MatchResult`: `status` `matched`; `matched` true; `partial_receipt` false; `ordered_value` 95.1; `received_value` 95.1; `invoice_total` 95.1; `message` `3-way match passed.` | API.md Endpoints → Invoices (match JSON); OpenAPI `MatchResult` | happy path — full receipt |
| INV-MAT-02 | positive | Setup `PO-2L-PART`, invoice only received line (INV-POST-07), then match | 200 | `partial_receipt` true; `message` indicates partial receipt flagged (API.md example uses `3-way match passed.` when false; store message when true references partial receipt) | API.md Business rules #5; OpenAPI `POST .../match` description | happy path — partial_receipt_flag |
| INV-MAT-03 | positive | Response from INV-MAT-01 | 200 | Body validates as OpenAPI schema `MatchResult` | OpenAPI schema `MatchResult` | schema validation (`expectSchema`) |
| INV-MAT-04 | positive | After INV-MAT-01, `GET /invoices/{invoiceId}` | 200 | `status` `matched`; `matched` true; `partial_receipt` false; totals consistent with match response | API.md (GET current status) | match-then-get |
| INV-MAT-05 | positive | Setup `PO-1L-FULL`, invoice for `quantity` 4 only (partial bill), match | 200 | `partial_receipt` false when PO fully received even if invoice lines are a subset | API.md #5 (flag is PO receipt completeness, not invoice coverage) | partial invoice on fully received PO |
| INV-MAT-N01 | negative | Create + match + `POST .../approve` (approve is setup only), then `POST .../match` again | 400 | `rule` `workflow_gate`; non-empty `detail` | API.md Business rules #10; OpenAPI `POST .../match` description | state — match after approved |
| INV-MAT-E01 | error | `POST /invoices/inv-does-not-exist/match` | 404 | JSON `detail`; no `rule` | OpenAPI 404; API.md Errors | unknown id |
| INV-MAT-E02 | error | `POST /invoices/inv-001/match/extra` | 404 | JSON `detail`; no `rule` | API.md Errors | unknown route |
| INV-MAT-A01 | assumed — ask | Second `POST .../match` when invoice is already `matched` but not approved — idempotent 200, or `400`? | — | — | QUESTIONS.md §4 (duplicate POST on match) | — |
| INV-MAT-A02 | assumed — ask | Match when invoice lines’ prices differ from PO but quantities OK — does match still pass? | — | — | QUESTIONS.md §4 (price at match) | — |

Rule **#5** (`partial_receipt_flag`) is covered by INV-MAT-02 (and contrast with INV-MAT-01 / INV-MAT-05). Rule **#10** (`workflow_gate`) on match is covered by INV-MAT-N01. Rule **#3** is enforced at create, not re-checked at match in API.md. Rules **#4**, **#6**, **#8**, and **#9** apply to approve/create, not match.

**Note on INV-MAT-02 message text:** Assert `partial_receipt` true and non-empty `message`; exact string only where API.md or OpenAPI `example` fixes it (`3-way match passed.` for the full-receipt case).

---

## Coverage notes

| Endpoint | positive | negative | error (404) | assumed — ask | business rules |
| --- | --- | --- | --- | --- | --- |
| POST /invoices | 10 | 23 | 1 | 5 | #3, #6, #8, #10 |
| GET /invoices/{invoiceId} | 4 | — | 2 | — | — |
| POST /invoices/{invoiceId}/match | 5 | 1 | 2 | 2 | #5, #10 |

**Out of scope for this area file:** `POST /invoices/{invoiceId}/approve`, vendor exposure, GL entries (rules #4, #7, #9, #11). Approve may appear only as **setup** for INV-MAT-N01.

**Cross-endpoint setup:** create PO, submit, receive, and approve are prerequisites where noted; assertions target invoice create/get/match only (except INV-POST-09 / INV-GET-04 / INV-MAT-04 cross-checks).

**Dropped from drafts (on purpose):**
- `three_way_match_gate` and `duplicate_approval` — approve area.
- `inactive_vendor_gate` on invoice — PO already bound to vendor at create time.
- Unknown query params on GET — not in QUESTIONS.md §4.
- Asserting match compares unit prices — not stated in API.md match response (totals only).

**Related approved design:** `docs/test-design/purchase-orders.md`, `docs/test-design/receipts.md` (PO/receive helpers).

**Existing tests:** No dedicated invoice spec yet; `scripts/smoke.ts` exercises create → match → approve — inspected only, not a substitute for this table.

---

**Status:** **approved** — Playwright tests in `tests/api/invoices.spec.ts`.
