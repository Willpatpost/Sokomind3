# Persistence and sharing

Sokomind remains account-free and server-free. Attempts, personal bests, and
experience preferences are stored only in the current browser unless the user
chooses to export or share them.

## Storage records

All keys are namespaced because GitHub project pages under one user domain
share a Web Storage origin:

- `sokomind.session.v1` — current puzzle plus its canonical action log;
- `sokomind.progress.v1` — a versioned synchronization envelope containing the
  best completed route per puzzle;
- `sokomind.experience.v1` — audio, volume, and motion preferences;
- `sokomind.optimal.v2` — locally proven move records;
- `sokomind.reset.v1` — a retained cross-tab marker for a confirmed full-data
  reset.

Per-puzzle elapsed time uses the tab-private
`sokomind:timer:<puzzle-id>` session-storage namespace. The legacy exact key
`sokomind:timer` remains owned only so a full reset can remove it safely.

The storage adapter classifies unavailable-storage, security, quota, and
unknown failures. A deduplicated warning remains visible while any owned key
cannot be persisted and clears after a later successful write. Earlier storage
schemas remain readable for migration.

Progress writes re-read the latest stored snapshot before mutation. Tabs merge
same-generation records deterministically by move count and stable tie-breakers;
a reset advances the generation so a stale tab cannot resurrect cleared data.
The browser `storage` event propagates completions, imports, and resets without
requiring an account or server.

The error-recovery **Reset saved data** action clears every enumerated owned
local key and the owned timer namespace, writes an empty higher-generation
progress tombstone, and publishes the reset marker. Other active tabs clear
their private timers and reload at Home before their mounted attempt can save
stale data again. Prefix-adjacent and unrelated origin keys are preserved.

## Exact attempt recovery

The session record never stores trusted coordinates. It stores a puzzle ID and
compact `U`, `D`, `L`, and `R` actions. Recovery resolves the current catalog
puzzle and replays every action through the core transition. An unknown puzzle,
invalid character, excessive log, or blocked action fails closed to a clean
room.

This same replay rule is used for shared solution fragments and solver result
verification. There is only one definition of a legal player transition.

## URLs and browser history

Puzzle routes use a GitHub Pages-safe hash:

```text
#/play/huge
#/play/ultra-tiny?play=D
```

Selecting a puzzle adds a browser-history entry. A Share action includes the
current route when it is at most 2,000 actions; longer attempts share the
puzzle only. Loading an edited or illegal replay still opens the named puzzle
but never trusts the bad state.

## Progress backups

The Progress dialog exports readable versioned JSON. Import validates the
schema and merges records rather than replacing them. The better record is the
one with fewer moves, and its original completion timestamp is preserved.

Reset progress writes a new empty synchronization generation after explicit
confirmation. It does not change the current attempt or experience preferences,
and open tabs converge on the reset generation.
