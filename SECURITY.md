# Security and Safe Collaboration

Do not commit `.env` files, Supabase service-role keys, passwords, tokens, or
real personal data. Use test doubles and environment variables.

Changes involving authentication, authorization, database schemas, secrets,
CI workflows, deployment, or production data require focused review and
validation. Keep the change small and document its impact and rollback plan.

If a secret is exposed, stop using it and rotate it through the appropriate
service. Do not publish credentials or exploit details in source files or issue
comments; inform the project owner privately.

AI collaborators must follow `AGENTS.md`, state their plan before acting, keep
humans responsible for consequential decisions, and report validation and
remaining uncertainty after acting.
