"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 技能 → 可用技能: 「新增技能」 (write one from scratch), edit / delete / 送審 for the person's own, and the administrator's review list
// (read the full text, then 分享給全公司 or 這個單位). A skill is only words: sharing it grants nobody any permission.
import { useEffect, useState } from "react";
import { tr } from "../pages/i18n";
import { Dialog, Select, api, useConfirm } from "./kit";
import { useMe } from "./me";

type Draft = { title: string; description: string; steps: string };

export function SkillEditor({ name, onClose, onSaved }: { name: string | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [d, setD] = useState<Draft>({ title: "", description: "", steps: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (name) void api<{ skill: Draft }>(`skills/mine/${encodeURIComponent(name)}`).then((r) => { if (r.ok) setD({ title: r.data.skill.title, description: r.data.skill.description, steps: r.data.skill.steps }); else setErr(r.data.error ?? tr("loadFail")); }); }, [name]);
  const save = async () => {
    setBusy(true); setErr("");
    const r = name ? await api(`skills/mine/${encodeURIComponent(name)}`, "PUT", d) : await api("skills/mine", "POST", d);
    setBusy(false);
    if (!r.ok) { setErr(r.data.error ?? tr("error")); return; }
    onSaved(tr("skSaved")); onClose();
  };
  return (
    <Dialog title={name ? tr("skEditTitle") : tr("skNew")} onClose={onClose} size="md">
      <label>{tr("skFieldName")}<br /><input className="tgx-input" data-tg-skill-title style={{ width: "100%" }} maxLength={60} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} autoFocus /></label>
      <label>{tr("skFieldDesc")}<br /><input className="tgx-input" data-tg-skill-desc style={{ width: "100%" }} maxLength={300} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></label>
      <label>{tr("skFieldSteps")}<br /><textarea className="tgx-input" data-tg-skill-steps style={{ width: "100%", minHeight: 180 }} value={d.steps} onChange={(e) => setD({ ...d, steps: e.target.value })} /></label>
      <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("skNoPerm")}</div>
      {err && <div className="tgx-err" role="alert">{err}</div>}
      <div className="tgx-actions">
        <button className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
        <button className="tgx-btn primary" data-tg-skill-save disabled={busy || !d.title.trim() || !d.description.trim() || !d.steps.trim()} onClick={() => void save()}>{tr("skSave")}</button>
      </div>
    </Dialog>
  );
}

/** Row buttons for a skill the person owns (a skill whose folder name starts with my-). */
export function MineActions({ name, onChanged, setMsg }: { name: string; onChanged: () => void; setMsg: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const { ask, dialog } = useConfirm();
  const del = () => ask(tr("skDeleteAsk"), tr("skDelete"), async () => { const r = await api(`skills/mine/${encodeURIComponent(name)}`, "DELETE"); if (r.ok) { setMsg(tr("skDeleted")); onChanged(); } else setMsg(r.data.error ?? tr("error")); });
  const submit = async () => { const r = await api(`skills/mine/${encodeURIComponent(name)}/submit`, "POST", {}); setMsg(r.ok ? tr("skSubmitted") : r.data.error ?? tr("error")); };
  return (<>
    <button type="button" className="tgx-btn" onClick={() => setEditing(true)}>{tr("skEdit")}</button>
    <button type="button" className="tgx-btn" onClick={() => void submit()}>{tr("skSubmit")}</button>
    <button type="button" className="tgx-btn" onClick={del}>{tr("skDelete")}</button>
    {editing && <SkillEditor name={name} onClose={() => setEditing(false)} onSaved={(m) => { setMsg(m); onChanged(); }} />}
    {dialog}
  </>);
}

type Sub = { userId: string; name: string; title: string; description: string; steps: string; at: number };
/** Administrators: skills their owners asked to share. They read the whole text before choosing where it goes. */
export function SkillReview({ onShared }: { onShared: () => void }) {
  const { me } = useMe();
  const [rows, setRows] = useState<Sub[] | null>(null); const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [unit, setUnit] = useState(""); const [msg, setMsg] = useState("");
  const load = () => { void api<{ skills: Sub[]; units: { id: string; name: string }[] }>("admin/skills/submitted").then((r) => { if (r.ok) { setRows(r.data.skills); setUnits(r.data.units); } }); };
  useEffect(() => { if (me?.role === "admin") load(); }, [me?.role]);
  if (me?.role !== "admin" || !rows || rows.length === 0) return null;
  const share = async (s: Sub, scope: "company" | "unit") => {
    const r = await api("admin/skills/share", "POST", { userId: s.userId, name: s.name, scope, unitId: scope === "unit" ? unit : undefined });
    if (r.ok) { setMsg(tr("skShared")); load(); onShared(); } else setMsg(r.data.error ?? tr("error"));
  };
  const reject = async (s: Sub) => { await api("admin/skills/reject", "POST", { userId: s.userId, name: s.name }); load(); };
  return (
    <div className="tgx-card" data-tg-skill-review style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>{tr("skReviewTitle")}</strong>
      <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("skReviewHelp")}</span>
      {rows.map((s) => (
        <div key={`${s.userId}/${s.name}`} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <strong>{s.title}</strong> <span className="tgx-muted" style={{ fontSize: 12 }}>{s.description}</span>
          <pre style={{ whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto", fontSize: 12, margin: "6px 0" }}>{s.steps}</pre>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="tgx-btn primary" onClick={() => void share(s, "company")}>{tr("skShareCompany")}</button>
            <Select ariaLabel={tr("skShareUnit")} width={180} value={unit} onChange={setUnit} placeholder={tr("skShareUnit")} options={units.map((u) => ({ value: u.id, label: u.name }))} />
            <button type="button" className="tgx-btn" disabled={!unit} onClick={() => void share(s, "unit")}>{tr("skShareUnitDo")}</button>
            <button type="button" className="tgx-btn" onClick={() => void reject(s)}>{tr("skReject")}</button>
          </div>
        </div>))}
      {msg && <div role="status">{msg}</div>}
    </div>);
}
