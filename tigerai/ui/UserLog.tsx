"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 使用者紀錄: members with their last online time, then one person's conversations, then one conversation read-only.
// Each step is the shared Modal (no back button). The page only draws what the server returned; the server decides who may see whom.
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageView } from "@/components/MessageView";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";
import { fmtDateTime, tr } from "../pages/i18n";
import { relativeZh, stayZh } from "../userlog/format";
import { Modal, Switch, api } from "./kit";
import { JoinCodes, RegisterRequests } from "./Register";
import { UnitChanges } from "./OrgPanel";

type Member = { id: string; name: string; email: string; status: string; departments: string[]; lastSeen: number | null; conversations: number; latestConversation: number | null; stayTodayMs: number; stayWeekMs: number };
type Conv = { id: string; title: string; modified: number };

const when = (ms: number | null) => (ms === null ? tr("ulNever") : (
  <span title={fmtDateTime(ms)}>{relativeZh(ms)}<span className="tgx-muted" style={{ fontSize: 12 }}> · {fmtDateTime(ms)}</span></span>));

export default function UserLog() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [headsCanView, setHeadsCanView] = useState(true);
  const [canSwitch, setCanSwitch] = useState(false);
  const [open, setOpen] = useState<Member | null>(null);
  const load = useCallback(async () => {
    const r = await api<{ members: Member[]; headsCanView: boolean; canSwitch: boolean }>("userlog");
    if (!r.ok) { setError(r.data.error ?? tr("ulLoadFail")); return; }
    setError(""); setMembers(r.data.members); setHeadsCanView(r.data.headsCanView); setCanSwitch(r.data.canSwitch);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (<>
    <p className="tgx-muted" style={{ marginTop: 0 }}>{tr("ulIntro")}</p>
    <RegisterRequests />
    <JoinCodes />
    <UnitChanges />
    {canSwitch && (
      <div className="tgx-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span><strong>{tr("ulSwitch")}</strong><br /><span className="tgx-muted" style={{ fontSize: 12 }}>{tr("ulSwitchHelp")}</span></span>
        <Switch checked={headsCanView} label={tr("ulSwitch")} onChange={async (next) => { const r = await api("userlog/setting", "PUT", { headsCanView: next }); if (r.ok) setHeadsCanView(next); else setError(r.data.error ?? tr("error")); }} />
      </div>)}
    {error && <div className="tgx-err" role="alert">{error}</div>}
    <div><a className="tgx-btn" data-ul-csv href="/api/tg/userlog/export" download>{tr("ulCsv")}</a></div>
    {members && members.length === 0 && <div className="tgx-muted">{tr("ulNone")}</div>}
    {members && members.length > 0 && (
      <div className="tgx-card" style={{ padding: 8, overflowX: "auto" }}>
        <table className="tg-table" style={{ width: "100%" }}>
          <thead><tr><th>{tr("ulColName")}</th><th>{tr("ulColDept")}</th><th>{tr("ulColSeen")}</th><th>{tr("ulColStay")}</th><th>{tr("ulColCount")}</th><th>{tr("ulColLatestV")}</th><th /></tr></thead>
          <tbody>{members.map((m) => (
            <tr key={m.id} data-ul-member={m.name}>
              <td><strong>{m.name}</strong>{m.status !== "active" && <span className="tgx-muted"> ({tr("ulDisabled")})</span>}</td>
              <td>{m.departments.length ? m.departments.join("、") : <span className="tgx-muted">{tr("ulNoDept")}</span>}</td>
              <td>{when(m.lastSeen)}</td>
              <td data-ul-stay>{tr("ulStayLine", { today: stayZh(m.stayTodayMs), week: stayZh(m.stayWeekMs) })}</td>
              <td>{m.conversations}</td>
              <td>{m.latestConversation === null ? <span className="tgx-muted">-</span> : when(m.latestConversation)}</td>
              <td><button className="tgx-btn" onClick={() => setOpen(m)}>{tr("ulOpen")}</button></td>
            </tr>))}</tbody>
        </table>
      </div>)}
    {open && <Conversations member={open} onClose={() => setOpen(null)} />}
  </>);
}

function Conversations({ member, onClose }: { member: Member; onClose: () => void }) {
  const [rows, setRows] = useState<Conv[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Conv | null>(null);
  useEffect(() => { void api<{ conversations: Conv[] }>(`userlog/member/${member.id}`).then((r) => { if (r.ok) setRows(r.data.conversations); else setError(r.data.error ?? tr("ulLoadFail")); }); }, [member.id]);
  return (
    <Modal title={tr("ulConvTitle", { name: member.name })} size="md" onClose={onClose}>
      {error && <div className="tgx-err" role="alert">{error}</div>}
      {rows && rows.length === 0 && <div className="tgx-muted">{tr("ulConvNone")}</div>}
      {rows && rows.map((c) => (
        <button key={c.id} type="button" className="tgx-row" data-ul-conv={c.id} onClick={() => setOpen(c)} style={{ justifyContent: "space-between", gap: 12 }}>
          <span className="name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
          <span className="tgx-muted" style={{ fontSize: 12, flex: "none" }}>{fmtDateTime(c.modified)}</span>
        </button>))}
      {open && <Reader member={member} conv={open} onClose={() => setOpen(null)} />}
    </Modal>);
}

type Msg = AgentMessage & { timestamp?: number };

function Reader({ member, conv, onClose }: { member: Member; conv: Conv; onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void api<{ messages: Msg[] }>(`userlog/member/${member.id}/${conv.id}`).then((r) => { if (r.ok) setMessages(r.data.messages); else setError(r.data.error ?? tr("ulLoadFail")); }); }, [member.id, conv.id]);
  const results = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const m of messages ?? []) if (m.role === "toolResult") map.set((m as ToolResultMessage).toolCallId, m as ToolResultMessage);
    return map;
  }, [messages]);
  return (
    <Modal title={conv.title} size="lg" onClose={onClose}>
      <div style={{ padding: "12px 18px 18px" }}>
      <div className="tgx-muted" style={{ fontSize: 12, marginBottom: 10 }} data-ul-readonly>{tr("ulReadOnly")}</div>
      {error && <div className="tgx-err" role="alert">{error}</div>}
      {/* No input box, no fork / edit / delete handlers: MessageView only offers those when the caller passes them. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 820, margin: "0 auto" }}>
        {messages?.filter((m) => m.role !== "toolResult").map((m, i) => (
          <div key={i} data-ul-msg={m.role}>
            <div className="tgx-muted" style={{ fontSize: 11, marginBottom: 2 }}>{m.role === "user" ? member.name : "AI"}{m.timestamp ? ` · ${fmtDateTime(m.timestamp)}` : ""}</div>
            <MessageView message={m} toolResults={results} />
          </div>))}
      </div>
      </div>
    </Modal>);
}
