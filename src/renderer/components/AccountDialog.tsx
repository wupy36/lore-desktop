import { useState } from "react";
import { useActions } from "../actions";
import { useAuth, usePrefs } from "../api/queries";
import { useUi } from "../store/ui";
import { Modal } from "./Modal";

/** Identity + server sign-in. Reads identity; never stores credentials itself (Lore keeps tokens in the OS secure store). */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const prefs = usePrefs().data;
  const prompt = useUi((s) => s.authPrompt);
  const a = useActions();
  const [identity, setIdentity] = useState(prefs?.identity ?? "");
  const [busy, setBusy] = useState(false);
  const info = auth.data;
  const sourceLabel = { preference: "set in Preferences (--identity)", repository: "from .lore/config.toml", none: "not set" } as const;

  return (
    <Modal title="Account" onClose={onClose} width={620}>
      {auth.isLoading && <div className="empty">Checking…</div>}
      {auth.isError && <div className="empty">{auth.error.message}</div>}
      {info && (
        <>
          <dl className="kv" style={{ gridTemplateColumns: "130px 1fr" }}>
            <dt>Commit identity</dt>
            <dd>
              {info.identity ?? <span className="hint">none — commits record no author</span>} <span className="hint">({sourceLabel[info.identitySource]})</span>
            </dd>
            <dt>Server</dt>
            <dd className="mono">{info.remote ?? "local only"}</dd>
            <dt>Signed in</dt>
            <dd>{info.loggedIn ? `yes — ${info.user?.name ?? info.user?.id ?? ""}` : info.authSupported ? "no" : "not applicable"}</dd>
          </dl>
          {info.note && <p className="hint" style={{ padding: "0 8px" }}>{info.note}</p>}
          <div className="row" style={{ padding: 8 }}>
            {info.authSupported && !info.loggedIn && (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void a.login().finally(() => setBusy(false));
                }}
              >
                {busy ? "Waiting for browser…" : "Sign in…"}
              </button>
            )}
            {info.loggedIn && (
              <button className="btn" onClick={() => void a.logout()}>
                Sign out
              </button>
            )}
          </div>
          {prompt && (
            <div className="cli-hint" style={{ borderColor: "var(--accent)" }} role="status">
              Finish signing in in your browser{prompt.code ? <> and enter the code <b className="mono">{prompt.code}</b></> : null}:
              <code>
                <a href={prompt.url} target="_blank" rel="noreferrer">
                  {prompt.url}
                </a>
              </code>
            </div>
          )}
        </>
      )}
      <div className="group-title">Commit identity override</div>
      <form
        className="row"
        style={{ padding: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void a.setPrefs({ identity: identity.trim() }).then(() => auth.refetch());
        }}
      >
        <input className="input" style={{ flex: 1 }} placeholder="you@studio.dev (empty = use the repository's identity)" value={identity} onChange={(e) => setIdentity(e.target.value)} aria-label="Commit identity" />
        <button className="btn" type="submit">
          Save
        </button>
      </form>
      <p className="hint" style={{ padding: "0 8px" }}>
        Passed as <code>--identity</code> to every Lore call from this app. Recorded on commits as <code>committed-by</code>; on servers with authentication the signed-in user is authoritative.
      </p>
    </Modal>
  );
}
