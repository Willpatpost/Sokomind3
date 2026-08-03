# Sokomind3 Full Codebase Audit — 2026-08-03

Comprehensive issue catalog produced by five parallel deep-review passes covering
project configuration, core engine, solver subsystem, UI/features layer, and test
suite. Every item includes file path, line numbers, severity, and a concrete
description of the problem and its consequences.

**Severity scale:**

| Level | Meaning |
|---|---|
| **CRITICAL** | Correctness or accessibility bug that affects users now |
| **HIGH** | Robustness gap — silent data corruption, crash path, or missing safety net |
| **MEDIUM** | Maintainability or architecture concern — increases cost of future changes |
| **LOW** | Polish, minor smell, or hardening opportunity |
| **INFO** | Design observation — not a defect but worth documenting |

---

## A. ACCESSIBILITY ISSUES

### A1. ConfirmDialog hardcoded ARIA IDs — CRITICAL

**File:** `src/shared/ui/ConfirmDialog.tsx`, lines 33-34

**Problem:** The component uses hardcoded `id="confirm-dialog-title"` and
`id="confirm-dialog-message"` for `aria-labelledby` and `aria-describedby`
associations. If two `ConfirmDialog` instances are ever mounted simultaneously
(e.g., a reset confirmation appears while a clear-board confirmation is still
animating out), the duplicate IDs violate the HTML spec and break the
assistive-technology association — screen readers will read the wrong title or
description for one of the dialogs.

**Impact:** WCAG 4.1.1 (Parsing) violation. Screen reader users may hear the
wrong dialog label.

**Fix:** Replace hardcoded IDs with `React.useId()`:
```tsx
const titleId = useId();
const messageId = useId();
```

---

### A2. ExperienceControls lacks dialog semantics — CRITICAL

**File:** `src/features/experience/ExperienceControls.tsx`, line 221

**Problem:** The settings popover uses `role="region"` instead of
`role="dialog"` and lacks `aria-modal="true"`. The manual focus trap
implementation (lines 87-112) finds the first and last focusable elements at
mount time but does not update if focusable elements are dynamically
added/removed within the panel. Assistive technologies will not announce this
as a dialog and will not constrain the virtual cursor to its contents.

**Impact:** WCAG 2.4.3 (Focus Order) and 4.1.2 (Name, Role, Value). Screen
reader users can navigate outside the "modal" with the virtual cursor despite
the visual focus trap. The panel behaves like an overlay but is announced as a
generic region.

**Fix:** Either:
- Migrate to a native `<dialog>` element with `showModal()` (preferred — gets
  inert behavior for free), or
- Add `role="dialog"` + `aria-modal="true"` and rewrite the focus trap to
  query focusable elements dynamically on each Tab keypress.

---

### A3. Solver live metrics not announced — LOW

**File:** `src/features/solver/SolverDialog.tsx`

**Problem:** The solver's real-time progress metrics (elapsed time, states
expanded, generation rate) update frequently but are not in an `aria-live`
region. Key state transitions — solver started, solution found, solver
failed/timed-out — are not announced to screen readers. A blind user cannot
determine whether the solver is still running or has finished without
tabbing through the dialog to read each field.

**Impact:** WCAG 4.1.3 (Status Messages). Sighted users see the progress bar
and live counters; screen reader users get nothing until they manually explore.

**Fix:** Add an `aria-live="polite"` region that emits a concise announcement
on each major state transition: "Solver started", "Solution found: 42 moves",
"Solver timed out after 30 seconds". Do NOT put the rapidly-updating counters
in the live region — that would be extremely noisy.

---

## B. CORRECTNESS ISSUES

### B1. Unsafe JSON casts bypass validation infrastructure — HIGH

Three locations cast parsed JSON to domain types without runtime validation,
despite excellent validation functions existing in the codebase
(`validatePuzzle`, `assertValidSolverSolution`, etc.).

**Location 1:** `src/catalog/puzzles.ts`, line 277
```ts
importedPuzzles as readonly PuzzleDefinition[]
```
The JSON import is typed as `unknown` effectively, and this assertion skips all
validation. If `imported-puzzles.json` contains a malformed entry (missing
`rows`, wrong `difficulty` string, etc.), it silently corrupts the catalog.
The corrupted puzzle may crash the parser, solver, or renderer at an arbitrary
later point with an unhelpful error.

**Location 2:** `src/catalog/puzzle-loader.ts`, line 50
```ts
parsed as PuzzleDefinition[]
```
The `Array.isArray` check on line 49 validates the outer array but not the
shape of individual elements. A shard JSON file with `{"id": 123}` (number
instead of string) would pass the array check and produce a corrupt puzzle
that crashes when `.rows` is accessed.

**Location 3:** `src/catalog/puzzle-metadata.ts`, line 26
```ts
metadata.puzzles as unknown as readonly MetadataTuple[]
```
A double cast through `unknown` — completely unchecked. If the JSON structure
changes (e.g., tuple order changes), errors are silent and delayed.

**Impact:** Silent data corruption. The app has `validatePuzzle()` and
`validatePuzzleRows()` that report structured errors, but they are never
called on these import paths.

**Fix:** Pipe each imported puzzle through `validatePuzzle()` at load time
(not at build time — the shards are loaded lazily). Throw or skip invalid
entries with a console warning. For metadata tuples, validate array length
and field types.

---

### B2. O(B) solved-check on every move, even non-push moves — MEDIUM

**File:** `src/core/game-session.ts`, lines 72-78 (`boxesAreSolved`), called
from `stepSnapshot` at line 217.

**Problem:** `stepSnapshot` always calls `createSnapshot`, which always calls
`boxesAreSolved`. This iterates all B boxes and checks each against the goal
map. When the player walks without pushing a box, the solved state cannot
change, but the check runs anyway.

**Impact:** For gameplay (B <= 20), the cost is negligible. For the solver,
which calls `stepSnapshot` millions of times, ~40-60% of calls are walk-only
moves. Skipping the check when `pushed === false` would eliminate O(B) work on
those calls.

**Fix:** In `stepSnapshot`, when the move does not push a box
(`boxIndex === undefined`), propagate `snapshot.solved` directly instead of
recomputing via `boxesAreSolved`. Alternatively, maintain an incremental
solved-box count and only recheck the one box that moved.

---

### B3. String-slice undo assumes single-character action encoding — MEDIUM

**File:** `src/core/game-session.ts`, line 263

```ts
actionLog: session.actionLog.slice(0, -1)
```

**Problem:** This assumes every action is encoded as exactly one character
(U/D/L/R). While this is currently true, the assumption is implicit and
undocumented. If the action encoding ever changes to multi-character (e.g.,
run-length encoding for solver output, or annotated moves like "PU" for
push-up), this line would silently produce corrupt action logs.

**Impact:** Latent fragility. Not a bug today, but a landmine for future
changes.

**Fix:** Either:
- Add an explicit comment and a compile-time assertion that
  `ACTION_CODES` are all single-character, or
- Use `encodeDirection` length: `actionLog.slice(0, -encodeDirection(…).length)`, or
- Store the log as an array of `ActionCode` instead of a concatenated string.

---

### B4. canonicalBoxSignature silent precondition — MEDIUM

**File:** `src/solver/search/model.ts`, lines 42-48

**Problem:** `canonicalBoxSignature` requires boxes to be pre-sorted by cell
index but does not verify this. If a caller passes unsorted boxes, the
function silently produces a non-canonical signature, causing the
transposition table to treat identical states as different (missed
deduplication) or different states as identical (incorrect pruning, depending
on collision patterns).

**Impact:** Incorrect solver behavior if any caller violates the precondition.
Currently all callers sort correctly, but this is a fragile implicit contract.

**Fix:** Add a debug-mode assertion:
```ts
if (process.env.NODE_ENV !== "production") {
  for (let i = 1; i < boxes.length; i++) {
    if (boxes[i].cell <= boxes[i - 1].cell) {
      throw new Error("canonicalBoxSignature: boxes must be sorted by cell");
    }
  }
}
```

---

### B5. Zobrist table fallback masks out-of-range bugs — LOW

**File:** `src/solver/search/model.ts`, lines 112-113, 119

```ts
const a = this.#tableA[cell * this.#labels + labelIdx] ?? 0;
const b = this.#tableB[cell * this.#labels + labelIdx] ?? 0;
```

**Problem:** The `?? 0` fallback silently produces hash value 0 for
out-of-range cell/label indices. If a new label is added to a puzzle without
rebuilding the Zobrist table, the fallback produces hash collisions (all
out-of-range entries hash to 0) rather than throwing. This could cause the
solver to treat distinct states as identical.

**Impact:** Silent hash collisions if Zobrist table dimensions are wrong.
Low probability because tables are built per-puzzle, but the failure mode
is silent incorrectness.

**Fix:** Replace `?? 0` with a bounds check that throws in debug mode.

---

### B6. document.title set outside useEffect — LOW

**File:** `src/features/play/use-persisted-play.ts`, line 99

**Problem:** `document.title` is set as a side effect inside a render-adjacent
callback, not inside a `useEffect`. Under React's concurrent rendering
features (StrictMode double-renders, Suspense), this side effect may execute
during a render that is later discarded, leaving a stale document title.

**Impact:** Minor — the title may briefly show the wrong puzzle name during
concurrent renders. Not user-visible in practice with current React usage.

**Fix:** Move the `document.title = …` assignment into a `useEffect` that
depends on the puzzle name.

---

## C. SOLVER ALGORITHM ISSUES

### C1. Heuristic gap in move-optimal IDA* — HIGH

**File:** `src/solver/search/ida-star.ts`, line 890

```ts
const newG = newMoves;
```

**Problem:** The IDA* search optimizes for total moves (walks + pushes), so
`g` counts total moves. But the heuristic `h` estimates pushes only (via
Hungarian assignment of box-to-goal distances). The heuristic is still
admissible (h <= h*) because real solutions require at least as many pushes,
and pushes are a subset of moves. However, the gap between what `g` measures
and what `h` estimates means:

1. The heuristic is much looser than it could be — it doesn't account for
   the walk moves the player must make between pushes.
2. IDA* may explore significantly more states than necessary, with many
   iterations at small f-limit increments.
3. On large puzzles with long walks between pushes, the gap is especially
   severe.

**Impact:** Solver performance degradation on large or spread-out puzzles.
The solver still finds optimal solutions, but may take much longer than
necessary.

**Fix:** Augment the heuristic with an estimate of walk cost. For example,
add the minimum walk distance between consecutive push positions in the
assignment. This is more expensive to compute but would tighten the bound
significantly.

---

### C2. IDA* transposition table rebuilt each iteration — MEDIUM

**File:** `src/solver/search/ida-star.ts`, line 569

```ts
// new Map() each iteration
```

**Problem:** The transposition table is rebuilt from scratch at the start of
each IDA* iteration. This means duplicate detection across iterations is lost.
States that were proven to have g-cost >= threshold in iteration N will be
re-expanded in iteration N+1 even if their g-cost hasn't improved.

**Impact:** This is standard IDA* behavior and is not a bug. However,
persistent transposition tables (keeping entries from prior iterations and
only clearing entries whose stored g-cost is >= the new threshold) are a
well-known enhancement that can reduce re-expansion significantly on
Sokoban puzzles. The tradeoff is memory — the table grows across iterations.

**Fix:** Retain the transposition table across iterations. On each new
iteration, either:
- Clear only entries with stored g-cost >= new f-limit, or
- Use a two-level scheme: keep the table but mark entries from prior
  iterations as "stale" and allow re-expansion only if the new g-cost
  improves on the stored value.

---

### C3. Missing advanced pruning techniques — MEDIUM

**File:** `src/solver/search/` (entire directory)

**Problem:** Three classical Sokoban pruning techniques are absent from both
the A* and IDA* engines:

1. **Tunnel macros:** When a box enters a straight tunnel (walls on both
   sides), it can only exit at the other end. The entire push-through can
   be treated as a single macro move, dramatically reducing the search
   tree in corridor-heavy puzzles.

2. **Goal macros:** Once a box reaches its goal in certain configurations
   (e.g., corner goal), it will never need to move again. The box can be
   removed from the search state, reducing the branching factor.

3. **Corral detection:** A corral is a region of the board enclosed by
   boxes. If all goals inside a corral are already filled, no box inside
   needs to move, and the corral can be treated as a wall for future
   moves.

**Impact:** These are the main techniques that differentiate competitive
Sokoban solvers from basic A*/IDA*. Their absence limits the solver's
ability to handle puzzles with corridors, corner goals, or enclosed regions
efficiently.

**Note:** This is already documented in `REMAINING-AUDIT-ITEMS.md` as item
Q8 with a detailed 3-phase implementation plan and ~7-9 day effort estimate.

---

### C4. A* retains all nodes for reconstruction — MEDIUM

**File:** `src/solver/search/engine.ts`, around line 253

**Problem:** The A* search retains every generated node in memory because
solution reconstruction walks parent indices. This means memory grows with
the number of generated states (not just expanded states). For large puzzles,
the difference between generated and expanded can be 3-10x, causing
premature memory limit hits.

**Impact:** Solver runs out of memory sooner than necessary on large puzzles.
The memory estimation system (which tracks generated nodes) may trigger
limit-reached terminations that could be avoided.

**Fix:** Use a more compact representation for the parent chain (e.g., store
only the move that led to each state, not the full node), or periodically
compact the node store by removing nodes that are not ancestors of any
frontier node.

---

### C5. Classic solver cancellation relies on cooperative yields — LOW

**File:** `src/solver/implementations/classic-solvers.ts`, referenced in
`docs/sokomind-follow-up-audit.md`

**Problem:** The classic solver adapters (DFS, Greedy, A*) depend on
cooperative macrotask yields for cancellation. They check `throwIfCancelled`
periodically during the search loop, but if the solver enters a
tight inner loop (e.g., Hungarian algorithm on a large label set), it may
not check for cancellation for hundreds of milliseconds.

There is no independent watchdog timer that can force-terminate a runaway
search. The two-layer worker architecture in the Sokomind solver solves this
by allowing the outer worker to terminate the inner one, but the classic
solvers run directly in the single solver worker.

**Impact:** The Cancel button may appear unresponsive for up to several
hundred milliseconds on complex puzzles. Not a correctness issue, but a
UX concern.

**Fix:** Either:
- Add a `setTimeout`-based watchdog in the worker host that terminates the
  worker if no progress event arrives within a deadline, or
- Restructure the classic solvers to check cancellation inside the
  Hungarian algorithm's inner loop.

---

### C6. Bidirectional lane memory retention — LOW

**File:** `src/solver/implementations/sokomind-solver.ts`

**Problem:** The bidirectional search lane retains all published records
(visited states, frontier entries) until its bounded phase ends. For puzzles
where the bidirectional search explores extensively before meeting, this can
accumulate significant memory. Unlike the forward-only search which can
compact or discard non-frontier nodes, the bidirectional lane needs both
forward and reverse state sets for meeting detection.

**Impact:** Higher peak memory usage during bidirectional search phases.
May contribute to premature memory-limit terminations.

**Fix:** Implement a bounded meeting buffer that keeps only the most recent
N states per side, using Bloom filters for approximate membership testing of
older states. This trades solution quality for memory efficiency.

---

### C7. Hungarian algorithm cost on large label sets — INFO

**File:** `src/solver/search/heuristic.ts`, `src/solver/search/assignment.ts`

**Problem:** The Hungarian algorithm runs in O(B^2 * G) per heuristic
evaluation where B = boxes per label and G = goals per label. For puzzles
with 20+ boxes of the same label, this is O(8000+) operations per state
expansion. The `AssignmentHeuristic` class caches results (LRU, 50K entries),
but cache misses are expensive.

**Impact:** No correctness issue. Performance concern only on large
single-label puzzles (15+ boxes). The current puzzle catalog maxes at 17
boxes (Grand Hall), where the cost is manageable.

**Note:** Profile before optimizing. The cache hit rate may be high enough
that this is not a bottleneck in practice.

---

## D. PERSISTENCE AND STORAGE ISSUES

### D1. No IndexedDB fallback — HIGH

**File:** `src/shared/storage.ts`

**Problem:** All persistence uses `localStorage`, which has a browser-imposed
limit of ~5 MB. The app stores:
- Progress records for 2,194+ puzzles (completion status, best moves, best
  pushes, timestamps)
- Session persistence (puzzle ID + action log up to 100,000 characters)
- Optimal solution cache (proven move/push counts)
- Experience preferences

With aggressive play and solution caching, the total data can approach the
5 MB ceiling. When the quota is exceeded, `localStorage.setItem` throws a
`QuotaExceededError`. The app handles this gracefully (via
`persistence-health.ts` and `PersistenceWarning`), but the user loses the
ability to save any new progress until they clear data.

**Impact:** Power users who solve many puzzles and cache optimal solutions
may hit the storage limit. The app degrades gracefully but cannot store new
data.

**Fix:** Add `IndexedDB` as a fallback for larger data (solution cache,
session action logs). Keep small, frequently-accessed data (preferences,
progress summary) in `localStorage`. Libraries like `idb-keyval` provide a
simple key-value API over IndexedDB.

---

### D2. BroadcastChannel browser support — LOW

**File:** `src/shared/progress-sync.ts`

**Problem:** The cross-tab sync system uses `BroadcastChannel` for real-time
progress synchronization. `BroadcastChannel` was only added to Safari in
version 15.4 (March 2022). Older Safari versions, WebViews in some iOS apps,
and some embedded browsers do not support it.

The code likely falls back to `StorageEvent` for cross-tab communication
(which has universal support), but the `BroadcastChannel` path may throw
on construction if not feature-detected.

**Impact:** Low — Safari 15.4+ covers nearly all current iOS/macOS users.
But if the code does not feature-detect `BroadcastChannel` before
constructing one, older browsers will throw.

**Fix:** Wrap `BroadcastChannel` construction in a feature check:
```ts
const channel = typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel("sokomind-progress")
  : null;
```

---

### D3. localStorage 5MB limit with 2,194 puzzles — INFO

**File:** `src/shared/storage.ts`, `src/shared/optimal-cache.ts`

**Problem:** With 2,194 puzzles, full progress records could consume:
- ~200 bytes per puzzle record x 2,194 = ~440 KB for progress alone
- Session action logs up to 100,000 characters = ~100 KB per active session
- Optimal cache entries vary but could add 50-100 KB

This is well within the 5 MB limit for typical play, but the solution cache
grows without bound as the user solves puzzles and the solver caches results.

**Impact:** Unlikely to cause issues for normal users. Only a concern for
users who systematically solve all 2,194 puzzles and cache all optimal
solutions.

**Note:** This is related to D1 (no IndexedDB fallback). If D1 is
addressed, D3 becomes moot.

---

## E. UI ARCHITECTURE ISSUES

### E1. Oversized orchestration hooks — MEDIUM

Three hooks/components exceed 450 lines and manage too many concerns:

**`src/features/play/use-play-controller.ts` — 489 lines, ~40 return properties**

This single hook manages: game session state, deadlock detection, timer,
hints, solver playback, completion dialog state, reset confirmation, sharing
(Web Share API + clipboard fallback), puzzle navigation (prev/next), progress
recording, progress import/reset, optimal solution cache, and keyboard
bindings. The ~40-property return object makes it difficult to understand
which properties are used by which child components.

**`src/features/solver/useSolverController.ts` — 568 lines**

Manages: Web Worker lifecycle with 5-second startup timeout, solver
discovery, run execution with progress callbacks, token-based concurrency
control, cancellation, fingerprint-based stale-result detection, elapsed
timer, log entry management (capped at 80), and automatic memory limit
adaptation.

**`src/features/selector/PuzzleSelectorPage.tsx` — 624 lines**

Handles three distinct views (difficulty grid, collection grid, puzzle list)
in a single component, plus filters (box count, completion status, text
search with 150ms debounce), pagination, breadcrumb navigation, and focus
management on page change.

**Impact:** High cognitive load for future maintainers. Difficult to test
individual concerns in isolation. Changes to one concern risk regressions
in others.

**Fix:** Decompose each into smaller, focused hooks/components:
- `use-play-controller` → `useGameState`, `usePlaySharing`, `useSolverPlayback`, `usePlayNavigation`
- `useSolverController` → `useSolverWorker`, `useSolverProgress`, `useSolverMetrics`
- `PuzzleSelectorPage` → `DifficultyView`, `CollectionView`, `PuzzleListView` as separate route-aware components

---

### E2. No Suspense loading fallback — LOW

**File:** `src/AppShell.tsx`, line 123

**Problem:** The `Suspense` fallback is `null`:
```tsx
<Suspense fallback={null}>
```

Four page components are lazy-loaded (`HomePage`, `PuzzleSelectorPage`,
`PlayPage`, `EditorPage`). On slow connections (3G, congested WiFi), page
transitions show a blank content area until the JavaScript chunk loads.
There is no spinner, skeleton, or any visual feedback.

**Impact:** Perceived performance issue on slow connections. Users may think
the app is broken during the loading gap.

**Fix:** Add a minimal loading indicator:
```tsx
<Suspense fallback={<div className={styles.loading} aria-busy="true">Loading...</div>}>
```

---

### E3. Service worker update uses window.confirm — LOW

**File:** `src/main.tsx`

**Problem:** When a service worker update is detected, the app uses
`window.confirm()` to prompt the user to reload. This is a blocking modal
dialog that interrupts gameplay, cannot be styled, and provides no context
about what changed.

**Impact:** Jarring UX during gameplay. If the user is in the middle of
solving a puzzle, the confirm dialog interrupts their flow.

**Fix:** Replace with a non-blocking toast notification (similar to the
existing share-success toast in `PlayPage`) that offers a "Reload" button.
The toast should be dismissible and should not interrupt gameplay.

---

### E4. Dark theme CSS duplication — MEDIUM

**File:** `src/features/game/Board.module.css`, lines 364-448 (and other CSS
modules throughout the codebase)

**Problem:** Dark theme styles are implemented by duplicating structural CSS
rules inside `:global(html[data-theme="dark"])` blocks. For example,
`Board.module.css` has 84 lines of dark-theme overrides that repeat selectors
and structure from the light theme section. A color change must be made in
two places, and structural changes require updating both sections.

**Impact:** Maintenance burden. Inconsistencies between light and dark themes
are likely to accumulate over time. The current dark theme already has 449
lines in `Board.module.css` alone.

**Fix:** Define all themeable values as CSS custom properties on `:root` and
`html[data-theme="dark"]`:
```css
:root {
  --board-bg: #f0e6d3;
  --wall-color: #4a3728;
}
html[data-theme="dark"] {
  --board-bg: #1a1a2e;
  --wall-color: #8b7355;
}
.board { background: var(--board-bg); }
```
This eliminates the duplicated structural rules entirely.

---

### E5. Board.tsx cell-level memoization — LOW

**File:** `src/features/game/Board.tsx`

**Problem:** The `Board` component is memoized at the top level (line 115),
but individual cells are not memoized. On each state change (move), the
entire board re-renders all cells, including those that did not change.
For small boards (5x5 to 10x10), this is fast. For larger boards (15x15+),
the unnecessary re-renders could be noticeable.

**Impact:** Potential performance issue on large custom-editor puzzles.
Not a problem for the built-in puzzle catalog (most puzzles are 10x10).

**Fix:** Extract each cell as a memoized component with props for its
specific state (floor/wall/goal/box/player). Only cells whose state
changes will re-render.

---

### E6. Experience provider hierarchy depth — INFO

**File:** `src/App.tsx`, `src/features/experience/ExperienceProvider.tsx`

**Problem:** The provider hierarchy is 3+ levels deep:
```
StrictMode > ErrorBoundary > ExperienceProvider > RouterProvider > AppShell
```

`ExperienceProvider` creates `ProceduralAudioController` lazily, manages
three preference dimensions (audio, motion, theme), listens for
visibility changes, and sets HTML data attributes. It wraps the entire
application, meaning any preference change triggers a context update
that flows through all consumers.

**Impact:** Not a performance issue currently (React 19 handles context
efficiently), but the deep nesting makes it harder to reason about which
provider owns which state.

**Note:** This is an architectural observation, not a defect. The current
structure works correctly.

---

## F. CATALOG AND DATA ISSUES

### F1. Code duplication between puzzles.ts and puzzle-metadata.ts — MEDIUM

**Files:**
- `src/catalog/puzzles.ts`
- `src/catalog/puzzle-metadata.ts`

**Duplicated elements:**

| Element | puzzles.ts | puzzle-metadata.ts |
|---|---|---|
| `PuzzleDifficulty` type | line 8 | line 62 |
| `DIFFICULTY_ORDER` / `DIFFICULTIES` | line 4 | line 61 |
| `SOKOMIND_ORIGINALS` constant | line 376 | line 63 |
| `CollectionInfo` interface | lines 382-385 | lines 75-78 |
| `getCollectionsForDifficulty` | lines 387-405 | `getMetadataCollectionsForDifficulty`, lines 80-100 |
| `getBoxCountsForFilter` | lines 407-417 | `getMetadataBoxCounts`, lines 102-112 |

**Problem:** These parallel APIs exist so that the selector page can work
with lightweight metadata without loading full puzzle board data. But the
duplication means changes must be made in two files, and drift between them
causes subtle bugs (e.g., if a new collection is added to one but not the
other).

**Impact:** Maintenance burden. Easy to introduce inconsistencies.

**Fix:** Extract shared types (`PuzzleDifficulty`, `CollectionInfo`) and
constants (`SOKOMIND_ORIGINALS`, `DIFFICULTY_ORDER`) into a shared module
(e.g., `src/catalog/catalog-types.ts`). Have both `puzzles.ts` and
`puzzle-metadata.ts` import from there.

---

### F2. Puzzle-loader linear scan on cache hit — LOW

**File:** `src/catalog/puzzle-loader.ts`, line 65

```ts
puzzles.find((puzzle) => puzzle.id === puzzleId)
```

**Problem:** After a shard is loaded and cached, subsequent lookups for
puzzles in that shard still use `Array.find()` — a linear scan. Each shard
contains up to 50 puzzles, so this is O(50) per lookup.

**Impact:** Negligible for typical usage (one puzzle loaded at a time).
Could matter if the selector page pre-loads thumbnails for all visible
puzzles.

**Fix:** Build a `Map<string, PuzzleDefinition>` from each loaded shard
instead of searching the raw array.

---

### F3. Labeled-box regex fragility — LOW

**File:** `src/catalog/puzzles.ts`, line 471

```ts
/[A-NP-QT-WYZ]/
```

**Problem:** This regex detects labeled boxes by matching uppercase letters
while excluding O, R, S, X (the reserved symbols). If a new reserved symbol
is added (e.g., `K` for a new game mechanic), this regex must be manually
updated. The regex is not derived from the `isDedicatedBox` function in
`puzzle.ts`, so the two definitions can drift.

**Impact:** Low — new reserved symbols are unlikely, and the regex is only
used for catalog diversity statistics.

**Fix:** Derive the regex from the same source of truth as `isDedicatedBox`,
or replace with a call to `isDedicatedBox` for each character.

---

### F4. Catalog Vite coupling — LOW

**File:** `src/catalog/puzzle-loader.ts`, lines 4, 17

**Problem:** `puzzle-loader.ts` uses `import.meta.glob` (line 4) and
`import.meta.env.PROD` (line 17), which are Vite-specific APIs. This
prevents the catalog loader from being used in Node.js tests or alternative
build systems without shimming.

**Impact:** Low — the project is committed to Vite. But this creates a
testing constraint: unit tests for puzzle loading must either mock these APIs
or test only through the built output.

**Fix:** Inject the shard URL map and environment flag as constructor
parameters rather than reading them from `import.meta` directly.

---

### F5. Puzzle diversity skew — INFO

**File:** Documented in `REMAINING-AUDIT-ITEMS.md` as items P1 and P2

**Problem:** The puzzle catalog has significant diversity issues:
- **Difficulty skew:** 97% of puzzles are intermediate/advanced. Tutorial
  (0.2%), beginner (2.1%), expert (0.6%), master (0.2%) tiers are nearly
  empty.
- **Boxoban homogeneity:** 92.6% of puzzles are exactly 10x10, and 94.6%
  have exactly 4 boxes. This is a structural limitation of the Boxoban
  dataset that provides most imported puzzles.
- **Labeled-box scarcity:** Only 15/2,194 puzzles use labeled boxes, and
  0 imported puzzles use them.

**Impact:** The difficulty curve is essentially flat — players go from a
handful of easy puzzles to thousands of similar-difficulty puzzles. The
labeled-box feature is undertested by the catalog.

**Note:** This is a data-sourcing issue, not a code issue. Already tracked
in the project's own audit.

---

## G. CORE ENGINE ISSUES

### G1. No deadlock detection in core engine — MEDIUM

**File:** `src/core/game-session.ts`

**Problem:** The core engine detects the win condition (`isSolved`) but does
not detect when a puzzle becomes unsolvable. If a player pushes a box into
a corner with no goal, the game continues to accept moves even though the
puzzle can no longer be solved. The player must manually reset.

The solver subsystem has sophisticated deadlock detection (static dead cells,
2x2 blocks, freeze deadlocks), and the UI layer uses `deadlock-bridge.ts`
to highlight deadlocked boxes. But the core engine itself has no concept of
deadlocks — the detection happens entirely at the UI/solver layer.

**Impact:** Not a correctness bug — the game correctly allows all legal
Sokoban moves. But the separation means the core engine cannot be used
standalone (e.g., in a CLI tool or test harness) with deadlock awareness.
The UI layer must always wire up `deadlock-bridge.ts` separately.

**Fix:** Consider adding an optional `deadlockDetector` parameter to
`stepSnapshot` that, if provided, checks the resulting state for deadlocks.
This keeps the core engine pure (no mandatory solver dependency) while
allowing opt-in deadlock detection.

---

### G2. Replay throws hard on blocked actions — LOW

**File:** `src/core/replay.ts`, lines 27-30

**Problem:** `replayActionLog` throws an `ActionLogError` with code
`"blocked-action"` if any step in the replay is blocked (the player tries
to walk into a wall or push a box that cannot move). This means a replay
log that was valid for one version of a puzzle will fail hard if the puzzle
is modified (e.g., a wall is added). There is no option for partial replay
or soft failure.

**Impact:** Low — puzzle definitions are immutable in the current design.
But if the editor allows sharing modified puzzles, replays of the original
puzzle would fail.

**Fix:** Add an optional `onBlocked` callback or a `strict` mode flag that
controls whether blocked actions throw or are skipped.

---

### G3. positionKey string allocation in hot paths — LOW

**File:** `src/core/position.ts`, lines 10-12

```ts
export function positionKey(position: Position): string {
  return `${position.row},${position.column}`;
}
```

**Problem:** `positionKey` creates a template-literal string on every call.
The function is exported and available for external use, but the core engine
and solver exclusively use `numericPositionKey` (which returns a number,
avoiding allocation). If any future code path calls `positionKey` in a hot
loop (e.g., per-move computation), the string allocations would create GC
pressure.

**Impact:** No impact currently — the function is not called in hot paths.
But its existence as a public API invites misuse.

**Note:** Consider deprecating or inlining this function if it has no
external callers.

---

### G4. Replay dead code — INFO

**File:** `src/core/replay.ts`, line 22

```ts
if (!direction) continue;
```

**Problem:** This guard is unreachable. `decodeActionLog` (called on line 19)
already validates every character in the action log and throws an
`ActionLogError` for any invalid character. The decoded array will never
contain `undefined` entries.

**Impact:** None — the guard is harmless but misleading. A reader might think
`decodeActionLog` can return partial results.

**Fix:** Remove the guard and add a type assertion, or leave it with a
comment explaining it is a defensive no-op.

---

## H. TEST SUITE ISSUES

### H1. No visual regression testing — MEDIUM

**Files:** `tests/e2e/` (entire directory)

**Problem:** Despite being a visual puzzle game with CSS animations, dark
theme, responsive layout, and FLIP-animated piece movement, the test suite
has no screenshot comparison or visual regression tests. The E2E tests
verify DOM structure, ARIA attributes, and keyboard behavior, but never
assert that the game actually looks correct.

**Impact:** Visual regressions (broken layouts, misaligned pieces, invisible
elements, animation glitches) can be introduced without any test catching
them. The dark theme is particularly vulnerable since it duplicates CSS
rules (see E4).

**Fix:** Add Playwright visual comparison tests for key states:
- Empty board (light + dark theme)
- Mid-game state with trail and deadlock highlighting
- Completion dialog
- Editor grid
- Mobile layout at 375px width
- Solver dialog with progress

---

### H2. No touch gesture E2E tests — MEDIUM

**Files:** `tests/e2e/mobile.spec.ts`, `tests/unit/swipe-direction.test.ts`

**Problem:** The unit test `swipe-direction.test.ts` covers the direction
calculation logic (given dx/dy, return direction), but no E2E test simulates
actual touch gestures on mobile device profiles. `mobile.spec.ts` tests
responsive layout and button interactions but uses keyboard navigation, not
touch.

The Playwright `page.touchscreen` API supports tap and swipe simulation.
The Pixel 7 and iPhone 14 projects are configured but never exercise touch
input.

**Impact:** Regressions in the swipe control system (pointer capture,
threshold detection, direction resolution) would not be caught by any test.

**Fix:** Add E2E tests that use Playwright's `page.touchscreen.tap()` and
manual pointer event sequences to simulate swipes on mobile profiles:
```ts
await page.touchscreen.tap(200, 300);
// Swipe right
await page.mouse.move(200, 300);
await page.mouse.down();
await page.mouse.move(260, 300, { steps: 5 });
await page.mouse.up();
```

---

### H3. No WASM solver backend tests — LOW

**Files:** `tests/unit/sokomind-engine.test.ts`,
`tests/unit/sokomind-engine-protocol.test.ts`

**Problem:** The test suite exercises the TypeScript solver implementations
extensively but never tests the WASM Sokomind engine backend. The
`sokomind-engine.test.ts` file tests the protocol layer and adapter
interface, but the actual WASM binary (`engine.generated.js`) is not loaded
or executed in any test.

**Impact:** Regressions or compatibility issues in the WASM engine would
not be caught by the test suite. The WASM engine is used as a solver backend
in production.

**Fix:** Add integration tests that load the WASM engine in a Node.js
worker thread (or via Playwright) and verify it produces correct, verified
solutions for a set of benchmark puzzles.

---

### H4. No audio unit tests — LOW

**File:** `src/features/experience/procedural-audio.ts` (429 lines, untested)

**Problem:** The procedural audio system is 429 lines of Web Audio API code
with 8 effect types, a pentatonic music generator, lookahead scheduling, and
AudioContext lifecycle management. None of this is unit-tested. The only
audio-related test is an E2E preference persistence test in `app.spec.ts`
(lines 69-97).

**Impact:** Regressions in audio synthesis (wrong frequencies, timing
glitches, resource leaks) would not be caught. The AudioContext lifecycle
management (autoplay restrictions, visibility-based pause/resume, disposal)
is particularly important and fragile.

**Fix:** Mock `AudioContext` and test:
- Each effect type produces the correct oscillator/gain envelope
- Music generator produces the correct note sequence
- Disposal disconnects all nodes
- Visibility change pauses/resumes correctly

---

### H5. globalThis.postMessage patching fragility — LOW

**Files:**
- `tests/unit/sokomind-engine.test.ts`, lines 42-43
- `tests/performance/sokomind-solver-huge.test.ts`, lines 74-76

**Problem:** These tests monkey-patch `globalThis.postMessage` to prevent
worker message errors when running engine code outside a worker context.
Cleanup happens in `finally` blocks, but if the Node.js test runner crashes
or exits between tests in the same file, subsequent tests could be affected.

**Impact:** Low — the Node.js built-in test runner provides per-file
isolation, mitigating this risk. But the pattern is fragile and non-obvious.

**Fix:** Use `t.mock.method(globalThis, "postMessage", () => {})` if the
Node.js test runner supports it, or document the pattern with a comment
explaining why it is safe.

---

### H6. Hint worker tests lack correctness coverage — LOW

**File:** `tests/unit/hint-worker-runtime.test.ts`

**Problem:** The hint worker tests cover lifecycle concerns (discovery
timeout, watchdog clearing, disposal) but do not test actual hint
generation or correctness. There is no test that verifies the hint worker
produces a valid next move for a given puzzle state.

**Impact:** Regressions in hint generation (e.g., returning invalid moves,
not respecting the current game state) would not be caught.

**Fix:** Add a test that:
1. Creates a hint worker runtime with a known solvable puzzle
2. Requests a hint from a specific game state
3. Verifies the returned move is legal and makes progress toward the
   solution

---

### H7. Exact deterministic assertions are brittle — INFO

**File:** `tests/performance/sokomind-solver-huge.test.ts`, lines 29-36

```ts
moves=1010, pushes=316, visited=1843, generated=13844, retained=3471, peakFrontier=387
```

**Problem:** These exact-value assertions verify algorithmic determinism.
Any change to search order, tie-breaking, or heuristic computation will
break them, even if the change is intentional and produces an equally-good
or better solution. The project maintains two assertion tiers (exact +
upper-bound) to handle this, but the exact tier requires manual updates
after any intentional algorithm change.

**Impact:** Not a defect — this is a deliberate design choice. But it
increases the maintenance cost of algorithm improvements. Each change
requires running the benchmark, recording new exact values, and updating
the test.

**Note:** Document the update procedure in a comment near the assertions.

---

### H8. Timer logic test thinness — LOW

**Files:**
- `tests/unit/timer-math.test.ts` (23 lines)
- `tests/unit/format-time.test.ts` (40 lines)

**Problem:** The timer implementation (`use-timer.ts`, 206 lines) handles
complex concerns: `performance.now()` timing, `sessionStorage` persistence,
`setTimeout` chain alignment to second boundaries (drift prevention),
`visibilitychange` pause/resume, and React lifecycle coordination. The
unit tests cover only the pure math functions (`timer-math.ts`, 20 lines)
and the formatting functions (`format-time.ts`), not the timer hook itself.

The actual timer lifecycle is only indirectly tested via E2E
(`route-accessibility.spec.ts` lines 42-65), which verifies that a timer
element exists and updates, but does not test accuracy, drift prevention,
or pause/resume behavior.

**Impact:** Regressions in timer accuracy, drift prevention, or
visibility-change handling would not be caught by unit tests.

**Fix:** Extract the timer logic from the React hook into a testable
class or set of functions, then test:
- Accuracy over simulated time spans
- Drift correction behavior
- Pause/resume on visibility change
- sessionStorage persistence and recovery

---

### H9. Editor validation edge cases — LOW

**File:** `tests/unit/editor-model.test.ts`

**Problem:** The editor model tests cover 22 labels and basic validation
(missing robot, unmatched boxes/goals) but do not test:
- Maximum board sizes (20x20 per `MAX_SIZE` in `editor-serialization.ts`)
- Minimum board sizes (3x3 per `MIN_SIZE`)
- Performance of editor operations on large grids
- Resize behavior near boundaries
- Undo/redo within the editor (if supported)

**Impact:** Edge cases in board sizing could produce crashes or unexpected
behavior in the editor.

**Fix:** Add boundary tests for `MIN_SIZE` and `MAX_SIZE`, plus a resize
test that crosses the boundary in each direction.

---

## I. BUILD AND INFRASTRUCTURE ISSUES

### I1. Audit item S3 still in progress — INFO

**File:** `AUDIT-TRACKER.md`

**Problem:** Item S3 (generated classic engine boundary) is the only audit
item still marked `IN PROGRESS`. It concerns the generated
`engine.generated.js` file, which is a large, weakly-checked boundary
between the TypeScript codebase and the compiled Sokomind engine.

**Impact:** The generated engine code is trusted at the boundary without
structural validation. If the generated code changes format, errors may
not be caught.

**Note:** This is tracked in the project's own audit system.

---

### I2. Missing WASM binary documentation — LOW

**File:** `src/solver/implementations/sokomind-engine/engine.generated.d.ts`

**Problem:** The `.d.ts` type declarations reference an `engine.generated.js`
module, but neither the source code nor build instructions for this module
are in the repository. It is unclear whether it is:
- Built from a separate repository
- Generated by a build script not checked in
- A manually compiled artifact

**Impact:** A new developer cannot rebuild the WASM engine from source
without external documentation.

**Fix:** Add a comment in `engine.generated.d.ts` or a `README.md` in the
`sokomind-engine/` directory explaining:
- Where the source lives
- How to rebuild the generated file
- What version/commit of the source was used

---

## SUMMARY

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 2 | A1, A2 |
| HIGH | 3 | B1, C1, D1 |
| MEDIUM | 9 | B2, B3, B4, C2, C3, C4, E1, E4, F1, G1, H1, H2 |
| LOW | 15 | A3, B5, B6, C5, C6, D2, E2, E3, E5, F2, F3, F4, G2, G3, H3-H9, I2 |
| INFO | 6 | C7, D3, E6, F5, G4, H7, I1 |

### Recommended Fix Order

**Phase 1 — Correctness and Accessibility (1-2 days)**
1. A1: ConfirmDialog `useId()` fix
2. A2: ExperienceControls dialog semantics
3. B1: Validate JSON imports at catalog boundaries
4. B6: Move `document.title` into `useEffect`

**Phase 2 — Solver Performance (3-5 days)**
5. C1: Tighten IDA* heuristic with walk-cost estimate
6. C2: Persistent transposition table across IDA* iterations
7. B2: Skip solved-check on non-push moves

**Phase 3 — Robustness (2-3 days)**
8. D1: Add IndexedDB fallback for storage
9. B4: Add debug assertion to `canonicalBoxSignature`
10. D2: Feature-detect `BroadcastChannel`

**Phase 4 — Maintainability (3-5 days)**
11. F1: Extract shared catalog types
12. E4: Refactor dark theme to CSS custom properties
13. E1: Decompose large hooks

**Phase 5 — Test Coverage (2-3 days)**
14. H1: Add visual regression tests
15. H2: Add touch gesture E2E tests
16. H4: Add audio unit tests
