# Seshat — structural code intelligence for AI agents

**Your agent reconstructs your codebase from likelihood. Seshat compiles it.**

Seshat turns a repository into a typed symbol graph (every function, class, route, and
table, with its *real* dependency edges, data flow, and constraints) and serves it to your
agent over MCP. So before your agent edits a function, it can ask what will actually break
instead of guessing.

Backed by a compiled intermediate representation, not text search or embeddings: if Seshat
says a function has three callers, it has exactly three.

## Why

AI coding agents are fast but structurally blind. When an agent changes one function, it
often cannot see everything that depends on it, so it silently breaks callers it never
looked at. A large share of AI-introduced regressions come from exactly this. Seshat gives
the agent the map.

## Try it first (no install, no login)

Paste any public repo at **https://seshat.papyruslabs.ai/try** and watch it trace what a
change would break.

## Install

```
npx -y @papyruslabsai/seshat-mcp setup <your-key>
```

Get a free key at **https://seshat.papyruslabs.ai** (first extraction is free). The setup
command writes your MCP config and stores the key.

Or configure manually (Claude Code, Cursor, or any MCP client):

```json
{
  "mcpServers": {
    "seshat": {
      "command": "npx",
      "args": ["-y", "@papyruslabsai/seshat-mcp"],
      "env": { "SESHAT_API_KEY": "your-key" }
    }
  }
}
```

## Tools

Point your agent at a repo with `sync_project`, then it investigates the way a senior
engineer does: orient, trace, verify.

**Orient**
- `list_projects` — what is synced
- `list_modules` — how the codebase is organized, by layer or module
- `query_entities` — find functions, classes, and routes by name, layer, or module
- `find_entry_points` — routes, exports, and the public API surface

**Investigate a symbol**
- `get_entity` — signature, callers, callees, data flow, side effects, and tables touched
- `get_dependencies` — the real call chain, callers and callees
- `get_blast_radius` — everything that breaks if you change it, transitively
- `get_data_flow` — what a function reads, returns, and mutates
- `get_optimal_context` — the minimal, ranked set of files to read before editing
- `find_by_constraint` — every function that touches a given table (or carries a given trait)
- `find_dead_code` — unreachable symbols, safe to delete

**Check the calls themselves** (JavaScript, TypeScript and Python)
- `query_call_sites` — calls by their state: async calls never awaited (floating promises,
  promises tested as conditions), calls whose failure escapes the caller (no `try` or
  `.catch` around that call), and results computed and dropped. Checked per call, not per
  function. `get_entity` and `get_dependencies` show the same state on each call.

**Read the history** (from the repo's commit record, backfilled on first sync)
- `get_lineage` — how one function has actually changed: each commit typed by what moved
  (body, calls, data, signature), CI pass/fail and reverts, what changes alongside it, and
  what last forced a change here. Ask it before touching anything load-bearing.
- `get_hotspots` — where development happens and where it fails: the most-changed code,
  thrash spots where changes keep getting reverted or landing on red CI, and heavily used
  code nobody has touched (stability pressure)
- `get_co_change_clusters` — the hidden modules: code that changes together across files
  even when no import connects it, so a change to one member usually means the rest

Every answer comes from the compiled graph and discloses the coverage behind it. History
is commit-resolution correlation and says so; it never claims causation it can't show.

> Cross-cutting audit tools (test coverage, topology, semantic clones) are being hardened
> and will be added to this list as they land.

## Privacy

Analysis runs in the Papyrus Labs cloud, by design: the compiled graph is the product's
moat, and keeping extraction server-side is how that stays protected. Public repos are
cloned from GitHub; private repos require you to connect your GitHub account. Source is
processed to build the graph and cached to serve queries. See the privacy policy at
seshat.papyruslabs.ai.

## Pricing

First extraction is free. $0.03 per query after a free tier; a typical investigation is 5
to 15 queries. Details at https://seshat.papyruslabs.ai.

MIT licensed server. Named for the goddess who kept the records, built so your agent can
read them.
