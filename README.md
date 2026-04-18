# Revenue AI OS

> A multi-tenant **Sales Operating System** for B2B revenue teams.
> Turns your CRM, calls, and context into one self-improving research
> engine — so reps spend their day selling, not searching, and leaders
> see ROI in weeks, not quarters.

---

## Read first

The repo has a small, layered doc tree. Start here:

| Document | Purpose | Read when |
|---|---|---|
| **[`MISSION.md`](MISSION.md)** | The *why*. Two product jobs, three layers, three-tier harness, operating principles, UX gates. **Source of truth.** | Before any non-trivial change |
| **[`CURSOR_PRD.md`](CURSOR_PRD.md)** | The *what*. Universal product spec — vision, four loops, architecture, sales-knowledge layer, ROI promises. | Scoping new capability or onboarding a new tenant |
| **[`docs/PROCESS.md`](docs/PROCESS.md)** | The *how*. Add a tool, connector, workflow, eval, tenant. On-call playbook. Anti-patterns. | When implementing |
| **[`apps/web/README.md`](apps/web/README.md)** | Web-app dev quick start (env, scripts, layout). | First time cloning, running locally |
| [`.cursorrules`](.cursorrules) | Cursor AI coding rules + complete file map. | Auto-applied by Cursor |
| [`apps/web/AGENTS.md`](apps/web/AGENTS.md) | Web-app-specific rules (tenant scoping, signal-over-noise gates). | When editing `apps/web/` |

Subsystem deep-dives live in [`docs/prd/`](docs/prd/). Anything under
[`docs/archive/`](docs/archive/) is **superseded** — read for archaeology
only, do not implement against.

---

## What this is

Two jobs the OS has to do well, for any tenant:

1. **Build pipeline** — find, prioritise, and engage net-new accounts that
   match this company's ICP.
2. **Manage existing customers** — portfolio health, churn signals,
   weekly theme digests.

Three layers that compound:

1. **Context** — canonical Postgres ontology (`urn:rev:` addressed) of
   companies, deals, signals, contacts, transcripts. One vector store.
2. **Agent** — one universal agent runtime, four role-shaped surfaces
   (pipeline coach, account strategist, leadership lens, onboarding coach),
   ~22 typed tools, 16 sales frameworks (SPIN, MEDDPICC, Sandler,
   Challenger, JOLT, …).
3. **Learning** — event-sourced telemetry; nightly workflows mine
   exemplars, propose prompt diffs, calibrate scoring weights, write
   attributions. Per-tenant adaptation lands in `calibration_ledger` for
   human approval.

See [`CURSOR_PRD.md` §3](CURSOR_PRD.md#3-the-product-in-one-diagram--the-four-loops)
for the full diagram.

---

## Tech stack

- **Next.js 16** (App Router) on Vercel — React 19, Turbopack
- **Supabase** — Postgres + pgvector + Row Level Security
- **Vercel AI SDK** with Anthropic, optionally via the AI Gateway
- **shadcn/ui + Tailwind 4**
- **Vitest** for unit tests; custom golden-eval harness gated in CI
- **Custom durable workflow runner** in `apps/web/src/lib/workflows/runner.ts` — pattern-compatible with Vercel Workflow DevKit
- **TypeScript** end-to-end, **Turborepo** monorepo, **npm workspaces**

---

## Repository layout

```
prospector-os/
├── MISSION.md                          # The why
├── CURSOR_PRD.md                       # The what
├── README.md                           # You are here
├── docs/
│   ├── PROCESS.md                      # The how
│   ├── prd/                            # Subsystem PRDs
│   ├── adoption-research-report.md
│   ├── deployment-guide.md
│   └── archive/                        # Superseded
├── apps/
│   └── web/                            # Next.js app — see apps/web/README.md
├── packages/
│   ├── core/                           # Scoring, funnel, prioritisation, citations, telemetry, business-skills, types
│   ├── adapters/                       # CRM, enrichment, transcripts, notifications, connectors
│   └── db/                             # Migrations + schema + Supabase client
├── config/                             # ICP, funnel, signal, scoring JSON defaults
├── scripts/                            # seed-tools, validate-workflows, setup
└── vercel.json                         # Cron schedules
```

---

## Quick start

```bash
git clone <repo>
cd prospector-os
npm install
cp .env.example .env.local
# Fill .env.local — see apps/web/README.md for the minimum set
npm run dev
```

Then open <http://localhost:3000> and follow the onboarding wizard. Full
quick start (env vars, database migrations, scripts, troubleshooting) in
[`apps/web/README.md`](apps/web/README.md).

---

## Common scripts

| Command | What it does |
|---|---|
| `npm run dev` | Turbopack dev server (port 3000) |
| `npm run build` | Production build of every workspace |
| `npm run type-check` | `tsc --noEmit` across the monorepo |
| `npm run lint` | ESLint via the Next.js config |
| `npm run test` | Vitest across `@prospector/core`, `@prospector/adapters`, and the web app |
| `npm run validate:workflows` | AST-checks every workflow for the tier-3 contract (idempotency, tenant scoping, holdout, DAG) |
| `npm run evals:smoke` | Cheap 3-case smoke eval |
| `npm run evals` | Full agent eval suite (gated in CI) |

---

## Operating principles (the short version)

> The full set is in [`MISSION.md`](MISSION.md). These are the ones that
> shape every code review.

1. **Signal over noise.** Daily push budget per rep: high=3, medium=2
   (default), low=1. Top-N defaults to 3. Short-form ≤ 150 words. ≤ 3
   Next-Step buttons. Bundle similar events. When in doubt, cut.
2. **Cite or shut up.** Every claim links to the source object. Every
   tool returns `{ data, citations }`. No invented numbers, no invented
   names.
3. **Ontology-first.** New capability = new tool or new ontology object,
   never a new bespoke page.
4. **One agent, many surfaces.** Surfaces are presets of the one
   universal agent (prompt + tool subset). Never a new runtime.
5. **Self-improving by default, never opaque.** Every adaptation lands as
   an inspectable, reversible row in `calibration_ledger`.
6. **Per-tenant adaptation.** Each tenant gets their own exemplars,
   weights, priors, business skills — derived from their own data.
7. **Evals are non-optional.** Every PR runs the eval suite; merge blocked
   on regression.
8. **ROI is a first-class product.** `/admin/roi` shows time saved +
   influenced ARR + holdout-cohort lift. No demo data anywhere in
   analytics.

---

## License

Proprietary. All rights reserved.

---

*If you are about to make a non-trivial change and you have not yet read
[`MISSION.md`](MISSION.md) — stop and read it first. The OS is coherent
because everyone working on it is reading from the same page.*
