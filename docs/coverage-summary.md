# API test coverage summary (P51 — possible 4 bugs in the 'invoices' area)

**Evidence:** executed — `npm run test:api` on 2026-10-23: **158 passed**, **4 failed** (162 total including setup, health, and schema specs).

Oracle: [API.md](API.md) and `GET /openapi.json`. Red tests are left failing; they indicate possible API defects, not test mistakes.

## Areas and specs

| Area | Test design | Playwright spec |
| --- | --- | --- |
| Vendors and catalog | [test-design/vendors-and-catalog.md](test-design/vendors-and-catalog.md) | `tests/api/vendors-and-catalog.spec.ts` |
| Purchase orders | [test-design/purchase-orders.md](test-design/purchase-orders.md) | `tests/api/purchase-orders.spec.ts` |
| Receipts | [test-design/receipts.md](test-design/receipts.md) | `tests/api/receipts.spec.ts` |
| Invoices | [test-design/invoices.md](test-design/invoices.md) | `tests/api/invoices.spec.ts` |
| Approval and exposure | [test-design/approval-and-exposure.md](test-design/approval-and-exposure.md) | `tests/api/approval-and-exposure.spec.ts` |

Each area’s design table maps one-to-one to tests (rows marked **assumed — ask** are skipped per `api-test-writer`).

## Endpoint coverage (tests written)

Counts are table rows implemented as tests. **Negative = 0** only where the design uses **—** (not applicable).

### Vendors and catalog

| endpoint | positive | negative | error (404) | passed | failed | possible bugs |
| --- | --- | --- | --- | --- | --- | --- |
| GET /vendors | 3 | — | 1 | 4 | 0 | 0 |
| POST /vendors | 5 | 6 | 1 | 12 | 0 | 0 |
| GET /skus | 3 | — | 1 | 4 | 0 | 0 |

### Purchase orders

| endpoint | positive | negative | error (404) | passed | failed | possible bugs |
| --- | --- | --- | --- | --- | --- | --- |
| POST /purchase-orders | 8 | 20 | 1 | 29 | 0 | 0 |
| GET /purchase-orders/{poId} | 3 | — | 2 | 5 | 0 | 0 |
| POST /purchase-orders/{poId}/submit | 3 | 3 | 1 | 7 | 0 | 0 |

### Receipts

| endpoint | positive | negative | error (404) | passed | failed | possible bugs |
| --- | --- | --- | --- | --- | --- | --- |
| POST /purchase-orders/{poId}/receive | 10 | 15 | 2 | 27 | 0 | 0 |

### Invoices

| endpoint | positive | negative | error (404) | passed | failed | possible bugs |
| --- | --- | --- | --- | --- | --- | --- |
| POST /invoices | 10 | 23 | 1 | 31 | 3 | 3 |
| GET /invoices/{invoiceId} | 4 | — | 2 | 6 | 0 | 0 |
| POST /invoices/{invoiceId}/match | 5 | 1 | 2 | 7 | 1 | 1 |

### Approval and exposure

| endpoint | positive | negative | error (404) | passed | failed | possible bugs |
| --- | --- | --- | --- | --- | --- | --- |
| POST /invoices/{invoiceId}/approve | 6 | 3 | 1 | 10 | 0 | 0 |
| GET /vendors/{vendorId}/exposure | 8 | 1 | 1 | 10 | 0 | 0 |

## Possible bugs (red tests)

| Test ID | Endpoint | Expected | Observed | Oracle |
| --- | --- | --- | --- | --- |
| INV-POST-N04 | POST /invoices | 400 `duplicate_invoice_detection` for case variant `inv-7` vs `INV-7` | 201 | API.md rule **#6** |
| INV-POST-N05 | POST /invoices | 400 `duplicate_invoice_detection` for padded ` INV-7 ` | 201 | API.md rule **#6** |
| INV-POST-N10 | POST /invoices | 400 `overpayment_protection` when total invoiced value exceeds received | 201 | API.md rule **#3** |
| INV-MAT-02 | POST /invoices/{invoiceId}/match | `partial_receipt: true` when PO not fully received | `partial_receipt: false` | API.md rule **#5** |

## Out of scope in this summary

- `tests/api/health.spec.ts`, `tests/api/schema.spec.ts`, `tests/api/reset.setup.ts` — infrastructure, not area design tables.
- `scripts/smoke.ts` — happy path only; inspected only, not a substitute for the design tables.
