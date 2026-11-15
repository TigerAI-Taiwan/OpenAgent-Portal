"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 精靈: my own menu of agents. 我的精靈 = the menu (click = new conversation with it; order and removal are mine, stored on the
// server); 找精靈 = what I could add: company roles, colleagues' shared agents ("加入我的功能表" keeps following the owner,
// "複製成我的" makes an independent copy I can edit), plus a form to build my own. Shared Modal, no back button.
// The server decides what is visible and who may edit (agents/personal.ts); nothing here is a boundary.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { tr } from "../pages/i18n";
import { Icon, Modal, api, useConfirm } from "./kit";
import { useMe } from "./me";
import { startConversation } from "./start";
import { closePanel, useUi } from "./store";
import MeetingEntry from "../wizards/meeting/ui/MeetingEntry";

export type MenuEntry = { id: string; name: string; description: string; kind: "company" | "mine" | "shared"; ownerName: string | null; shared?: boolean; inMenu: boolean };

const CSS = `
.tga-tabs{display:flex;gap:6px;flex:none;padding:0 0 4px}
.tga-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:14px;background:var(--bg-panel)}
.tga-main{flex:1;min-width:0;text-align:left;border:0;background:none;color:var(--text);font:inherit;cursor:pointer;padding:0;display:flex;flex-direction:column;gap:2px}
.tga-main:hover .tga-name{text-decoration:underline}
.tga-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tga-desc{font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tga-kind{font-size:11px;color:var(--text-muted);flex:none}
.tga-acts{display:flex;gap:2px;flex:none;flex-wrap:wrap;justify-content:flex-end}
.tga-acts .tgx-icon-btn{width:30px;height:30px}
.tga-acts .tgx-btn{padding:3px 12px;font-size:12px}
.tga-list{display:flex;flex-direction:column;gap:8px}
@media (max-width:760px){.tga-row{flex-wrap:wrap}.tga-acts{width:100%;justify-content:flex-start}}
`;

const kindLabel = (e: MenuEntry) => (e.kind === "company" ? tr("agKindCompany") : e.kind === "mine" ? tr("agKindMine") : tr("agKindShared", { name: e.ownerName ?? "?" }));

export default function AgentsModal() {
  const ui = useUi();
  const [tab, setTab] = useState<"mine" | "find">(ui.panel?.tab === "find" ? "find" : "mine");
  const [form, setForm] = useState<{ id?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  return (
    <Modal title={tr("agentsTitle")} size="md" onClose={closePanel}>
      <style>{CSS}</style>
      <div className="tga-tabs" role="tablist" aria-label={tr("agentsTitle")}>
        <button type="button" role="tab" aria-selected={tab === "mine"} className={`tgx-btn${tab === "mine" ? " primary" : ""}`} onClick={() => setTab("mine")}>{tr("agMine")}</button>
        <button type="button" role="tab" aria-selected={tab === "find"} className={`tgx-btn${tab === "find" ? " primary" : ""}`} onClick={() => setTab("find")}>{tr("agFind")}</button>
        <button type="button" className="tgx-btn" style={{ marginLeft: "auto" }} onClick={() => setForm({})}>{tr("agNew")}</button>
      </div>
      {tab === "mine" ? <MyMenu version={version} onEdit={(id) => setForm({ id })} onChanged={bump} /> : <AgentBrowse version={version} onChanged={bump} onClosePanel={closePanel} />}
      {form && <AgentForm id={form.id} onClose={(changed) => { setForm(null); if (changed) bump(); }} />}
    </Modal>
  );
}

function useStart() {
  const { me } = useMe();
  return useCallback((e: { id: string; name: string }) => { closePanel(); void startConversation({ id: e.id, name: e.name }, "", null, me?.homeDir ?? null); }, [me?.homeDir]);
}

function MyMenu({ version, onEdit, onChanged }: { version: number; onEdit: (id: string) => void; onChanged: () => void }) {
  const { ask, dialog } = useConfirm();
  const start = useStart();
  const [menu, setMenu] = useState<MenuEntry[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { const r = await api<{ menu: MenuEntry[] }>("agents/menu"); if (r.ok) setMenu(r.data.menu); else setError(r.data.error ?? tr("loadFail")); }, []);
  useEffect(() => { void load(); }, [load, version]);
  const act = async (p: Promise<{ ok: boolean; data: { error?: string; menu?: MenuEntry[] } }>) => { const r = await p; if (!r.ok) setError(r.data.error ?? tr("error")); else { setError(""); if (r.data.menu) setMenu(r.data.menu); onChanged(); } };
  const move = (i: number, d: number) => {
    if (!menu) return;
    const ids = menu.map((m) => m.id); const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setMenu(ids.map((id) => menu.find((m) => m.id === id)!));
    void act(api<{ menu: MenuEntry[] }>("agents/menu", "PUT", { ids }));
  };
  if (!menu) return <div className="tgx-muted">{error || tr("loading")}</div>;
  return (<>
    <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("agHint")}</div>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {menu.length === 0 && <div className="tgx-muted">{tr("agEmptyMenu")}</div>}
    <div className="tga-list">
      <MeetingEntry />
      {menu.map((e, i) => (
        <div className="tga-row" key={e.id} data-tg-agent={e.id}>
          <button type="button" className="tga-main" title={tr("useThis")} onClick={() => start(e)}>
            <span className="tga-name">{e.name}</span>
            {e.description && <span className="tga-desc">{e.description}</span>}
          </button>
          <span className="tga-kind">{kindLabel(e)}</span>
          <span className="tga-acts">
            <button type="button" className="tgx-icon-btn" title={tr("agMoveUp")} aria-label={tr("agMoveUp")} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={14} /></button>
            <button type="button" className="tgx-icon-btn" title={tr("agMoveDown")} aria-label={tr("agMoveDown")} disabled={i === menu.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={14} /></button>
            {e.kind === "mine" && <button type="button" className="tgx-icon-btn" title={tr("agEdit")} aria-label={tr("agEdit")} onClick={() => onEdit(e.id)}><Icon name="edit" size={14} /></button>}
            {e.kind === "mine"
              ? <button type="button" className="tgx-icon-btn" title={tr("agDelete")} aria-label={tr("agDelete")} onClick={() => ask(tr("cfDelAgent", { name: e.name }), tr("agDelete"), async () => { const r = await api("agents/mine/" + e.id, "DELETE"); setError(r.ok ? "" : r.data.error ?? tr("error")); await load(); onChanged(); })}><Icon name="trash" size={14} /></button>
              : <button type="button" className="tgx-icon-btn" title={tr("agRemove")} aria-label={tr("agRemove")} onClick={() => ask(tr("cfRemoveAgent", { name: e.name }), tr("agRemove"), () => act(api<{ menu: MenuEntry[] }>("agents/menu/" + e.id, "DELETE")))}><Icon name="x" size={14} /></button>}
          </span>
        </div>))}
    </div>
    {dialog}
  </>);
}

/** Everything I could use: also the 技能 modal's "AI 角色" tab. */
export function AgentBrowse({ version = 0, onChanged, onClosePanel }: { version?: number; onChanged?: () => void; onClosePanel: () => void }) {
  const start = useStart();
  const { ask, dialog } = useConfirm();
  const [rows, setRows] = useState<MenuEntry[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(async () => { const r = await api<{ agents: MenuEntry[] }>("agents/browse"); if (r.ok) setRows(r.data.agents); else setError(r.data.error ?? tr("loadFail")); }, []);
  useEffect(() => { void load(); }, [load, version]);
  const act = async (path: string, body: unknown, msg = "") => { const r = await api(path, "POST", body); setError(r.ok ? "" : r.data.error ?? tr("error")); setNote(r.ok ? msg : ""); if (r.ok) { await load(); onChanged?.(); } };
  void onClosePanel;
  if (!rows) return <div className="tgx-muted">{error || tr("loading")}</div>;
  return (<>
    <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("agCopyNote")}</div>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {note && <div role="status" className="tgx-muted">{note}</div>}
    {rows.length === 0 && <div className="tgx-muted">{tr("fnRolesEmpty")}</div>}
    <div className="tga-list">
      {rows.map((e) => (
        <div className="tga-row" key={e.id}>
          <span className="tga-main" style={{ cursor: "default" }}>
            <span className="tga-name">{e.name}</span>
            {e.description && <span className="tga-desc">{e.description}</span>}
          </span>
          <span className="tga-kind">{kindLabel(e)}</span>
          <span className="tga-acts">
            <button type="button" className="tgx-btn" onClick={() => start(e)}>{tr("useThis")}</button>
            {e.kind !== "mine" && <button type="button" className="tgx-btn" onClick={() => ask(tr("agCopyNote"), tr("agCopy"), () => act(`agents/${e.id}/copy`, {}, tr("agSaved")))}>{tr("agCopy")}</button>}
            {e.inMenu ? <button type="button" className="tgx-btn" disabled>{tr("agAdded")}</button> : <button type="button" className="tgx-btn primary" onClick={() => act("agents/menu", { agentId: e.id }, tr("agSaved"))}>{tr("agAdd")}</button>}
          </span>
        </div>))}
    </div>
    {dialog}
  </>);
}

function AgentForm({ id, onClose }: { id?: string; onClose: (changed: boolean) => void }) {
  const [f, setF] = useState({ name: "", description: "", system_prompt: "", shared: false });
  const [loaded, setLoaded] = useState(!id);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (id) void api<{ agent: typeof f }>(`agents/mine/${id}`).then((r) => { if (r.ok) { setF(r.data.agent); setLoaded(true); } else setError(r.data.error ?? tr("loadFail")); }); }, [id]);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    const r = id ? await api(`agents/mine/${id}`, "PATCH", f) : await api("agents/mine", "POST", f);
    setBusy(false);
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    onClose(true);
  };
  return (
    <Modal title={id ? tr("agEdit") : tr("agNew")} size="md" onClose={() => onClose(false)}>
      {!loaded ? <div className="tgx-muted">{error || tr("loading")}</div> : (
        <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input className="tgx-input" aria-label={tr("agName")} placeholder={tr("agName")} maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
          <input className="tgx-input" aria-label={tr("agDesc")} placeholder={tr("agDesc")} maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <textarea className="tgx-input" rows={7} aria-label={tr("agPrompt")} placeholder={tr("agPrompt")} maxLength={8000} value={f.system_prompt} onChange={(e) => setF({ ...f, system_prompt: e.target.value })} />
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={f.shared} onChange={(e) => setF({ ...f, shared: e.target.checked })} />{tr("agShare")}</label>
          {error && <div className="tgx-err" role="alert">{error}</div>}
          <div className="tgx-actions">
            <button type="button" className="tgx-btn" onClick={() => onClose(false)}>{tr("cancel")}</button>
            <button className="tgx-btn primary" disabled={busy || !f.name.trim()}>{tr("save")}</button>
          </div>
        </form>)}
    </Modal>
  );
}
