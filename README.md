# ClickUp Analytics

Internal analytics and integration tooling for POP Creations' ClickUp workspace.

This repository owns:

- the nightly ClickUp workspace snapshot;
- Cloudflare D1 loading and schema maintenance;
- product and status-transition reporting scripts; and
- the Cloudflare Worker that receives ClickUp webhooks and exposes the protected query interface.

It does not own an application database or any shared Supabase schema. Shared
database work belongs exclusively in [`u2giants/shared-db`](https://github.com/u2giants/shared-db).

## Operations

- `ClickUp Workspace Snapshot` runs daily at 02:00 UTC.
- `Refresh Products Table` runs daily at 06:00 UTC.
- Worker changes under `integrations/worker/` deploy through GitHub Actions.
- Credentials stay in GitHub Actions secrets or 1Password vault `vibe_coding`;
  never commit secret values.

See [`scripts/README.md`](scripts/README.md) and
[`integrations/worker/README.md`](integrations/worker/README.md) for reproduction
and deployment details.
