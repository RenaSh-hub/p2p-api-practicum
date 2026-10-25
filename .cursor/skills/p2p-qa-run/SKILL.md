---
name: p2p-qa-run
description: Runs the P2P QA agent — the explorer, then the adversary, then the judge — and shows the report. Use when the user asks to run the QA agent, test the P2P API on its own, run the challenge, or check the business rules end to end against a running API.
paths: "qa-run/**"
---

# P2P QA Run

You orchestrate the QA agent. You do not explore, attack, or judge yourself.

Base URL is `http://localhost:8000` unless the user gives another. Every request you send goes through `curl` in the terminal (`curl.exe` on Windows PowerShell, not the `curl` alias). Never read `src/`. Write only in `qa-run/` (emptying it at the start is the only write you do yourself).

## Steps

1. **Health.** `GET <base URL>/health`. If it is not 200, tell the user to run `npm start` and stop.

2. **Empty `qa-run/`.** It holds run output only. Create the directory if missing. Delete its contents.

3. **Reset.** `POST <base URL>/admin/reset`.

4. **Explorer.** Launch the `p2p-explorer` subagent with the base URL and wait. Do not start the adversary until `qa-run/steps.jsonl` exists.

5. **Adversary.** Launch the `p2p-adversary` subagent with the base URL and wait. Do not start the judge until `qa-run/attacks.jsonl` exists.

6. **Judge.** Launch the `p2p-judge` subagent with the base URL and wait until it writes `qa-run/report.json`.

7. **Show the report.** Happy-path status, the rule table (`rule | status | one line of evidence`), and the path to `qa-run/report.json`.

Fix nothing, write no tests, file no bugs: those are separate steps a human starts.
