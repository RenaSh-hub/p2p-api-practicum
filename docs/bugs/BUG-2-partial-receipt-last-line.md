# Match reports a complete receipt when the last line is still short

## Rule broken

`partial_receipt_flag`

## Severity

Medium: ordered value is 70 and received value is 50, so 20.00 of goods has not arrived, and the match sets `partial_receipt` to false.

## Basis

executed

## Steps to reproduce

`GET /skus` returned `LUM-2X4-8` then `PLY-12-4X8`. These requests created a new vendor and order, received the first line in full and 2 of 6 on the last line, invoiced only what was received, and matched. Each one was `curl.exe` with `Content-Type: application/json`.

```bash
curl.exe -sS -X POST http://localhost:8000/vendors -H "content-type: application/json" --data-binary "{\"name\":\"Bug Partial 1792953880813\",\"active\":true}"

curl.exe -sS -X POST http://localhost:8000/purchase-orders -H "content-type: application/json" --data-binary "{\"vendor_id\":\"vnd-12aa431e\",\"line_items\":[{\"sku\":\"LUM-2X4-8\",\"description\":\"2x4 stud, 8 ft\",\"quantity\":8,\"unit_price\":5},{\"sku\":\"PLY-12-4X8\",\"description\":\"Plywood sheet, 1/2 in, 4x8 ft\",\"quantity\":6,\"unit_price\":5}]}"

curl.exe -sS -X POST http://localhost:8000/purchase-orders/po-5225c6f1/submit -H "content-type: application/json" --data-binary "{}"

curl.exe -sS -X POST http://localhost:8000/purchase-orders/po-5225c6f1/receive -H "content-type: application/json" --data-binary "{\"items\":[{\"sku\":\"LUM-2X4-8\",\"quantity\":8},{\"sku\":\"PLY-12-4X8\",\"quantity\":2}]}"

curl.exe -sS -X POST http://localhost:8000/invoices -H "content-type: application/json" --data-binary "{\"po_id\":\"po-5225c6f1\",\"invoice_number\":\"INV-ShortLast-1792953880813\",\"line_items\":[{\"sku\":\"LUM-2X4-8\",\"quantity\":8,\"unit_price\":5},{\"sku\":\"PLY-12-4X8\",\"quantity\":2,\"unit_price\":5}]}"

curl.exe -sS -X POST http://localhost:8000/invoices/inv-177bbbdc/match -H "content-type: application/json" --data-binary "{}"
```

The receive call returned `ordered_value` 70, `received_value` 50, received quantity 8 of 8 on `LUM-2X4-8` and 2 of 6 on `PLY-12-4X8`. The match call is the one that breaks the rule.

## Expected

`docs/API.md` Business rules row 5:

> The match result sets `partial_receipt` to `true` when any line of the PO is not fully received.

The match should return 200 with `partial_receipt` true.

## Actual

200

```json
{
  "invoice_id": "inv-177bbbdc",
  "po_id": "po-5225c6f1",
  "status": "matched",
  "matched": true,
  "partial_receipt": false,
  "ordered_value": 70,
  "received_value": 50,
  "invoice_total": 50,
  "message": "3-way match passed."
}
```

`INV-MAT-02` and the partial-receipt flow's match step fail for the same rule: a later line that is not fully received still comes back with `partial_receipt` false.

## What this proves

When the last line is only partly received, the match still returns `partial_receipt` false. The response itself shows ordered value 70 and received value 50.

## What this does not prove

It does not prove the shortfall of 20.00 was invoiced or approved. The invoice total is 50, equal to the received value. It does not prove the flag is wrong when the short line is the first line.

## Open question

Does `partial_receipt` become true when the first line is the short one and the last line is fully received? This run only left the last line short.
