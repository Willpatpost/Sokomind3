# Sokomind Codebase Audit Tracker

Last updated: 2026-08-02

This is the active tracker for the repository architecture, correctness, performance, deployment, testing, accessibility, and maintenance audit. Update an item's status only after its acceptance checks pass.

`REMAINING-AUDIT-ITEMS.md` remains authoritative for Q8, P1, P2, and P6. It must not be deleted until every item in that file is implemented and validated. Those items are deliberately scheduled last and for a separate work session.

## Status legend

| Status | Meaning |
|---|---|
| `OPEN` | Confirmed issue; implementation has not started |
| `IN PROGRESS` | Code or tests are currently being changed |
| `FIXED` | The documented acceptance checks passed |
| `DEFERRED` | Intentionally reserved for `REMAINING-AUDIT-ITEMS.md` |
| `EXCLUDED` | Explicitly outside the requested scope |

## Project decisions and guardrails

- The only product name is **Sokomind**. Product-facing code, metadata, documentation, and tests must not use iteration-specific names.
- GitHub Pages paths and public URLs must be configurable or derived from repository metadata. They must not be hard-coded to the current repository's iteration suffix.
- Licensing and third-party puzzle provenance changes are excluded from this audit by project direction.
- Q8 solver macros/corral research and P1/P2/P6 catalog work are deferred to `REMAINING-AUDIT-ITEMS.md` and must not be implemented in this workstream.
- Do not trade away replay validity, solver determinism, accessibility, or the existing Huge benchmark counters for speed.

## Baseline

At the start of this audit:

- `npm.cmd ci` completed with zero reported vulnerabilities.
- Lint and TypeScript checks passed.
- Unit tests passed: 366/366.
- Static-build tests passed: 5/5.
- Local Chromium tests passed: 25/25.
- The current GitHub Actions deployment run passed its configured browser, accessibility, solver, build, and deployment jobs.
- Coverage was 66.89% lines, 73.91% branches, and 73.41% functions; the generated solver engine had 41.80% line coverage.
- The Huge solver returned the same 1,010 moves, 316 pushes, 1,843 visited states, and 13,844 generated states for the base, mirrored, and rotated cases.

## Progress index

| ID | Severity | Status | Item |
|---|---|---|---|
| C1 | High | `FIXED` | Malformed hashes crash routing and recovery is overly destructive |
| C2 | Medium | `FIXED` | Replay accepts actions after the solved state |
| C3 | Medium | `FIXED` | Persistence failures are silent |
| C4 | Medium | `FIXED` | Cross-tab progress writes can lose data |
| C5 | Medium | `FIXED` | Puzzle-scoped timer, hint, playback, and deadlock state can leak across routes |
| C6 | Low | `FIXED` | Imported unknown progress IDs can produce inconsistent totals |
| C7 | Low | `FIXED` | Home's next-unsolved fallback is unreachable |
| D1 | High | `FIXED` | Public URL metadata and test mount paths are not portable |
| D2 | High | `FIXED` | A navigation 404 can overwrite the cached application shell |
| D3 | Medium | `FIXED` | Service-worker revisions and cached assets are not reconciled |
| D4 | Low | `FIXED` | Framing protection is declared in a CSP delivery mode that browsers ignore |
| P1 | High | `FIXED` | The timer publishes React state every animation frame |
| P2 | Medium | `FIXED` | The complete puzzle-board catalog is an eager Home dependency |
| P3 | Medium | `FIXED` | Large collections render every puzzle row at once |
| P4 | Medium | `FIXED` | Closed lazy dialogs and the solver worker initialize eagerly |
| P5 | Medium | `FIXED` | Hint and full-solver runs can contend for resources |
| S1 | High | `FIXED` | IDA* does not account for or enforce its full memory budget |
| S2 | Medium | `FIXED` | Solver registration and execution validate different capabilities |
| S3 | Medium | `IN PROGRESS` | The generated classic solver is a large weakly checked boundary |
| T1 | Medium | `FIXED` | Performance regressions do not reliably block deployment |
| T2 | Medium | `FIXED` | Generated-engine synchronization is not checked before unit tests |
| T3 | Medium | `FIXED` | Coverage and delivery bundle budgets are not enforced |
| T4 | Low | `FIXED` | Workflow/action/dependency update guardrails can be stronger |
| A1 | Medium | `FIXED` | Same-page route changes do not consistently announce or focus new content |
| M1 | Low | `FIXED` | Product naming, puzzle-count metadata, and audit links are stale or inconsistent |
| X1 | N/A | `EXCLUDED` | Licensing and third-party puzzle provenance |
| R1 | N/A | `DEFERRED` | Q8 and P1/P2/P6 from `REMAINING-AUDIT-ITEMS.md` |

## Current implementation summary

| IDs | Outcome |
|---|---|
| C1-C2 | Route decoding now fails closed, recovery reloads without deleting data, confirmed reset clears only exact owned keys, and the core game transition is terminal after solve. |
| C3-C4 | Storage operations return typed failure reasons; a deduplicated warning reports persistence health; versioned safe-integer generation/revision envelopes, merge-before-write, storage-event reconciliation, and a full-reset marker prevent lost updates and post-reset resurrection across active tabs. |
| C5-C7 | Play controllers remount by puzzle/action identity, timer restoration requires a matching saved attempt, imported progress is catalog-normalized with safe counter/timestamp invariants, and Continue uses saved session -> first unsolved -> first puzzle precedence. |
| D1 | Public metadata derives from `PUBLIC_SITE_URL`/repository metadata, preview paths are configurable, and the sole product name is `Sokomind`. An arbitrary `/nested-audit/` mount passed its browser test. |
| D2 | The service worker installs an immutable known-good shell and never replaces it with an arbitrary navigation response. |
| D3 | Build-derived revisions, staged-cache validation, awaited writes, runtime fill, and old-generation pruning are enforced. Dialogs, workers, and 44 board shards remain runtime-loaded; browser tests prove on-demand fill, offline reuse, navigation-404 safety, and distinct worker-generation replacement. |
| D4 | The ineffective meta-delivered `frame-ancestors` directive was removed and the GitHub Pages response-header limitation is documented. |
| P1 | Timer updates align to visible second boundaries while exact elapsed time remains in refs/persistence; puzzle lookup now uses a precomputed ID index. |
| P2-P3 | A generated metadata index keeps Home and the selector independent of board payloads. Play fetches one of 44 bounded board shards, while 1,000-room collections expose URL-addressable 50-row pages with focus and filter reset behavior. |
| P4 | Progress and solver dialogs mount only while open; solver clients/workers are created on demand and disposed on close. |
| P5 | Hint workers have startup/result watchdogs plus error/message-error handling, cancellation terminates ownership deterministically, and opening the full solver synchronously cancels hints before allocating its worker. |
| S1 | IDA* now estimates static and dynamic retained memory, enforces the ceiling before and during search, and reports category/current/peak telemetry. |
| S2 | One capability validator now covers registration, discovery, and pre-dispatch compatibility with typed failure codes and invalid-adapter isolation. |
| S3 | Shared command/result envelopes, runtime guards in both directions, malformed-message failure behavior, declaration synchronization, and a separate generated-engine coverage floor are complete. Exact nested payload extraction and incremental module conversion remain ongoing architecture work. |
| T1-T2 | Multi-puzzle and Huge performance tests are blocking CI gates; Huge bounds search/rewrite/total time; generated-engine synchronization runs before unit tests. |
| T3 | Independent typed/generated coverage floors and per-target gzip budgets are enforced. Home closure, workers, largest asset, and each board shard have readable non-regression failures. |
| T4 | Actions are pinned to reviewed commit SHAs, deployment explicitly requires the default branch, and Dependabot groups compatible families while reserving every major update for deliberate review. |
| A1 | Route identity includes puzzle/collection/action state; new route headings receive focus and are announced, including history navigation. |
| M1 | Stale puzzle-count copy and audit links were corrected; the follow-up audit uses the canonical name; tracked content and filenames contain no iteration-specific product names. |
| X1/R1 | Licensing remains excluded. Q8 and P1/P2/P6 in `REMAINING-AUDIT-ITEMS.md` remain deferred and that file is unchanged. |

## 2026-08-02 follow-up review

| Finding | Resolution |
|---|---|
| GitHub Actions failed two WebKit recovery cases because WebKit retains a failed module import for the page lifetime | Recovery tests now fail a non-Home lazy route and return to the already-loaded Home route; the original data-preservation and cross-tab reset assertions remain intact. |
| Unknown puzzle IDs and shared logs above 2,000 actions could mount persistence and overwrite the saved attempt | Route validity is checked before stateful play hooks mount, inbound and outbound sharing use one limit, and invalid routes replace to Home without touching storage. |
| Home and selector progress snapshots became stale after another tab completed or reset progress | Both views use one storage-event-backed progress hook with a post-subscription re-read. |
| Hint startup could remain silent or overlap a full laboratory run | A connection owner now enforces startup/result watchdogs, fatal worker events, termination, and synchronous arbitration. |
| Explicit reduced/full motion did not consistently override the OS and dark secondary text missed contrast targets | Resolved motion is applied before React and globally in CSS; explicit full motion overrides the media fallback, dark tokens exceed 4.5:1, and representative dark/motion views have browser axe coverage. |
| The progress import file control had no accessible name | The hidden file input has an explicit label and is located by that name in browser coverage. |
| Failed browser jobs exposed no trace artifacts and action pins lagged reviewed releases | Failure-only Playwright artifacts are retained for seven days and every first-party deployment action is pinned to a reviewed immutable release SHA. |

## Correctness and data protection

### C1 - Safe route parsing and recovery

**Evidence:** `src/router/parse-hash.ts` decodes route segments with unguarded `decodeURIComponent()`. A malformed shared hash throws during router initialization. `src/shared/ui/ErrorBoundary.tsx` then offers a recovery path that deletes every same-origin storage key with a broad prefix.

**Fix:**

1. Add a total, non-throwing route-segment decoder.
2. Convert invalid encodings to the existing not-found/invalid-link route.
3. Make ordinary reload the default error recovery action.
4. Put data reset behind explicit confirmation and delete only the exact keys owned by this application.
5. Add malformed-hash unit and browser regression tests.

**Acceptance:** Malformed hashes never throw, reload does not clear storage, reset cannot delete prefix-adjacent or unrelated keys, and the focused unit/browser tests pass.

### C2 - Terminal replay semantics

**Evidence:** Live play rejects movement after solving, but the core `move()` function and replay loop continue applying trailing actions. A replay can solve a puzzle and then push a box off its goal into a state the live UI cannot create.

**Fix:** Make the core transition terminal once solved, or reject any replay action after the first solved state. Prefer a single core invariant shared by live play, imports, saved sessions, and solver verification.

**Acceptance:** Solve-then-walk and solve-then-push-off fixtures cannot produce a post-solve state; existing valid replay and solver verification tests remain unchanged.

### C3 - Observable persistence health

**Evidence:** Low-level storage helpers report write failure, but progress, session, preferences, and optimal-cache callers discard it. Quota and privacy-mode failures therefore look like successful autosaves.

**Fix:** Return typed persistence results, maintain a deduplicated application-level persistence-health state, and show an actionable warning without interrupting play.

**Acceptance:** Simulated quota/security exceptions surface one warning, successful later writes can clear the warning, and gameplay remains usable.

### C4 - Cross-tab progress reconciliation

**Evidence:** Each tab loads progress once and later writes its entire snapshot. Two tabs can overwrite different completions or resurrect data following a reset.

**Fix:** Store records per puzzle or merge against the latest persisted snapshot before writing. Coordinate active tabs with the `storage` event or `BroadcastChannel`, including reset/version semantics.

**Acceptance:** Two-client completion, improvement, import, and reset tests cannot lose or resurrect records.

### C5 - Puzzle-scoped controller lifecycle

**Evidence:** Browser history can reuse the same play component for another puzzle while timer, deadlock, playback, and hint state are reset only through the explicit selector path. Active hint tokens are not fully invalidated on puzzle changes.

**Fix:** Add one route-transition boundary keyed by puzzle/session identity that cancels playback and solver work, clears puzzle-local state, and initializes/persists the correct timer. Either remount the controller per puzzle or make every hook react correctly to identity changes.

**Acceptance:** Puzzle A -> puzzle B -> browser back cannot inherit time, highlights, pending hints, toasts, or playback state.

### C6 - Progress import normalization

**Evidence:** Unknown puzzle IDs are retained and raw record keys are used for some totals while computed statistics ignore them, allowing counts and progress bars above 100%.

**Fix:** Normalize imported progress against the active catalog, validate record invariants, and use one aggregate source for all displayed totals.

**Acceptance:** Unknown/stale records are reported or ignored consistently and all displayed percentages remain within 0-100%.

### C7 - Next-unsolved navigation

**Evidence:** Home assigns the first puzzle as a fallback before applying the computed next-unsolved fallback, making the latter unreachable.

**Fix:** Keep the saved-session target optional and apply the next-unsolved/first-puzzle fallback exactly once.

**Acceptance:** With progress but no saved session, Continue opens the first unsolved puzzle.

## Deployment, PWA, and security

### D1 - Portable public URL and canonical metadata

**Evidence:** Production metadata, browser configuration, and preview scripts assume one Pages project path. The repository is intended to move while retaining the same product identity.

**Fix:** Keep the product name `Sokomind` everywhere. Derive the deployed Pages URL/path from GitHub repository metadata or an explicit environment variable, with a canonical production fallback. Parameterize local preview and browser tests with the same source of truth. Test canonical, Open Graph, and image URLs exactly.

**Acceptance:** No iteration-specific product name exists in tracked content; a test deployment at an arbitrary subpath works; canonical and social URLs resolve successfully; moving the repository requires configuration only, not code edits.

### D2 - Navigation cache poisoning

**Evidence:** The service worker can store any navigation response, including a 404, under the application-shell key. Offline root navigation then returns the cached error document.

**Fix:** Cache the shell only from a successful root/scope navigation, never replace it from arbitrary navigations, and keep a known-good cached shell when the network returns an error.

**Acceptance:** Online 404 -> offline root still returns the application with status 200; failed navigations never replace the shell.

### D3 - Service-worker revision and asset lifecycle

**Evidence:** The cache name is manually versioned, every emitted asset is precached, runtime entries are not reconciled, and browser tests block service workers.

**Fix:** Generate a build revision, precache only the shell/critical assets, runtime-cache immutable hashed assets, prune obsolete entries, await cache writes through the event lifetime, and add a service-worker-enabled Playwright project.

**Acceptance:** A two-build upgrade removes obsolete hashed assets, optional dialog/worker chunks are not downloaded at install, offline Home and direct-Play refreshes work, and update tests pass.

### D4 - Framing policy

**Evidence:** `frame-ancestors` is delivered through a meta CSP, where browsers ignore it. GitHub Pages does not supply a repository-controlled response header for it.

**Fix:** Treat this as a deployment-platform limitation. If framing protection becomes required, use a host or edge layer that can emit CSP or `X-Frame-Options` headers; otherwise remove the ineffective directive and document the limitation.

**Acceptance:** The security documentation and delivered policy make no unsupported framing guarantee.

## Runtime and delivery performance

### P1 - Timer render cadence and puzzle lookup

**Evidence:** The timer publishes state on every animation frame even though the UI displays whole seconds. The play controller also linearly scans the full catalog on each timer-driven render.

**Fix:** Keep precise elapsed time in refs, publish at meaningful display boundaries, preserve pause/resume/persistence semantics, and replace repeated scans with a precomputed ID-to-index lookup.

**Acceptance:** Displayed time remains correct across pause/resume/reload; render count drops to approximately one update per second; the lookup is constant time; focused tests pass.

### P2 - Catalog sharding

**Evidence:** Home imports and instantiates every puzzle board. The catalog chunk is roughly 568 KB raw even though Home needs only identifiers, summary counts, and progress metadata.

**Fix:** Generate a compact metadata index and split board payloads by collection or puzzle ID. Load full board data only for selector detail, play, or solver routes.

**Acceptance:** Home does not depend on the board-data chunk; deep links still load the requested puzzle; import/export and progress lookup remain stable; an initial-route gzip budget is enforced.

### P3 - Large-list rendering

**Evidence:** A 1,000-puzzle collection creates roughly 14,000 DOM nodes because every row is rendered at once.

**Fix:** Prefer accessible pagination with URL-addressable pages, or use a proven virtual list that preserves keyboard navigation and screen-reader semantics. `content-visibility` may supplement but not replace bounded DOM size.

**Acceptance:** The largest collection keeps rendered rows/DOM within a fixed budget and keyboard, focus, filtering, and direct-link tests pass.

### P4 - Dialog and worker initialization

**Evidence:** Lazy-imported dialogs are always mounted while closed; the solver controller then creates and discovers its worker immediately.

**Fix:** Mount dialogs only while open, create solver clients on demand, tear them down predictably, and optionally prefetch chunks after an explicit hover or idle signal.

**Acceptance:** A cold Play route does not fetch closed-dialog chunks or create the solver worker; opening each dialog remains responsive and state-safe.

### P5 - Solver-run arbitration

**Evidence:** Hint and full-solver features own separate workers and can run concurrently without a shared resource policy. Hint startup also has weaker liveness handling.

**Fix:** Add a solver-run arbiter, disable or cancel hints during laboratory runs, and give both paths consistent startup, timeout, error, and message-error handling.

**Acceptance:** Conflicting runs cannot overlap, cancellation is deterministic, and worker-silence tests cover both features.

## Solver architecture and resource contracts

### S1 - IDA* memory accounting

**Evidence:** IDA* reports zero estimated memory and limits only a rough transposition-table estimate, excluding compiled geometry, caches, stack state, reachability snapshots, and buffers.

**Fix:** Implement a conservative shared live/peak estimator, include static and dynamic structures, enforce the limit before and during search, and report meaningful telemetry.

**Acceptance:** A budget below static allocation is rejected; peak estimates are non-zero and monotonic; normal baselines and deterministic results remain valid.

### S2 - Capability contract validation

**Evidence:** Registration validates only a subset of solver metadata, discovery later rejects malformed metadata globally, and execution does not check every declared board/request capability.

**Fix:** Use one canonical validator during registration and discovery, isolate invalid adapters, and reject incompatible labeled/generic/partial requests before dispatch.

**Acceptance:** Invalid adapters cannot register, one invalid adapter cannot break unrelated discovery, and unsupported requests return typed errors.

### S3 - Generated classic-engine boundary

**Evidence:** The largest solver implementation is concatenated from classic scripts, excluded from normal linting, exposed through broad record types, and lightly covered relative to the typed core.

**Fix:** Immediately add exact generated contracts, synchronization checks, targeted `checkJs`/linting where safe, and a separate coverage floor. Incrementally extract explicit modules rather than attempting a single rewrite.

**Acceptance:** Generated and source files cannot drift; request/result types are exact; the engine's enforced coverage increases without changing benchmark counters.

The new search techniques in Q8 remain deferred; this item only strengthens the existing engine boundary and controls.

## Testing, CI, and maintenance

### T1 - Enforced performance gates

**Evidence:** The Huge benchmark is allowed to fail without blocking deployment and bounds only part of its total work. The inexpensive multi-puzzle performance suite is not a deployment gate.

**Fix:** Remove the soft failure, bound initial, rewrite, and total duration separately, run the multi-puzzle suite, and retain exact replay/counter assertions.

**Acceptance:** A performance or determinism regression fails CI and prevents deployment; documented thresholds have reasonable variance headroom.

### T2 - Generated-engine synchronization

**Evidence:** Unit tests can run against a stale tracked generated engine; regeneration occurs later during build even though the generator already supports `--check`.

**Fix:** Add a dedicated check script before unit tests/CI and fail if source and generated output differ after preparation.

**Acceptance:** Editing an engine source without regenerating fails the first relevant CI job.

### T3 - Coverage and bundle budgets

**Evidence:** Coverage has no threshold, the generated engine has low line coverage, and static-build tests verify existence rather than delivery size.

**Fix:** Establish non-decreasing coverage floors for typed and generated code separately. Add gzip budgets for Home, Play, worker bundles, and the largest individual chunk.

**Acceptance:** Coverage or bundle regressions fail CI with a readable per-target report.

### T4 - Workflow and dependency guardrails

**Evidence:** Actions use mutable major tags, manual deployment policy partly depends on external environment settings, and broad dependency grouping can create incompatible major/peer combinations.

**Fix:** Pin Actions to reviewed commit SHAs, explicitly require the default branch for deployment, split dependency groups by compatibility family, and avoid automatic incompatible majors.

**Acceptance:** Workflow policy is visible in the repository; grouped update branches install and test coherently.

## Accessibility and metadata

### A1 - Route focus and announcements

**Evidence:** Route announcements key only on the broad page type. Moving between two puzzles can leave focus on the document body with no useful live announcement.

**Fix:** Key route identity on puzzle/collection identity, announce the new title, and move focus to the new main heading unless the navigation originated inside a component that intentionally manages focus.

**Acceptance:** Puzzle-to-puzzle and history navigation have deterministic focus and announcements; axe and keyboard E2E tests remain green.

### M1 - Canonical naming and stale metadata

**Evidence:** Product/version terminology, puzzle-count descriptions, documentation links, and some navigation labels are inconsistent with the current application.

**Fix:** Use only `Sokomind` as the product name, compute or update puzzle counts from one source, repair broken audit links, and make labels describe their actual destinations.

**Acceptance:** A repository-wide search finds no iteration-specific product names in tracked content, metadata matches generated catalog totals, and documentation links resolve.

## Excluded and deferred work

### X1 - Licensing and provenance (`EXCLUDED`)

No licensing, attribution, or third-party puzzle provenance changes will be made in this audit. Runtime/catalog architecture may change, but it must not alter the puzzle corpus under the guise of optimization.

### R1 - Reserved research and catalog work (`DEFERRED`)

The following remain exclusively in `REMAINING-AUDIT-ITEMS.md`:

- Q8: tunnel macros, goal macros, and corral pruning.
- P1: difficulty skew and external collection sourcing.
- P2: Boxoban structural homogeneity and corpus rebalancing.
- P6: catalog-scale labeled-box conversion/generation.

Immediate work may add small labeled regression fixtures, capability enforcement, catalog sharding, or list pagination because those strengthen existing behavior without implementing the reserved corpus/research items.

## Validation log

Add dated evidence here whenever an item changes to `FIXED`.

| Date | Items | Evidence |
|---|---|---|
| 2026-08-01 | Baseline | Clean install; lint; typecheck; 366 unit tests; 5 static-build tests; 25 local Chromium tests; current remote workflow green |
| 2026-08-01 | C1-C7 | 391/391 unit tests; browser coverage for malformed hashes, exact-key/cross-tab full reset, persistence warning/retry, two-tab completion/reset, attempt-bound timers, progress normalization, and Continue precedence |
| 2026-08-01 | D1, D2, D4, P4, A1, M1 | 6/6 static-build tests; 41/41 combined Chromium/service-worker tests; focused browser test passed at `/nested-audit/`; tracked-content and filename searches found no iteration-specific product names |
| 2026-08-01 | P1 | Exact timer math and catalog-index unit tests passed; a three-second running sample dropped from roughly 70 ms script/125 ms task/16 ms style work to 3 ms/12 ms/1 ms |
| 2026-08-01 | S1, S2, T1, T2 | Full unit/build/lint/typecheck passed; multi-puzzle gate passed; Huge passed in 54.8 seconds with exact 1,010 moves, 316 pushes, 1,843 visited, and 13,844 generated for every required orientation |
| 2026-08-01 | D3 | 3/3 service-worker lifecycle tests cover clean-install offline Home/Play refresh, no first-install reload, dialog/worker deferral, navigation-404 safety, same-build revision replacement, and pruning; critical-root closure, positive runtime-fill coverage, and a genuine two-build migration test remain open |
| 2026-08-01 | T3 | 6/6 gzip-budget/static tests and aggregate coverage gates pass at 68.01% lines, 75.14% branches, and 74.82% functions; the item remains `IN PROGRESS` until typed/generated coverage floors are separate |
| 2026-08-01 | T4 | Workflow SHA pins were resolved against the official action repositories; default-branch deployment and the supported compatibility-family/major-version Dependabot policy are repository-visible; the complete local validation set passed |
| 2026-08-02 | Deployment and follow-up review | Reproduced both failed WebKit recovery cases from the GitHub run, corrected their page-lifetime module-failure assumption, and passed 404/404 unit tests, 7/7 static tests, and all 93 locally runnable browser cases with 2 intentional skips across Chromium, WebKit, mobile Chrome, mobile Safari, and the service-worker project |
| 2026-08-02 | D3, P2, P3 | 44 generated board shards measure 1.66-3.00 KB gzip; Home's transitive closure contains no board payload; the 1,000-room collection renders exactly 50 URL-addressable rows; 3/3 service-worker lifecycle tests cover positive runtime fill, offline direct Play, navigation safety, and distinct worker-generation replacement/pruning |
| 2026-08-02 | P5, S3, T3 | Five hint-worker lifecycle tests and five generated-engine protocol tests pass; typed coverage is 92.86% lines, 84.44% branches, and 94.35% functions; generated-engine coverage is 41.80%, 63.54%, and 56.25% respectively; exact nested generated payload extraction remains tracked under S3 |
| 2026-08-02 | T1 and solver regression | The multi-puzzle gate passed all four tiers; Huge passed in 58.8 seconds with the 874-move/304-push rewrite and exact 1,010 moves, 316 pushes, 1,843 visited, and 13,844 generated for base, mirrored, and rotated discovery |
