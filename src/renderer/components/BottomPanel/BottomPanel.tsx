import { useActivity } from "../../store/activity";
import { useUi } from "../../store/ui";
import { ConsoleLog } from "./ConsoleLog";
import { LocksPanel } from "./LocksPanel";
import { TransferQueue } from "./TransferQueue";

export function BottomPanel() {
  const tab = useUi((s) => s.bottomTab);
  const setTab = useUi((s) => s.setBottomTab);
  const running = useActivity((s) => s.transfers.filter((t) => t.state === "running").length);
  const { clearLog, clearFinished } = useActivity.getState();
  return (
    <div className="pane bottom">
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === "console"} onClick={() => setTab("console")}>
          Console
        </button>
        <button className="tab" role="tab" aria-selected={tab === "transfers"} onClick={() => setTab("transfers")}>
          Transfers {running ? `(${running})` : ""}
        </button>
        <button className="tab" role="tab" aria-selected={tab === "locks"} onClick={() => setTab("locks")}>
          Locks
        </button>
        <span className="tspacer" />
        {tab !== "locks" && (
          <button className="mini" style={{ margin: 3 }} onClick={tab === "console" ? clearLog : clearFinished}>
            Clear
          </button>
        )}
      </div>
      {tab === "console" ? <ConsoleLog /> : tab === "transfers" ? <TransferQueue /> : <LocksPanel />}
    </div>
  );
}
