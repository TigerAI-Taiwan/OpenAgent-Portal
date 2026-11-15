"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 設定 → 管理: the idle sign-out minutes (default 30; off allowed).
import { useEffect, useState } from "react";
import { tr } from "../pages/i18n";
import { Switch, api } from "./kit";

export function IdleAdmin() {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [draft, setDraft] = useState("30"); const [err, setErr] = useState("");
  useEffect(() => { void api<{ minutes: number }>("admin/idle").then((r) => { if (r.ok) { setMinutes(r.data.minutes); setDraft(String(r.data.minutes || 30)); } }); }, []);
  if (minutes === null) return null;
  const save = async (n: number) => { const r = await api<{ minutes: number }>("admin/idle", "PUT", { minutes: n }); if (r.ok) { setMinutes(r.data.minutes); setErr(""); } else setErr(r.data.error ?? tr("error")); };
  return (
    <div className="tgx-card" data-tg-idle-admin style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>{tr("idleTitle")}</strong>
      <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("idleHelp")}</span>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Switch checked={minutes > 0} label={tr("idleTitle")} onChange={(on) => void save(on ? Math.max(1, Number(draft) || 30) : 0)} />
        {minutes > 0 && (<>
          <label>{tr("idleMinutes")} <input className="tgx-input" style={{ width: 80 }} type="number" min={1} max={1440} value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
          <button type="button" className="tgx-btn" onClick={() => void save(Number(draft))}>{tr("idleSave")}</button>
        </>)}
      </div>
      {err && <div className="tgx-err" role="alert">{err}</div>}
    </div>);
}
