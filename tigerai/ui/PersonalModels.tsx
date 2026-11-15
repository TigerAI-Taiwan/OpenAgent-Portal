"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 設定 › 帳號 › 我的模型連線 (everyone, for their own connections only). The server always answers for the signed-in person; nothing
// here names another person. The key is typed once and never comes back (only its last 4 characters).
import { useCallback, useEffect, useState } from "react";
import { localizeError, tr } from "../pages/i18n";
import { Modal, Switch, api, useConfirm } from "./kit";
import { loadMe } from "./me";

type Conn = { id: string; name: string; baseUrl: string; models: string[]; enabled: boolean; maxTokens: number; contextWindow: number; reasoning: boolean; hasKey: boolean; keyLast4: string | null };
type View = { switches: { allow: boolean; publicWithoutKey: boolean }; max: number; connections: Conn[] };
type TestResult = { ok: boolean; ms?: number; models?: number; ids?: string[]; error?: string; code?: string };

const errText = (d: { error?: string; code?: string }) => (d.code === "gateway" && d.error ? d.error : localizeError(d.code, d.error ?? ""));

export default function PersonalModels({ isAdmin }: { isAdmin: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [editing, setEditing] = useState<Conn | "new" | null>(null);
  const [msg, setMsg] = useState("");
  const confirm = useConfirm();
  const load = useCallback(async () => {
    const r = await api<View>("personal-models");
    if (r.ok) setView(r.data); else setMsg(errText(r.data) || tr("error"));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const take = (r: { ok: boolean; data: View & { error?: string; code?: string } }) => {
    if (!r.ok) { setMsg(errText(r.data)); return false; }
    setMsg(""); setView(r.data); loadMe(true); // the model picker follows how many connections are usable
    return true;
  };
  if (!view) return <div className="tgx-card tgx-muted">{msg || tr("loading")}</div>;
  const list = view.connections;
  const move = async (i: number, dir: -1 | 1) => {
    const ids = list.map((c) => c.id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    take(await api<View>("personal-models/reorder", "POST", { ids }));
  };
  return (
    <div className="tgx-card" data-tg-personal-models style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <strong>{tr("pmTitle")}</strong>
      <div className="tgx-muted" style={{ fontSize: 13 }}>{tr("pmHelp")}</div>
      {!view.switches.allow && <div className="tgx-muted" role="status">{tr("pmOff")}</div>}
      {view.switches.allow && list.length === 0 && <div className="tgx-muted">{!view.switches.publicWithoutKey && !isAdmin ? tr("pmNoneRequired") : tr("pmNone")}</div>}
      {list.map((c, i) => (
        <div key={c.id} data-tg-personal-conn style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="tgx-badge">{i + 1}</span>
            <strong>{c.name}</strong>
            <span style={{ flex: 1 }} />
            <button type="button" className="tgx-btn" style={{ padding: "2px 10px" }} disabled={i === 0} aria-label={`${tr("pmUp")} ${c.name}`} onClick={() => void move(i, -1)}>↑</button>
            <button type="button" className="tgx-btn" style={{ padding: "2px 10px" }} disabled={i === list.length - 1} aria-label={`${tr("pmDown")} ${c.name}`} onClick={() => void move(i, 1)}>↓</button>
            <Switch checked={c.enabled} label={`${tr("pmOn")} ${c.name}`} onChange={async (v) => take(await api<View>(`personal-models/${c.id}`, "PATCH", { enabled: v }))} />
            <button type="button" className="tgx-btn" onClick={() => setEditing(c)}>{tr("pmEdit")}</button>
            <button type="button" className="tgx-btn" aria-label={`${tr("pmDelete")} ${c.name}`} onClick={() => confirm.ask(tr("pmDeleteAsk", { name: c.name }), tr("pmDelete"), async () => { take(await api<View>(`personal-models/${c.id}`, "DELETE")); })}>{tr("pmDelete")}</button>
          </div>
          <div className="tgx-muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
            {c.baseUrl} · {tr("pmModelsCount", { n: c.models.length })} ({c.models.join(", ")}) · {tr("pmLimits", { max: c.maxTokens, ctx: c.contextWindow })} · {c.hasKey ? tr("pmKeyLast", { last4: c.keyLast4 ?? "" }) : tr("pmNoKey")}
          </div>
        </div>))}
      {list.length > 1 && <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("pmOrderHelp")}</div>}
      {msg && <div className="tgx-err" role="alert">{msg}</div>}
      {view.switches.allow && list.length < view.max && <div><button type="button" className="tgx-btn primary" onClick={() => setEditing("new")}>{tr("pmAdd")}</button></div>}
      {editing && <Editor conn={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(v) => { setView(v); setEditing(null); loadMe(true); }} />}
      {confirm.dialog}
    </div>
  );
}

function Editor({ conn, onClose, onSaved }: { conn: Conn | null; onClose: () => void; onSaved: (v: View) => void }) {
  const [name, setName] = useState(conn?.name ?? ""); const [baseUrl, setBaseUrl] = useState(conn?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(""); const [models, setModels] = useState(conn?.models.join(", ") ?? "");
  const [maxTokens, setMaxTokens] = useState(String(conn?.maxTokens ?? 16384)); const [ctxWin, setCtxWin] = useState(String(conn?.contextWindow ?? 128000)); const [reasoning, setReasoning] = useState(conn?.reasoning ?? false);
  const [preset, setPreset] = useState("");
  // Marking a connection as thinking while the budget is still the plain default gives it room to think; a size the person typed is never touched.
  const markThinking = (on: boolean) => { setReasoning(on); if (on && maxTokens.trim() === "16384") setMaxTokens("40000"); };
  const pickPreset = (v: string) => { setPreset(v); if (v === "nvidia") { setBaseUrl("https://integrate.api.nvidia.com/v1"); if (!name.trim()) setName("NVIDIA"); if (/glm/i.test(models)) markThinking(true); } };
  // NVIDIA's glm models think before answering: the preset marks them as thinking by default.
  const changeModels = (v: string) => { setModels(v); if (preset === "nvidia" && !reasoning && /glm/i.test(v)) markThinking(true); };
  const [err, setErr] = useState(""); const [test, setTest] = useState<TestResult | null>(null); const [busy, setBusy] = useState(false);
  const runTest = async () => {
    setTest({ ok: false, error: "…" });
    const r = await api<TestResult>("personal-models/test", "POST", { ...(conn ? { id: conn.id } : {}), baseUrl, ...(apiKey ? { apiKey } : {}) });
    setTest(r.data);
  };
  const addModel = (id: string) => { const cur = models.split(",").map((x) => x.trim()).filter(Boolean); if (!cur.includes(id)) changeModels([...cur, id].join(", ")); };
  const save = async () => {
    setBusy(true); setErr("");
    const body = { name, baseUrl, models, maxTokens, contextWindow: ctxWin, reasoning, ...(apiKey ? { apiKey } : {}) };
    const r = conn ? await api<View>(`personal-models/${conn.id}`, "PATCH", body) : await api<View>("personal-models", "POST", body);
    setBusy(false);
    if (!r.ok) { setErr(errText(r.data)); return; }
    onSaved(r.data);
  };
  return (
    <Modal title={conn ? tr("pmEditTitle", { name: conn.name }) : tr("pmAddTitle")} onClose={onClose} size="md">
      <form style={{ display: "flex", flexDirection: "column", gap: 10 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {!conn && <label>{tr("pmPreset")}<select className="tgx-input" style={{ width: "100%" }} value={preset} onChange={(e) => pickPreset(e.target.value)}>
          <option value="">{tr("pmPresetNone")}</option>
          <option value="nvidia">{tr("pmPresetNvidia")}</option>
        </select></label>}
        {preset === "nvidia" && <div className="tgx-muted" data-testid="pm-preset-hint">{tr("pmPresetNvidiaHint")}</div>}
        <label>{tr("pmName")}<input className="tgx-input" style={{ width: "100%" }} value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} placeholder={tr("pmNameHint")} /></label>
        <label>{tr("pmUrl")}<input className="tgx-input" style={{ width: "100%" }} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" /></label>
        <label>{tr("pmKey")}<input className="tgx-input" style={{ width: "100%" }} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={conn?.hasKey ? tr("pmKeyHas", { last4: conn.keyLast4 ?? "" }) : tr("pmKeyNone")} /></label>
        <label>{tr("pmModels")}<input className="tgx-input" style={{ width: "100%" }} value={models} onChange={(e) => changeModels(e.target.value)} placeholder={tr("pmModelsHint")} /></label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={{ flex: "1 1 160px" }}>{tr("pmMaxTokens")}<input className="tgx-input" style={{ width: "100%" }} inputMode="numeric" data-testid="pm-max-tokens" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} /></label>
          <label style={{ flex: "1 1 160px" }}>{tr("pmContext")}<input className="tgx-input" style={{ width: "100%" }} inputMode="numeric" data-testid="pm-context" value={ctxWin} onChange={(e) => setCtxWin(e.target.value)} /></label>
        </div>
        <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("pmMaxTokensHint")}</div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" data-testid="pm-reasoning" checked={reasoning} onChange={(e) => markThinking(e.target.checked)} />{tr("pmReasoning")}</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="tgx-btn" onClick={runTest} disabled={!baseUrl}>{tr("pmTest")}</button>
          {test && <span role="status">{test.ok ? tr("pmTestOk", { n: test.models ?? 0, ms: test.ms ?? 0 }) : test.error === "…" ? "…" : `${tr("pmTestFail")}: ${errText(test)}`}</span>}
        </div>
        {test?.ok && (test.ids?.length ?? 0) > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("pmPickModels")}</span>
            {test.ids!.slice(0, 12).map((id) => <button key={id} type="button" className="tgx-btn" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => addModel(id)}>{id}</button>)}
          </div>)}
        {err && <div className="tgx-err" role="alert">{err}</div>}
        <div className="tgx-actions">
          <button type="button" className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
          <button className="tgx-btn primary" disabled={busy || !name.trim() || !baseUrl.trim() || !models.trim()}>{tr("pmSave")}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- 設定 › 管理 › 模型: the two switches (administrators)

type Admin = { switches: { allow: boolean; publicWithoutKey: boolean; mutualFallback: boolean }; people: { userId: string; name: string; count: number }[] };

export function PersonalAdmin() {
  const [data, setData] = useState<Admin | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => { const r = await api<Admin>("admin/models/personal"); if (r.ok) setData(r.data); else setMsg(errText(r.data) || tr("error")); }, []);
  useEffect(() => { void load(); }, [load]);
  const set = async (patch: Partial<Admin["switches"]>) => {
    const r = await api<{ switches: Admin["switches"] }>("admin/models/personal", "PUT", patch);
    if (!r.ok) { setMsg(errText(r.data)); return; }
    setMsg(""); setData((d) => (d ? { ...d, switches: r.data.switches } : d));
  };
  if (!data) return <div className="tgx-muted">{msg || tr("loading")}</div>;
  return (
    <div className="tgx-card" data-tg-personal-admin style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
      <strong>{tr("pmAdminTitle")}</strong>
      <div className="tgx-muted" style={{ fontSize: 13 }}>{tr("pmAdminHelp")}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Switch checked={data.switches.allow} label={tr("pmAllow")} onChange={(v) => void set({ allow: v })} />
        <div><div>{tr("pmAllow")}</div><div className="tgx-muted" style={{ fontSize: 12 }}>{tr("pmAllowDesc")}</div></div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Switch checked={data.switches.publicWithoutKey} label={tr("pmPublic")} disabled={!data.switches.allow} onChange={(v) => void set({ publicWithoutKey: v })} />
        <div><div>{tr("pmPublic")}</div><div className="tgx-muted" style={{ fontSize: 12 }}>{tr("pmPublicDesc")}</div></div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Switch checked={data.switches.mutualFallback} label={tr("pmMutual")} disabled={!data.switches.allow} onChange={(v) => void set({ mutualFallback: v })} />
        <div><div>{tr("pmMutual")}</div><div className="tgx-muted" style={{ fontSize: 12 }}>{tr("pmMutualDesc")}</div></div>
      </div>
      <div><strong style={{ fontSize: 13 }}>{tr("pmPeople")}</strong></div>
      {data.people.length === 0 && <div className="tgx-muted" style={{ fontSize: 13 }}>{tr("pmPeopleNone")}</div>}
      {data.people.map((p) => <div key={p.userId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>{p.name}</span><span className="tgx-muted">{tr("pmPeopleCount", { n: p.count })}</span></div>)}
      {msg && <div className="tgx-err" role="alert">{msg}</div>}
    </div>
  );
}
