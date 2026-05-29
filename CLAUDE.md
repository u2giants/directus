# CLAUDE.md — Claude Code specific additions

**Read AGENTS.md first.** This file only covers things specific to Claude Code sessions.

---

## MCP tools available

### Cloudflare MCP
Tool prefix: `mcp__claude_ai_Cloudflare_Developer_Platform__`

Key IDs:
- D1 database: `c37aeb36-e16e-416b-b699-c910f6f8dc10` (clickup-events)
- Worker: `plane-integrations` (plane-integrations.u2giants.workers.dev)

```
d1_database_query  database_id=c37aeb36-e16e-416b-b699-c910f6f8dc10  sql=SELECT ...
workers_list
r2_buckets_list
```

### Coolify API (via Bash/curl)
```bash
curl -s "http://178.156.180.212:8000/api/v1/applications" \
  -H "Authorization: Bearer 1|mlVx9mbwsN1Sga6eLtJEvmPioy6Sra9AnepnCe3K7d0a2927"
```
Server UUID: `onwp0kd7w1w74w9yeotnoihp`

### GitHub CLI
Authenticated as `u2giants`. Repo: `u2giants/plane`.
```bash
gh workflow run deploy-worker.yml --repo u2giants/plane
gh run list --repo u2giants/plane --limit 5
gh secret set SECRET_NAME --repo u2giants/plane --body "value"
```

### Browser automation
- Chrome MCP (`mcp__Claude_in_Chrome__*`) — use for authenticated sessions (has user cookies)
- Playwright (`mcp__playwright__*`) — use for headless/programmatic flows

---

## Memory files

`/home/ai/.claude/projects/-worksp-plane/memory/`

Write new memories there as decisions are made.

---

## Interview system

URL format: `https://plane-integrations.u2giants.workers.dev/interview?who=[name]`

---

## What NOT to build yet

Do NOT start building design inventory, custom Plane features, or infrastructure migration until:
1. Jen's interview is complete
2. A full system design has been written and approved

Current phase is discovery/planning. Plane is deployed but not yet customized.

---

## Commit style

- Short imperative subject line (`add`, `fix`, `update`, `remove`)
- No period at end of subject
- Body optional; use for non-obvious rationale only

---

## Allowed operations

- Read/query D1, Workers, R2 freely
- Run GitHub workflows and check run status
- Query Coolify API for app status
- Browser automation for research or verification
- Commit and push on `main` (no force push)
