import { useStyleWorkshop } from "./hooks/useStyleWorkshop";
import { LibraryView } from "./views/LibraryView";
import { DetailView } from "./views/DetailView";

export default function StyleWorkshopPage() {
  const ws = useStyleWorkshop();

  if (ws.view === "library") return <LibraryView ws={ws} />;
  if (!ws.selectedProject) return null;
  return <DetailView ws={ws} />;
}
