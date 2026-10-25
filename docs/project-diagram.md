# P2P API Practicum — project diagram

This document maps how the repository fits together: the practice API, documentation, automated tests, Cursor QA agents, and CI.

**PDF export:** run `npm run docs:diagram-pdf` to regenerate [project-diagram.pdf](./project-diagram.pdf) from this file.

## Repository overview

```mermaid
flowchart TB
  subgraph docs["Documentation"]
    API["docs/API.md — 11 business rules"]
    TD["docs/test-design/*.md"]
    BUGS["docs/bugs/BUG-*.md"]
    COV["docs/coverage-summary.md"]
    CHAL["CHALLENGE.md"]
  end

  subgraph api["P2P API — src/"]
    SRV["server.ts"]
    APP["app.ts — routes"]
    SCH["schemas.ts — Zod"]
    OAS["openapi.ts"]
    RUL["rules.ts"]
    STO["store.ts — in-memory"]
    SRV --> APP
    APP --> SCH
    APP --> STO
    STO --> RUL
    SCH --> OAS
  end

  subgraph tests["Automated tests — tests/api/"]
    PW["Playwright specs"]
    FL["flows/ — full, partial, over-invoice"]
    HLP["helpers/ — po, schema"]
    PW --> FL
    PW --> HLP
  end

  subgraph cursor["Cursor tooling — .cursor/"]
    AG["agents: explorer, adversary, judge, api-test-writer"]
    SK["skills: p2p-qa-run, api-test-design, api-schema-validation"]
    HK["hooks — guard constitution and assertions"]
    RL["rules/api-testing.mdc"]
  end

  subgraph qrun["QA run output — qa-run/"]
    STEPS["steps.jsonl"]
    ATK["attacks.jsonl"]
    RPT["report.json"]
  end

  subgraph ci["CI"]
    GHA[".github/workflows/api-tests.yml"]
  end

  SCR["scripts/smoke.ts"]
  README["README.md"]

  README --> api
  CHAL --> cursor
  cursor --> qrun
  AG -->|"curl only, no src/"| api
  PW -->|"HTTP localhost:8000"| api
  GHA --> PW
  SCR --> api
  TD --> PW
  BUGS --> PW
  API --> AG
  OAS --> PW
```

## Runtime stack (request path)

```mermaid
flowchart LR
  CLIENT["Client / Playwright / curl / Swagger UI"]
  EXP["Express app.ts"]
  ZOD["Zod validation — schemas.ts"]
  STORE["store.ts — workflow and ledger"]
  RULES["rules.ts — RuleViolation / NotFound"]
  MEM["In-memory seed data"]

  CLIENT -->|JSON HTTP| EXP
  EXP --> ZOD
  ZOD --> STORE
  STORE --> RULES
  STORE --> MEM
  EXP -->|/docs, /openapi.json| CLIENT
```

## Purchase-to-pay happy path

```mermaid
sequenceDiagram
  participant V as Vendors / SKUs
  participant PO as Purchase order
  participant R as Receive
  participant I as Invoice
  participant M as 3-way match
  participant A as Approve and ledger
  participant E as Exposure

  Note over V: GET /vendors, /skus
  PO->>PO: POST /purchase-orders
  PO->>PO: POST .../submit
  R->>R: POST .../receive (partial OK)
  I->>I: POST /invoices
  M->>M: POST .../match
  A->>A: POST .../approve
  E->>E: GET /vendors/{id}/exposure
  Note over PO,E: POST /admin/reset restores seed
```

## QA agent pipeline (challenge)

```mermaid
flowchart LR
  SKILL["p2p-qa-run skill"]
  EXP["p2p-explorer"]
  ADV["p2p-adversary"]
  JUD["p2p-judge"]
  API["API :8000"]

  SKILL -->|reset and orchestrate| EXP
  EXP -->|logs| STEPS["qa-run/steps.jsonl"]
  EXP --> API
  SKILL --> ADV
  ADV -->|logs| ATKS["qa-run/attacks.jsonl"]
  ADV --> API
  SKILL --> JUD
  JUD --> STEPS
  JUD --> ATKS
  JUD --> RPT["qa-run/report.json"]
  JUD --> API
```

## How the layers relate

| Layer | Role |
| --- | --- |
| **API** | Express + Zod + in-memory store; intentional defects (find via HTTP, not by reading `src/`) |
| **Docs** | Human rules in `API.md`; machine schema via `/openapi.json` and Swagger at `/docs` |
| **Playwright** | Regression and flow tests under `tests/api/`; CI runs them on push |
| **QA agents** | Explorer, then adversary, then judge; artifacts under `qa-run/` |
| **Bug reports** | `docs/bugs/` documents findings tied to regression tests |

## Key paths

| Path | Contents |
| --- | --- |
| `src/` | API implementation |
| `docs/API.md` | Written reference and money rules |
| `docs/test-design/` | Human-approved test design tables |
| `docs/bugs/` | Bug write-ups from test findings |
| `tests/api/` | Playwright API tests |
| `.cursor/agents/` | Subagent prompts (explorer, adversary, judge, test writer) |
| `.cursor/skills/p2p-qa-run/` | Orchestrates the QA agent run |
| `qa-run/` | Output from the last QA agent run |
| `CHALLENGE.md` | 60-minute QA agent exercise spec |
