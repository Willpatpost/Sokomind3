import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PUZZLE_METADATA,
  DIFFICULTY_ORDER,
  getMetadataCollectionsForDifficulty,
  getPuzzleMetadataByDifficulty,
  getMetadataBoxCounts,
  type PuzzleMetadata,
  type PuzzleDifficulty,
} from "@/src/catalog/puzzle-metadata";
import type { ProgressData } from "@/src/shared/progress";
import { useStoredProgress } from "@/src/shared/use-stored-progress";
import { isOptimal, loadOptimalCache } from "@/src/shared/optimal-cache";
import { ExperienceControls } from "@/src/features/experience";
import {
  useRouter,
  Link,
  homeHash,
  puzzlesHash,
  puzzleDifficultyHash,
  puzzleDifficultyPageHash,
  puzzleCollectionHash,
  puzzleCollectionPageHash,
  playHash,
} from "@/src/router";
import type { Route, RouterValue } from "@/src/router";
import styles from "./PuzzleSelectorPage.module.css";

const PUZZLES_PER_PAGE = 50;

const DIFFICULTY_LABELS: Record<PuzzleDifficulty, string> = {
  tutorial: "Tutorial",
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
  master: "Master",
};

const DIFFICULTY_COLORS: Record<PuzzleDifficulty, string> = {
  tutorial: "var(--sage-500)",
  beginner: "var(--sage-600)",
  intermediate: "var(--blue-500)",
  advanced: "var(--amber-500)",
  expert: "var(--coral-500)",
  master: "var(--ink-700)",
};

type CompletionFilter = "all" | "cleared" | "open";

type SelectorRoute = Extract<
  Route,
  { page: "puzzles" | "puzzles-difficulty" | "puzzles-collection" }
>;

interface PuzzleSelectorPageProps {
  readonly route: SelectorRoute;
}

export function PuzzleSelectorPage({ route }: PuzzleSelectorPageProps) {
  const { navigate } = useRouter();
  const progress = useStoredProgress();
  const completedIds = useMemo(
    () => new Set(Object.keys(progress.completed)),
    [progress],
  );
  const optimalCache = useMemo(() => loadOptimalCache(), []);

  useEffect(() => {
    if (route.page === "puzzles") {
      document.title = "Puzzles · Sokomind";
    } else if (route.page === "puzzles-difficulty") {
      document.title = `${DIFFICULTY_LABELS[route.difficulty]} Puzzles · Sokomind`;
    } else {
      document.title = `${route.collection} · Sokomind`;
    }
  }, [route]);

  const findNextUnsolved = useCallback(
    (puzzles: readonly PuzzleMetadata[]) => {
      return puzzles.find((p) => !completedIds.has(p.id))?.id;
    },
    [completedIds],
  );

  if (route.page === "puzzles") {
    return (
      <DifficultyGrid
        completedIds={completedIds}
        findNextUnsolved={findNextUnsolved}
        navigate={navigate}
      />
    );
  }

  if (route.page === "puzzles-difficulty") {
    const collections = getMetadataCollectionsForDifficulty(route.difficulty);
    if (collections.length === 1) {
      return (
        <PuzzleListView
          difficulty={route.difficulty}
          collection={collections[0].name}
          completedIds={completedIds}
          directDifficultyView
          optimalCache={optimalCache}
          progress={progress}
          navigate={navigate}
          pageNumber={route.pageNumber}
        />
      );
    }
    return (
      <CollectionGrid
        difficulty={route.difficulty}
        collections={collections}
        completedIds={completedIds}
        findNextUnsolved={findNextUnsolved}
        navigate={navigate}
      />
    );
  }

  return (
    <PuzzleListView
      difficulty={route.difficulty}
      collection={route.collection}
      completedIds={completedIds}
      optimalCache={optimalCache}
      progress={progress}
      navigate={navigate}
      pageNumber={route.pageNumber}
    />
  );
}

function DifficultyGrid({
  completedIds,
  findNextUnsolved,
  navigate,
}: {
  completedIds: ReadonlySet<string>;
  findNextUnsolved: (p: readonly PuzzleMetadata[]) => string | undefined;
  navigate: (hash: string) => void;
}) {
  const nextId = useMemo(
    () => findNextUnsolved(PUZZLE_METADATA),
    [findNextUnsolved],
  );

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <Link href={homeHash()} className={styles.backButton} aria-label="Back to home">
              <span aria-hidden="true">&larr;</span>
            </Link>
            <h1 className={styles.pageTitle}>Choose a difficulty</h1>
          </div>
          <ExperienceControls />
        </div>

        {nextId && (
          <button
            type="button"
            className={styles.nextButton}
            onClick={() => navigate(playHash(nextId))}
          >
            Play next unsolved
          </button>
        )}

        <div className={styles.grid}>
          {DIFFICULTY_ORDER.map((difficulty) => {
            const puzzles = getPuzzleMetadataByDifficulty(difficulty);
            const solved = puzzles.filter((p) => completedIds.has(p.id)).length;
            const pct = puzzles.length > 0 ? (solved / puzzles.length) * 100 : 0;
            return (
              <button
                key={difficulty}
                type="button"
                className={styles.difficultyCard}
                onClick={() => navigate(puzzleDifficultyHash(difficulty))}
              >
                <div className={styles.cardHeader}>
                  <span
                    className={styles.cardDot}
                    style={{ background: DIFFICULTY_COLORS[difficulty] }}
                  />
                  <h2 className={styles.cardName}>{DIFFICULTY_LABELS[difficulty]}</h2>
                </div>
                <div className={styles.cardStats}>
                  <strong>{solved}</strong> of {puzzles.length} cleared
                </div>
                <div className={styles.cardTrack}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function CollectionGrid({
  difficulty,
  collections,
  completedIds,
  findNextUnsolved,
  navigate,
}: {
  difficulty: PuzzleDifficulty;
  collections: readonly { name: string; count: number }[];
  completedIds: ReadonlySet<string>;
  findNextUnsolved: (p: readonly PuzzleMetadata[]) => string | undefined;
  navigate: (hash: string) => void;
}) {
  const puzzles = useMemo(
    () => getPuzzleMetadataByDifficulty(difficulty),
    [difficulty],
  );
  const nextId = useMemo(() => findNextUnsolved(puzzles), [findNextUnsolved, puzzles]);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <Link href={puzzlesHash()} className={styles.backButton} aria-label="Back to difficulties">
              <span aria-hidden="true">&larr;</span>
            </Link>
            <h1 className={styles.pageTitle}>{DIFFICULTY_LABELS[difficulty]}</h1>
          </div>
          <ExperienceControls />
        </div>

        <nav className={styles.breadcrumb}>
          <Link href={puzzlesHash()}>Puzzles</Link>
          <span>&rsaquo;</span>
          <span className={styles.breadcrumbCurrent}>{DIFFICULTY_LABELS[difficulty]}</span>
        </nav>

        {nextId && (
          <button
            type="button"
            className={styles.nextButton}
            onClick={() => navigate(playHash(nextId))}
          >
            Play next unsolved in {DIFFICULTY_LABELS[difficulty]}
          </button>
        )}

        <div className={styles.grid}>
          {collections.map((col) => {
            const colPuzzles = puzzles.filter(
              (p) => p.collection === col.name,
            );
            const solved = colPuzzles.filter((p) => completedIds.has(p.id)).length;
            const pct = col.count > 0 ? (solved / col.count) * 100 : 0;
            return (
              <button
                key={col.name}
                type="button"
                className={styles.collectionCard}
                onClick={() => navigate(puzzleCollectionHash(difficulty, col.name))}
              >
                <h2 className={styles.cardName}>{col.name}</h2>
                <div className={styles.cardStats}>
                  <strong>{solved}</strong> of {col.count} cleared
                </div>
                <div className={styles.cardTrack}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function PuzzleListView({
  difficulty,
  collection,
  completedIds,
  optimalCache,
  progress,
  navigate,
  pageNumber,
  directDifficultyView = false,
}: {
  difficulty: PuzzleDifficulty;
  collection: string;
  completedIds: ReadonlySet<string>;
  optimalCache: ReturnType<typeof loadOptimalCache>;
  progress: ProgressData;
  navigate: RouterValue["navigate"];
  pageNumber?: number;
  directDifficultyView?: boolean;
}) {
  const [boxFilter, setBoxFilter] = useState<number | null>(null);
  const [completionFilter, setCompletionFilter] = useState<CompletionFilter>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pageStatusRef = useRef<HTMLParagraphElement>(null);
  const previousPageNumberRef = useRef(pageNumber);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const allPuzzles = useMemo(
    () =>
      getPuzzleMetadataByDifficulty(difficulty).filter(
        (p) => p.collection === collection,
      ),
    [difficulty, collection],
  );

  const boxCounts = useMemo(
    () => getMetadataBoxCounts(difficulty, collection),
    [difficulty, collection],
  );

  const filteredPuzzles = useMemo(() => {
    const needle = debouncedQuery.trim().toLocaleLowerCase();
    return allPuzzles.filter((p) => {
      if (boxFilter !== null && p.boxes !== boxFilter) return false;
      if (completionFilter === "cleared" && !completedIds.has(p.id)) return false;
      if (completionFilter === "open" && completedIds.has(p.id)) return false;
      if (needle && !p.title.toLocaleLowerCase().includes(needle)) return false;
      return true;
    });
  }, [allPuzzles, boxFilter, completionFilter, completedIds, debouncedQuery]);

  const nextUnsolved = useMemo(
    () => allPuzzles.find((p) => !completedIds.has(p.id))?.id,
    [allPuzzles, completedIds],
  );

  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < allPuzzles.length; i++) map.set(allPuzzles[i].id, i);
    return map;
  }, [allPuzzles]);
  const viewLabel = directDifficultyView
    ? DIFFICULTY_LABELS[difficulty]
    : collection;
  const baseListHash = directDifficultyView
    ? puzzleDifficultyHash(difficulty)
    : puzzleCollectionHash(difficulty, collection);
  const pageHash = useCallback(
    (nextPage: number) => directDifficultyView
      ? puzzleDifficultyPageHash(difficulty, nextPage)
      : puzzleCollectionPageHash(difficulty, collection, nextPage),
    [collection, difficulty, directDifficultyView],
  );
  const pageCount = Math.max(
    1,
    Math.ceil(filteredPuzzles.length / PUZZLES_PER_PAGE),
  );
  const requestedPage = pageNumber ?? 1;
  const currentPage = Math.min(requestedPage, pageCount);
  const pageStart = (currentPage - 1) * PUZZLES_PER_PAGE;
  const visiblePuzzles = filteredPuzzles.slice(
    pageStart,
    pageStart + PUZZLES_PER_PAGE,
  );
  const firstResult = filteredPuzzles.length === 0 ? 0 : pageStart + 1;
  const lastResult = Math.min(
    pageStart + visiblePuzzles.length,
    filteredPuzzles.length,
  );

  const resetPagination = useCallback(() => {
    if (pageNumber !== undefined) navigate(baseListHash, { replace: true });
  }, [baseListHash, navigate, pageNumber]);

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setQuery(value);
      resetPagination();
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setDebouncedQuery(value), 150);
    },
    [resetPagination],
  );

  useEffect(() => {
    if (requestedPage === currentPage) return;
    navigate(pageHash(currentPage), { replace: true });
  }, [currentPage, navigate, pageHash, requestedPage]);

  useEffect(() => {
    if (previousPageNumberRef.current === pageNumber) return;
    previousPageNumberRef.current = pageNumber;
    pageStatusRef.current?.focus();
  }, [pageNumber]);

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <Link
              href={
                directDifficultyView
                  ? puzzlesHash()
                  : puzzleDifficultyHash(difficulty)
              }
              className={styles.backButton}
              aria-label={
                directDifficultyView
                  ? "Back to difficulties"
                  : "Back to collections"
              }
            >
              <span aria-hidden="true">&larr;</span>
            </Link>
            <h1 className={styles.pageTitle}>{viewLabel}</h1>
          </div>
          <ExperienceControls />
        </div>

        <nav className={styles.breadcrumb}>
          <Link href={puzzlesHash()}>Puzzles</Link>
          <span>&rsaquo;</span>
          {directDifficultyView ? (
            <span className={styles.breadcrumbCurrent}>
              {DIFFICULTY_LABELS[difficulty]}
            </span>
          ) : (
            <>
              <Link href={puzzleDifficultyHash(difficulty)}>
                {DIFFICULTY_LABELS[difficulty]}
              </Link>
              <span>&rsaquo;</span>
              <span className={styles.breadcrumbCurrent}>{collection}</span>
            </>
          )}
        </nav>

        {nextUnsolved && (
          <button
            type="button"
            className={styles.nextButton}
            onClick={() => navigate(playHash(nextUnsolved))}
          >
            Play next unsolved in {viewLabel}
          </button>
        )}

        <div className={styles.filters}>
          {boxCounts.length > 1 && (
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Boxes</span>
              <button
                type="button"
                className={styles.filterChip}
                data-active={boxFilter === null || undefined}
                aria-pressed={boxFilter === null}
                onClick={() => {
                  setBoxFilter(null);
                  resetPagination();
                }}
              >
                All
              </button>
              {boxCounts.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={styles.filterChip}
                  data-active={boxFilter === count || undefined}
                  aria-pressed={boxFilter === count}
                  onClick={() => {
                    setBoxFilter(count);
                    resetPagination();
                  }}
                >
                  {count}
                </button>
              ))}
            </div>
          )}

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Status</span>
            {(["all", "cleared", "open"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={styles.filterChip}
                data-active={completionFilter === value || undefined}
                aria-pressed={completionFilter === value}
                onClick={() => {
                  setCompletionFilter(value);
                  resetPagination();
                }}
              >
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>

          <label className={styles.search}>
            <span aria-hidden="true">&#x2315;</span>
            <input
              type="search"
              value={query}
              onChange={handleSearchChange}
              placeholder="Search"
            />
          </label>
        </div>

        {filteredPuzzles.length > 0 ? (
          <>
            <p
              className={styles.resultSummary}
              ref={pageStatusRef}
              role="status"
              tabIndex={-1}
            >
              Showing {firstResult}&ndash;{lastResult} of {filteredPuzzles.length}
              {" puzzles"}
            </p>
            <div className={styles.puzzleList}>
            {visiblePuzzles.map((puzzle) => {
              const complete = completedIds.has(puzzle.id);
              const record = progress.completed[puzzle.id];
              const optimal = record
                ? isOptimal(optimalCache, puzzle.id, record.moves)
                : false;
              const num = (indexMap.get(puzzle.id) ?? 0) + 1;
              return (
                <button
                  key={puzzle.id}
                  type="button"
                  className={styles.puzzleItem}
                  data-testid="puzzle-row"
                  onClick={() => navigate(playHash(puzzle.id))}
                >
                  <span className={styles.puzzleNumber}>
                    {String(num).padStart(2, "0")}
                  </span>
                  <span className={styles.puzzleCopy}>
                    <strong>{puzzle.title}</strong>
                    <small>
                      {puzzle.width} &times; {puzzle.height}
                      {" · "}
                      {puzzle.boxes} {puzzle.boxes === 1 ? "box" : "boxes"}
                    </small>
                  </span>
                  {complete && (
                    <span
                      className={styles.puzzleComplete}
                      style={optimal ? { color: "var(--amber-400)" } : undefined}
                    >
                      {optimal ? "★" : "✓"}
                    </span>
                  )}
                </button>
              );
            })}
            </div>
            {pageCount > 1 ? (
              <nav
                aria-label={`${viewLabel} puzzle pages`}
                className={styles.pagination}
              >
                {currentPage === 1 ? (
                  <span aria-disabled="true" className={styles.pageLink}>
                    Previous
                  </span>
                ) : (
                  <Link
                    className={styles.pageLink}
                    href={pageHash(currentPage - 1)}
                  >
                    Previous
                  </Link>
                )}
                <span className={styles.pageNumbers}>
                  {Array.from({ length: pageCount }, (_, index) => index + 1)
                    .map((number) => (
                      <Link
                        aria-current={number === currentPage ? "page" : undefined}
                        className={styles.pageLink}
                        href={pageHash(number)}
                        key={number}
                      >
                        {number}
                      </Link>
                    ))}
                </span>
                {currentPage === pageCount ? (
                  <span aria-disabled="true" className={styles.pageLink}>
                    Next
                  </span>
                ) : (
                  <Link
                    className={styles.pageLink}
                    href={pageHash(currentPage + 1)}
                  >
                    Next
                  </Link>
                )}
              </nav>
            ) : null}
          </>
        ) : (
          <div className={styles.empty}>
            <strong>No puzzles match</strong>
            <span>Try adjusting your filters.</span>
          </div>
        )}
      </div>
    </main>
  );
}
