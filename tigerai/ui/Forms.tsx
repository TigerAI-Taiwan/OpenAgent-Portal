"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 設定 › 表單 (administrators and department heads): import a form package (blank PDF + field map), switch it on or off, delete it, try the
// map with sample data. The server decides who may manage which form (a head only for departments they head); this page draws the answer.
import { useCallback, useEffect, useState } from "react";
import { trx as tr } from "../pages/i18n";
import "../pages/i18n-forms";
import { Modal, Switch, api, useConfirm } from "./kit";

type Form = { id: string; name: string; description: string; group_ids: string[]; enabled: boolean; fieldCount: number };
type Dept = { id: string; name: string };
type Check = { missing: { key: string; label: string }[]; errors: string[]; warnings: string[] };

const readB64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

export default function Forms() {
  const { ask, dialog } = useConfirm();
  const [forms, setForms] = useState<Form[] | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [fontReady, setFontReady] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [importing, setImporting] = useState(false);
  const [checking, setChecking] = useState<Form | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ forms: Form[]; departments: Dept[]; fontReady: boolean }>("forms/manage");
    if (!r.ok) { setError(r.data.error ?? tr("loadFail")); return; }
    setError(""); setForms(r.data.forms); setDepts(r.data.departments); setFontReady(r.data.fontReady);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const deptName = (id: string) => depts.find((d) => d.id === id)?.name ?? id;
  return (<>
    <p className="tgx-muted" style={{ marginTop: 0 }}>{tr("fmIntro")}</p>
    {!fontReady && <div className="tgx-err" role="alert" data-testid="forms-font-warning">{tr("fmFont")}</div>}
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {note && <div role="status">{note}</div>}
    <div style={{ margin: "8px 0" }}><button type="button" className="tgx-btn primary" onClick={() => setImporting(true)}>{tr("fmImport")}</button></div>
    {forms && forms.length === 0 && <div className="tgx-muted">{tr("fmNone")}</div>}
    {forms?.map((f) => (
      <div className="tgx-card" key={f.id} data-testid={`form-${f.name}`} style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <strong>{f.name} <span className="tgx-muted" style={{ fontWeight: 400 }}>· {tr("fmFields", { n: f.fieldCount })}</span></strong>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <Switch checked={f.enabled} label={`${tr("fmEnabled")} ${f.name}`} onChange={async (v) => { const r = await api(`forms/manage/${f.id}`, "PATCH", { enabled: v }); setError(r.ok ? "" : r.data.error ?? tr("error")); void load(); }} />
            <button type="button" className="tgx-btn" onClick={() => setChecking(f)}>{tr("fmCheck")}</button>
            <button type="button" className="tgx-btn" onClick={() => ask(tr("fmDelete", { name: f.name }), tr("delete"), async () => { const r = await api(`forms/manage/${f.id}`, "DELETE"); setError(r.ok ? "" : r.data.error ?? tr("error")); void load(); })}>{tr("delete")}</button>
          </span>
        </div>
        {f.description && <div className="tgx-muted" style={{ fontSize: 12 }}>{f.description}</div>}
        <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("fmDepsLabel")}: {f.group_ids.length === 0 ? tr("fmNoDept") : f.group_ids.map(deptName).join("、")}</div>
      </div>))}
    {importing && <ImportForm depts={depts} onClose={() => setImporting(false)} onDone={() => { setImporting(false); setNote(tr("fmSaved")); void load(); }} />}
    {checking && <CheckForm form={checking} onClose={() => setChecking(null)} />}
    {dialog}
  </>);
}

function ImportForm({ depts, onClose, onDone }: { depts: Dept[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [gids, setGids] = useState<string[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [def, setDef] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!pdf || !def) { setError(tr("fmPickFile")); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(await def.text()); } catch { setError(tr("fmBadDef")); return; }
    setBusy(true);
    const r = await api("forms/manage", "POST", { name, description, group_ids: gids, pdf_base64: await readB64(pdf), def: parsed });
    setBusy(false);
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    onDone();
  };
  return (
    <Modal title={tr("fmImport")} onClose={onClose} size="md">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label>{tr("fmName")}<input className="tgx-input" style={{ width: "100%" }} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <label>{tr("fmDesc")}<input className="tgx-input" style={{ width: "100%" }} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></label>
        <div>
          <strong>{tr("fmDepts")}</strong>
          {depts.length === 0 && <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("fmDeptsNone")}</div>}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
            {depts.map((d) => <label key={d.id}><input type="checkbox" checked={gids.includes(d.id)} onChange={() => setGids((x) => (x.includes(d.id) ? x.filter((y) => y !== d.id) : [...x, d.id]))} /> {d.name}</label>)}
          </div>
        </div>
        <label>{tr("fmPdf")}<input type="file" accept="application/pdf,.pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} /></label>
        <label>{tr("fmDef")}<input type="file" accept="application/json,.json" onChange={(e) => setDef(e.target.files?.[0] ?? null)} /></label>
        <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("fmDefHelp")}</div>
        {error && <div className="tgx-err" role="alert" style={{ whiteSpace: "pre-wrap" }}>{error}</div>}
        <div><button type="button" className="tgx-btn primary" disabled={busy || !name.trim()} onClick={() => void save()}>{tr("fmSave")}</button></div>
      </div>
    </Modal>
  );
}

function CheckForm({ form, onClose }: { form: Form; onClose: () => void }) {
  const [text, setText] = useState("{\n  \n}");
  const [result, setResult] = useState<Check | null>(null);
  const [error, setError] = useState("");
  const go = async () => {
    let data: unknown;
    try { data = JSON.parse(text); } catch { setError(tr("fmBadDef")); return; }
    const r = await api<Check>(`forms/manage/${form.id}/check`, "POST", { data });
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    setError(""); setResult(r.data);
  };
  return (
    <Modal title={`${tr("fmCheck")}:${form.name}`} onClose={onClose} size="md">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("fmCheckHelp")}</div>
        <textarea className="tgx-input" style={{ width: "100%", minHeight: 160, fontFamily: "var(--font-mono)" }} value={text} onChange={(e) => setText(e.target.value)} aria-label={tr("fmCheck")} />
        <div><button type="button" className="tgx-btn primary" onClick={() => void go()}>{tr("fmCheckGo")}</button></div>
        {error && <div className="tgx-err" role="alert">{error}</div>}
        {result && (<div role="status">
          {result.missing.length + result.errors.length === 0 && <div>{tr("fmCheckOk")}</div>}
          {result.missing.length > 0 && <div><strong>{tr("fmMissing")}</strong>: {result.missing.map((m) => m.label).join("、")}</div>}
          {result.errors.length > 0 && <div><strong>{tr("fmErrors")}</strong><ul>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
          {result.warnings.length > 0 && <div className="tgx-muted"><strong>{tr("fmWarnings")}</strong><ul>{result.warnings.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        </div>)}
      </div>
    </Modal>
  );
}
