import { useEffect } from "react";
import { useActions } from "./actions";

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
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        void a.push();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a]);
}
