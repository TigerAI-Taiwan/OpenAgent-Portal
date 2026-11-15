"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 系統狀態: version, uptime, database size, backup file names. For administrators and the maintenance account (counts, no people).
import { useEffect, useState } from "react";
import { fmtDateTime, tr } from "../pages/i18n";
import { api } from "./kit";

type Status = { version: string; uptimeSec: number; database: { bytes: number }; counts: { accounts: number; channels: number }; backups: { name: string; bytes: number; modified: number }[] };
const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function SystemStatus() {
  const [s, setS] = useState<Status | null>(null); const [err, setErr] = useState("");
  useEffect(() => { void api<Status>("admin/system").then((r) => { if (r.ok) setS(r.data); else setErr(r.data.error ?? tr("loadFail")); }); }, []);
  if (!s) return <div className="tgx-muted">{err || tr("loading")}</div>;
  const hours = Math.floor(s.uptimeSec / 3600), mins = Math.floor((s.uptimeSec % 3600) / 60);
  return (
    <div className="tgx-card" data-tg-system style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div>{tr("sysVersion")}:<strong>{s.version}</strong></div>
      <div>{tr("sysUptime")}:{hours} 小時 {mins} 分</div>
      <div>{tr("sysDb")}:{mb(s.database.bytes)}</div>
      <div>{tr("sysCounts")}:{s.counts.accounts} / {s.counts.channels}</div>
      <div><strong>{tr("sysBackups")}</strong>{s.backups.length === 0 ? <div className="tgx-muted">{tr("sysNoBackups")}</div> : s.backups.map((b) => <div key={b.name}>{b.name} · {mb(b.bytes)} · {fmtDateTime(b.modified)}</div>)}</div>
      <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("sysNote")}</span>
    </div>);
}
