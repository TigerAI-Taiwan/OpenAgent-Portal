"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 交辦: the progress record of work orders. Two tabs: 交辦我 (handed to me, each with a tag for who made it: 人 / AI / n8n) and
// 我交辦 (handed out by me, with 全部 / 交給人 / 交給 AI). An order handed to an AI runs in the background; when it stops it waits
// here as 待確認 with the AI's result and the applicant confirms (完成) or sends it back with a reason. The assignee acts in place.
// 公佈欄 (the bell) stays the wider view: announcements and every action item. Shared Modal, no back button.
import { useCallback, useEffect, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { fmtDay, tr, type Key } from "../pages/i18n";
import { Icon, Modal, Segmented, TextPromptDialog, api } from "./kit";
import { refreshSummary } from "./bulletin-store";
import NewAssignment, { ASSIGNMENT_CREATED } from "./NewAssignment";
import { useMe } from "./me";
import { closePanel, useUi } from "./store";

type Asg = {
  id: string; title: string; description: string; applicantId: string; applicantName: string; assigneeId: string; assigneeName: string; dueDate: number | null; sessionId: string | null;
  status: "open" | "accepted" | "running" | "review" | "done" | "returned"; returnReason: string | null; doneNote: string | null; source: "person" | "ai" | "n8n";
  assigneeKind: "user" | "ai"; agentName: string | null; runState: "running" | "review" | null; aiResult: string | null; aiNote: string | null; runCount: number;
};
type Tab = "assigned" | "mine";
type Kind = "all" | "user" | "ai";
// The API says "running" / "review" for an AI order that has a run state (workorders/assignments.ts apiStatus).
const statusKey = (a: Asg): Key => (a.status === "running" || a.status === "review" ? (`asRun_${a.status}` as Key) : (`asStatus_${a.status}` as Key));

const CSS = `
.tgas-tabs{display:flex;gap:6px;flex:none;align-items:center;flex-wrap:wrap}
.tgas-row{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap}
.tgas-over{color:#d93025;font-weight:600}
.tgas-result{margin-top:8px;border-top:1px solid var(--border);padding-top:8px}
.tgas-acts{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}
`;

/** 「確認」 交辦單 carry `/?settings=dir&node=…`: shown as a link that opens the file in the 目錄. */
function withDirLink(text: string) {
  const m = /(\/\?settings=dir&node=[^\s()（）]+)/.exec(text);
  if (!m) return text;
  const i = m.index;
  return <>{text.slice(0, i)}<a href={m[1]} data-tg-dir-link>{tr("asOpenDir")}</a>{text.slice(i + m[1].length)}</>;
}

export default function AssignmentsModal() {
  const ui = useUi();
  const [tab, setTab] = useState<Tab>(ui.panel?.tab === "mine" ? "mine" : "assigned");
  const [kind, setKind] = useState<Kind>("all");
  const [creating, setCreating] = useState(false);
  const tabs: { id: Tab; label: string }[] = [{ id: "assigned", label: tr("asTabToMe") }, { id: "mine", label: tr("asTabByMe") }];
  return (
    <Modal title={tr("assignmentsTitle")} size="md" onClose={closePanel}>
      <style>{CSS}</style>
      <div className="tgas-tabs" role="tablist" aria-label={tr("assignmentsTitle")}>
        {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tgx-btn${tab === t.id ? " primary" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
        <button type="button" className="tgx-btn" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>{tr("newAssignment")}</button>
      </div>
      {tab === "mine" && <Segmented ariaLabel={tr("asTabByMe")} value={kind} onChange={(v) => setKind(v as Kind)} options={[{ value: "all", label: tr("asKindAll") }, { value: "user", label: tr("asKindUser") }, { value: "ai", label: tr("asKindAi") }]} />}
      <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("asOnlyProgress")}</div>
      <List tab={tab} kind={kind} focus={ui.panel?.focus ?? null} />
      {creating && <NewAssignment onClose={() => setCreating(false)} />}
    </Modal>
  );
}

function List({ tab, kind, focus }: { tab: Tab; kind: Kind; focus: string | null }) {
  const { me } = useMe();
  const [rows, setRows] = useState<Asg[] | null>(null);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{ id: string; what: "complete" | "return" } | null>(null);
  const load = useCallback(async () => {
    const q = tab === "assigned" ? "scope=assigned" : `scope=mine${kind === "all" ? "" : `&kind=${kind}`}`;
    const r = await api<{ assignments: Asg[] }>(`assignments?${q}`);
    if (r.ok) { setRows(r.data.assignments); setError(""); } else setError(r.data.error ?? tr("loadFail"));
  }, [tab, kind]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  // An AI order that is still working changes by itself: look again every few seconds while one is on screen.
  const working = rows?.some((a) => a.runState === "running") ?? false;
  useEffect(() => { if (!working) return; const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, [working, load]);
  useEffect(() => { if (focus && rows) document.querySelector(`[data-tg-assignment="${window.CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center" }); }, [focus, rows]);
  useEffect(() => { const on = () => void load(); window.addEventListener(ASSIGNMENT_CREATED, on); return () => window.removeEventListener(ASSIGNMENT_CREATED, on); }, [load]);
  const act = async (path: string, data: unknown = {}) => { const r = await api(path, "POST", data); setError(r.ok ? "" : r.data.error ?? tr("error")); await load(); void refreshSummary(); };
  const today = (() => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); })();
  if (rows === null) return <div className="tgx-muted">{error || tr("loading")}</div>;
  return (<>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {rows.length === 0 && <div className="tgx-muted">{tr("asNone")}</div>}
    {rows.map((a) => {
      const isAi = a.assigneeKind === "ai";
      const active = a.status === "open" || a.status === "accepted" || a.status === "running" || a.status === "review";
      const late = a.dueDate !== null && Math.floor(a.dueDate / 86_400_000) * 86_400_000 < today && active;
      const mineToDo = !isAi && active && a.assigneeId === me?.id;
      const aiReview = isAi && a.status === "review" && a.applicantId === me?.id;
      const tag = a.source === "person" ? tr("asTagPerson") : a.source === "ai" ? tr("asTagAi") : tr("asTagN8n");
      return (
        <div className="tgx-card" key={a.id} data-tg-assignment={a.id} data-tg-state={isAi ? (a.runState ?? a.status) : a.status} style={{ marginBottom: 0, ...(focus === a.id ? { outline: "2px solid var(--accent, #3b82f6)" } : {}) }}>
          <div className="tgas-row"><strong>{a.title}</strong><span style={{ display: "flex", gap: 6 }}>{tab === "assigned" && <span className="tgx-badge" data-tg-tag={a.source}>{tag}</span>}<span className="tgx-badge">{tr(statusKey(a))}</span></span></div>
          {a.description && <div style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{withDirLink(a.description)}</div>}
          <div className="tgx-muted" style={{ fontSize: 12 }}>
            {tr("asBy")}: {a.applicantName} · {tr("asTo")}: {isAi ? `AI · ${a.agentName ?? tr("asGeneralAi")}` : a.assigneeName}
            {a.dueDate ? <> · <span className={late ? "tgas-over" : ""}><Icon name="calendar" size={11} /> {fmtDay(a.dueDate)}{late ? ` · ${tr("bOverdue")}` : ""}</span></> : null}
            {a.sessionId && <> · <a href={`/?session=${encodeURIComponent(a.sessionId)}`}>{isAi ? tr("asOpenChat") : tr("chats")}</a></>}
          </div>
          {isAi && a.runState === "running" && <div className="tgx-muted" style={{ marginTop: 6 }}>{tr("asAiWorking")}</div>}
          {isAi && a.aiNote && <div style={{ marginTop: 6 }} className="tgas-over">{a.aiNote}</div>}
          {isAi && a.aiResult && <div className="tgas-result" data-tg-ai-result><MarkdownBody>{a.aiResult}</MarkdownBody></div>}
          {a.returnReason && <div style={{ marginTop: 4 }}>{tr("asReason")}: {a.returnReason}</div>}
          {a.doneNote && <div style={{ marginTop: 4 }}>{tr("asNote")}: {a.doneNote}</div>}
          {(mineToDo || aiReview) && (
            <div className="tgas-acts">
              {a.status === "open" && <button className="tgx-btn primary" onClick={() => act(`assignments/${a.id}/accept`)}>{tr("asAccept")}</button>}
              <button className="tgx-btn" onClick={() => setPrompt({ id: a.id, what: "complete" })}>{tr("asComplete")}</button>
              <button className="tgx-btn" onClick={() => setPrompt({ id: a.id, what: "return" })}>{tr("asReturn")}</button>
            </div>)}
        </div>);
    })}
    {prompt && <TextPromptDialog title={tr(prompt.what === "return" ? "asReturn" : "asComplete")} label={tr(prompt.what === "return" ? "asReason" : "asNote")} confirmLabel={tr(prompt.what === "return" ? "asReturn" : "asComplete")} required={prompt.what === "return"}
      onClose={() => setPrompt(null)} onSubmit={(text) => { const p = prompt; setPrompt(null); void act(`assignments/${p.id}/${p.what}`, p.what === "return" ? { reason: text } : { note: text }); }} />}
  </>);
}
