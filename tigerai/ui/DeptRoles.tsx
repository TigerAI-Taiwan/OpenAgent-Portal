"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 部門 AI 角色: a department head (or an administrator) makes AI roles for their own department and puts lecture notes in them.
// The server decides everything (tigerai/knowledge/access.ts): this screen only shows what the server returned. Shared Modal and controls.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { localizeError, tr, type Key } from "../pages/i18n";
import { Modal, Select, api, useConfirm } from "./kit";

type Role = { id: string; name: string; description: string; system_prompt: string; enabled: boolean; group_ids: string[]; departments: string[]; canReadOnDemand: boolean };
type Dept = { id: string; name: string };
type Limits = { maxFileBytes: number; maxFiles: number; maxTotalBytes: number };
type KFile = { name: string; bytes: number; tokens: number; mode: "inline" | "ondemand"; mtime: number };
type Budget = { window: number; windowKnown: boolean; budgetTokens: number; usedTokens: number; percent: number; inline: string[]; onDemand: string[] };

const CSS = `
.tgk-row{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:14px;background:var(--bg-panel);margin-bottom:8px;flex-wrap:wrap}
.tgk-main{flex:1;min-width:160px;display:flex;flex-direction:column;gap:2px}
.tgk-acts{display:flex;gap:6px;flex-wrap:wrap}
.tgk-bar{height:10px;border-radius:999px;border:1px solid var(--border);background:var(--bg);overflow:hidden}
.tgk-bar>div{height:100%;background:var(--accent)}
.tgk-badge{font-size:11px;border:1px solid var(--border);border-radius:999px;padding:1px 8px;color:var(--text-muted);white-space:nowrap}
.tgk-badge.on{background:var(--bg-selected);color:var(--text)}
`;

const KN_ERR: Record<string, Key> = { bad_type: "knErrType", too_big: "knErrSize", not_text: "knErrText", forbidden: "knErrForbidden", too_many: "knErrTooMany", bad_name: "knErrName", empty: "knErrEmpty" };
const limitsVars = (l: Limits | null) => ({ file: Math.round((l?.maxFileBytes ?? 204800) / 1024) });
function errText(code: unknown, message: string, l: Limits | null): string {
  const key = typeof code === "string" ? KN_ERR[code] : undefined;
  return key ? tr(key, limitsVars(l)) : localizeError(code, message);
}

export default function DeptRoles() {
  const { ask, dialog } = useConfirm();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<{ role?: Role } | null>(null);
  const [files, setFiles] = useState<Role | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ roles: Role[]; departments: Dept[]; limits: Limits }>("knowledge/roles");
    if (r.ok) { setRoles(r.data.roles); setDepts(r.data.departments); setLimits(r.data.limits); setError(""); } else setError(r.status === 403 ? tr("knNoDept") : r.data.error ?? tr("loadFail"));
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!roles) return <div className="tgx-muted">{error || tr("loading")}</div>;
  return (<>
    <style>{CSS}</style>
    <div className="tgx-muted" style={{ marginBottom: 10 }}>{tr("knIntro")}</div>
    <div style={{ marginBottom: 10 }}><button type="button" className="tgx-btn primary" disabled={depts.length === 0} onClick={() => setForm({})}>{tr("knNewRole")}</button></div>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {roles.length === 0 && <div className="tgx-muted">{tr("knEmptyRoles")}</div>}
    {roles.map((a) => (
      <div className="tgk-row" key={a.id} data-tg-role={a.id} style={a.enabled ? undefined : { opacity: 0.6 }}>
        <span className="tgk-main">
          <strong>@{a.name}</strong>
          <span className="tgx-muted" style={{ fontSize: 12 }}>{a.departments.join("、") || tr("everyone")}{a.description ? ` · ${a.description}` : ""}</span>
        </span>
        <span className="tgk-acts">
          <button type="button" className="tgx-btn" onClick={() => setFiles(a)}>{tr("knFiles")}</button>
          <button type="button" className="tgx-btn" onClick={() => setForm({ role: a })}>{tr("agEdit")}</button>
          {a.enabled && <button type="button" className="tgx-btn" onClick={() => ask(tr("cfDisableRole", { name: a.name }), tr("knDisable"), async () => { const r = await api(`knowledge/roles/${a.id}`, "DELETE"); setError(r.ok ? "" : errText((r.data as { code?: string }).code, r.data.error ?? tr("error"), limits)); await load(); })}>{tr("knDisable")}</button>}
        </span>
      </div>))}
    {form && <RoleForm role={form.role} depts={depts} onClose={(changed) => { setForm(null); if (changed) void load(); }} />}
    {files && limits && <KnowledgeModal role={files} limits={limits} onClose={() => setFiles(null)} />}
    {dialog}
  </>);
}

function RoleForm({ role, depts, onClose }: { role?: Role; depts: Dept[]; onClose: (changed: boolean) => void }) {
  const [f, setF] = useState({ name: role?.name ?? "", description: role?.description ?? "", system_prompt: role?.system_prompt ?? "", group_id: depts[0]?.id ?? "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    const body = role ? { name: f.name, description: f.description, system_prompt: f.system_prompt } : f;
    const r = role ? await api(`knowledge/roles/${role.id}`, "PATCH", body) : await api("knowledge/roles", "POST", body);
    setBusy(false);
    if (!r.ok) { setError(errText((r.data as { code?: string }).code, r.data.error ?? tr("error"), null)); return; }
    onClose(true);
  };
  return (
    <Modal title={role ? tr("knEditRole") : tr("knNewRole")} size="md" onClose={() => onClose(false)}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="tgx-input" aria-label={tr("knRoleName")} placeholder={tr("knRoleName")} maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        <input className="tgx-input" aria-label={tr("knRoleDesc")} placeholder={tr("knRoleDesc")} maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <textarea className="tgx-input" rows={6} aria-label={tr("knRolePrompt")} placeholder={tr("knRolePrompt")} maxLength={4000} value={f.system_prompt} onChange={(e) => setF({ ...f, system_prompt: e.target.value })} />
        {!role && depts.length > 1 && <label style={{ display: "flex", gap: 8, alignItems: "center" }}>{tr("knDeptLabel")}<Select ariaLabel={tr("knDeptLabel")} value={f.group_id} options={depts.map((d) => ({ value: d.id, label: d.name }))} onChange={(v) => setF({ ...f, group_id: v })} width={220} /></label>}
        {!role && depts.length === 1 && <div className="tgx-muted">{tr("knDeptLabel")}:{depts[0].name}</div>}
        <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("knRoleNote")}</div>
        {error && <div className="tgx-err" role="alert">{error}</div>}
        <div className="tgx-actions">
          <button type="button" className="tgx-btn" onClick={() => onClose(false)}>{tr("cancel")}</button>
          <button className="tgx-btn primary" disabled={busy || !f.name.trim()}>{tr("save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function KnowledgeModal({ role, limits, onClose }: { role: Role; limits: Limits; onClose: () => void }) {
  const { ask, dialog } = useConfirm();
  const [files, setFiles] = useState<KFile[] | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [canRead, setCanRead] = useState(role.canReadOnDemand);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ files: KFile[]; budget: Budget; role: Role }>(`knowledge/roles/${role.id}/files`);
    if (r.ok) { setFiles(r.data.files); setBudget(r.data.budget); setCanRead(r.data.role.canReadOnDemand); } else setError(errText((r.data as { code?: string }).code, r.data.error ?? tr("loadFail"), limits));
  }, [role.id, limits]);
  useEffect(() => { void load(); }, [load]);

  const send = async (list: File[], forceName: string | null) => {
    setError(""); setNote("");
    let done = 0;
    for (const file of list) {
      const name = forceName ?? file.name;
      const res = await fetch(`/api/tg/knowledge/roles/${role.id}/files/${encodeURIComponent(name)}`, { method: "PUT", body: await file.arrayBuffer(), cache: "no-store" });
      if (res.ok) { done += 1; continue; }
      let j: { error?: string; code?: string } = {};
      try { j = await res.json(); } catch { /* empty */ }
      setError(`${name}:${errText(j.code, j.error ?? tr("error"), limits)}`);
      break;
    }
    if (done) setNote(tr("knUploaded", { n: done }));
    await load();
  };
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []); e.target.value = "";
    const target = replaceTarget.current; replaceTarget.current = null;
    if (list.length) void send(target ? list.slice(0, 1) : list, target);
  };
  const first = files?.filter((f) => f.mode === "ondemand")[0];
  return (
    <Modal title={tr("knTitle", { name: role.name })} size="lg" onClose={onClose}>
      <style>{CSS}</style>
      <input ref={pick} type="file" multiple accept=".md,.txt,text/markdown,text/plain" aria-label={tr("knUpload")} style={{ display: "none" }} onChange={onPick} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <button type="button" className="tgx-btn primary" onClick={() => { replaceTarget.current = null; pick.current?.click(); }}>{tr("knUpload")}</button>
        <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("knRule", { file: Math.round(limits.maxFileBytes / 1024), n: limits.maxFiles, total: limits.maxTotalBytes / 1024 / 1024 })}</span>
      </div>
      {budget && (
        <div className="tgx-card" style={{ padding: "10px 14px", marginBottom: 10 }} data-tg-budget>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><strong>{tr("knUsed", { n: budget.percent })}</strong><span className="tgx-muted" style={{ fontSize: 12 }}>{budget.windowKnown ? tr("knWindow", { window: budget.window.toLocaleString() }) : tr("knWindowUnknown", { window: budget.window.toLocaleString() })}</span></div>
          <div className="tgk-bar" role="progressbar" aria-valuenow={budget.percent} aria-valuemin={0} aria-valuemax={100} aria-label={tr("knUsed", { n: budget.percent })}><div style={{ width: `${budget.percent}%` }} /></div>
          <div className="tgx-muted" style={{ fontSize: 12, marginTop: 4 }}>{tr("knBudget", { budget: budget.budgetTokens.toLocaleString(), used: budget.usedTokens.toLocaleString() })}</div>
        </div>)}
      {first && <div className="tgx-muted" style={{ marginBottom: 8 }} role="status">{tr("knOverNote", { name: first.name })} {tr("knOnDemandNote")}</div>}
      {first && !canRead && <div className="tgx-err" role="alert">{tr("knNoRead")}</div>}
      {error && <div className="tgx-err" role="alert">{error}</div>}
      {note && <div className="tgx-muted" role="status" style={{ marginBottom: 8 }}>{note}</div>}
      {!files && <div className="tgx-muted">{tr("loading")}</div>}
      {files && files.length === 0 && <div className="tgx-muted">{tr("knEmptyFiles")}</div>}
      {files?.map((f) => (
        <div className="tgk-row" key={f.name} data-tg-file={f.name}>
          <span className="tgk-main"><strong style={{ overflowWrap: "anywhere" }}>{f.name}</strong><span className="tgx-muted" style={{ fontSize: 12 }}>{tr("knSize", { kb: Math.max(1, Math.round(f.bytes / 1024)) })}</span></span>
          <span className={`tgk-badge${f.mode === "inline" ? " on" : ""}`}>{f.mode === "inline" ? tr("knInline") : tr("knOnDemand")}</span>
          <span className="tgk-acts">
            <button type="button" className="tgx-btn" title={tr("knReplaceTip", { name: f.name })} onClick={() => { replaceTarget.current = f.name; pick.current?.click(); }}>{tr("knReplace")}</button>
            <a className="tgx-btn" style={{ textDecoration: "none" }} href={`/api/tg/knowledge/roles/${role.id}/files/${encodeURIComponent(f.name)}`} download={f.name}>{tr("knDownload")}</a>
            <button type="button" className="tgx-btn" onClick={() => ask(tr("knConfirmDelete", { name: f.name }), tr("knDelete"), async () => { const r = await api(`knowledge/roles/${role.id}/files/${encodeURIComponent(f.name)}`, "DELETE"); setError(r.ok ? "" : errText((r.data as { code?: string }).code, r.data.error ?? tr("error"), limits)); await load(); })}>{tr("knDelete")}</button>
          </span>
        </div>))}
      <div className="tgx-muted" style={{ fontSize: 12, marginTop: 8 }}>{tr("knNewConvNote")}</div>
      {dialog}
    </Modal>
  );
}
