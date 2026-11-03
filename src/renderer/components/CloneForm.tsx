import { useState } from "react";
import { useActions } from "../actions";
import { useUi } from "../store/ui";

/** `lore clone <url> <path>`. The target is `<parent folder>/<repository name>`, as the CLI defaults it. */
export function CloneForm({ defaultUrl = "" }: { defaultUrl?: string }) {
  const a = useActions();
  const [url, setUrl] = useState(defaultUrl);
  const [parent, setParent] = useState("");
  const name = url.replace(/\/+$/, "").split("/").pop() ?? "";
  const sep = parent.includes("\\") ? "\\" : "/";
  const target = parent && name ? `${parent.replace(/[\\/]+$/, "")}${sep}${name}` : "";
  const valid = /^lores?:\/\/[^/]+\/[^/]+/.test(url) && !!target;

  return (
    <form
      className="clone-form"
      aria-label="Clone repository"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void a.clone(url.trim(), target);
        useUi.getState().setBottomTab("transfers");
      }}
    >
      <div className="group-title">Clone</div>
      <div className="row" style={{ padding: 6 }}>
        <input className="input" style={{ flex: 1 }} placeholder="lore://host:41337/repository" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Repository URL" />
      </div>
      <div className="row" style={{ padding: "0 6px 6px" }}>
        <input className="input" style={{ flex: 1 }} placeholder="Parent folder" value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Parent folder" />
        <button type="button" className="mini" onClick={() => void a.pickFolder("Clone into folder").then((p) => p && setParent(p))}>
          Browse…
        </button>
        <button type="submit" className="btn primary" disabled={!valid} title={target ? `lore clone ${url} ${target}` : "Enter a URL and a folder"}>
          Clone
        </button>
      </div>
      {target && <div className="hint mono" style={{ padding: "0 8px 6px" }}>→ {target}</div>}
    </form>
  );
}
