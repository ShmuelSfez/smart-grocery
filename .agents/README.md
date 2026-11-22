# SmartCart AI Agent Infrastructure (`.agents/`)

This directory contains SmartCart's auto-discovered rules and progressive-disclosure skills, designed to work out of the box with **Google Antigravity**, **OpenAI Codex**, **Claude Code**, and **Cursor**.

---

## 1. How Auto-Discovery & Context Loading Work

To maximize accuracy while preserving context-window budget (Antigravity enforces a `24 KB` per-rule cap and a `20,000`-token aggregate rules budget), instructions are split into **three tiers**:

1. **Hierarchical Directory Rules (`AGENTS.md` — Contextual & Always Active in Scope):**
   - [`/AGENTS.md`](../AGENTS.md) — Root engineering, honesty, security, zero-dependency, and git/deploy contract loaded across the whole repository.
   - [`/web/AGENTS.md`](../web/AGENTS.md) — Loaded automatically only when working inside `web/` (pure ES modules, Safari regex rules, strict CSP/XSS, `?v=N` cache busting, `codec.js` sync, UI price honesty).
   - [`/extension/AGENTS.md`](../extension/AGENTS.md) — Loaded automatically only when working inside `extension/` (zero passwords, `AbortController` timeouts, barcode translation, per-item `ADD_500` isolation, MV3 CSP).
   - [`/tests/regression/AGENTS.md`](../tests/regression/AGENTS.md) — Loaded automatically only when working inside `tests/regression/` (DUT vs. Testbench separation, zero-import XML oracle, `<= 30%` non-tautology gate, passing-only coverage, `waivers.json` expiry/ticket rules).

2. **Specialized Subagents (`.agents/agents/*.md` — Strict Separation of Concerns):**
   - [`agents/smartcart-web.md`](./agents/smartcart-web.md) — Owns only `web/**`, `pipeline/**`, `api/**`, and `serve.mjs` (SmartCart website, full delivery address & zone engine, Hebrew list importers, weighted produce, and 9-chain honest pricing).
   - [`agents/smartcart-extensions.md`](./agents/smartcart-extensions.md) — Owns only `extension/**` and packaged `.zip` builds across all 7 online supermarket storefronts.
   - [`agents/smartcart-verification.md`](./agents/smartcart-verification.md) — Independent DV verification agent owning `tests/**` and `tests/regression/**`; never edits production code, audits diffs, writes adversarial tests, and issues PASS/FAIL signoff.

2. **Workspace Rules (`.agents/rules/*.md` — Always-On Gates):**
   - [`rules/verification-signoff.md`](./rules/verification-signoff.md) (`trigger: always_on`) — Mandatory pre-commit signoff gate (`node --check`, `npm test`, `regression:smoke`, and `update-map.mjs`).

3. **Progressive-Disclosure Skills (`.agents/skills/<name>/SKILL.md` — Loaded On Demand):**
   - Only each skill's `name` and `description` YAML frontmatter are injected into the agent's initial context. Full procedural runbooks, helper scripts (`scripts/`), and deep references (`references/`) load **only** when activated for a relevant task:
     - [`skills/code-infra/SKILL.md`](./skills/code-infra/SKILL.md) — 3-minute codebase reading order, end-to-end architecture flows (`references/architecture.md`), live export inventory (`references/file-inventory.md`), and `scripts/update-map.mjs`.
     - [`skills/dv-regression/SKILL.md`](./skills/dv-regression/SKILL.md) — Runbook for the 628-list DV regression suite, `S1`–`S10` scoreboard, generalization splits, coverage closure, failure triage, and `waivers.json`.
     - [`skills/price-pipeline-ops/SKILL.md`](./skills/price-pipeline-ops/SKILL.md) — Runbook for Israeli Price Transparency feeds (`Stores`, `PriceFull`, `PromoFull`), `.gz` vs. disguised ZIP decoding, `UTF-16LE`/`Windows-1255`, `StoreType=2` online stores, `gh-pages` publishing, and onboarding new chains (Victory, Yochananof).
     - [`skills/release-and-deploy/SKILL.md`](./skills/release-and-deploy/SKILL.md) — Step-by-step release runbook (`?v=N` bump, `shufersal-extension.zip`, git hygiene, Vercel production deploy, and commercial SaaS migration checklist).

---

## 2. Legacy `gemini/` Compatibility

Earlier versions stored agent docs under `gemini/`. Because `gemini/` is **not** an auto-discovered customization root, all canonical rules and skills now live in `/AGENTS.md` and `/.agents/`. Thin compatibility pointers remain in `gemini/` (and `node gemini/skills/code-infra/scripts/update-map.mjs` delegates directly to `.agents/skills/code-infra/scripts/update-map.mjs`) so existing links and muscle memory continue to work with zero content drift.
