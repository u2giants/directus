# CLAUDE.md — Claude Code specific notes

**Read `AGENTS.md` first.** It is the canonical guide (architecture, identifiers, deployment, quirks, pending work). This file only adds Claude-specific access/operational notes.

## Access available to this machine
- **Coolify API:** `http://178.156.180.212:8000/api/v1`, Bearer `1|mlVx9mbwsN1Sga6eLtJEvmPioy6Sra9AnepnCe3K7d0a2927`, server UUID `onwp0kd7w1w74w9yeotnoihp`. Coolify owns runtime config (env, domains, restart) — change runtime settings there, not in the repo.
- **GitHub CLI:** authed as `u2giants`. Repo `u2giants/poppim`.
- **Cloudflare MCP** (`mcp__claude_ai_Cloudflare_Developer_Platform__*`): D1 `c37aeb36-e16e-416b-b699-c910f6f8dc10`, Workers, R2. (No DNS via MCP — use the Cloudflare API token for DNS.)
- **Azure CLI** (`az`): authenticated as `Albert@popcre.com` (tenant `1caeb1c0-…`) for Entra/SSO app registrations.
- **Directus admin API:** `https://pm.designflow.app`. Runtime secrets live in Coolify; a local copy is `/home/ai/.poppim-deploy.env` (chmod 600, never commit).
- **Sudo + Docker** on this VPS (it is the production host — do not run heavy throwaway stacks; deploy via Coolify).

## SSH / direct-server rule
SSH/direct-docker is **not** the deployment path. Deploy via Coolify. Direct DB/container access is for setup, migration, or emergency only, and must be recorded back into the repo or Coolify (see AGENTS.md §11 for the one documented Coolify-DB setup action).

## Memory
`/home/ai/.claude/projects/-worksp-poppim/memory/` (also mirrored under `-worksp-plane` for the legacy path). Write new decisions there; keep `MEMORY.md` index current.

## Commit style
Short imperative subject (`add`/`fix`/`update`/`remove`), no trailing period. Body only for non-obvious rationale. Commit + push on `main` (no force push).
