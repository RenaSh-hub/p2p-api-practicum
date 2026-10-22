# Documentation cross-check: `docs/API.md` vs OpenAPI

Sources: `docs/API.md` (read in repo) and `GET http://localhost:8000/openapi.json` (fetched once). No `src/` and no other endpoints were used.

## 1. In both documents

- There is no authentication on the API — **API.md** *Basics*; **OpenAPI** `info.description` — inspected only
- Data is kept in memory and returns to seed state on restart or `POST /admin/reset` — **API.md** *Basics*; **OpenAPI** `info.description`, `POST /admin/reset` `description` — inspected only
- Money amounts are dollars rounded to cents — **API.md** *Basics* (*Money*); **OpenAPI** `VendorExposure.open_ap_liability`, `PoLine.unit_price`, `PurchaseOrder.ordered_value`, and related schema `description` fields — inspected only
- Rejected requests return JSON with a human-readable `detail`; `404` responses do not include a `rule` — **API.md** *Errors*; **OpenAPI** `info.description`, schema `Error` — inspected only
- Business and validation failures use the same eleven rule names plus `validation_error` — **API.md** *Errors*, *Business rules*; **OpenAPI** schema `Error.properties.rule.enum` — inspected only
- `GET /health` returns body `{ "status": "ok" }` — **API.md** *Endpoints* → *System*; **OpenAPI** `GET /health`, schema `Health` — inspected only
- `POST /admin/reset` clears POs, invoices, and created vendors and restores seed vendors and the SKU catalog — **API.md** *Endpoints* → *System*; **OpenAPI** `POST /admin/reset` `description` — inspected only
- `POST /admin/reset` response body includes `"status": "reset"` — **API.md** *Endpoints* → *System*; **OpenAPI** schema `Reset` — inspected only
- `GET /vendors` lists vendors — **API.md** *Endpoints* → *Vendors*; **OpenAPI** `GET /vendors` — inspected only
- `POST /vendors` creates a vendor; `name` is required and non-empty; `active` is optional and defaults to `true` — **API.md** *Endpoints* → *Vendors*; **OpenAPI** `POST /vendors`, schema `VendorCreate` — inspected only
- `GET /vendors/{vendorId}/exposure` returns open AP liability and approved invoice ids — **API.md** *Endpoints* → *Vendors*; **OpenAPI** `GET /vendors/{vendorId}/exposure`, schema `VendorExposure` — inspected only
- Unknown vendor on exposure returns `404` — **API.md** *Endpoints* → *Vendors*; **OpenAPI** `GET /vendors/{vendorId}/exposure` response `404` — inspected only
- `GET /skus` lists catalog SKUs — **API.md** *Endpoints* → *Catalog*; **OpenAPI** `GET /skus` — inspected only
- `POST /purchase-orders` creates a draft PO and returns `201` — **API.md** *Endpoints* → *Purchase orders*; **OpenAPI** `POST /purchase-orders` response `201` — inspected only
- PO create requires an existing vendor (`404` if missing) and an active vendor (`inactive_vendor_gate`) — **API.md** *Endpoints* → *Purchase orders*, *Business rules* #1; **OpenAPI** `POST /purchase-orders` `description`, responses `404`/`400` — inspected only
- PO line `quantity` must be greater than 0 and at most 10,000; `unit_price` is between 0 and 100,000 — **API.md** *Endpoints* → *Purchase orders*; **OpenAPI** schema `PoLineCreate` — inspected only
- Each SKU may appear at most once on a PO — **API.md** *Endpoints* → *Purchase orders*; **OpenAPI** `POST /purchase-orders` `description` — inspected only
- PO statuses are `draft`, `submitted`, and `closed` — **API.md** *The purchase-to-pay flow*; **OpenAPI** schema `PurchaseOrder.properties.status.enum` — inspected only
- `GET /purchase-orders/{poId}` returns the PO — **API.md** *Endpoints* → *Purchase orders*; **OpenAPI** `GET /purchase-orders/{poId}` — inspected only
- `POST /purchase-orders/{poId}/submit` only accepts a draft PO (`workflow_gate`) — **API.md** *Endpoints* → *Purchase orders*, *Business rules* #10; **OpenAPI** `POST /purchase-orders/{poId}/submit` `description` — inspected only
- `POST /purchase-orders/{poId}/receive` records delivery on a submitted PO; cumulative received quantity per line cannot exceed ordered quantity (`receive_quantity_limit`); PO closes when every line is fully received — **API.md** *Endpoints* → *Purchase orders*, *Business rules* #2; **OpenAPI** `POST /purchase-orders/{poId}/receive` `description` — inspected only
- `POST /invoices` creates an invoice with initial status `received` — **API.md** *Endpoints* → *Invoices*; **OpenAPI** `POST /invoices` response `201`, schema `Invoice.properties.status.enum` — inspected only
- Invoicing is allowed only when the PO is `submitted` or `closed` (`workflow_gate`) — **API.md** *Business rules* #10; **OpenAPI** `POST /invoices` `description` — inspected only
- Invoice numbers are unique per vendor, compared case-insensitively with surrounding spaces ignored (`duplicate_invoice_detection`) — **API.md** *Business rules* #6; **OpenAPI** `POST /invoices` `description` — inspected only
- Invoice lines must reference SKUs on the PO, each SKU at most once (`invoice_line_validation`) — **API.md** *Business rules* #8; **OpenAPI** `POST /invoices` `description` — inspected only
- Total and line quantities invoiced on a PO cannot exceed what was received (`overpayment_protection`) — **API.md** *Business rules* #3; **OpenAPI** `POST /invoices` `description` — inspected only
- `GET /invoices/{invoiceId}` returns the invoice — **API.md** *Endpoints* → *Invoices*; **OpenAPI** `GET /invoices/{invoiceId}` — inspected only
- Invoice statuses are `received`, `matched`, and `approved` — **API.md** *The purchase-to-pay flow*; **OpenAPI** schema `Invoice.properties.status.enum` — inspected only
- `partial_receipt` is `null` until the invoice is matched — **API.md** *Endpoints* → *Invoices* (create response); **OpenAPI** schema `Invoice.properties.partial_receipt` `description` — inspected only
- `POST /invoices/{invoiceId}/match` runs a 3-way match and sets `partial_receipt` when any PO line is not fully received (`partial_receipt_flag`) — **API.md** *Endpoints* → *Invoices*, *Business rules* #5; **OpenAPI** `POST /invoices/{invoiceId}/match` `description` — inspected only
- An approved invoice cannot be matched again (`workflow_gate`) — **API.md** *Business rules* #10; **OpenAPI** `POST /invoices/{invoiceId}/match` `description` — inspected only
- `POST /invoices/{invoiceId}/approve` requires a prior match (`three_way_match_gate`) and allows only one approval (`duplicate_approval`) — **API.md** *Endpoints* → *Invoices*, *Business rules* #4 and #9; **OpenAPI** `POST /invoices/{invoiceId}/approve` `description` — inspected only
- Approval posts a balanced ledger entry debiting Materials Expense and crediting Accounts Payable (`gl_balance`) — **API.md** *Endpoints* → *Invoices*, *Business rules* #7; **OpenAPI** `POST /invoices/{invoiceId}/approve` `description`, schemas `GlEntry` / `GlLine` — inspected only
- Vendor exposure equals the sum of `total_amount` on that vendor’s approved invoices (`vendor_exposure_math`) — **API.md** *Business rules* #11; **OpenAPI** `GET /vendors/{vendorId}/exposure` `description` — inspected only
- Base server URL is `http://localhost:8000` — **API.md** *Basics*; **OpenAPI** `servers[0].url` — inspected only

## 2. In one document only

**Only in `docs/API.md`**

- Clients should send `Content-Type: application/json` on every request body — **API.md** *Basics* (*Format*) — inspected only
- The API can be run on another port with `PORT=8001 npm start` — **API.md** *Basics* — inspected only
- Server-generated id prefixes are `vnd-…`, `po-…`, and `inv-…`; seed vendors use fixed ids — **API.md** *Basics* (*IDs*) — inspected only
- HTTP status semantics: `200` success, `201` created, `400` invalid or rule rejection, `404` missing record or route — **API.md** *Errors* table — inspected only
- Narrative eight-step purchase-to-pay flow from vendor pick through exposure check — **API.md** *The purchase-to-pay flow* — inspected only
- Workflow statuses move forward only (no backward transitions described) — **API.md** *The purchase-to-pay flow* — inspected only
- After reset, exactly two seed vendors (`vnd-001` active, `vnd-002` inactive) and five named SKUs with catalog prices — **API.md** *Seed data* — inspected only
- Catalog prices are reference only; PO lines carry their own `unit_price` — **API.md** *Seed data* — inspected only
- Full prose table of all eleven business rules with plain-language promises — **API.md** *Business rules* — inspected only
- Receive payload shape uses an `items` array of `{ sku, quantity }` — **API.md** *Endpoints* → *Purchase orders* (example JSON) — inspected only
- Example match and approve response JSON including `message`, account names, and `vendor_exposure` — **API.md** *Endpoints* → *Invoices* — inspected only
- Ordered curl sequence and `npm run smoke` as a one-command happy path — **API.md** *A full session with curl* — inspected only
- Quantity and unit-price limits also apply to delivery and invoice lines — **API.md** *Endpoints* → *Purchase orders* — inspected only

**Only in OpenAPI**

- Document metadata: OpenAPI `3.1.0`, title `P2P Practice API`, version `1.0.0` — **OpenAPI** `info` — inspected only
- Operations grouped by tags: System, Vendors, Catalog, Purchase orders, Invoices — **OpenAPI** path operation `tags` — inspected only
- Per-operation summaries and response status codes (e.g. `POST /vendors` → `201`, submit/receive/match/approve → `200`) — **OpenAPI** `paths.*.responses` — inspected only
- String fields use schema constraints such as `minLength: 1` on ids, skus, and names — **OpenAPI** `VendorCreate`, `PurchaseOrderCreate`, `PoLineCreate`, etc. — inspected only
- Quantities use `exclusiveMinimum: 0` and `maximum: 10000` on create/receive/invoice line schemas — **OpenAPI** `PoLineCreate`, `ReceiveRequest`, `InvoiceLine` — inspected only
- Invoice resource includes `vendor_id` and `total_amount` on the representation — **OpenAPI** schema `Invoice` — inspected only
- Match response schema is `MatchResult` with required financial totals and `message` — **OpenAPI** schema `MatchResult` — inspected only
- Approve response schema is `ApproveResult` with nested `GlEntry` — **OpenAPI** schema `ApproveResult` — inspected only
- `POST /admin/reset` success is explicitly HTTP `200` — **OpenAPI** `POST /admin/reset` response `200` — inspected only

## 3. Conflicts

None found — inspected only

## 4. Not documented

Neither document answers the following. Each is a question for the developer; treat as **assumed until answered**.

- Are fractional quantities allowed (e.g. `quantity: 10.5`), and if so how are line totals and exposure rounded? — **assumed until answered** — inspected only
- What is the maximum length or character set for vendor names, SKUs, descriptions, and invoice numbers? — **assumed until answered** — inspected only
- If the same `POST` is sent twice with identical bodies (e.g. two `submit` calls on the same draft, or two `approve` on the same invoice), is the second call idempotent, a no-op success, or a `400` with a specific `rule`? — **assumed until answered** — inspected only
- Can multiple partial `receive` calls split one line’s quantity across deliveries, and must receive requests include only SKUs being delivered in that shipment? — **assumed until answered** — inspected only
- Can one PO have multiple invoices (partial billing), and how does `overpayment_protection` apply across them? — **assumed until answered** — inspected only
- May invoice `unit_price` differ from the PO line price, and does matching compare price as well as quantity? — **assumed until answered** — inspected only
- May an invoice include a subset of PO SKUs or must it cover all lines? — **assumed until answered** — inspected only
- What happens if `POST /invoices/{invoiceId}/match` is called again when the invoice is already `matched` but not yet approved? — **assumed until answered** — inspected only
- Are concurrent requests from multiple clients supported, and is any locking or last-write-wins behavior defined? — **assumed until answered** — inspected only
- For `400` responses, is the `rule` field always present in practice even though the OpenAPI `Error` schema only requires `detail`? — **assumed until answered** — inspected only
- Does `GET` on an unknown route return `404`, and is the body shape the same as a missing resource id? — **assumed until answered** — inspected only
- Is there a documented rounding rule when `quantity × unit_price` produces more than two decimal places (e.g. half-up vs truncate)? — **assumed until answered** — inspected only
- Can `POST /vendors` or other creates be retried safely after a timeout (duplicate name vendors, duplicate invoice numbers already covered; generic idempotency is not)? — **assumed until answered** — inspected only
- Are negative or zero-money edge cases (zero-quantity lines if validation bypassed, $0 invoices) explicitly allowed or rejected outside the stated min/max? — **assumed until answered** — inspected only
