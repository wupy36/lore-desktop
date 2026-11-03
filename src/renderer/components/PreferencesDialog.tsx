import { useState } from "react";
import type { Prefs } from "@shared/types";
import { useActions } from "../actions";
import { usePrefs } from "../api/queries";
import { Modal } from "./Modal";

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="pref-row">
      <div className="pref-label">
        <div>{label}</div>
        {desc && <div className="hint">{desc}</div>}
      </div>
      <div className="pref-control">{children}</div>
    </div>
  );
}

const Check = ({ k, prefs, set }: { k: keyof Prefs; prefs: Prefs; set: (p: Partial<Prefs>) => void }) => (
  <input type="checkbox" checked={prefs[k] as boolean} onChange={(e) => set({ [k]: e.target.checked })} aria-label={k} />
);

/** Text prefs commit on blur/Enter, so a half-typed path is never saved. */
function TextPref({ value, onCommit, placeholder, label }: { value: string; onCommit: (v: string) => void; placeholder?: string; label: string }) {
  const [v, setV] = useState(value);
  return (
    <input
      className="input mono"
      style={{ width: "100%" }}
      value={v}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === "Enter" && v !== value && onCommit(v)}
    />
  );
}

export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const prefs = usePrefs().data;
  const a = useActions();
  if (!prefs) return null;
  const set = (p: Partial<Prefs>) => void a.setPrefs(p);

  return (
    <Modal title="Preferences" onClose={onClose} width={720}>
      <h3 className="pref-section">Appearance</h3>
      <Row label="Theme">
        <select className="input" value={prefs.theme} onChange={(e) => set({ theme: e.target.value as Prefs["theme"] })} aria-label="Theme">
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">Follow system</option>
        </select>
      </Row>
      <Row label="Font size">
        <select className="input" value={prefs.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} aria-label="Font size">
          {[11, 12, 13, 14, 15, 16].map((n) => (
            <option key={n} value={n}>
              {n}px
            </option>
          ))}
        </select>
      </Row>
      <Row label="Row density" desc="Compact fits more files on screen; comfortable is easier to click.">
        <select className="input" value={prefs.density} onChange={(e) => set({ density: e.target.value as Prefs["density"] })} aria-label="Row density">
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
        </select>
      </Row>

      <h3 className="pref-section">Workspace</h3>
      <Row label="Reopen last repository on start">
        <Check k="reopenLastRepo" prefs={prefs} set={set} />
      </Row>
      <Row label="Refresh automatically" desc="Watch the working folder; changed files are reported to Lore (lore dirty) and re-checked.">
        <Check k="autoRefresh" prefs={prefs} set={set} />
      </Row>
      <Row label="Confirm before Reset" desc="Reset discards local changes and cannot be undone.">
        <Check k="confirmReset" prefs={prefs} set={set} />
      </Row>
      <Row label="Sync discards local modifications" desc="Toolbar Sync runs lore sync --reset: files changed both locally and incoming are overwritten.">
        <Check k="syncDiscardLocal" prefs={prefs} set={set} />
      </Row>

      <h3 className="pref-section">Tools</h3>
      <Row label="External diff tool" desc='Placeholders: {base} {local} {path}. Example: "C:\Program Files\Beyond Compare 4\BCompare.exe" "{base}" "{local}"'>
        <TextPref label="External diff tool" value={prefs.externalDiffTool} placeholder='code --diff "{base}" "{local}"' onCommit={(v) => set({ externalDiffTool: v })} />
      </Row>

      <h3 className="pref-section">Advanced</h3>
      <Row label="Lore library path" desc="Override the bundled Lore native library (LORE_LIB_PATH). Takes effect after restart.">
        <TextPref label="Lore library path" value={prefs.loreLibPath} placeholder="(bundled)" onCommit={(v) => set({ loreLibPath: v })} />
      </Row>
      <p className="hint" style={{ marginTop: 12 }}>Saved to the settings folder (Help → Open settings folder).</p>
    </Modal>
  );
}
