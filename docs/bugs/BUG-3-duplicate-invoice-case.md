# A second invoice is accepted when the number differs only by letter case

## Rule broken

`duplicate_invoice_detection`

## Severity

High: a second invoice for 20.00 was stored after the same vendor had already used that invoice number with different letter case.

## Basis

executed

## Steps to reproduce

`GET /skus` returned `LUM-2X4-8` first. These requests created a new vendor, received 10 units at 5.00, stored `INV-Case-1792953880813` for 4 of those units, then sent the same number in lower case for 4 more units. Each one was `curl.exe` with `Content-Type: application/json`.

```bash
curl.exe -sS -X POST http://localhost:8000/vendors -H "content-type: application/json" --data-binary "{\"name\":\"Bug Case 1792953880813\",\"active\":true}"

curl.exe -sS -X POST http://localhost:8000/purchase-orders -H "content-type: application/json" --data-binary "{\"vendor_id\":\"vnd-277062e1\",\"line_items\":[{\"sku\":\"LUM-2X4-8\",\"description\":\"2x4 stud, 8 ft\",\"quantity\":10,\"unit_price\":5}]}"

curl.exe -sS -X POST http://localhost:8000/purchase-orders/po-885f2b44/submit -H "content-type: application/json" --data-binary "{}"

curl.exe -sS -X POST http://localhost:8000/purchase-orders/po-885f2b44/receive -H "content-type: application/json" --data-binary "{\"items\":[{\"sku\":\"LUM-2X4-8\",\"quantity\":10}]}"

curl.exe -sS -X POST http://localhost:8000/invoices -H "content-type: application/json" --data-binary "{\"po_id\":\"po-885f2b44\",\"invoice_number\":\"INV-Case-1792953880813\",\"line_items\":[{\"sku\":\"LUM-2X4-8\",\"quantity\":4,\"unit_price\":5}]}"

curl.exe -sS -X POST http://localhost:8000/invoices -H "content-type: application/json" --data-binary "{\"po_id\":\"po-885f2b44\",\"invoice_number\":\"inv-case-1792953880813\",\"line_items\":[{\"sku\":\"LUM-2X4-8\",\"quantity\":4,\"unit_price\":5}]}"
```

The first invoice returned 201 and `inv-089275dc`. The second call is the one that breaks the rule. Its quantity still fits the receipt, so overpayment is not the reason it should be refused.

## Expected

`docs/API.md` Business rules row 6:

> A vendor cannot submit the same invoice number twice. Numbers are compared ignoring upper or lower case and surrounding spaces, so `INV-7`, `inv-7` and ` INV-7 ` are the same number.

The second invoice should be rejected with 400 and `rule` `duplicate_invoice_detection`.

## Actual

201

```json
{
  "id": "inv-1e56cf9d",
  "po_id": "po-885f2b44",
  "vendor_id": "vnd-277062e1",
  "invoice_number": "inv-case-1792953880813",
  "status": "received",
  "line_items": [{ "sku": "LUM-2X4-8", "quantity": 4, "unit_price": 5 }],
  "total_amount": 20,
  "matched": false,
  "partial_receipt": null
}
```

`INV-POST-N04` fails the same way: `inv-7` is accepted after `INV-7`. `INV-POST-N05` also returned 201 for ` INV-7-PAD ` after `INV-7-PAD`.

## What this proves

Letter case does not make two invoice numbers different for this vendor. The second invoice, total 20.00, was stored. The existing padded-number test shows surrounding spaces are not folded into the same number either.

## What this does not prove

It does not prove an identical invoice number is accepted. It does not prove either invoice was matched or approved, and it does not prove vendor exposure includes both totals.

## Open question

If both invoices are approved, does exposure include both 20.00 amounts under numbers the rule treats as one?
