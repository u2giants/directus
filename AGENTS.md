# AGENTS.md — ClickUp analytics

This repository contains ClickUp snapshot, Cloudflare D1, reporting, and webhook
worker tooling. It is not an application-database repository.

## Rules

1. GitHub is the source of truth. Commit to `main`; GitHub Actions owns scheduled
   jobs and Worker deployments.
2. Do not create or alter shared Supabase schema here. Route every shared schema,
   migration, RPC, trigger, RLS, seed, or cross-app data-contract change through
   `u2giants/shared-db` first.
3. Store credentials in GitHub Actions secrets or 1Password vault `vibe_coding`.
   Never commit values, `.env` files, access tokens, or database passwords.
4. Preserve the nightly snapshot and product-refresh schedules unless Albert
   explicitly approves an operational change.
5. Validate Python and Worker changes before pushing, then verify the relevant
   GitHub Actions run.
6. Do not add retired application-platform code or infrastructure to this repo.
