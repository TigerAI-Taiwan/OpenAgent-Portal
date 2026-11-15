"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 設定 › 管理 › 模型 (administrators only; the server refuses everyone else). A LIST of model connections in the order they are
// tried: the first is the primary (usually the local LLM Manager), the rest are fallbacks (e.g. the cloud ai-api-proxy, backup only).
// Each connection has its own address, key, offered models and limits. Every write goes through the connection routes, which audit it.
import { useCallback, useEffect, useState } from "react";
import { localizeError, tr } from "../pages/i18n";
import { Modal, Switch, api, useConfirm } from "./kit";

type Override = { contextWindow?: number; maxTokens?: number; images?: boolean };
export type ConnView = {
  id: string; name: string; baseUrl: string; enabled: boolean; hasKey: boolean; keyLast4: string | null;
  offered: string[] | null; defaultModel: string | null; overrides: Record<string, Override>;
  status: { ok: boolean; models: number; error?: string } | null;
};
type GwModel = { id: string; contextWindow: number | null; maxTokens: number | null; offered: boolean; embedding?: boolean; contextDefault?: number; maxTokensDefault?: number; imagesDefault?: boolean };
type ListState = { connections: ConnView[] };

const errText = (d: { error?: string; code?: string }) => (d.code === "gateway" && d.error ? d.error : localizeError(d.code, d.error ?? ""));

export default function ModelsAdmin() {
  const [list, setList] = useState<ConnView[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const confirm = useConfirm();
  const load = useCallback(async () => {
    const r = await api<ListState>("admin/models/connections");
    if (r.ok) setList(r.data.connections); else setMsg(r.data.error ?? tr("error"));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const take = (r: { ok: boolean; data: { error?: string; connections?: ConnView[] } & { code?: string } }) => {
    if (!r.ok) { setMsg(errText(r.data)); return false; }
    setMsg(""); if (r.data.connections) setList(r.data.connections); return true;
  };
  const move = async (i: number, dir: -1 | 1) => {
    if (!list) return;
    const ids = list.map((c) => c.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    take(await api("admin/models/connections/reorder", "POST", { ids }));
  };
  if (!list) return <div className="tgx-muted">{msg || tr("loading")}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="tgx-muted" style={{ fontSize: 13 }}>{tr("connHelp")}</div>
      {list.length === 0 && <div className="tgx-muted">{tr("connNone")}</div>}
      {list.map((c, i) => (
        <div className="tgx-card" key={c.id} data-tg-conn={c.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="tgx-badge">{i + 1}</span>
            <strong>{c.name}</strong>
            <span className="tgx-muted" style={{ fontSize: 12 }}>{i === 0 ? tr("connPrimary") : tr("connBackup")}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="tgx-btn" style={{ padding: "2px 10px" }} disabled={i === 0} aria-label={`${tr("connUp")} ${c.name}`} onClick={() => void move(i, -1)}>↑</button>
            <button type="button" className="tgx-btn" style={{ padding: "2px 10px" }} disabled={i === list.length - 1} aria-label={`${tr("connDown")} ${c.name}`} onClick={() => void move(i, 1)}>↓</button>
            <Switch checked={c.enabled} label={`${tr("connEnabled")} ${c.name}`} onChange={async (v) => take(await api(`admin/models/connections/${c.id}`, "PATCH", { enabled: v }))} />
            <button type="button" className="tgx-btn" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? tr("connCollapse") : tr("connEdit")}</button>
            <button type="button" className="tgx-btn" aria-label={`${tr("connDelete")} ${c.name}`} onClick={() => confirm.ask(tr("connDeleteAsk", { name: c.name }), tr("connDelete"), async () => { if (take(await api(`admin/models/connections/${c.id}`, "DELETE"))) setOpen(null); })}>{tr("connDelete")}</button>
          </div>
          <div className="tgx-muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
            {c.baseUrl} · {!c.enabled ? tr("connOff") : c.status ? (c.status.ok ? tr("connStatusOk", { n: c.status.models }) : tr("connStatusErr", { n: c.status.models })) : "…"}
            {c.enabled && c.status && !c.status.ok && c.status.error ? ` · ${c.status.error}` : ""}
          </div>
          {open === c.id && <ConnEditor conn={c} onSaved={(l) => setList(l)} />}
        </div>))}
      {msg && <div className="tgx-err" role="alert">{msg}</div>}
      <div><button type="button" className="tgx-btn primary" onClick={() => setAdding(true)}>{tr("connAdd")}</button></div>
      {adding && <AddConnection onClose={() => setAdding(false)} onAdded={(l) => { setList(l); setAdding(false); }} />}
      {confirm.dialog}
    </div>
  );
}

function AddConnection({ onClose, onAdded }: { onClose: () => void; onAdded: (l: ConnView[]) => void }) {
  const [name, setName] = useState(""); const [baseUrl, setBaseUrl] = useState(""); const [apiKey, setApiKey] = useState("");
  const [err, setErr] = useState(""); const [test, setTest] = useState(""); const [busy, setBusy] = useState(false);
  const runTest = async () => {
    setTest("…");
    const r = await api<{ ok: boolean; models?: number; ms?: number; error?: string; code?: string }>("admin/models/test", "POST", { baseUrl, apiKey: apiKey || undefined });
    setTest(r.data.ok ? tr("mdlOk", { n: r.data.models ?? 0, ms: r.data.ms ?? 0 }) : `${tr("mdlFail")}: ${r.data.error ? errText(r.data) : r.status}`);
  };
  const add = async () => {
    setBusy(true);
    const r = await api<{ connections: ConnView[] }>("admin/models/connections", "POST", { name, baseUrl, ...(apiKey ? { apiKey } : {}) });
    setBusy(false);
    if (!r.ok) { setErr(errText(r.data)); return; }
    onAdded(r.data.connections);
  };
  return (
    <Modal title={tr("connAdd")} onClose={onClose} size="md">
      <form style={{ display: "flex", flexDirection: "column", gap: 10 }} onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label>{tr("connName")}<input className="tgx-input" style={{ width: "100%" }} value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} placeholder={tr("connNameHint")} /></label>
        <label>{tr("mdlBaseUrl")}<input className="tgx-input" style={{ width: "100%" }} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" /></label>
        <label>{tr("mdlKey")}<input className="tgx-input" style={{ width: "100%" }} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={tr("mdlKeyNone")} /></label>
        <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("mdlKeyHelp")}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="tgx-btn" onClick={runTest} disabled={!baseUrl}>{tr("mdlTest")}</button>
          {test && <span role="status">{test}</span>}
        </div>
        {err && <div className="tgx-err" role="alert">{err}</div>}
        <div className="tgx-actions">
          <button type="button" className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
          <button className="tgx-btn primary" disabled={busy || !name.trim() || !baseUrl.trim()}>{tr("connAddDo")}</button>
        </div>
      </form>
    </Modal>
  );
}

/** The editor of one connection: name, address, key, test, which models it offers and their limits. */
function ConnEditor({ conn, onSaved }: { conn: ConnView; onSaved: (l: ConnView[]) => void }) {
  const [name, setName] = useState(conn.name); const [baseUrl, setBaseUrl] = useState(conn.baseUrl); const [apiKey, setApiKey] = useState("");
  const [gw, setGw] = useState<GwModel[] | null>(null);
  const [offered, setOffered] = useState<Set<string>>(new Set(conn.offered ?? []));
  const [def, setDef] = useState(conn.defaultModel ?? "");
  const [ov, setOv] = useState<Record<string, { ctx: string; max: string }>>(Object.fromEntries(Object.entries(conn.overrides ?? {}).filter(([, v]) => v.contextWindow || v.maxTokens).map(([k, v]) => [k, { ctx: v.contextWindow ? String(v.contextWindow) : "", max: v.maxTokens ? String(v.maxTokens) : "" }])));
  const [imgOv, setImgOv] = useState<Record<string, boolean>>(Object.fromEntries(Object.entries(conn.overrides ?? {}).filter(([, v]) => typeof v.images === "boolean").map(([k, v]) => [k, v.images as boolean])));
  const [msg, setMsg] = useState(""); const [test, setTest] = useState("");
  const fetchGw = useCallback(async (keepTicks: boolean) => {
    const r = await api<{ models: GwModel[] }>(`admin/models/connections/${conn.id}/gateway`);
    if (!r.ok) { setMsg(errText(r.data)); return; }
    setMsg(""); setGw(r.data.models);
    // Embedding models cannot chat: never ticked, never offered.
    if (!keepTicks) setOffered(new Set(conn.offered ?? r.data.models.filter((m) => !m.embedding).map((m) => m.id)));
  }, [conn.id, conn.offered]);
  useEffect(() => { void fetchGw(false); }, [fetchGw]);
  const runTest = async () => {
    setTest("…");
    const r = await api<{ ok: boolean; models?: number; ms?: number; error?: string; code?: string }>("admin/models/test", "POST", { id: conn.id, baseUrl: baseUrl || undefined, apiKey: apiKey || undefined });
    setTest(r.data.ok ? tr("mdlOk", { n: r.data.models ?? 0, ms: r.data.ms ?? 0 }) : `${tr("mdlFail")}: ${r.data.error ? errText(r.data) : r.status}`);
  };
  const save = async () => {
    const all = gw ? gw.filter((m) => !m.embedding).every((m) => offered.has(m.id)) : true;
    const overrides: Record<string, Override> = {};
    for (const id of new Set([...Object.keys(ov), ...Object.keys(imgOv)])) {
      const v = ov[id] ?? { ctx: "", max: "" };
      const c = Number(v.ctx); const m = Number(v.max);
      const g = gw?.find((x) => x.id === id);
      const o: Override = {};
      // The switch is an override only when it differs from what the gateway reports (no report = pictures allowed).
      if (typeof imgOv[id] === "boolean" && imgOv[id] !== (g?.imagesDefault ?? true)) o.images = imgOv[id];
      // The boxes hold the effective values; only a value that differs from what the gateway/default gives is an override.
      if (c > 0 && c !== (g?.contextDefault ?? g?.contextWindow)) o.contextWindow = c;
      if (m > 0 && m !== (g?.maxTokensDefault ?? g?.maxTokens)) o.maxTokens = m;
      if (Object.keys(o).length) overrides[id] = o;
    }
    const body: Record<string, unknown> = { name, baseUrl, offered: gw && !all ? [...offered] : null, defaultModel: def || null, overrides };
    if (apiKey) body.apiKey = apiKey;
    const r = await api<{ connections: ConnView[] }>(`admin/models/connections/${conn.id}`, "PATCH", body);
    if (!r.ok) { setMsg(errText(r.data)); return; }
    setApiKey(""); setMsg(tr("saved")); onSaved(r.data.connections);
    void fetchGw(true);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <label>{tr("connName")}<input className="tgx-input" style={{ width: "100%" }} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
      <label>{tr("mdlBaseUrl")}<input className="tgx-input" style={{ width: "100%" }} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" /></label>
      <label>{tr("mdlKey")}<input className="tgx-input" style={{ width: "100%" }} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={conn.hasKey ? tr("mdlKeyHas", { last4: conn.keyLast4 ?? "" }) : tr("mdlKeyNone")} /></label>
      <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("mdlKeyHelp")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="tgx-btn" onClick={runTest}>{tr("mdlTest")}</button>
        <button type="button" className="tgx-btn" onClick={() => void fetchGw(false)}>{tr("mdlFetch")}</button>
        {test && <span role="status">{test}</span>}
      </div>
      {gw && (
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
            <button type="button" className="tgx-btn" onClick={() => setOffered(new Set(gw.filter((m) => !m.embedding).map((m) => m.id)))}>{tr("mdlSelectAll")}</button>
            <button type="button" className="tgx-btn" onClick={() => { setOffered(new Set()); setDef(""); }}>{tr("mdlClearAll")}</button>
            <span className="tgx-muted" role="status">{tr("mdlCount", { n: offered.size, total: gw.filter((m) => !m.embedding).length })}</span>
          </div>
          <table className="tg-table">
            <thead><tr><th>{tr("mdlOffered")}</th><th>{tr("mdlDefault")}</th><th>{tr("mdlCtx")}</th><th>{tr("mdlMax")}</th><th>{tr("mdlImages")}</th><th /></tr></thead>
            <tbody>{gw.map((m) => {
              const on = offered.has(m.id) && !m.embedding;
              return (
                <tr key={m.id} style={m.embedding ? { opacity: 0.6 } : undefined}>
                  <td><label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={on} disabled={m.embedding} onChange={(e) => { const n = new Set(offered); if (e.target.checked) n.add(m.id); else { n.delete(m.id); if (def === m.id) setDef(""); } setOffered(n); }} />{m.id}{m.embedding && <span className="tgx-muted" style={{ fontSize: 12 }}> {tr("mdlEmbedding")}</span>}</label></td>
                  <td>{on && <button type="button" className={`tgx-btn${def === m.id ? " primary" : ""}`} style={{ padding: "2px 12px" }} aria-pressed={def === m.id} aria-label={`${tr("mdlDefault")} ${m.id}`} onClick={() => setDef(m.id)}>{def === m.id ? "✓" : "·"}</button>}</td>
                  <td>{on && <input className="tgx-input" style={{ width: 110 }} inputMode="numeric" aria-label={`${tr("mdlCtx")} ${m.id}`} value={ov[m.id]?.ctx || String(m.contextDefault ?? m.contextWindow ?? "")} onChange={(e) => setOv({ ...ov, [m.id]: { ctx: e.target.value, max: ov[m.id]?.max || String(m.maxTokensDefault ?? m.maxTokens ?? "") } })} />}</td>
                  <td>{on && <input className="tgx-input" style={{ width: 110 }} inputMode="numeric" aria-label={`${tr("mdlMax")} ${m.id}`} value={ov[m.id]?.max || String(m.maxTokensDefault ?? m.maxTokens ?? "")} onChange={(e) => setOv({ ...ov, [m.id]: { ctx: ov[m.id]?.ctx || String(m.contextDefault ?? m.contextWindow ?? ""), max: e.target.value } })} />}</td>
                  <td>{on && <Switch checked={imgOv[m.id] ?? m.imagesDefault ?? true} label={`${tr("mdlImages")} ${m.id}`} onChange={(v) => setImgOv({ ...imgOv, [m.id]: v })} />}</td>
                  <td>{on && (ov[m.id] || m.id in imgOv) && <button type="button" className="tgx-btn" style={{ padding: "2px 12px" }} aria-label={`${tr("mdlRestore")} ${m.id}`} onClick={() => { const n = { ...ov }; delete n[m.id]; setOv(n); const k = { ...imgOv }; delete k[m.id]; setImgOv(k); }}>{tr("mdlRestore")}</button>}</td>
                </tr>);
            })}</tbody>
          </table>
        </div>)}
      <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("mdlHint")}</div>
      {msg && <div className="tgx-err" role="status">{msg}</div>}
      <div><button type="button" className="tgx-btn primary" onClick={save}>{tr("mdlSave")}</button></div>
    </div>
  );
}
