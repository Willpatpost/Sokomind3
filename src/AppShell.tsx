import { lazy, Suspense, useEffect, useRef } from "react";
import { useRouter } from "@/src/router";

const HomePage = lazy(() =>
  import("@/src/features/home/HomePage").then((m) => ({ default: m.HomePage })),
);
const PuzzleSelectorPage = lazy(() =>
  import("@/src/features/selector/PuzzleSelectorPage").then((m) => ({
    default: m.PuzzleSelectorPage,
  })),
);
const PlayPage = lazy(() =>
  import("@/src/features/play/PlayPage").then((m) => ({ default: m.PlayPage })),
);
const EditorPage = lazy(() =>
  import("@/src/features/editor-page/EditorPage").then((m) => ({
    default: m.EditorPage,
  })),
);

const PAGE_LABELS: Record<string, string> = {
  home: "Home",
  puzzles: "Puzzles",
  "puzzles-difficulty": "Puzzles",
  "puzzles-collection": "Puzzles",
  play: "Play",
  editor: "Editor",
};

function LoadingFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>
      <span aria-busy="true">Loading...</span>
    </div>
  );
}

export function AppShell() {
  const { route } = useRouter();
  const announcerRef = useRef<HTMLDivElement>(null);
  const prevPage = useRef(route.page);

  useEffect(() => {
    if (prevPage.current !== route.page && announcerRef.current) {
      announcerRef.current.textContent = `Navigated to ${PAGE_LABELS[route.page] ?? route.page}`;
      prevPage.current = route.page;
    }
  }, [route.page]);

  return (
    <>
      <div
        ref={announcerRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      <Suspense fallback={<LoadingFallback />}>
        {route.page === "home" && <HomePage />}
        {(route.page === "puzzles" ||
          route.page === "puzzles-difficulty" ||
          route.page === "puzzles-collection") && (
          <PuzzleSelectorPage route={route} />
        )}
        {route.page === "play" && (
          <PlayPage puzzleId={route.puzzleId} actionLog={route.actionLog} />
        )}
        {route.page === "editor" && <EditorPage customData={route.customData} />}
      </Suspense>
    </>
  );
}
