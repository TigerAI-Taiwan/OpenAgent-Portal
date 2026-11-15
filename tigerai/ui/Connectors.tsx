"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 設定 › 系統連接 (administrators): link systems to the AI through MCP. The community edition offers the n8n template only (the server refuses
// any other); a consultant add-on adds more templates to the same list. The server checks every call again (admin only; groups on every tool call).
import { useCallback, useEffect, useState } from "react";
import { fmtDateTime, trx as tr } from "../pages/i18n";
import "../pages/i18n-mcp";
import { CE_MCP_NOTICE, LOOKS_LIKE_WRITE, N8N_READ_TOOLS, type ConnectorTemplate } from "../n8nmcp/templates";
import { Modal, Switch, api, useConfirm } from "./kit";

type Tool = { name: string; description: string; readOnly: boolean | null };
type Conn = { id: string; name: string; template: string; description: string; url: string; group_ids: string[]; enabled: boolean; allow_tools: string[]; hasToken: boolean; tokenLast4: string | null; tools: Tool[]; testedAt: number | null };
type Group = { id: string; name: string };
type TestResult = { ok: boolean; tools?: Tool[]; ms?: number; code?: string; error?: string };

const WHY: Record<string, Parameters<typeof tr>[0]> = { unreachable: "cnUnreachable", unauthorized: "cnUnauthorized", timeout: "cnTimeout", bad_response: "cnBadResponse", bad_url: "cnBadUrl" };

export function Connectors() {
  const { ask, dialog } = useConfirm();
  const [rows, setRows] = useState<Conn[] | null>(null);
  const [templates, setTemplates] = useState<ConnectorTemplate[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [editing, setEditing] = useState<{ conn: Conn | null; template: string | null } | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    const [c, g] = await Promise.all([api<{ servers: Conn[]; templates: ConnectorTemplate[] }>("admin/connectors"), api<{ groups: Group[] }>("admin/groups")]);
    if (c.ok) { setRows(c.data.servers); setTemplates(c.data.templates); } else setError(c.data.error ?? tr("loadFail"));
    if (g.ok) setGroups(g.data.groups);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (c: Conn, enabled: boolean) => {
    setRows((xs) => xs?.map((x) => (x.id === c.id ? { ...x, enabled } : x)) ?? null);
    const r = await api(`admin/connectors/${c.id}`, "PATCH", { enabled });
    if (!r.ok) setError(r.data.error ?? tr("error"));
    void load();
  };
  const tpl = (id: string) => templates.find((t) => t.id === id);
  if (!rows) return <div className="tgx-muted">{error || tr("loading")}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="tgx-muted">{tr("cnHelp")}</div>
      {templates.length > 0 && templates.every((x) => x.id === "n8n") && <div className="tgx-muted" data-testid="ce-mcp-notice">{CE_MCP_NOTICE}</div>}
      {error && <div className="tgx-err" role="alert">{error}</div>}
      {note && <div role="status">{note}</div>}
      <div><button type="button" className="tgx-btn primary" onClick={() => setEditing({ conn: null, template: null })}>{tr("cnAdd")}</button></div>
      {rows.length === 0 && <div className="tgx-muted">{tr("cnNone")}</div>}
      {rows.map((c) => (
        <div className="tgx-card" key={c.id} data-testid={`connector-${c.name}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
            <strong>{c.name} <span className="tgx-muted" style={{ fontWeight: 400 }}>· {tpl(c.template)?.label ?? c.template}</span></strong>
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <Switch checked={c.enabled} label={`${tr("cnEnabled")} ${c.name}`} onChange={(v) => void toggle(c, v)} />
              <button type="button" className="tgx-btn" onClick={() => setEditing({ conn: c, template: c.template })}>{tr("cnEdit")}</button>
              <button type="button" className="tgx-btn" onClick={() => ask(tr("cnDelete", { name: c.name }), tr("delete"), async () => { const r = await api(`admin/connectors/${c.id}`, "DELETE"); setError(r.ok ? "" : r.data.error ?? tr("error")); void load(); })}>{tr("delete")}</button>
            </span>
          </div>
          <div className="tgx-muted" style={{ fontSize: 12 }}>{c.url} · {c.hasToken ? `${tr("cnKey")} ····${c.tokenLast4}` : `${tr("cnKey")}: ${tr("cnKeyNone")}`}</div>
          <div className="tgx-muted" style={{ fontSize: 12 }}>{c.allow_tools.length === 0 ? tr("cnToolsNone") : c.allow_tools.includes("*") ? tr("cnToolsAll") : tr("cnToolsCount", { n: c.allow_tools.length })} · {tr("cnGroups")}: {c.group_ids.length === 0 ? tr("n8nNobody") : groups.filter((g) => c.group_ids.includes(g.id)).map((g) => g.name).join("、")}</div>
        </div>))}
      {editing && <ConnectorForm key={editing.conn?.id ?? "new"} templates={templates} groups={groups} initial={editing} onClose={() => setEditing(null)} onSaved={(m) => { setNote(m); setEditing(null); void load(); }} />}
      {dialog}
    </div>
  );
}

function toolLabel(t: Tool, template: string | null): string {
  if (template === "n8n") return N8N_READ_TOOLS.includes(t.name) ? tr("cnToolRead") : tr("cnToolN8nWrite");
  if (t.readOnly === true) return tr("cnToolRead");
  if (t.readOnly === false || LOOKS_LIKE_WRITE.test(t.name)) return tr("cnToolWrite");
  return tr("cnToolUnknown");
}

function ConnectorForm({ templates, groups, initial, onClose, onSaved }: { templates: ConnectorTemplate[]; groups: Group[]; initial: { conn: Conn | null; template: string | null }; onClose: () => void; onSaved: (note: string) => void }) {
  const c = initial.conn;
  const [template, setTemplate] = useState<string | null>(initial.template);
  const t = templates.find((x) => x.id === template) ?? null;
  const [name, setName] = useState(c?.name ?? "");
  const [description, setDescription] = useState(c?.description ?? "");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [gids, setGids] = useState<string[]>(c?.group_ids ?? []);
  const [allow, setAllow] = useState<string[]>(c?.allow_tools ?? []);
  const [tools, setTools] = useState<Tool[]>(c?.tools ?? []);
  const [result, setResult] = useState("");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const pick = (id: string) => {
    const x = templates.find((y) => y.id === id)!;
    setTemplate(id); setName(x.nameHint); setAllow([...x.defaultAllow]); setDescription("");
  };
  const all = allow.includes("*");
  const test = async () => {
    setTesting(true); setResult("");
    const r = await api<TestResult>("admin/connectors/test", "POST", { id: c?.id, url: url || undefined, token: token || undefined });
    setTesting(false);
    if (!r.ok) { setResult(tr("cnTestFail", { why: r.data.error ?? tr("error") })); return; }
    if (r.data.ok) { setTools(r.data.tools ?? []); setResult(tr("cnTestOk", { n: r.data.tools?.length ?? 0, ms: r.data.ms ?? 0 })); }
    else setResult(tr("cnTestFail", { why: tr(WHY[r.data.code ?? ""] ?? "error") }));
  };
  const save = async () => {
    const body: Record<string, unknown> = { name, description, group_ids: gids, allow_tools: allow };
    if (!c) body.template = template;
    if (url) body.url = url;
    if (token) body.token = token;
    const r = c ? await api(`admin/connectors/${c.id}`, "PATCH", body) : await api("admin/connectors", "POST", body);
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    onSaved(c ? tr("cnSaved") : tr("cnCreated"));
  };
  const flip = (name: string) => setAllow((a) => (a.includes(name) ? a.filter((x) => x !== name) : [...a.filter((x) => x !== "*"), name]));
  // Names that are allowed but not (or no longer) offered stay visible so they can be removed.
  const shown: Tool[] = [...tools, ...allow.filter((n) => n !== "*" && !tools.some((x) => x.name === n)).map((n) => ({ name: n, description: "", readOnly: null }))];
  return (
    <Modal title={c ? `${tr("cnEdit")} ${c.name}` : tr("cnAdd")} onClose={onClose} size="md">
      {!t ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="tgx-muted">{tr("cnPickTemplate")}</div>
          {templates.map((x) => (
            <button type="button" key={x.id} className="tgx-card" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => pick(x.id)} aria-label={`${tr("cnPickTemplate")} ${x.label}`}>
              <strong>{x.label}</strong><div className="tgx-muted" style={{ fontSize: 12 }}>{x.description}</div>
            </button>))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label>{tr("cnName")}<input className="tgx-input" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>{tr("cnDesc")}<input className="tgx-input" style={{ width: "100%" }} maxLength={200} placeholder={t.description} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label>{tr("cnUrl")}<input className="tgx-input" style={{ width: "100%" }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={c ? c.url : t.urlHint} /></label>
          <label>{t.tokenLabel}<input className="tgx-input" style={{ width: "100%" }} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={c?.hasToken ? tr("cnKeyHas", { last4: c.tokenLast4 ?? "" }) : tr("cnKeyNone")} /></label>
          <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("cnKeyHelp")}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="tgx-btn" disabled={testing || (!c && !url)} onClick={() => void test()}>{testing ? tr("cnTesting") : tr("cnTest")}</button>
            {result && <span role="status">{result}</span>}
            {c?.testedAt && !result && <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("cnTestedAt", { t: fmtDateTime(c.testedAt) })}</span>}
          </div>
          <div>
            <strong>{tr("cnGroups")}</strong> <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("cnSuggested", { who: t.suggestedGroups })}</span>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
              {groups.map((g) => <label key={g.id}><input type="checkbox" checked={gids.includes(g.id)} onChange={() => setGids((x) => (x.includes(g.id) ? x.filter((y) => y !== g.id) : [...x, g.id]))} /> {g.name}</label>)}
            </div>
            {gids.length === 0 && <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("cnGroupsNobody")}</div>}
          </div>
          <div>
            <strong>{tr("cnTools")}</strong>
            <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("cnToolsHelp")}</div>
            {tools.length === 0 && <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("cnTestNeed")}</div>}
            <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
              {shown.map((x) => (
                <label key={x.name} title={x.description} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={all || allow.includes(x.name)} disabled={all} onChange={() => flip(x.name)} />
                  <code>{x.name}</code><span className="tgx-muted" style={{ fontSize: 12 }}>{toolLabel(x, template)}</span>
                </label>))}
            </div>
            <label style={{ display: "block", marginTop: 6 }}><input type="checkbox" checked={all} onChange={(e) => setAllow(e.target.checked ? ["*"] : [])} /> {tr("cnToolsAll")}</label>
            {all && <div className="tgx-err" style={{ fontSize: 12 }}>{tr("cnToolsAllWarn")}</div>}
          </div>
          {error && <div className="tgx-err" role="alert">{error}</div>}
          <div><button type="button" className="tgx-btn primary" onClick={() => void save()}>{tr("cnSave")}</button></div>
        </div>
      )}
    </Modal>
  );
}
