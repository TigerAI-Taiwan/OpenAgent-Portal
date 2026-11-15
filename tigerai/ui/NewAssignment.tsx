"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 新交辦單 as its own modal (opened from the "+" menu and from the 交辦單 tab). No page of its own.
import { useEffect, useState, type FormEvent } from "react";
import { tr } from "../pages/i18n";
import { DateField, Modal, Segmented, Select, api } from "./kit";
import { enableAiPush } from "./push-client";

export const ASSIGNMENT_CREATED = "tg-assignment-created";

/** `prefill` fills the form (a person still reads it and presses 建立); `onCreated` gets the new id (the meeting summary marks its item as opened). */
export type AssignmentPrefill = { title?: string; description?: string; assigneeId?: string; dueDate?: string };
export default function NewAssignment({ onClose, prefill, onCreated }: { onClose: () => void; prefill?: AssignmentPrefill; onCreated?: (assignmentId: string) => void }) {
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ title: prefill?.title ?? "", description: prefill?.description ?? "", assigneeId: prefill?.assigneeId ?? "", dueDate: prefill?.dueDate ?? "", link: false, kind: "user" as "user" | "ai", agentId: "general" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ menu: { id: string; name: string }[] }>("agents/menu").then((r) => { if (r.ok) setRoles(r.data.menu); }); }, []);
  useEffect(() => { void api<{ users: { id: string; name: string }[] }>("users").then((r) => { if (r.ok) setUsers(r.data.users); }); }, []);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (f.kind === "user" && !f.assigneeId) { setError(tr("pickUser")); return; }
    setBusy(true);
    // Asked here and only here: the click on 建立 is the gesture the browser needs, and this is the moment the person wants to be told.
    if (f.kind === "ai") void enableAiPush();
    const sessionId = f.link ? new URLSearchParams(window.location.search).get("session") ?? sessionStorage.getItem("tg-last-session") : null;
    const r = await api<{ assignment?: { id?: string } }>("assignments", "POST", { title: f.title, description: f.description, ...(f.kind === "ai" ? { assigneeKind: "ai", agentId: f.agentId } : { assigneeId: f.assigneeId }), ...(f.dueDate ? { dueDate: f.dueDate } : {}), ...(sessionId && f.kind === "user" ? { sessionId } : {}) });
    setBusy(false);
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    window.dispatchEvent(new Event(ASSIGNMENT_CREATED));
    if (onCreated && r.data.assignment?.id) onCreated(r.data.assignment.id);
    onClose();
  };
  return (
    <Modal title={tr("newAssignment")} size="md" onClose={onClose}>
      <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input className="tgx-input" placeholder={tr("asTitle")} aria-label={tr("asTitle")} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required autoFocus />
        <textarea className="tgx-input" rows={4} placeholder={tr("asDesc")} aria-label={tr("asDesc")} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{tr("asGiveTo")}
          <Segmented ariaLabel={tr("asGiveTo")} value={f.kind} onChange={(v) => setF({ ...f, kind: v as "user" | "ai" })} options={[{ value: "user", label: tr("asToPerson") }, { value: "ai", label: tr("asToAi") }]} /></div>
        {f.kind === "user"
          ? <Select ariaLabel={tr("asAssignee")} placeholder={tr("pickUser")} value={f.assigneeId} options={users.map((u) => ({ value: u.id, label: u.name }))} onChange={(v) => setF({ ...f, assigneeId: v })} />
          : (<>
            <Select ariaLabel={tr("asPickRole")} value={f.agentId} options={[{ value: "general", label: tr("asGeneralAi") }, ...roles.map((r) => ({ value: r.id, label: r.name }))]} onChange={(v) => setF({ ...f, agentId: v })} />
            <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("asAiHint")}</div>
          </>)}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>{tr("asDue")} <DateField ariaLabel={tr("asDue")} value={f.dueDate} onChange={(v) => setF({ ...f, dueDate: v })} /></div>
        {f.kind === "user" && <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={f.link} onChange={(e) => setF({ ...f, link: e.target.checked })} />{tr("asLinkSession")}</label>}
        {error && <div className="tgx-err" role="alert">{error}</div>}
        <div className="tgx-actions">
          <button type="button" className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
          <button className="tgx-btn primary" disabled={busy || !f.title.trim()}>{tr("asCreate")}</button>
        </div>
      </form>
    </Modal>
  );
}
