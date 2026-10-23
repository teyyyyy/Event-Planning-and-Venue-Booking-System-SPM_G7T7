# Collaboration and AI Guardrails

This repository is developed collaboratively by people and AI assistants. AI
assists with analysis, implementation, testing, and documentation; humans own
requirements, priorities, approvals, and decisions with significant impact.

## Required workflow for every prompt

Before making a change, an AI collaborator must:

1. Explain its understanding of the request.
2. Propose a concise plan and identify important assumptions or choices.
3. Ask the user to confirm or adjust the plan when the choice could materially
   change the result or affect external, production, database, or irreversible
   state.

After the agreed work, the AI must report what changed, which files changed,
what validation was run, and any unresolved risks or assumptions.

The AI must not silently replace a human decision with its own preference.

## Change rules

- Keep changes scoped to the request; avoid unrelated refactoring.
- Inspect existing code, tests, and documentation before changing behavior.
- Change behavior and its tests in the same change.
- Do not weaken tests, coverage thresholds, lint rules, or security checks.
- Never commit secrets, credentials, service-role keys, `.env` files, or real
  user data.
- Do not use client-supplied roles, permissions, or identities as a source of
  truth for protected operations.
- Treat frontend visibility as usability, not as a security boundary.
- Database schema or data changes require a migration, impact assessment, and
  rollback consideration.

## Human approval required

Pause for explicit human approval before destructive or difficult-to-reverse
actions, including production changes, data deletion, credential rotation,
deployment, broad dependency upgrades, rewriting Git history, or changing CI
security controls.

## Validation

Run `scripts/test-all.sh` for code or test changes. Run
`scripts/check-guardrails.sh` when changing repository policy, configuration,
CI, scripts, authentication, or database files.

Instructions guide collaborators; automated checks enforce the rules.
