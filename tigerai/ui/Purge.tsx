"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 永久刪除個人資料, two steps: list what goes, then type the person's e-mail. The server checks both (accounts/purge.ts).
import { useEffect, useState } from "react";
import { tr } from "../pages/i18n";
import { Modal, api } from "./kit";

type Preview = { person: { id: string; name: string; email: string }; items: { key: string; label: string; count: number }[]; kept: { label: string; count: number }[] };

export function PurgeDialog({ userId, onClose, onDone }: { userId: string; onClose: () => void; onDone: () => void }) {
  const [pv, setPv] = useState<Preview | null>(null);
  const [step, setStep] = useState(1);
  const [typed, setTyped] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { void api<Preview>(`admin/users/${userId}/purge`).then((r) => { if (r.ok) setPv(r.data); else setErr(r.data.error ?? tr("error")); }); }, [userId]);
  const go = async () => {
    setBusy(true); setErr("");
    const r = await api(`admin/users/${userId}/purge`, "POST", { confirmEmail: typed });
    setBusy(false);
    if (!r.ok) { setErr(r.data.error ?? tr("error")); return; }
    onDone();
  };
  return (
    <Modal title={tr("purgeTitle")} size="md" onClose={onClose}>
      <div style={{ padding: "12px 18px 18px", display: "flex", flexDirection: "column", gap: 10 }} data-tg-purge>
        <div className="tgx-muted">{tr("purgeIntro")}</div>
        {pv && <div><strong>{pv.person.name}</strong> <span className="tgx-muted">{pv.person.email}</span></div>}
        {pv && step === 1 && (<>
          <strong>{tr("purgeList")}</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{pv.items.map((i) => <li key={i.key}>{i.label}:{i.count}</li>)}</ul>
          <strong>{tr("purgeKept")}</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{pv.kept.map((i) => <li key={i.label}>{i.label}:{i.count}</li>)}</ul>
          <div style={{ display: "flex", gap: 8 }}><button className="tgx-btn" onClick={onClose}>{tr("purgeCancel")}</button><button className="tgx-btn primary" onClick={() => setStep(2)}>{tr("purgeNext")}</button></div>
        </>)}
        {pv && step === 2 && (<>
          <label>{tr("purgeType")}<input className="tgx-input" style={{ width: "100%" }} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={pv.person.email} /></label>
          <div style={{ display: "flex", gap: 8 }}><button className="tgx-btn" onClick={onClose}>{tr("purgeCancel")}</button><button className="tgx-btn primary" disabled={busy || typed.trim().toLowerCase() !== pv.person.email.toLowerCase()} onClick={() => void go()}>{tr("purgeDo")}</button></div>
        </>)}
        {err && <div className="tgx-err" role="alert">{err}</div>}
      </div>
    </Modal>);
}
