"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 上架 an n8n workflow (member form) and the administrator's two publishing switches. Every rule is on the server (n8n/publish.ts).
import { useEffect, useState, type FormEvent } from "react";
import { tr } from "../pages/i18n";
import { Select, api } from "./kit";

type Policy = { who: string; whoGroupIds: string[]; visibility: string };
type G = { id: string; name: string };

export function N8nPublishForm() {
  const [info, setInfo] = useState<{ policy: Policy; may: { ok: boolean }; groups: G[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", label: "", description: "", url: "", method: "POST" });
  const [pick, setPick] = useState<string[]>([]);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [admin, setAdmin] = useState(false);
  useEffect(() => { void api<{ policy: Policy; may: { ok: boolean }; groups: G[] }>("n8n/publish").then((r) => { if (r.ok) setInfo(r.data); }); void api<{ role?: string }>("me").then((r) => setAdmin(r.data.role === "admin")); }, []);
  if (!info) return null;
  const choose = admin || info.policy.visibility === "choose";
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setMsg("");
    const r = await api<{ published?: boolean }>("n8n/publish", "POST", { ...f, groupIds: choose ? pick : [] });
    if (!r.ok) { setErr(r.data.error ?? tr("error")); return; }
    setMsg(r.data.published ? tr("pubDone") : tr("pubSent")); setOpen(false); setF({ name: "", label: "", description: "", url: "", method: "POST" });
  };
  return (
    <div className="tgx-card" data-tg-n8n-publish style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span><strong>{tr("pubTitle")}</strong><br /><span className="tgx-muted" style={{ fontSize: 12 }}>{tr("pubIntro")}</span></span>
        {info.may.ok ? <button type="button" className="tgx-btn" onClick={() => setOpen(!open)}>{tr("pubOpen")}</button> : <span className="tgx-muted">{tr("pubNo")}</span>}
      </div>
      {msg && <div role="status">{msg}</div>}
      {open && (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label>{tr("pubName")}<input className="tgx-input" style={{ width: "100%" }} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label>{tr("pubLabel")}<input className="tgx-input" style={{ width: "100%" }} value={f.label} maxLength={40} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
          <label>{tr("pubDesc")}<input className="tgx-input" style={{ width: "100%" }} value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} required /></label>
          <label>{tr("pubUrl")}<input className="tgx-input" style={{ width: "100%" }} type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} required /></label>
          <label>{tr("whMethod")}<select className="tgx-input" style={{ width: "100%" }} data-testid="pub-method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="POST">POST</option><option value="GET">GET</option></select><span className="tgx-muted" style={{ fontSize: 12 }}>{tr("whMethodHint")}</span></label>
          {choose && (
            <div><strong>{tr("pubWho")}</strong>
              {[{ id: "*", name: tr("pubEveryone") }, ...info.groups].map((g) => (
                <label key={g.id} style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={pick.includes(g.id)} onChange={(e) => setPick(e.target.checked ? [...pick, g.id] : pick.filter((x) => x !== g.id))} />{g.name}</label>))}
            </div>)}
          {err && <div className="tgx-err" role="alert">{err}</div>}
          <div><button className="tgx-btn primary">{admin ? tr("pubSubmitAdmin") : tr("pubSubmit")}</button></div>
        </form>)}
    </div>);
}

export function N8nPublishPolicy() {
  const [p, setP] = useState<Policy | null>(null);
  const [groups, setGroups] = useState<G[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { void api<{ policy: Policy }>("admin/n8n/publish-policy").then((r) => { if (r.ok) setP(r.data.policy); }); void api<{ groups: G[] }>("admin/groups").then((r) => { if (r.ok) setGroups(r.data.groups); }); }, []);
  if (!p) return null;
  const save = async (next: Policy) => { setP(next); const r = await api("admin/n8n/publish-policy", "PUT", next); setErr(r.ok ? "" : (r.data.error ?? tr("error"))); };
  return (
    <div className="tgx-card" data-tg-publish-policy style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>{tr("polTitle")}</strong>
      <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("polReview")}</span>
      <label>{tr("polWho")}<br /><Select ariaLabel={tr("polWho")} width={240} value={p.who} onChange={(v) => void save({ ...p, who: v })} options={[{ value: "all", label: tr("polWhoAll") }, { value: "admin", label: tr("polWhoAdmin") }, { value: "groups", label: tr("polWhoGroups") }]} /></label>
      {p.who === "groups" && groups.map((g) => (
        <label key={g.id} style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={p.whoGroupIds.includes(g.id)} onChange={(e) => void save({ ...p, whoGroupIds: e.target.checked ? [...p.whoGroupIds, g.id] : p.whoGroupIds.filter((x) => x !== g.id) })} />{g.name}</label>))}
      <label>{tr("polVis")}<br /><Select ariaLabel={tr("polVis")} width={240} value={p.visibility} onChange={(v) => void save({ ...p, visibility: v })} options={[{ value: "all", label: tr("polVisAll") }, { value: "own", label: tr("polVisOwn") }, { value: "choose", label: tr("polVisChoose") }]} /></label>
      {err && <div className="tgx-err" role="alert">{err}</div>}
    </div>);
}
