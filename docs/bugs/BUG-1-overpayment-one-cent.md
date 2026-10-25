# An invoice one cent above the received value is accepted

## Rule broken

`overpayment_protection`

## Severity

High: the invoice total is 10.01 against a received value of 10.00, so 0.01 is recorded for goods that were not received.

## Basis

executed

## Steps to reproduce

`GET /skus` returned `LUM-2X4-8` first. These requests then created a new vendor and order and sent the invoice. Each one was `curl.exe` with `Content-Type: application/json`.

```bash
curl.exe -sS -X POST http://localhost:8000/vendors -H "content-type: application/json" --data-binary "{\"name\":\"Bug Overpay 1792953880813\",\"active\":true}"

curl.exe -sS -X POST http://localhost:8000/purchase-orders -H "content-type: application/json" --data-binary "{\"vendor_id\":\"vnd-2b9c6d81\",\"line_items\":[{\"sku\":\"LUM-2X4-8\",\"description\":\"2x4 stud, 8 ft\",\"quantity\":1,\"unit_price\":10}]}"

curl.exe -sS -X POST http://localhost:8000/purchase-orders/po-d04abd71/submit -H "content-type: application/json" --data-binary "{}"

curl.exe -sS -X POST http://localhost:8000/purchase-orders/po-d04abd71/receive -H "content-type: application/json" --data-binary "{\"items\":[{\"sku\":\"LUM-2X4-8\",\"quantity\":1}]}"

curl.exe -sS -X POST http://localhost:8000/invoices -H "content-type: application/json" --data-binary "{\"po_id\":\"po-d04abd71\",\"invoice_number\":\"INV-Cent-1792953880813\",\"line_items\":[{\"sku\":\"LUM-2X4-8\",\"quantity\":1,\"unit_price\":10.01}]}"
```

The receive call returned `received_value` 10. The last call is the one that breaks the rule.

## Expected

`docs/API.md` Business rules row 3:

> Everything invoiced on a PO never exceeds what was received: not per line quantity, and not in total value. There is no tolerance.

The invoice should be rejected with 400 and `rule` `overpayment_protection`.

## Actual

201

```json
{
  "id": "inv-7f2444f1",
  "po_id": "po-d04abd71",
  "vendor_id": "vnd-2b9c6d81",
  "invoice_number": "INV-Cent-1792953880813",
  "status": "received",
  "line_items": [{ "sku": "LUM-2X4-8", "quantity": 1, "unit_price": 10.01 }],
  "total_amount": 10.01,
  "matched": false,
  "partial_receipt": null
}
```

`INV-POST-N10` fails for the same rule: 10 units received at 4.75 (received value 47.50) and invoiced at 4.76 returned 201 instead of 400 `overpayment_protection`.

## What this proves

A received value of 10.00 does not block an invoice total of 10.01. The API stored that invoice.

## What this does not prove

It does not prove that a large excess is accepted. It does not prove this invoice can be matched or approved, and it does not prove the 0.01 is included in vendor exposure.

## Open question

How large an excess is still refused? This run only sent one cent over a 10.00 receipt.
