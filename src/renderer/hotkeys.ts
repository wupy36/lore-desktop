import { useEffect } from "react";
import { useActions } from "./actions";
import { useUi } from "./store/ui";

/** Global hotkeys. Ctrl+Enter (commit) is handled by the message box itself. */
export function useHotkeys() {
  const a = useActions();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "F5") {
        e.preventDefault();
        void a.refresh(true);
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void a.sync();
      } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUi.getState().setModal("palette");
      } else if (ctrl && e.key === ",") {
        e.preventDefault();
        useUi.getState().setModal("preferences");
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        useUi.getState().setModal("createRepository");
      } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void a.pickRepository();
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        void a.push();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a]);
}
