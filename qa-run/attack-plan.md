# Attack plan

Base URL: `http://localhost:8000`. No `POST /admin/reset`. SKU codes come from a live `GET /skus` at the start of the run (never hard-coded). Every attack uses a new vendor and a new purchase order. Invoice numbers and vendor names get a timestamp suffix.

Setup calls are not logged. The logged request is only the call that tests the rule.

Outcomes: `HELD` if the API does what the docs say, `BREACHED` if it accepts a forbidden action, refuses under the wrong rule, or returns a wrong total or flag, `undocumented` if no named business rule covers the case.

## Challenge attacks (first)

1. `three_way_match_gate`. Create an active vendor, a one-line PO, submit, receive every unit, and record an invoice for that receipt. Do not match. Send `POST /invoices/{id}/approve` with `{}`.
   Expected: 400 and `rule` `three_way_match_gate` (docs/API.md Business rules row 4; Invoices approve).

2. `receive_quantity_limit`. Active vendor, PO quantity 4, submit. Send `POST /purchase-orders/{id}/receive` for quantity 20 of that SKU.
   Expected: 400 and `rule` `receive_quantity_limit` (row 2; Purchase orders receive).

3. `overpayment_protection`. Receive 10 units at 4.75 (received value 47.50). Send `POST /invoices` for the same 10 units at 9.50 (invoice value 95.00).
   Expected: 400 and `rule` `overpayment_protection` (row 3; Invoices). Quantity is within the receipt; total value is not. No tolerance.

4. `inactive_vendor_gate`. `POST /vendors` with `active: false`. Send `POST /purchase-orders` for that vendor.
   Expected: 400 and `rule` `inactive_vendor_gate` (row 1; Purchase orders).

## Edge cases

5. `receive_quantity_limit`. Two lines so the PO stays `submitted`: receive the first SKU in full and only part of the second, then send a second delivery of 1 more unit of the first SKU (one unit over that line, across deliveries).
   Expected: 400 and `rule` `receive_quantity_limit` (row 2, "across all deliveries"). A `workflow_gate` refusal would be the wrong rule, because the PO is still submitted.

6. `overpayment_protection`. Receive 1 unit at 10.00. Invoice that unit at 10.01 (one cent over).
   Expected: 400 `overpayment_protection` (row 3, "no tolerance").

7. `overpayment_protection`. Receive 100 units at 10.00 (received value 1000.00). Invoice 100 units at 10.05 (1005.00, 0.5 percent over).
   Expected: 400 `overpayment_protection`.

8. `overpayment_protection`. Receive 10 units at 10.00 (received value 100.00). Invoice 11 units at 1.00 (value 11.00, under the received value, but one unit over the received quantity).
   Expected: 400 `overpayment_protection` (row 3, "not per line quantity, and not in total value").

9. `overpayment_protection`. Submit a PO and do not receive anything. Invoice 1 unit at 10.00 against a received value of 0.
   Expected: 400 `overpayment_protection`. `workflow_gate` would be the wrong rule: a submitted PO may be invoiced (row 10).

10. `overpayment_protection`. Receive 10 units at 5.00. First invoice takes 6 units (setup). Second invoice asks for 6 more (together 12 units and 60.00 against 10 units and 50.00 received).
    Expected: 400 `overpayment_protection` on the second invoice.

11. `overpayment_protection`. Two lines at 0.10 and 0.20, both fully received (received value 0.30). Invoice the same quantities and prices.
    Expected: 201 and `total_amount` 0.30. An equal invoice is not an overpayment. A refusal, or a total above 0.30, is a breach (row 3; Basics, money rounded to cents).

12. Zero quantity. `POST /purchase-orders` with `quantity` 0.
    Expected: the Purchase orders section requires quantity greater than 0, but none of the 11 named rules covers it. A 4xx rejection is `undocumented`. A 2xx is `BREACHED`.

13. Negative quantity. `POST /purchase-orders` with `quantity` -5. Same expectation as 12.

14. Negative price. `POST /purchase-orders` with `unit_price` -1. Same expectation as 12. The documented price range is 0 to 100,000.

15. Zero price. `POST /purchase-orders` with `unit_price` 0 and quantity 1.
    Expected: 201. A price of 0 is inside the documented range (Purchase orders). Rejection is `BREACHED`.

16. `duplicate_invoice_detection`. Invoice `INV-Case-<stamp>` for part of a receipt, then invoice `inv-case-<stamp>` for another part that is still within the receipt (so overpayment does not also apply).
    Expected: 400 `duplicate_invoice_detection` (row 6).

17. `duplicate_invoice_detection`. Same shape, second number is the first number with a leading and a trailing space.
    Expected: 400 `duplicate_invoice_detection`.

18. `duplicate_invoice_detection`. Two vendors, two orders, the same invoice number on each.
    Expected: 201 for the second vendor. Uniqueness is per vendor (row 6; OpenAPI `POST /invoices`). A duplicate-rule rejection is `BREACHED`.

19. `partial_receipt_flag`. Two lines. Receive the first line in full and the second line short (short line last). Invoice only what was received. `POST /invoices/{id}/match`.
    Expected: 200 and `partial_receipt` true (row 5).

20. `partial_receipt_flag`. Same, but the first line is short and the second line is fully received (short line first).
    Expected: 200 and `partial_receipt` true.

21. `partial_receipt_flag`. Both lines fully received, invoice matches the receipt.
    Expected: 200 and `partial_receipt` false. A true flag here is `BREACHED`.

22. `workflow_gate`. Receive against a draft PO.
    Expected: 400 `workflow_gate` (row 10, receive only on a submitted PO).

23. `workflow_gate`. Submit a PO, submit it again.
    Expected: 400 `workflow_gate` (submit only a draft).

24. `workflow_gate`. Invoice a draft PO.
    Expected: 400 `workflow_gate` (invoice only a submitted or closed PO).

25. `workflow_gate`. Approve a matched invoice (setup), then `POST /invoices/{id}/match` again.
    Expected: 400 `workflow_gate` (never match an approved invoice again).

26. `duplicate_approval`. Approve a matched invoice, then `POST /invoices/{id}/approve` again.
    Expected: 400 `duplicate_approval` (row 9). `three_way_match_gate` or `workflow_gate` would be the wrong rule.

27. `invoice_line_validation`. PO and receipt contain only the first catalog SKU. Invoice the second catalog SKU.
    Expected: 400 `invoice_line_validation` (row 8).

28. `invoice_line_validation`. Invoice the same SKU on two lines.
    Expected: 400 `invoice_line_validation` (each SKU appears once).

29. `gl_balance`. Match an invoice whose lines total a cent-clean amount, then `POST /invoices/{id}/approve`.
    Expected: 200, `gl_entry.balanced` true, and total debits equal total credits equal the invoice total (row 7). A dirty float or a mismatch is `BREACHED`.

30. `gl_balance`. Same, with lines at 0.10 and 0.20 (mathematical total 0.30).
    Expected: debits and credits both 0.30 and `balanced` true.

31. `vendor_exposure_math`. Approve one invoice, then `GET /vendors/{id}/exposure`.
    Expected: `open_ap_liability` equals that invoice's `total_amount`, and `approved_invoices` lists that id (row 11).

32. `vendor_exposure_math`. Approve two invoices and leave a third invoice unapproved. `GET /vendors/{id}/exposure`.
    Expected: liability equals the sum of the two approved totals only, and the unapproved id is absent.

33. `vendor_exposure_math`. Approve one invoice for 0.10 and another for 0.20. `GET /vendors/{id}/exposure`.
    Expected: `open_ap_liability` 0.30, both ids listed.
