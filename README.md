# P2P Practice API

A small purchase-to-pay (P2P) API for learning API testing with AI agents. It covers vendors, purchase orders, deliveries, vendor invoices, a 3-way match and ledger postings. Everything runs locally and keeps its data in memory.

It was built for the Agentic QA Practicum course, Blocks 8 and 9: students fork it, cover it with Playwright API tests, then take the [QA agent challenge](CHALLENGE.md).

> This API has defects on purpose. Find them through the API, the way a tester would, not by reading `src/`.

![Swagger UI](docs/swagger-ui.png)

## Get your own copy

You need Node.js 20 or newer and the GitHub CLI (`gh`) signed in.

```bash
gh repo fork vskadorva/p2p-api-practicum --clone
cd p2p-api-practicum
npm install
npm start
```

The API starts on `http://localhost:8000`. Stop it with Ctrl+C.

## Two kinds of documentation

| Document | Where | What it is good for |
| --- | --- | --- |
| Swagger UI | `http://localhost:8000/docs` | Generated from the code. Every endpoint, field, type and status code. You can send requests from the page. |
| OpenAPI JSON | `http://localhost:8000/openapi.json` | The same description as a file. Tools and agents read this one, for example to validate response schemas. |
| Written reference | [docs/API.md](docs/API.md) | Written by a person. The business flow, the 11 rules and worked examples. |

## Useful commands

| Command | What it does |
| --- | --- |
| `npm start` | Start the API on port 8000 |
| `PORT=8001 npm start` | Start it on another port |
| `npm run dev` | Start it and restart on every code change |
| `npm run smoke` | Run the happy path once against the running API |
| `npm run typecheck` | Check the TypeScript code |
| `curl -X POST localhost:8000/admin/reset` | Put the data back to the seed state |

## Project layout

| Path | Contents |
| --- | --- |
| `src/server.ts` | Starts the server |
| `src/app.ts` | Routes and error handling |
| `src/schemas.ts` | Request and response schemas (the OpenAPI document is generated from these) |
| `src/rules.ts` | The business rules |
| `src/store.ts` | In-memory data and the workflow |
| `src/openapi.ts` | Route descriptions for the OpenAPI document |
| `scripts/smoke.ts` | The happy-path check |
| `docs/API.md` | The written reference |
| `docs/project-diagram.md` | Architecture map (Mermaid) |
| `CHALLENGE.md` | The QA agent challenge |

## Troubleshooting

- **`Port 8000 is already in use`**: another copy is still running. Stop it, or start this one with `PORT=8001 npm start` and use that port everywhere.
- **Data from an earlier run is still there**: call `POST /admin/reset`, or restart the API.
- **`npm run smoke` fails on the first line**: the API is not running. Start it in another terminal first.
