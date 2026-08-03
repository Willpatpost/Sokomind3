import { AmbientBackdrop } from "@/src/features/experience";
import { RouterProvider } from "@/src/router";
import { PersistenceWarning } from "@/src/shared/ui/PersistenceWarning";
import { AppShell } from "./AppShell";

export function App() {
  return (
    <RouterProvider>
      <AmbientBackdrop />
      <AppShell />
      <PersistenceWarning />
    </RouterProvider>
  );
}
