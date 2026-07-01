#!/usr/bin/env node

/**
 * @papyruslabs/seshat-mcp — Structural Code Analysis MCP Server (Cloud Proxy)
 *
 * Declares the Seshat tool suite to Claude/AI clients. All tool calls are
 * proxied to the Ptah Cloud API. Tool descriptions are written as triggers —
 * they tell the LLM *when* to reach for each tool, not just what it does.
 */

import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ─── Setup Command ───────────────────────────────────────────────
// `npx @papyruslabsai/seshat-mcp setup YOUR_API_KEY` writes the
// correct MCP config into ~/.claude.json, handling the Windows
// npx vs npx.cmd difference automatically.

import fs from 'fs';
import os from 'os';

if (process.argv[2] === 'setup') {
  const apiKey = process.argv[3];
  if (!apiKey) {
    console.error('Usage: npx @papyruslabsai/seshat-mcp setup YOUR_API_KEY');
    console.error('Get your free key at https://seshat.papyruslabs.ai');
    process.exit(1);
  }

  const configPath = path.join(os.homedir(), '.claude.json');
  const isWindows = process.platform === 'win32';
  const npxCommand = isWindows ? 'npx.cmd' : 'npx';

  const mcpEntry = {
    command: npxCommand,
    args: ['-y', '@papyruslabsai/seshat-mcp'],
    env: { SESHAT_API_KEY: apiKey },
  };

  let config: Record<string, any> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh
  }

  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    config.mcpServers = {};
  }
  config.mcpServers.seshat = mcpEntry;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  // Also persist API key to ~/.seshat/config.json so it's available even when
  // a project-level .mcp.json overrides the user-level config without an env block.
  const seshatDir = path.join(os.homedir(), '.seshat');
  if (!fs.existsSync(seshatDir)) fs.mkdirSync(seshatDir, { recursive: true });
  fs.writeFileSync(
    path.join(seshatDir, 'config.json'),
    JSON.stringify({ apiKey }, null, 2) + '\n',
    'utf-8',
  );

  console.log(`Seshat MCP configured in ${configPath}`);
  console.log(`API key persisted to ${path.join(seshatDir, 'config.json')}`);
  console.log(`  command: ${npxCommand}`);
  console.log(`  api key: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`);
  console.log('');
  console.log('Restart Claude Code to connect.');
  process.exit(0);
}

// ─── Server Instructions ─────────────────────────────────────────
// Sent to the LLM at connection time. This is the "first contact" pitch.

const SERVER_INSTRUCTIONS = `Seshat provides structural code analysis backed by a compiled intermediate representation — not heuristic guesses or text search. Every function, class, and route in the synced codebase has been extracted into a typed symbol graph with dependency edges, data flow, constraints, and architectural layer tags. Results are precise and complete — if Seshat says a function has 3 callers, it has exactly 3 callers.

HOW TO USE SESHAT — Seshat tools are designed for iterative exploration, not one-shot lookups. A single tool call answers a single structural question. Understanding a system requires several calls that build on each other — the same way a senior developer investigates code before changing it.

A typical investigation:
1. query_entities or list_modules → orient yourself in the codebase
2. get_entity → deep-dive the function you care about
3. get_blast_radius → discover what's connected and what could break
4. get_dependencies or get_data_flow → trace specific edges
5. get_optimal_context → decide what source to read before making changes
6. Repeat steps 2-5 on newly discovered symbols until you have a complete picture

Each call reveals structure that informs the next. The goal is understanding, not minimum calls. 5-15 queries per investigation is normal and expected.

All tools are read-only and safe to call at any time.

GETTING STARTED — If list_projects returns empty, the current project hasn't been synced yet. Use the sync_project tool to import it:
1. Detect the git remote: run \`git remote get-url origin\` in the user's terminal
2. Call sync_project with that repo URL
3. Wait for extraction to complete (typically 5-30 seconds depending on repo size)
4. Then call list_projects again — the project will now appear
Note: For private repos, sync_project will return a GitHub authorization URL. Direct the user to open it in their browser to connect their GitHub account, then retry sync_project.

TOOL REFERENCE — Each tool maps to a structural question:

Setup & Navigation:
- "What projects are loaded?" → list_projects
- "Sync this repo to Seshat" → sync_project
- "How is the codebase organized?" → list_modules
- "What's the full API surface?" → get_topology
- "What tier am I on?" → get_account_status

Understanding Code:
- "Find functions by name or layer" → query_entities
- "Deep-dive a single function" → get_entity
- "Who calls this / what does it call?" → get_dependencies
- "What data does this read/write/mutate?" → get_data_flow
- "What should I read before modifying X?" → get_optimal_context
- "Which functions touch the DB / require auth / throw?" → find_by_constraint
- "What reads or writes the 'users' table?" → find_by_constraint(table="users")
- "Find functions that can fail, including transitively" → query_traits(trait="fallible")

Change Planning:
- "What breaks if I change this?" → get_blast_radius
- "Is there dead code I can safely delete?" → find_dead_code
- "Is there copy-pasted logic I should consolidate?" → find_semantic_clones

Security & Quality Audits:
- "Which endpoints require auth and which don't?" → get_auth_matrix
- "Where is sensitive data exposed without protection?" → find_exposure_leaks
- "Where are errors thrown but never caught?" → find_error_gaps
- "Are there architecture violations?" → find_layer_violations
- "Does framework-agnostic code import framework-specific code?" → find_runtime_violations
- "Are there memory/lifecycle/ownership issues?" → find_ownership_violations

Metrics:
- "How coupled is the codebase?" → get_coupling_metrics
- "Which functions are tested and which aren't?" → get_test_coverage

TEMPORAL ANALYSIS — Any tool accepts an optional temporal parameter: { temporal: { last_n: N } }. This runs the tool across recent snapshots and returns a trend. Requires at least 2 snapshots. Example:
  get_coupling_metrics({ project: "myapp", temporal: { last_n: 5 } })
`;

// ─── Private Tools (Ptah IP — never exposed publicly) ────────────
// These tools are reserved for the Ptah write layer. They exist in
// the codebase but are never listed, never hinted at, never mentioned.

const PRIVATE_TOOLS = new Set([
  'estimate_task_cost',
  'simulate_mutation',
  'create_symbol',
  'diff_bundle',
  'conflict_matrix',
  'query_data_targets',
  'trace_boundaries', // Hidden until response shaping is refined
]);

// ─── Shared Definitions ──────────────────────────────────────────

const projectParam = {
  type: 'string' as const,
  description: 'Project name (required in multi-project mode). Use list_projects to see available projects.',
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const READ_ONLY_OPEN = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

// ─── Tool Definitions ─────────────────────────────────────────────
// Descriptions are written as TRIGGERS: they tell the LLM when to
// reach for the tool, what it returns, and how it compares to built-in
// alternatives like grep/Read.

const TOOLS = [
  // ─── Always Visible ───────────────────────────────────────────────

  {
    name: 'get_account_status',
    title: 'Account Status',
    description: 'See your current plan, available tools, and credit balance. Call this if a tool returns a tier error or you want to know what tools are available.',
    inputSchema: { type: 'object' as const, properties: {} },
    annotations: READ_ONLY_OPEN,
  },

  // ─── Cartographer (Free Tier) ─────────────────────────────────────

  {
    name: 'list_projects',
    title: 'List Projects',
    description: 'Start here. Returns all synced codebases with their size, language, and project name. You need the project name for every other tool. If this returns empty, use sync_project to import the current repo.',
    inputSchema: { type: 'object' as const, properties: {} },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'sync_project',
    title: 'Sync Project',
    description: 'Import a public GitHub repo into Seshat for structural analysis. Call this when list_projects returns empty or when the user wants to analyze a new repo. Detects the git remote automatically if no URL is provided. Extraction typically takes 5-30 seconds. After syncing, call list_projects to confirm the project is available. Use force: true to re-extract even if a cached snapshot exists (useful after code changes or when Seshat extraction has been updated).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repo_url: { type: 'string', description: 'Public GitHub repo URL (e.g., https://github.com/org/repo). If omitted, tries to detect from the current git remote.' },
        force: { type: 'boolean', description: 'Force re-extraction even if a cached snapshot exists. Default: false.' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'query_entities',
    title: 'Query Entities',
    description: 'Like grep but for code structure. Find functions, classes, and routes by name, architectural layer (route/service/component), or module. Returns matching symbols with their type, file, and layer — use this instead of grep when you need to find code by what it does, not by text content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        query: { type: 'string', description: 'Search term — matches against symbol name, ID, source file, and module' },
        layer: { type: 'string', description: 'Filter by architectural layer: route, controller, service, repository, utility, hook, component, schema' },
        module: { type: 'string', description: 'Filter by module (partial match)' },
        language: { type: 'string', description: 'Filter by source language: javascript, typescript, python, go, rust, etc.' },
        limit: { type: 'number', description: 'Max results to return (default: 50)' },
      },
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_entity',
    title: 'Get Entity Details',
    description: 'Get everything about one function or class — its signature, callers, callees, data flow, constraints, source location, and database operations (which tables it reads/writes). Use this when you need to deeply understand a single symbol before modifying it. Returns more than reading the source file because it includes the dependency context.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        id: { type: 'string', description: 'Entity ID or name' },
      },
      required: ['id'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_dependencies',
    title: 'Get Dependencies',
    description: 'Trace who calls a function and what it calls, up to N levels deep. Use this instead of grep-for-function-name when you need the actual call chain — returns the dependency graph, not text matches. Covers callers (upstream), callees (downstream), or both.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        entity_id: { type: 'string', description: 'Entity ID or name' },
        direction: { type: 'string', enum: ['callers', 'callees', 'both'], description: 'Which direction to traverse (default: both)' },
        depth: { type: 'number', description: 'How many levels deep to traverse (default: 2)' },
      },
      required: ['entity_id'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_data_flow',
    title: 'Get Data Flow',
    description: 'See what data a function reads, returns, and mutates (DB writes, state changes). Use this when debugging data bugs or when you need to verify whether a function has side effects before refactoring it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        entity_id: { type: 'string', description: 'Entity ID or name' },
      },
      required: ['entity_id'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'find_by_constraint',
    title: 'Find by Constraint',
    description: 'Find every function with a specific syntactic constraint tag — AUTH (requires authentication), DB_ACCESS (touches database), THROWS (explicit throw statement), PURE (no side effects), NETWORK_IO (makes HTTP calls), VALIDATED (has input validation). Also supports table-level queries: pass table="walks" to find every function that reads or writes the walks table (answers "what touches this table?" for schema migrations). Constraints are extracted from source syntax, not inferred. For semantic/behavioral properties (e.g., "can fail transitively"), use query_traits instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        constraint: { type: 'string', description: 'Constraint tag to search for: AUTH, VALIDATED, PURE, THROWS, DB_ACCESS, NETWORK_IO, IMP, etc.' },
        table: { type: 'string', description: 'Optional: filter to functions that touch a specific database table (e.g., "walks", "users"). Returns structured db_operations showing read/write/mutate per function.' },
      },
      required: ['constraint'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_blast_radius',
    title: 'Get Blast Radius',
    description: 'Before modifying a function, call this to see everything that could break. Returns all transitively affected symbols — both upstream callers and downstream callees — with distance from the change point. Like git log --follow but for runtime impact. Designed for repeated use: as you discover new symbols with other tools, call this again on them to expand your understanding of the affected surface.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        entity_ids: { type: 'array', items: { type: 'string' }, description: 'Array of entity IDs or names to compute blast radius for' },
      },
      required: ['entity_ids'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_lineage',
    title: 'Get Lineage',
    description: 'The change history of one symbol, typed by what kind of change each commit made (body, calls, data, signature, constraints…), with CI verdicts, reverts, rename tracking, co-change partners, and rejected PRs that touched it. Call before modifying anything load-bearing: it answers "how does this entity usually change, and what happened last time someone tried?" — which no text diff can. Complements get_blast_radius (current impact) with history (past behavior).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        entity_id: { type: 'string', description: 'Entity ID or name to fetch change history for' },
      },
      required: ['entity_id'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_hotspots',
    title: 'Get Hotspots',
    description: 'Project-level change-history orientation: the most-changed entities (and what kind of change dominates each), low-survival thrash spots where changes don\'t stick, heavily-depended-on entities that haven\'t changed all window (interface freeze), and directories with no recent changes. Call it after list_modules when orienting in a codebase — it answers "where does development actually happen, and where does it fail?" from commit history rather than current structure. Complements get_lineage (one entity\'s story) with the project-wide map.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
      },
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_co_change_clusters',
    title: 'Get Co-Change Clusters',
    description: 'The codebase\'s hidden modules: groups of symbols that historically change together (≥3 shared commits, sweep commits excluded), computed from real commit history. Clusters that span multiple directories reveal coupling the file tree doesn\'t show. Call it when planning a change or splitting work across agents — touching one member of a cluster usually means touching the rest, even when no static dependency connects them. Correlation evidence, honestly framed; complements get_blast_radius (static reach) with empirical reach.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
      },
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'list_modules',
    title: 'List Modules',
    description: 'Get a bird\'s-eye view of how the codebase is organized. Groups all symbols by architectural layer (route/service/component), module, file, or language with counts. Use this to orient yourself in an unfamiliar codebase before diving into specifics.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        group_by: { type: 'string', enum: ['layer', 'module', 'file', 'language'], description: 'How to group entities (default: layer)' },
      },
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_topology',
    title: 'Get Topology',
    description: 'Get the full API surface map in one call — all routes, middleware, auth patterns, and database tables. Use this when you need to understand the overall architecture without reading every file. Returns the information you\'d normally piece together from dozens of file reads.',
    inputSchema: {
      type: 'object' as const,
      properties: { project: projectParam },
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_optimal_context',
    title: 'Get Optimal Context',
    description: 'Before working on a function, call this to get the most relevant related code ranked by importance and fitted to a token budget. Returns a prioritized reading list of symbols you should understand — better than guessing which files to open. Designed for iterative use: call it on your target, read the top results, then call it again on any surprising dependencies to build a complete picture.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        target_entity: { type: 'string', description: 'Entity ID or name to build context around' },
        max_tokens: { type: 'number', description: 'Token budget for the context window (default: 8000)' },
        strategy: { type: 'string', enum: ['bfs', 'blast_radius'], description: 'Traversal strategy: bfs (faster, local neighborhood) or blast_radius (full affected set)' },
      },
      required: ['target_entity'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'find_entry_points',
    title: 'Find Entry Points',
    description: 'List the ways into the system: route/controller handlers, test entries, framework plugin registrations, and exported symbols (the public API surface), classified by kind and ranked by reach. Call it first when orienting in an unfamiliar codebase — it answers "where does execution start, and what is the public surface?" Complements list_modules (structure) and find_dead_code (its exact inverse: these are the reachability roots).',
    inputSchema: {
      type: 'object' as const,
      properties: { project: projectParam },
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'trace_data_path',
    title: 'Trace Data Path',
    description: 'Follow data from one function through the call graph to its sinks. From a start entity it walks callees, records the data each hop consumes/produces/mutates, and reports the chain from the start to every sink the data reaches — database writes, network egress, filesystem writes — plus the tables touched. Call it before changing a function that handles real data: it answers "where does this data end up?", the cross-call composition get_data_flow (one entity) cannot give. Flags untrusted inputs at the source.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        entity_id: { type: 'string', description: 'Entity ID or name to trace data flow from' },
        max_depth: { type: 'number', description: 'How many call hops to follow downstream (default: 5, max: 8)' },
      },
      required: ['entity_id'],
    },
    annotations: READ_ONLY_OPEN,
  },

  // ─── Analyst Tools (Tier 2) ───────────────────────────────────────

  {
    name: 'find_dead_code',
    title: 'Find Dead Code',
    description: 'Find functions that nothing calls. Walks the call graph from all entry points (routes, exports, tests) and flags symbols that are unreachable. Use this during cleanup or before a release to find safe deletion candidates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        include_tests: { type: 'boolean', description: 'Include test entities in dead code results (default: false)' },
      },
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'find_layer_violations',
    title: 'Find Layer Violations',
    description: 'Find places where the architecture is broken — a database repository calling a route handler, a utility importing a component. Returns every backward or skip-layer dependency that violates clean architecture.',
    inputSchema: {
      type: 'object' as const,
      properties: { project: projectParam },
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_coupling_metrics',
    title: 'Get Coupling Metrics',
    description: 'Measure how tangled your code is. Returns coupling (cross-boundary dependencies), cohesion (within-group dependencies), and instability scores. High coupling + low cohesion = refactoring candidates. Start with group_by: "layer" for the architectural health view ("are my controllers more coupled than my services?"), then drill into group_by: "module" for specific hotspots.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        group_by: { type: 'string', enum: ['module', 'layer'], description: 'Group entities by module or layer (default: module)' },
      },
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_auth_matrix',
    title: 'Get Auth Matrix',
    description: 'Audit authentication coverage. Shows which API routes and controllers require auth and which don\'t, plus inconsistencies like database access without auth checks. For large codebases, use the module parameter to drill into a specific module/directory. Most useful for backend codebases with middleware-based auth. Frontend frameworks (React, Vue) handle auth via component wrappers, which this tool won\'t detect as AUTH constraints.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        module: { type: 'string' as const, description: 'Filter to routes/controllers in a specific module or directory path (optional).' },
        layer: { type: 'string' as const, description: 'Filter to a specific layer: "route" or "controller" (optional).' },
      },
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'find_error_gaps',
    title: 'Find Error Gaps',
    description: 'Find crash risks: functions that throw or have network/DB side effects whose callers don\'t catch errors. Returns the specific caller→callee pairs where exceptions can propagate unhandled. Use this before shipping to find missing error handling.',
    inputSchema: {
      type: 'object' as const,
      properties: { project: projectParam },
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'get_test_coverage',
    title: 'Get Test Coverage',
    description: 'See which production functions are actually exercised by tests via the call graph — semantic coverage, not line coverage. Optionally ranks uncovered functions by blast radius so you know which missing tests are riskiest.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        weight_by_blast_radius: { type: 'boolean', description: 'Rank uncovered entities by blast radius to prioritize testing (default: false, slower)' },
      },
    },
    annotations: READ_ONLY_OPEN,
  },
  // find_runtime_violations RETIRED 2026-06-12 (BUILD-LIST B1): built against
  // the v1 runtime-tagging model; the server now answers it with an honest
  // retirement notice for old clients. Discipline-aware rebuild planned.
  {
    name: 'find_ownership_violations',
    title: 'Find Ownership Violations',
    description: 'Find memory and lifecycle issues — entities with complex ownership, unsafe blocks, escaping references, or illegal mutability on borrowed data. Returns 0 for most JS/Python codebases — a non-zero result in those languages indicates a serious boundary violation worth investigating. Most detailed results for Rust and C++.',
    inputSchema: { type: 'object' as const, properties: { project: projectParam } },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'query_traits',
    title: 'Query Traits',
    description: 'Find functions by inferred behavioral trait — "fallible" (can fail, including transitively via callees that throw), "asyncContext" (carries async state), "generator" (yields values). Traits are semantic properties inferred from the call graph, not just syntax. Use this when you need to find all code with a specific capability. For syntactic tags (explicit throw statements, DB access), use find_by_constraint instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        trait: { type: 'string', description: 'The trait or capability to search for (e.g., "fallible", "asyncContext")' },
      },
      required: ['trait'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'find_exposure_leaks',
    title: 'Find Exposure Leaks',
    description: 'Find places where public/API code directly accesses private internals, bypassing the intended abstraction boundary. Use this during API design reviews or before extracting a module.',
    inputSchema: { type: 'object' as const, properties: { project: projectParam } },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'find_semantic_clones',
    title: 'Find Semantic Clones',
    description: 'Find duplicated logic across the codebase. Normalizes variable names and compares code structure to catch identical algorithms in different files — even across different languages. Use this before a DRY refactor.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        min_complexity: { type: 'number', description: 'Minimum logic expressions to count as a match (default: 5)' },
      },
    },
    annotations: READ_ONLY_OPEN,
  },

  // ─── Architect Tools (Tier 3) ─────────────────────────────────────

  {
    name: 'estimate_task_cost',
    title: 'Estimate Task Cost',
    description: 'Before starting a code change, estimate how many tokens it will consume. Computes the blast radius, sums source tokens across all affected symbols, and projects total burn including iteration cycles. Use this to check if a task fits your context budget before committing to it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        target_entities: { type: 'array', items: { type: 'string' }, description: 'Entity IDs or names that will be modified' },
        context_budget: { type: 'number', description: 'LLM context window token budget (default: 200000)' },
      },
      required: ['target_entities'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'simulate_mutation',
    title: 'Simulate Mutation',
    description: 'Simulate a hypothetical code change without writing anything. Five mutation dimensions: constraints/traits (behavioral tags — who upstream breaks), edges (add/remove calls — orphaned callees, inherited error handling and data contracts), data (add/remove table access — which co-tenants of the table must be reviewed), signature (param changes — which call sites break). Use this to plan a change before making it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        entity_id: { type: 'string', description: 'The target entity to analyze.' },
        mutation: {
          type: 'object',
          description: 'The hypothetical change to apply.',
          properties: {
            dimension: { type: 'string', enum: ['constraints', 'traits', 'edges', 'data', 'signature'], description: 'The attribute scope to mutate.' },
            change: {
              type: 'object',
              properties: {
                add: { type: 'array', items: { type: 'string' }, description: 'constraints/traits: tags to add (e.g. "fallible", "auth")' },
                remove: { type: 'array', items: { type: 'string' }, description: 'constraints/traits: tags to remove' },
                add_calls: { type: 'array', items: { type: 'string' }, description: 'edges: callees the target would start calling' },
                remove_calls: { type: 'array', items: { type: 'string' }, description: 'edges: callees the target would stop calling' },
                add_tables: { type: 'array', items: { type: 'object', properties: { table: { type: 'string' }, operation: { type: 'string' } } }, description: 'data: tables the target would start touching' },
                remove_tables: { type: 'array', items: { type: 'string' }, description: 'data: tables the target would stop touching' },
                params: { type: 'object', properties: { add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } }, description: 'signature: parameter changes' },
              },
            },
          },
          required: ['dimension', 'change'],
        },
      },
      required: ['entity_id', 'mutation'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'create_symbol',
    title: 'Create Symbol',
    description: 'Register a planned new symbol in the graph before it exists on disk. This lets simulate_mutation and conflict_matrix reason about code you haven\'t written yet. Nothing is written to disk.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        id: { type: 'string', description: 'The unique ID or name for the new symbol.' },
        source_file: { type: 'string', description: 'The relative path to the file where this symbol will be created.' },
        layer: { type: 'string', description: 'The architectural layer (e.g., "service", "route", "component").' },
        description: { type: 'string', description: 'Brief description of the symbol\'s purpose.' },
      },
      required: ['id', 'source_file'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'diff_bundle',
    title: 'Diff Bundle',
    description: 'Compare a worktree against the loaded project to see what changed structurally — not a line diff, but which symbols were added, removed, or had their signatures/dependencies changed. Use this after making changes to verify the structural impact.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        worktree_path: { type: 'string', description: 'Absolute path to the worktree or branch checkout to compare' },
        include_unchanged: { type: 'boolean', description: 'Include unchanged entities in the output (default: false)' },
      },
      required: ['worktree_path'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'conflict_matrix',
    title: 'Conflict Matrix',
    description: 'Given multiple planned tasks, check which ones can run in parallel safely. Classifies every task pair: Tier 1 (different files, safe), Tier 2 (same file different symbols, careful), Tier 3 (same symbol, must sequence). Returns a matrix and suggested execution order.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique task identifier (e.g. "add-dark-mode")' },
              entity_ids: { type: 'array', items: { type: 'string' }, description: 'Symbol names or IDs that this task will modify' },
              dimensions: { type: 'array', items: { type: 'string' }, description: 'Optional: Code scopes this task will modify.' },
              expand_blast_radius: { type: 'boolean', description: 'Include transitively affected symbols in the conflict check (default: false)' },
            },
            required: ['id', 'entity_ids'],
          },
          description: 'Array of tasks to check for conflicts.',
        },
      },
      required: ['tasks'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'trace_boundaries',
    title: 'Trace Boundaries',
    description: 'Identify the boundary surface of one or two codebases — entities that face outward (expose an API, accept network input, make network calls). When given two projects, surfaces both boundary sets so you can trace the handshake between a backend and frontend, detect orphaned routes with no consumer, or find frontend calls with no matching backend handler. Works across any language — boundaries are detected from coordinates (exposure, layer, side effects, data sources), not framework-specific patterns.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_a: { type: 'string', description: 'First project name (e.g., the backend). Required.' },
        project_b: { type: 'string', description: 'Second project name (e.g., the frontend). Optional — if omitted, shows only project_a\'s boundary surface.' },
      },
      required: ['project_a'],
    },
    annotations: READ_ONLY_OPEN,
  },
  {
    name: 'query_data_targets',
    title: 'Query Data Targets',
    description: 'Find every function that reads from or writes to a specific database table, state object, or data source. Use this when you need to understand all the code paths that touch a particular data store.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: projectParam,
        target_name: { type: 'string', description: 'The name of the database table, state object, or data source (e.g., "users", "auth_token").' },
      },
      required: ['target_name'],
    },
    annotations: READ_ONLY_OPEN,
  },
];

// ─── _meta Steering Hints ────────────────────────────────────────
// After each tool call, suggest the next logical tool based on what
// the agent has been doing. This replaces progressive revelation —
// all tools are visible, but hints guide the agent toward the right
// tool at the right time.

// ─── Project Resolution (Fallback) ────────────────────────────────

// Cache for the last project used — so tools auto-scope after list_projects
let _lastKnownProject: string | undefined;

function resolveProjectName(): string | undefined {
  // If SESHAT_PROJECTS is set to a single name, use it
  if (process.env.SESHAT_PROJECTS && !process.env.SESHAT_PROJECTS.includes(',') && !process.env.SESHAT_PROJECTS.includes('*')) {
     return path.basename(process.env.SESHAT_PROJECTS);
  }
  // If we've seen a project from list_projects or sync_project, use that
  if (_lastKnownProject) return _lastKnownProject;
  // No project could be resolved — caller should use list_projects or sync_project
  return undefined;
}

// ─── Cloud API helper ─────────────────────────────────────────────

function getCloudUrl(path: string): string {
  const base = process.env.PTAH_CLOUD_URL || 'https://api.papyruslabs.ai';
  // If PTAH_CLOUD_URL includes a full path (legacy), strip it back to the base
  const baseUrl = base.replace(/\/api\/mcp\/execute\/?$/, '');
  return `${baseUrl}${path}`;
}

// ─── Server Setup ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const server = new Server(
    {
      name: 'seshat',
      version: '0.20.0',
    },
    {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    }
  );



  // ─── ListTools — all public tools, Architect tools hidden unless Pro mode ──

  const isProMode = !!process.env.SESHAT_SUPABASE_KEY;

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const visibleTools = isProMode
      ? TOOLS
      : TOOLS.filter((tool) => !PRIVATE_TOOLS.has(tool.name));
    process.stderr.write(`[Seshat${isProMode ? ' Pro' : ''}] ListTools: ${visibleTools.length} tools${isProMode ? '' : ` (${PRIVATE_TOOLS.size} private)`}\n`);
    return { tools: visibleTools };
  });

  // ─── CallTool handler ──────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    let apiKey = process.env.SESHAT_API_KEY;
    if (!apiKey) {
      // Fallback: read from ~/.seshat/config.json (written by `setup` command).
      // This covers the case where a project-level .mcp.json overrides the
      // user-level config without passing the env block.
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.seshat', 'config.json'), 'utf-8'));
        apiKey = cfg.apiKey;
      } catch {
        // file doesn't exist or isn't valid JSON
      }
    }
    if (!apiKey) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'SESHAT_API_KEY not found. Run: npx @papyruslabsai/seshat-mcp setup YOUR_API_KEY' }, null, 2) }],
        isError: true,
      };
    }

    // Block private Ptah tools from being called (unless Pro mode)
    if (!isProMode && PRIVATE_TOOLS.has(name)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2) }],
        isError: true,
      };
    }

    // ─── get_account_status ──────────────────────────────────────
    if (name === 'get_account_status') {
      try {
        const res = await fetch(getCloudUrl('/api/mcp/account'), {
          method: 'GET',
          headers: { 'x-api-key': apiKey },
        });

        if (!res.ok) {
          const errorText = await res.text();
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: `Failed to fetch account status (${res.status}): ${errorText}` }, null, 2) }],
            isError: true,
          };
        }

        const account = await res.json();

        // List available tools (all tools in Pro mode, public only otherwise)
        const publicTools = TOOLS
          .filter(t => isProMode || !PRIVATE_TOOLS.has(t.name))
          .map(t => t.name);

        const response: any = {
          status: 'active',
          tools_available: publicTools.length,
          your_tools: publicTools,
          dashboard: 'https://seshat.papyruslabs.ai/dashboard',
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Account status check failed: ${(err as Error).message}` }, null, 2) }],
          isError: true,
        };
      }
    }

    // ─── sync_project ──────────────────────────────────────────
    if (name === 'sync_project') {
      let repoUrl = (args as any)?.repo_url;

      // If no URL provided, try to detect git remote
      let headSha: string | undefined;
      if (!repoUrl) {
        try {
          const { execSync } = await import('child_process');
          const remote = execSync('git remote get-url origin', { timeout: 5000 }).toString().trim();
          // Normalize SSH URLs to HTTPS
          const sshMatch = remote.match(/^git@github\.com:(.+)\.git$/);
          repoUrl = sshMatch ? `https://github.com/${sshMatch[1]}` : remote.replace(/\.git$/, '');
          // Capture current HEAD SHA for cache comparison
          try {
            headSha = execSync('git rev-parse HEAD', { timeout: 5000 }).toString().trim().slice(0, 12);
          } catch { /* shallow clone or no commits */ }
        } catch {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              error: 'No repo_url provided and could not detect git remote. Please provide the GitHub repo URL.',
              hint: 'Example: sync_project({ repo_url: "https://github.com/org/repo" })',
            }, null, 2) }],
            isError: true,
          };
        }
      }

      try {
        const res = await fetch(getCloudUrl('/api/extract/create'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({ repo_url: repoUrl, force: (args as any)?.force === true, head_sha: headSha }),
        });

        if (!res.ok) {
          const errorText = await res.text();
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: `Sync failed (${res.status}): ${errorText}` }, null, 2) }],
            isError: true,
          };
        }

        const result = await res.json();

        // If private repo needs GitHub auth
        if (result.status === 'github_auth_required') {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              status: 'github_auth_required',
              message: `This repository is private and requires GitHub authentication.\n\nTo connect your GitHub account, open this URL in your browser:\n\n${result.auth_url}\n\nAfter authorizing, try sync_project again.`,
              auth_url: result.auth_url,
            }, null, 2) }],
            isError: true,
          };
        }

        // If already ready, return immediately
        if (result.status === 'ready') {
          _lastKnownProject = result.repo_name;
          return {
            content: [{ type: 'text', text: JSON.stringify({
              status: 'ready',
              project: result.repo_name,
              total_entities: result.total_entities,
              language: result.language,
              message: 'Project synced and ready. You can now use all Seshat tools with this project.',
              cached: result.cached || false,
            }, null, 2) }],
          };
        }

        // If queued/extracting, poll until complete
        if (result.status === 'queued' || result.status === 'extracting') {
          const pollUrl = getCloudUrl(`/api/extract/status/${result.repo_name}`);
          const maxAttempts = 60; // 5 minutes max
          for (let i = 0; i < maxAttempts; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
              const pollRes = await fetch(pollUrl, { headers: { 'x-api-key': apiKey } });
              if (pollRes.ok) {
                const pollResult = await pollRes.json();
                if (pollResult.status === 'ready') {
                  _lastKnownProject = pollResult.repo_name;
                  return {
                    content: [{ type: 'text', text: JSON.stringify({
                      status: 'ready',
                      project: pollResult.repo_name,
                      total_entities: pollResult.total_entities,
                      language: pollResult.language,
                      message: 'Project synced and ready. You can now use all Seshat tools with this project.',
                    }, null, 2) }],
                  };
                }
                if (pollResult.status === 'github_auth_required') {
                  return {
                    content: [{ type: 'text', text: JSON.stringify({
                      status: 'github_auth_required',
                      message: `This repository is private and requires GitHub authentication.\n\nTo connect your GitHub account, open this URL in your browser:\n\n${pollResult.auth_url || 'https://seshat.papyruslabs.ai/dashboard'}\n\nAfter authorizing, try sync_project again.`,
                      auth_url: pollResult.auth_url,
                    }, null, 2) }],
                    isError: true,
                  };
                }
                if (pollResult.status === 'failed') {
                  return {
                    content: [{ type: 'text', text: JSON.stringify({
                      error: `Extraction failed: ${pollResult.error || 'Unknown error'}`,
                      hint: 'The repo may be too large, private, or contain unsupported file types.',
                    }, null, 2) }],
                    isError: true,
                  };
                }
              }
            } catch { /* continue polling */ }
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({
              status: 'timeout',
              message: 'Extraction is taking longer than expected. Try calling list_projects in a minute to check if it completed.',
            }, null, 2) }],
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Sync failed: ${(err as Error).message}` }, null, 2) }],
          isError: true,
        };
      }
    }

    // Determine the project hash for this workspace
    // list_projects is unscoped — it returns ALL projects for the user
    // trace_boundaries uses project_a instead of project for its primary project
    const project_hash = name === 'list_projects'
        ? undefined
        : (args && typeof args === 'object' && 'project' in args)
            ? String((args as any).project)
            : (args && typeof args === 'object' && 'project_a' in args)
                ? String((args as any).project_a)
                : resolveProjectName();

    // If no project could be resolved and this isn't list_projects, tell the LLM how to fix it
    if (!project_hash && name !== 'list_projects') {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          error: 'No project specified. Call list_projects first to see available projects, then pass the project name as the "project" argument.',
          hint: 'If list_projects returns empty, use sync_project to import the current repo first.',
        }, null, 2) }],
        isError: true,
      };
    }

    try {
      // Proxy the tool call to the cloud
      const body: Record<string, any> = { tool: name, args };
      if (project_hash) body.project_hash = project_hash;

      const res = await fetch(getCloudUrl('/api/mcp/execute'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errorText = await res.text();
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Cloud API Error (${res.status}): ${errorText}` }, null, 2) }],
          isError: true
        };
      }

      const result = await res.json();

      // Cache the first project from list_projects so subsequent tool calls auto-scope
      if (name === 'list_projects' && result.projects && result.projects.length > 0) {
        _lastKnownProject = result.projects[0].name;
      }

      // Extract pre-formatted text (table-of-contents style) if the API provided one.
      // This is far more token-efficient than JSON for list-heavy responses.
      const textContent = result._text || null;
      if (result._text) delete result._text;

      // Separate _meta into assistant-only content so it doesn't clutter
      // the user-visible response. The LLM still sees it for context.
      // Server-side _meta now includes cross-tool recommendations.
      const meta = (result._meta && Object.keys(result._meta).length > 0) ? result._meta : null;
      if (result._meta) delete result._meta;

      // Use text format when available; fall back to compact JSON (no pretty-print)
      const primaryText = textContent || JSON.stringify(result);

      const content: Array<{ type: string; text: string; annotations?: any }> = [
        { type: 'text', text: primaryText },
      ];
      if (meta) {
        content.push({ type: 'text', text: JSON.stringify({ _meta: meta }), annotations: { audience: ['assistant'], priority: 0.2 } });
      }

      return { content };

    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Cloud proxy failed: ${(err as Error).message}` }, null, 2) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`Seshat MCP v0.16.10 connected. Structural intelligence ready.\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
