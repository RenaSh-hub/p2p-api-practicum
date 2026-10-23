# Vendor API — test design

Source: `docs/API.md` (*Endpoints* → *Vendors*, *Basics* → *IDs*, *Errors*), OpenAPI `POST /vendors` / `VendorCreate` / `Vendor`, `docs/QUESTIONS.md`.

## POST /vendors

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| V-POST-01 | positive | `{ "name": "Cedar Point Hardware" }` (unique name, e.g. suffix with timestamp in tests) | 201 | Body matches `Vendor`: server `id` with `vnd-` prefix; `name` equals sent name; `active` is `true` | API.md *Vendors*; OpenAPI `Vendor` | — |
| V-POST-02 | positive | `{ "name": "<unique>", "active": false }` | 201 | `active` is `false`; `name` and `id` as above | API.md *Vendors* (`active` optional); OpenAPI `VendorCreate.active` | documented option |
| V-POST-03 | positive | `{ "name": "<unique>", "active": true }` | 201 | `active` is `true` | API.md *Vendors*; OpenAPI `VendorCreate` | documented option |
| V-POST-04 | positive | `{ "name": "A" }` (single character after trim) | 201 | Valid `Vendor`; `name` is `"A"` | OpenAPI `VendorCreate.name` `minLength: 1` (via schema) | boundary values (smallest valid) |
| V-POST-05 | positive | `{ "name": "  Maple Ridge  " }` | 201 | `name` is `"Maple Ridge"` (leading/trailing space trimmed) | OpenAPI `VendorCreate.name` `.trim()` | documented transform |
| V-POST-06 | negative | `{ "name": "" }` | 400 | `rule`: `validation_error`; `detail` mentions empty name | API.md *Vendors*; OpenAPI 400 | equivalence class (empty string) |
| V-POST-07 | negative | `{}` (omit `name`) | 400 | `rule`: `validation_error` | OpenAPI `VendorCreate` required `name` | equivalence class (missing field) |
| V-POST-08 | negative | `{ "name": "   " }` (whitespace only) | 400 | `rule`: `validation_error` | OpenAPI `VendorCreate.name` trim + min 1 | boundary values (empty after trim) |
| V-POST-09 | negative | `{ "name": 123 }` | 400 | `rule`: `validation_error` | OpenAPI `VendorCreate.name` type string | equivalence class (wrong type) |
| V-POST-10 | negative | `{ "name": "<unique>", "active": "yes" }` | 400 | `rule`: `validation_error` | OpenAPI `VendorCreate.active` type boolean | equivalence class (wrong type) |
| V-POST-11 | negative | Invalid JSON body or non-JSON `Content-Type` | 400 | `rule`: `validation_error` | API.md *Basics* (JSON); app error handler | equivalence class (malformed body) |
| V-POST-12 | negative | Two `POST /vendors` with the same `name` string | 201 then 201 | Each response is a distinct `Vendor` (`id` differs); no error documented for duplicate names | — | state (repeat create) |
| V-POST-13 | assumed — ask | Same `POST /vendors` retried after timeout (identical body twice) | — | — | QUESTIONS.md (idempotency on create) | state |

**404:** Not applicable — `POST /vendors` has no path id and no documented 404 response (OpenAPI responses: 201, 400 only).

**Business rules:** None of the 11 rules in API.md *Business rules* apply to vendor creation; rejections use `validation_error` only.
