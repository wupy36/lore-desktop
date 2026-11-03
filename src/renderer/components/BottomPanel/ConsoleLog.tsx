import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useActivity } from "../../store/activity";
import { formatTime } from "../../selectors";

export function ConsoleLog() {
  const log = useActivity((s) => s.log);
  const ref = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: log.length, getScrollElement: () => ref.current, estimateSize: () => 20, overscan: 10 });
  const stick = useRef(true);

  useEffect(() => {
    if (stick.current && log.length) virt.scrollToIndex(log.length - 1, { align: "end" });
  }, [log.length, virt]);

  return (
    <div
      ref={ref}
      className="pane-body"
      style={{ background: "var(--bg-0)" }}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
      }}
      role="log"
      aria-label="Console log"
    >
      {log.length === 0 && <div className="empty">Every Lore call is logged here with its equivalent CLI command.</div>}
      <div style={{ height: virt.getTotalSize(), position: "relative" }}>
        {virt.getVirtualItems().map((vi) => {
          const e = log[vi.index];
          if (!e) return null;
          return (
            <div key={e.id} className={`log-row${e.ok === false ? " error" : ""}`} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }} title={JSON.stringify(e.args)}>
              <span className="t">{formatTime(e.ts).slice(11)}</span>
              <span className="b">{e.backend}</span>
              <span className="c">
                {e.command ?? e.op} <span style={{ color: "var(--text-faint)" }}>→ {e.message}</span>
              </span>
              <span className="d">{e.durationMs !== null ? `${e.durationMs.toFixed(0)} ms` : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
