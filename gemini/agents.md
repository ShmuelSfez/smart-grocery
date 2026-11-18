# SmartCart (העגלה החכמה) — Legacy Agent Guide Pointer

> **Moved to Auto-Discovered Root & `.agents/`:**  
> To support automatic hierarchical discovery across **Antigravity, Codex, Claude Code, and Cursor** without duplicate maintenance, SmartCart's authoritative agent rules and skills now live at the repository root:

- **Master Engineering & Honesty Contract:** [../AGENTS.md](../AGENTS.md)
- **Scoped Frontend Rules (`web/`):** [../web/AGENTS.md](../web/AGENTS.md)
- **Scoped DV Testbench Rules (`tests/regression/`):** [../tests/regression/AGENTS.md](../tests/regression/AGENTS.md)
- **Pre-Commit Signoff Gate:** [../.agents/rules/verification-signoff.md](../.agents/rules/verification-signoff.md)
- **Agent Infrastructure Overview:** [../.agents/README.md](../.agents/README.md)
- **Workspace Skills (`.agents/skills/`):**
  - [`code-infra`](../.agents/skills/code-infra/SKILL.md) — Codebase reading order, architecture flows & live file inventory
  - [`dv-regression`](../.agents/skills/dv-regression/SKILL.md) — 628-list DV regression suite, `S1`–`S10` triage & waivers
  - [`price-pipeline-ops`](../.agents/skills/price-pipeline-ops/SKILL.md) — Price Transparency XML feeds, `gh-pages` & new-chain onboarding
  - [`release-and-deploy`](../.agents/skills/release-and-deploy/SKILL.md) — Pre-release checks, `?v=N`, extension zip, Vercel & SaaS checklist

Always read and edit the canonical files above rather than duplicating rules under `gemini/`.
