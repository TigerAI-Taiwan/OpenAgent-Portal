"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 公佈欄 modal (opened from the bell in the top bar). Tabs: 個人區 (what I must act on, each item actionable in place),
// 公用區 (announcements), 我交辦的 (orders I created), 全部 (admin). Shared Modal, no back button, zh-TW.
// Every permission is checked on the server; what this file hides is only what the server would refuse anyway.
import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { fmtDateTime, fmtDay, tr, type Key } from "../pages/i18n";
import { DateField, Icon, Modal, Segmented, TextPromptDialog, api, useConfirm } from "./kit";
import NewAssignment, { ASSIGNMENT_CREATED } from "./NewAssignment";
import { closeBulletin, openBulletin, refreshSummary, useBulletin, type BulletinTab } from "./bulletin-store";
import { useMe } from "./me";
import { WizardPersonal, type WItem } from "./Wizards";

const CSS = `
.tgb{display:flex;flex-direction:column;height:100%;min-height:0}
.tgb-tabs{display:flex;gap:6px;padding:10px 16px;border-bottom:1px solid var(--border);overflow-x:auto;flex:none;align-items:center}
.tgb-tabs .tgx-btn{white-space:nowrap;display:inline-flex;gap:6px;align-items:center}
.tgb-main{flex:1;min-height:0;overflow:auto;padding:16px 20px}
.tgb-col{width:100%;max-width:var(--chat-content-max-width,820px);margin:0 auto}
.tgb-col .tgx-card{max-width:none;width:100%;box-sizing:border-box}
.tgb-row{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap}
.tgb-over{color:#d93025;font-weight:600}
.tgb-unread{font-weight:700}
.tgb-read{font-weight:400}
.tgb-card{cursor:pointer;text-align:left;width:100%;font:inherit;color:var(--text)}
.tgb-card:hover{background:var(--bg-hover)}
.tgb-head{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;color:var(--text);font:inherit;padding:0;cursor:pointer;text-align:left}
.tgb-headtitle{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tgb-headmeta{font-size:12px;flex:none}
.tgb-caret{display:inline-flex;transition:transform .12s;transform:rotate(-90deg)}
.tgb-caret[data-open="1"]{transform:none}
.tgb-md{border-top:1px solid var(--border);padding-top:10px;margin-top:8px}
@media (max-width:760px){.tgb-tabs{padding:8px 10px}.tgb-main{padding:12px}}
`;

type Ann = {
  id: string; title: string; body: string; authorId: string; authorName: string; audienceAll: boolean; audience: { id: string; name: string }[]; audienceLabel: string;
  pinned: boolean; expiresAt: number | null; expired: boolean; requireAck: boolean; createdAt: number; updatedAt: number; read: boolean; acked: boolean; mine: boolean; canEdit: boolean; edited: boolean;
  stats?: { total: number; read: number; acked: number; notRead: string[]; notAcked: string[] };
};
type Hist = { id: number; editorName: string; ts: number; oldTitle: string; oldBody: string };
type Asg = { id: string; title: string; description: string; applicantName: string; assigneeId: string; assigneeName: string; dueDate: number | null; sessionId: string | null; status: "open" | "accepted" | "done" | "returned"; returnReason: string | null; doneNote: string | null; runState?: "running" | "review" | null };
type Item =
  | { kind: "assignment"; id: string; title: string; due: number | null; overdue: boolean; assignment: Asg }
  | { kind: "ack"; id: string; title: string; due: null; overdue: false; announcement: Ann }
  | { kind: "approval"; id: string; title: string; due: null; overdue: false; approval: { name: string; body: string; applicantName: string } }
  | { kind: "wizard"; id: string; title: string; due: null; overdue: false; wizard: WItem };

export default function BulletinOverlay() {
  const b = useBulletin();
  const { me } = useMe();
  if (!b.open || !me) return null;
  const tab = b.open.tab;
  const s = b.summary;
  const tabs: { id: BulletinTab; label: string; badge: number }[] = [
    { id: "personal", label: tr("bTabPersonal"), badge: s?.count ?? 0 },
    { id: "public", label: tr("bTabPublic"), badge: s?.unread.count ?? 0 },
    { id: "mine", label: tr("bTabMine"), badge: 0 },
    ...(me.role === "admin" ? [{ id: "all" as const, label: tr("bTabAll"), badge: 0 }] : []),
  ];
  return (
    <Modal title={tr("bulletin")} size="lg" onClose={closeBulletin}>
      <style>{CSS}</style>
      <div className="tgb">
        <div className="tgb-tabs" role="tablist" aria-label={tr("bulletin")}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tgx-btn${tab === t.id ? " primary" : ""}`} onClick={() => openBulletin(t.id)}>
              {t.label}{t.badge > 0 && <span className="tgx-badge" style={tab === t.id ? { background: "var(--bg)", color: "var(--text)" } : undefined}>{t.badge}</span>}
            </button>))}
        </div>
        <div className="tgb-main"><div className="tgb-col">
          {tab === "personal" && <Personal />}
          {tab === "public" && <Public canPost={s?.canPost === true} startCompose={b.open.compose === true} openId={b.open.announcementId} />}
          {(tab === "mine" || tab === "all") && <Orders scope={tab === "all" ? "all" : "mine"} />}
        </div></div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- 個人區

const overdueMark = (due: number | null, overdue: boolean) => (due ? <span className={overdue ? "tgb-over" : ""}>{tr("asDue")}: {fmtDay(due)}{overdue ? ` · ${tr("bOverdue")}` : ""}</span> : null);

function Personal() {
  const { me } = useMe();
  const { ask, dialog } = useConfirm();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{ id: string; what: "complete" | "return" } | null>(null);
  const [open, setOpen] = useState<Ann | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setExpanded((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const load = useCallback(async () => {
    const r = await api<{ items: Item[] }>(`bulletin/personal?tzo=${new Date().getTimezoneOffset()}`);
    if (r.ok) setItems(r.data.items); else setError(r.data.error ?? tr("loadFail"));
    void refreshSummary();
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const on = () => void load(); window.addEventListener(ASSIGNMENT_CREATED, on); return () => window.removeEventListener(ASSIGNMENT_CREATED, on); }, [load]);
  const act = async (path: string, data: unknown = {}) => { const r = await api(path, "POST", data); setError(r.ok ? "" : r.data.error ?? tr("error")); await load(); };
  if (!items) return <div className="tgx-muted">{error || tr("loading")}</div>;
  return (<>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {items.length === 0 && <div className="tgx-muted">{tr("bNothing")}</div>}
    {items.map((it) => { const k = `${it.kind}-${it.id}`; const ex = expanded.has(k); return (
      <div className="tgx-card" key={k}>
        <button type="button" className="tgb-head" aria-expanded={ex} onClick={() => toggle(k)}>
          <span className="tgb-caret" data-open={ex ? "1" : "0"}><Icon name="chevron" size={13} /></span>
          <span className="tgb-headtitle">{it.title}</span>
          <span className="tgx-muted tgb-headmeta">{it.kind === "assignment" ? <>{tr((it.assignment.runState ? `asRun_${it.assignment.runState}` : `asStatus_${it.assignment.status}`) as Key)}{it.due ? <> · <span className={it.overdue ? "tgb-over" : ""}>{fmtDay(it.due)}{it.overdue ? ` ${tr("bOverdue")}` : ""}</span></> : null}</> : it.kind === "ack" ? tr("bRequireAck") : it.kind === "wizard" ? (it.wizard.aspect === "skill" ? tr("bKindSkill") : tr("bKindWizard")) : tr("shareRequest")}</span>
        </button>
        {it.kind === "assignment" && (<>
          {ex && it.assignment.description && <div style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{it.assignment.description}</div>}
          <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("asBy")}: {it.assignment.applicantName}
            {it.assignment.sessionId && <> · <a href={`/?session=${encodeURIComponent(it.assignment.sessionId)}`}>{tr("chats")}</a></>}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {it.assignment.status === "open" && <button className="tgx-btn primary" onClick={() => act(`assignments/${it.id}/accept`)}>{tr("asAccept")}</button>}
            <button className="tgx-btn" onClick={() => setPrompt({ id: it.id, what: "complete" })}>{tr("asComplete")}</button>
            <button className="tgx-btn" onClick={() => setPrompt({ id: it.id, what: "return" })}>{tr("asReturn")}</button>
          </div>
        </>)}
        {it.kind === "ack" && (<>
          <div className="tgx-muted" style={{ fontSize: 12, margin: "4px 0" }}>{tr("bFrom")}: {it.announcement.authorName} · {fmtDateTime(it.announcement.createdAt)}</div>
          {ex && <div className="tgb-md"><MarkdownBody>{it.announcement.body}</MarkdownBody></div>}
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="tgx-btn primary" onClick={() => act(`announcements/${it.id}/ack`)}>{tr("bAck")}</button>
            <button className="tgx-btn" onClick={() => setOpen(it.announcement)}>{tr("details")}</button>
          </div>
        </>)}
        {it.kind === "wizard" && <div style={{ marginTop: 8 }}><WizardPersonal item={it.wizard} admin={me?.role === "admin"} onDone={() => void load()} after={closeBulletin} /></div>}
        {it.kind === "approval" && (<>
          {ex && <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0", font: "inherit" }}>{it.approval.body}</pre>}
          <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("asBy")}: {it.approval.applicantName}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="tgx-btn primary" onClick={() => ask(tr("cfApprove", { name: it.approval.name }), tr("approve"), () => act(`admin/workorders/${it.id}/decide`, { approve: true }))}>{tr("approve")}</button>
            <button className="tgx-btn" onClick={() => ask(tr("cfReject", { name: it.approval.name }), tr("reject"), () => act(`admin/workorders/${it.id}/decide`, { approve: false }))}>{tr("reject")}</button>
          </div>
        </>)}
      </div>); })}
    {prompt && <TextPromptDialog title={tr(prompt.what === "return" ? "asReturn" : "asComplete")} label={tr(prompt.what === "return" ? "asReason" : "asNote")} confirmLabel={tr(prompt.what === "return" ? "asReturn" : "asComplete")} required={prompt.what === "return"}
      onClose={() => setPrompt(null)} onSubmit={(text) => { const p = prompt; setPrompt(null); void act(`assignments/${p.id}/${p.what}`, p.what === "return" ? { reason: text } : { note: text }); }} />}
    {open && <Detail id={open.id} onClose={() => { setOpen(null); void load(); }} onChanged={() => void load()} />}
    {dialog}
  </>);
}

// ---------------------------------------------------------------- 公用區

function Public({ canPost, startCompose, openId }: { canPost: boolean; startCompose: boolean; openId?: string }) {
  const [view, setView] = useState<"active" | "expired">("active");
  const [rows, setRows] = useState<Ann[] | null>(null);
  const [error, setError] = useState("");
  const [compose, setCompose] = useState(startCompose);
  const [openAnn, setOpenAnn] = useState<string | null>(openId ?? null);
  const load = useCallback(async () => {
    const r = await api<{ announcements: Ann[] }>(`announcements?view=${view}&tzo=${new Date().getTimezoneOffset()}`);
    if (r.ok) setRows(r.data.announcements); else setError(r.data.error ?? tr("loadFail"));
    void refreshSummary();
  }, [view]);
  useEffect(() => { void load(); }, [load]);
  return (<>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
      <Segmented ariaLabel={tr("bTabPublic")} value={view} options={[{ value: "active", label: tr("bActive") }, { value: "expired", label: tr("bExpired") }]} onChange={(v) => { setRows(null); setView(v as typeof view); }} />
      {canPost && <button className="tgx-btn primary" style={{ marginLeft: "auto" }} onClick={() => setCompose(true)}>{tr("bNewAnnouncement")}</button>}
    </div>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {rows === null ? <div className="tgx-muted">{tr("loading")}</div> : rows.length === 0 && <div className="tgx-muted">{tr(view === "active" ? "bNoAnn" : "bNoExpired")}</div>}
    {rows?.map((a) => (
      <button type="button" className="tgx-card tgb-card" key={a.id} onClick={() => setOpenAnn(a.id)}>
        <div className="tgb-row">
          <span className={a.read || a.mine ? "tgb-read" : "tgb-unread"}>{a.pinned && <span className="tgx-badge" style={{ marginRight: 6 }}>{tr("bPinned")}</span>}{a.title}</span>
          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
            {a.requireAck && !a.acked && !a.mine && <span className="tgx-badge">{tr("bRequireAck")}</span>}
            {a.requireAck && a.acked && <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("bAcked")}</span>}
            {a.stats && <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("bReadStats", { read: a.stats.read, total: a.stats.total })}</span>}
          </span>
        </div>
        <div className="tgx-muted" style={{ fontSize: 12, marginTop: 4 }}>{a.authorName} · {a.audienceAll ? tr("bAudienceAll") : a.audienceLabel} · {fmtDateTime(a.createdAt)}{a.expiresAt ? ` · ${tr("bDueOn", { day: fmtDay(a.expiresAt) })}` : ""}</div>
      </button>))}
    {compose && <Compose onClose={(changed) => { setCompose(false); if (changed) void load(); }} />}
    {openAnn && <Detail id={openAnn} onClose={() => { setOpenAnn(null); void load(); }} onChanged={() => void load()} />}
  </>);
}

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { ask, dialog } = useConfirm();
  const [d, setD] = useState<{ announcement: Ann; history: Hist[] } | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  const load = useCallback(async () => {
    const r = await api<{ announcement: Ann; history: Hist[] }>(`announcements/${id}?tzo=${new Date().getTimezoneOffset()}`);
    if (r.ok) setD(r.data); else setError(r.data.error ?? tr("loadFail"));
  }, [id]);
  useEffect(() => { void (async () => { await api(`announcements/${id}/read`, "POST", {}); await load(); void refreshSummary(); })(); }, [id, load]);
  const a = d?.announcement;
  const history = d?.history ?? [];
  const ack = async () => { const r = await api(`announcements/${id}/ack`, "POST", {}); setError(r.ok ? "" : r.data.error ?? tr("error")); await load(); onChanged(); void refreshSummary(); };
  const togglePin = async () => { if (!a) return; const r = await api(`announcements/${id}`, "PATCH", { pinned: !a.pinned }); setError(r.ok ? "" : r.data.error ?? tr("error")); await load(); onChanged(); };
  const del = async () => { const r = await api(`announcements/${id}`, "DELETE"); if (!r.ok) { setError(r.data.error ?? tr("error")); return; } onChanged(); onClose(); };
  return (
    <Modal title={a?.title ?? tr("bulletin")} size="md" onClose={onClose}>
      {!a ? <div className="tgx-muted">{error || tr("loading")}</div> : (<>
        <div className="tgx-muted" style={{ fontSize: 12 }}>
          {tr("bFrom")}: {a.authorName} · {fmtDateTime(a.createdAt)}{a.edited ? ` · ${tr("bEdited")}` : ""}<br />
          {tr("bAudience")}: {a.audienceAll ? tr("bAudienceAll") : a.audienceLabel}{a.expiresAt ? ` · ${tr("bDueOn", { day: fmtDay(a.expiresAt) })}` : ""}{a.expired ? ` · ${tr("bExpired")}` : ""}{a.pinned ? ` · ${tr("bPinned")}` : ""}
        </div>
        <div><MarkdownBody>{a.body}</MarkdownBody></div>
        {a.requireAck && !a.mine && (a.acked ? <div className="tgx-muted">{tr("bAcked")}</div> : <div><button className="tgx-btn primary" onClick={ack}>{tr("bAck")}</button></div>)}
        {a.stats && (
          <div className="tgx-card" style={{ margin: 0 }}>
            <strong>{tr("bReadStats", { read: a.stats.read, total: a.stats.total })}{a.requireAck ? ` · ${tr("bAckStats", { n: a.stats.acked, total: a.stats.total })}` : ""}</strong>
            {a.stats.notRead.length > 0 && <div style={{ marginTop: 6 }}><span className="tgx-muted">{tr("bNotRead")}: </span>{a.stats.notRead.join("、")}</div>}
            {a.requireAck && a.stats.notAcked.length > 0 && <div style={{ marginTop: 6 }}><span className="tgx-muted">{tr("bNotAcked")}: </span>{a.stats.notAcked.join("、")}</div>}
          </div>)}
        {history.length > 0 && (
          <details>
            <summary style={{ cursor: "pointer" }}>{tr("bHistory")} ({history.length})</summary>
            {history.map((h) => (
              <div key={h.id} className="tgx-card" style={{ margin: "8px 0 0" }}>
                <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("bEditedBy", { name: h.editorName, time: fmtDateTime(h.ts) })}</div>
                <strong>{h.oldTitle}</strong><div style={{ whiteSpace: "pre-wrap" }}>{h.oldBody}</div>
              </div>))}
          </details>)}
        {error && <div className="tgx-err" role="alert">{error}</div>}
        {a.canEdit && (
          <div className="tgx-actions">
            <button className="tgx-btn" onClick={togglePin}>{tr(a.pinned ? "bUnpin" : "bPin")}</button>
            <button className="tgx-btn" onClick={() => setEdit(true)}>{tr("bEdit")}</button>
            <button className="tgx-btn" onClick={() => ask(tr("bDeleteConfirm"), tr("bDelete"), del)}>{tr("bDelete")}</button>
          </div>)}
        {edit && <Compose existing={a} onClose={(changed) => { setEdit(false); if (changed) { void load(); onChanged(); } }} />}
      </>)}
      {dialog}
    </Modal>
  );
}

// ---------------------------------------------------------------- compose / edit (a human publishes; the AI only drafts)

function Compose({ existing, onClose }: { existing?: Ann; onClose: (changed: boolean) => void }) {
  const [scope, setScope] = useState<{ all: boolean; groups: { id: string; name: string }[] } | null>(null);
  const [f, setF] = useState({
    title: existing?.title ?? "", body: existing?.body ?? "", all: existing?.audienceAll ?? false, groups: existing?.audience.map((g) => g.id) ?? ([] as string[]),
    pinned: existing?.pinned ?? false, requireAck: existing?.requireAck ?? false, expires: existing?.expiresAt ? new Date(existing.expiresAt).toISOString().slice(0, 10) : "",
  });
  const [topic, setTopic] = useState("");
  const [ai, setAi] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ all: boolean; groups: { id: string; name: string }[] }>("bulletin/scope").then((r) => { if (r.ok) setScope(r.data); }); }, []);
  const audienceOk = f.all || f.groups.length > 0;
  const names = useMemo(() => (f.all ? tr("bAudienceAll") : (scope?.groups ?? []).filter((g) => f.groups.includes(g.id)).map((g) => g.name).join("、")), [f.all, f.groups, scope]);
  const draft = async () => {
    setAi("working"); setError("");
    const r = await api<{ title: string; body: string }>("announcements/draft", "POST", { topic, audience: names });
    if (!r.ok) { setAi("idle"); setError(r.data.error ?? tr("error")); return; }
    setF((x) => ({ ...x, title: r.data.title, body: r.data.body })); setAi("done");
  };
  const submit = async () => {
    setBusy(true); setError("");
    const data = { title: f.title, body: f.body, audience: f.all ? "all" : f.groups, pinned: f.pinned, requireAck: f.requireAck, expiresAt: f.expires || null };
    const r = existing ? await api(`announcements/${existing.id}`, "PATCH", data) : await api("announcements", "POST", data);
    setBusy(false);
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    void refreshSummary(); onClose(true);
  };
  return (
    <Modal title={tr(existing ? "bEdit" : "bNewAnnouncement")} size="md" onClose={() => onClose(false)}>
      <div>
        <div className="tgx-muted" style={{ marginBottom: 4 }}>{tr("bAudience")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 150, overflow: "auto" }}>
          {scope?.all && <label style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 4px" }}><input type="checkbox" checked={f.all} onChange={(e) => setF({ ...f, all: e.target.checked })} />{tr("bAudienceAll")}</label>}
          {!f.all && (scope?.groups ?? []).map((g) => (
            <label key={g.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 4px" }}>
              <input type="checkbox" checked={f.groups.includes(g.id)} onChange={(e) => setF({ ...f, groups: e.target.checked ? [...f.groups, g.id] : f.groups.filter((x) => x !== g.id) })} />{g.name}
            </label>))}
          {scope && !scope.all && scope.groups.length === 0 && <div className="tgx-muted">{tr("bNoGroups")}</div>}
        </div>
      </div>
      <div className="tgx-card" style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <input className="tgx-input" aria-label={tr("bAiTopic")} placeholder={tr("bAiTopic")} maxLength={1000} value={topic} onChange={(e) => setTopic(e.target.value)} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="tgx-btn" disabled={!topic.trim() || ai === "working"} onClick={draft}>{tr(ai === "working" ? "bAiWorking" : "bAiHelp")}</button>
          {ai === "done" && <span className="tgx-muted" role="status">{tr("bAiDone")}</span>}
        </div>
      </div>
      <input className="tgx-input" placeholder={tr("bTitle")} aria-label={tr("bTitle")} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <textarea className="tgx-input" rows={8} placeholder={tr("bBody")} aria-label={tr("bBody")} maxLength={8000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{tr("bExpires")} <DateField ariaLabel={tr("bExpires")} value={f.expires} onChange={(v) => setF({ ...f, expires: v })} /></div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />{tr("bPin")}</label>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={f.requireAck} onChange={(e) => setF({ ...f, requireAck: e.target.checked })} />{tr("bRequireAck")}</label>
      {error && <div className="tgx-err" role="alert">{error}</div>}
      <div className="tgx-actions">
        <button type="button" className="tgx-btn" onClick={() => onClose(false)}>{tr("cancel")}</button>
        <button type="button" className="tgx-btn primary" disabled={busy || !audienceOk || !f.title.trim() || !f.body.trim()} onClick={submit}>{tr(existing ? "save" : "bPublish")}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- 我交辦的 / 全部

function Orders({ scope }: { scope: "mine" | "all" }) {
  const [rows, setRows] = useState<(Asg & { createdAt: number })[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => { const r = await api<{ assignments: (Asg & { createdAt: number })[] }>(`assignments?scope=${scope}`); if (r.ok) setRows(r.data.assignments); else setError(r.data.error ?? tr("loadFail")); }, [scope]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  useEffect(() => { const on = () => void load(); window.addEventListener(ASSIGNMENT_CREATED, on); return () => window.removeEventListener(ASSIGNMENT_CREATED, on); }, [load]);
  const today = (() => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); })();
  return (<>
    <div style={{ display: "flex", marginBottom: 12 }}><button className="tgx-btn" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>{tr("newAssignment")}</button></div>
    {creating && <NewAssignment onClose={() => setCreating(false)} />}
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {rows === null ? <div className="tgx-muted">{tr("loading")}</div> : rows.length === 0 && <div className="tgx-muted">{tr("asNone")}</div>}
    {rows?.map((a) => {
      const late = a.dueDate !== null && Math.floor(a.dueDate / 86_400_000) * 86_400_000 < today && (a.status === "open" || a.status === "accepted");
      return (
        <div className="tgx-card" key={a.id}>
          <div className="tgb-row"><strong>{a.title}</strong><span className="tgx-badge">{tr(`asStatus_${a.status}` as Key)}</span></div>
          {a.description && <div style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{a.description}</div>}
          <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("asBy")}: {a.applicantName} · {tr("asTo")}: {a.assigneeName}{a.dueDate ? <> · {overdueMark(a.dueDate, late)}</> : null}</div>
          {a.returnReason && <div style={{ marginTop: 4 }}>{tr("asReason")}: {a.returnReason}</div>}
          {a.doneNote && <div style={{ marginTop: 4 }}>{tr("asNote")}: {a.doneNote}</div>}
        </div>);
    })}
  </>);
}
