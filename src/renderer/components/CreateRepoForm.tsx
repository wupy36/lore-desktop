import { useState } from "react";
import { useActions } from "../actions";

/** `lore repository create`. Without a server URL it creates a local-only repository (`--offline <name>`). */
export function CreateRepoForm({ onDone }: { onDone?: () => void }) {
  const a = useActions();
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [server, setServer] = useState("");
  const nameOk = /^[\w.-]+$/.test(name);
  const serverOk = !server || /^lores?:\/\/[^/]+\/?$/.test(server.trim());
  const sep = parent.includes("\\") ? "\\" : "/";
  const path = parent && nameOk ? `${parent.replace(/[\\/]+$/, "")}${sep}${name}` : "";
  const valid = !!path && serverOk;
  const remote = server.trim().replace(/\/+$/, "");
  const cmd = remote ? `lore repository create ${remote}/${name}` : `lore --offline repository create ${name}`;

  return (
    <form
      className="clone-form"
      aria-label="Create repository"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void a.createRepository({ path, name, ...(remote ? { remoteUrl: remote } : {}) }).then(() => onDone?.());
      }}
    >
      <div className="group-title">New repository</div>
      <div className="row" style={{ padding: 6 }}>
        <input className="input" style={{ flex: 1 }} placeholder="Name, e.g. MyGame" value={name} onChange={(e) => setName(e.target.value)} aria-label="Repository name" />
      </div>
      <div className="row" style={{ padding: "0 6px 6px" }}>
        <input className="input" style={{ flex: 1 }} placeholder="Parent folder" value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Repository parent folder" />
        <button type="button" className="mini" onClick={() => void a.pickFolder("Create repository in folder").then((p) => p && setParent(p))}>
          Browse…
        </button>
      </div>
      <div className="row" style={{ padding: "0 6px 6px" }}>
        <input className="input" style={{ flex: 1 }} placeholder="Server (optional), e.g. lore://127.0.0.1:41337" value={server} onChange={(e) => setServer(e.target.value)} aria-label="Server URL" />
        <button type="submit" className="btn primary" disabled={!valid} title={cmd}>
          Create
        </button>
      </div>
      <div className="hint" style={{ padding: "0 8px 6px" }}>
        {!name ? "Letters, digits, . _ - only." : !nameOk ? "Name may only contain letters, digits, . _ -" : !serverOk ? "Server must look like lore://host:port" : path ? <span className="mono">{cmd} → {path}</span> : "Choose a parent folder."}
        {!remote && name && nameOk && " · local only: add a server later to push."}
      </div>
    </form>
  );
}
