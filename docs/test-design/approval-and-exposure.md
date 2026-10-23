# Test design — approval and exposure

Oracle: `docs/API.md` (Invoices approve, Vendors exposure, The purchase-to-pay flow, Business rules #4, #7, #9 and #11, Seed data, Errors, Basics) and OpenAPI paths `POST /invoices/{invoiceId}/approve`, `GET /vendors/{vendorId}/exposure` (schemas `ApproveResult`, `GlEntry`, `GlLine`, `VendorExposure`). Assumed gaps from `docs/QUESTIONS.md` are called out below.

Precondition for every case: data is at seed state (`POST /admin/reset` in `tests/api/reset.setup.ts` only — not inside individual tests).

**Setup unless a row says otherwise:** use active vendor `vnd-001` and unique `invoice_number` values per test. Create → submit → receive → invoice → match steps are **setup only** unless the row asserts on them.

| Helper | Steps (summary) | Use for |
| --- | --- | --- |
| `INV-MATCHED-2L` | `PO-2L-FULL` (invoices design), invoice per API.md two-line example (`total_amount` 95.1), `POST .../match` | Happy-path approve; exposure 95.1 |
| `INV-MATCHED-1L` | `PO-1L-FULL`, one line `LUM-2X4-8` ×10 @4.75 (`total_amount` 47.5), `POST .../match` | Single-invoice exposure; second PO for vendor isolation |
| `INV-RECEIVED` | Same as `INV-MATCHED-1L` through create only; **no** match | Approve without match |
| `INV-MATCHED-ZERO` | `PO-1L-FULL`, invoice one line ×10 @0 (`total_amount` 0), `POST .../match` | Zero-dollar GL and exposure boundary |
| `TWO-MATCHED-SAME-VENDOR` | Two separate closed POs on `vnd-001`, each with one matched invoice (e.g. 47.5 + 4.75), neither approved yet | Multi-invoice exposure math |

Approve success is **200** with `ApproveResult` (OpenAPI). No request body on approve (OpenAPI).

---

## POST /invoices/{invoiceId}/approve

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| APV-01 | positive | Setup `INV-MATCHED-2L`, then `POST /invoices/{invoiceId}/approve` | 200 | `invoice_id` matches; `status` `approved`; `gl_entry.balanced` true; one debit `{ "account": "5000 Materials Expense", "amount": 95.1 }`, one credit `{ "account": "2000 Accounts Payable", "amount": 95.1 }`; `vendor_exposure` 95.1 | API.md Endpoints → Invoices (approve example); rules #7, #11; OpenAPI `ApproveResult` | happy path |
| APV-02 | positive | Response from APV-01 | 200 | Body validates as OpenAPI schema `ApproveResult` | OpenAPI schema `ApproveResult` | schema validation (`expectSchema`) |
| APV-03 | positive | After APV-01, `GET /invoices/{invoiceId}` | 200 on GET | `status` `approved`; `matched` true | API.md flow step 7; OpenAPI `Invoice` | approve-then-get |
| APV-04 | positive | After APV-01, `GET /vendors/vnd-001/exposure` | 200 on GET | `open_ap_liability` 95.1; `approved_invoices` contains approved `invoice_id` | API.md rules #11; OpenAPI `VendorExposure` | cross-check — `vendor_exposure` matches exposure endpoint |
| APV-05 | positive | Setup `INV-MATCHED-ZERO`, then `POST .../approve` | 200 | `gl_entry` debits and credits each `amount` 0; `balanced` true; `vendor_exposure` 0 | API.md (unit_price from 0); rule #7 | boundary — zero-dollar approval |
| APV-06 | positive | Setup `TWO-MATCHED-SAME-VENDOR`, approve first invoice only | 200 | `vendor_exposure` equals first invoice `total_amount` only (not sum of both) | API.md rule #11 | state — exposure excludes unapproved invoices |
| APV-N01 | negative | Setup `INV-RECEIVED`, `POST .../approve` (never matched) | 400 | `rule` `three_way_match_gate`; non-empty `detail` | API.md Business rules #4; OpenAPI `POST .../approve` description | state — approve before match |
| APV-N02 | negative | Setup `INV-MATCHED-1L`, approve once, `POST .../approve` again on same `invoiceId` | 400 on second | `rule` `duplicate_approval` | API.md Business rules #9; OpenAPI description | state — approve twice |
| APV-N03 | negative | `POST /invoices/inv-does-not-exist/approve` | 404 | JSON `detail`; no `rule` | OpenAPI 404; API.md Errors | unknown id |
| APV-E01 | error | `POST /invoices/inv-001/approve/extra` | 404 | JSON `detail`; no `rule` | API.md Errors | unknown route |
| APV-A01 | assumed — ask | Second `POST .../approve` after first returned 200: is strict `duplicate_approval` the only intended behavior? | — | — | QUESTIONS.md §4 (duplicate POST / idempotency) | — |

Rules **#4** (`three_way_match_gate`) → APV-N01. **#7** (`gl_balance`) → APV-01, APV-05 (balanced entry; debits equal credits). **#9** (`duplicate_approval`) → APV-N02. Rule **#11** is asserted on approve response in APV-01, APV-04, APV-06 and covered in depth under exposure. Rules **#1–#3**, **#5–#6**, **#8**, **#10** are out of scope here (invoice create/match/receive areas); match may appear only as setup.

There is no documented client-visible way to post an unbalanced ledger entry; do not add a negative row for `gl_balance` beyond verifying balanced GL on success.

---

## GET /vendors/{vendorId}/exposure

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| EXP-01 | positive | Fresh seed, `GET /vendors/vnd-001/exposure` | 200 | `vendor_id` `vnd-001`; `open_ap_liability` 0; `approved_invoices` `[]` | API.md Endpoints → Vendors; rule #11 (empty sum) | happy path — no approvals yet |
| EXP-02 | positive | Setup `INV-MATCHED-2L`, approve, then `GET /vendors/vnd-001/exposure` | 200 | `open_ap_liability` 95.1; `approved_invoices` length 1; array contains that invoice `id` | API.md exposure example; rule #11 | state — after single approval |
| EXP-03 | positive | Setup `TWO-MATCHED-SAME-VENDOR`, approve **both** invoices, then `GET /vendors/vnd-001/exposure` | 200 | `open_ap_liability` equals sum of both invoices’ `total_amount`; `approved_invoices` length 2; contains both ids | API.md rule #11 | state — sum over multiple approved invoices |
| EXP-04 | positive | Any successful EXP-01 or EXP-02 response | 200 | Body validates as OpenAPI schema `VendorExposure` | OpenAPI schema `VendorExposure` | schema validation (`expectSchema`) |
| EXP-05 | positive | Setup `INV-MATCHED-1L` (matched, not approved), `GET /vendors/vnd-001/exposure` | 200 | `open_ap_liability` 0; `approved_invoices` `[]` | API.md rule #11 (approved only) | state — matched but not approved excluded |
| EXP-06 | positive | Setup `INV-RECEIVED` (create only, not matched), `GET /vendors/vnd-001/exposure` | 200 | `open_ap_liability` 0; `approved_invoices` `[]` | API.md rule #11 | state — received invoice excluded |
| EXP-07 | positive | Approve one invoice on `vnd-001`; create second active vendor via `POST /vendors`, `GET /vendors/{newVendorId}/exposure` | 200 on new vendor | `open_ap_liability` 0; `approved_invoices` `[]` | API.md rule #11 (per vendor) | equivalence class — vendor isolation |
| EXP-08 | positive | Fresh seed, `GET /vendors/vnd-002/exposure` (inactive seed vendor) | 200 | `vendor_id` `vnd-002`; `open_ap_liability` 0; `approved_invoices` `[]` | API.md Seed data (`vnd-002` exists); exposure does not require active vendor | happy path — inactive vendor id |
| EXP-N01 | negative | `GET /vendors/vnd-does-not-exist/exposure` | 404 | JSON `detail`; no `rule` | API.md Endpoints → Vendors; OpenAPI 404 | unknown id |
| EXP-E01 | error | `GET /vendors/vnd-001/exposure/extra` | 404 | JSON `detail`; no `rule` | API.md Errors | unknown route |
| EXP-A01 | assumed — ask | After two approvals, is `approved_invoices` order defined (creation order, id sort, arbitrary)? | — | — | QUESTIONS.md §4 (ordering not documented) | — |
| EXP-A02 | assumed — ask | Fractional line totals: does `open_ap_liability` rounding match sum of stored `total_amount` cents? | — | — | QUESTIONS.md §4 (fractional quantities / rounding) | — |

Rule **#11** (`vendor_exposure_math`) is covered by EXP-01 through EXP-03, EXP-05, EXP-06, EXP-07, and cross-check APV-04.

---

## Coverage notes

| Endpoint | positive | negative | error (404) | assumed — ask | business rules |
| --- | --- | --- | --- | --- | --- |
| POST /invoices/{invoiceId}/approve | 6 | 3 | 1 | 1 | #4, #7, #9 (+ #11 on response) |
| GET /vendors/{vendorId}/exposure | 8 | 1 | 1 | 2 | #11 |

**Out of scope for this area file:** `POST /invoices`, `GET /invoices/{invoiceId}`, `POST .../match`, PO/receive/submit behavior, and `workflow_gate` on match (covered in `docs/test-design/invoices.md`). Those endpoints may appear only as **setup**.

**Cross-endpoint setup:** PO helpers from `docs/test-design/purchase-orders.md` and `docs/test-design/receipts.md`; invoice create/match patterns from `docs/test-design/invoices.md`.

**Dropped from drafts (on purpose):**
- Request body / `Content-Type` variants on approve (OpenAPI defines no body; same as submit).
- Asserting GL account strings beyond API.md / OpenAPI examples (fixed accounts only).
- Testing `gl_balance` failure path (not reachable via public API).
- Unknown query params on GET exposure — not in QUESTIONS.md §4.

**Existing tests:** `scripts/smoke.ts` runs match → approve → exposure — inspected only, not a substitute for this table. `tests/api/invoices.spec.ts` uses approve as setup for INV-MAT-N01 only.

---

**Status:** **approved** — Playwright tests in `tests/api/approval-and-exposure.spec.ts`.
