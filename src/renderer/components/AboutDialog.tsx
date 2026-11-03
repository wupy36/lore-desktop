import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "../api/client";
import { Modal } from "./Modal";

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const about = useQuery({ queryKey: ["about"], queryFn: () => api.invoke("app:about", undefined) }).data;
  const [license, setLicense] = useState<{ title: string; text: string } | null>(null);

  const show = async (id: string, title: string) => {
    const { text } = await api.invoke("app:license", { id });
    if (text !== null) setLicense({ title, text });
  };

  return (
    <Modal title="About Lore Desktop" onClose={onClose} width={760}>
      {about && (
        <dl className="kv" style={{ gridTemplateColumns: "120px 1fr" }}>
          <dt>Version</dt>
          <dd>{about.version}</dd>
          <dt>Lore backend</dt>
          <dd>
            {about.backend}
            {about.sdkVersion ? ` · @lore-vcs/sdk ${about.sdkVersion}` : ""}
          </dd>
          <dt>Electron</dt>
          <dd>
            {about.electron} (Chromium {about.chrome}, Node {about.node})
          </dd>
          <dt>Platform</dt>
          <dd>
            {about.platform} {about.arch}
          </dd>
          <dt>Settings</dt>
          <dd className="mono">{about.userData}</dd>
        </dl>
      )}
      <p className="hint" style={{ padding: "0 8px" }}>
        Community project, not affiliated with or endorsed by Epic Games. “Lore” is a trademark of Epic Games, Inc.
      </p>
      <div className="group-title">Licenses</div>
      {about?.licenses.map((l) => (
        <div key={l.id} className="list-row" tabIndex={0} onClick={() => void show(l.id, l.title)} onKeyDown={(e) => e.key === "Enter" && void show(l.id, l.title)}>
          <span>📄</span>
          <span className="grow">{l.title}</span>
          {l.external && <span className="hint">external</span>}
        </div>
      ))}
      {about && about.licenses.length === 0 && <div className="empty">License files are bundled with packaged builds.</div>}
      {license && (
        <>
          <div className="group-title">{license.title}</div>
          <pre className="license-text" aria-label={`${license.title} license text`}>
            {license.text}
          </pre>
        </>
      )}
    </Modal>
  );
}
