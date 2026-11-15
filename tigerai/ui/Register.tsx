"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 學生自行註冊: the administrator's switch (Users page) and the class join codes (使用者紀錄 page). Every rule is on the server.
import { useCallback, useEffect, useState } from "react";
import { tr } from "../pages/i18n";
import { Switch, api, useConfirm } from "./kit";
import { fmtDateTime } from "../pages/i18n";

type Setting = { open: boolean; requireCode: boolean; autoApprove: boolean; perHour: number };

export function RegisterAdmin() {
  const [s, setS] = useState<Setting | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void api<Setting>("admin/register").then((r) => { if (r.ok) setS(r.data); }); }, []);
  if (!s) return null;
  const put = async (patch: Partial<Setting>) => {
    const r = await api<Setting>("admin/register", "PUT", patch);
    if (r.ok) { setS({ ...s, open: r.data.open, requireCode: r.data.requireCode, autoApprove: r.data.autoApprove }); setError(""); } else setError(r.data.error ?? tr("error"));
  };
  return (
    <div className="tgx-card" data-tg-register-admin style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span><strong>{tr("regAdminTitle")}</strong><br /><span className="tgx-muted" style={{ fontSize: 12 }}>{tr("regAdminHelp")}</span></span>
        <Switch checked={s.open} label={tr("regAdminTitle")} onChange={(v) => void put({ open: v })} />
      </div>
      {s.open && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span><strong>{tr("regRequireCode")}</strong><br /><span className="tgx-muted" style={{ fontSize: 12 }}>{tr("regRequireCodeHelp")}</span></span>
          <Switch checked={s.requireCode} label={tr("regRequireCode")} onChange={(v) => void put({ requireCode: v })} />
        </div>)}
      {s.open && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span><strong>{tr("regAuto")}</strong><br /><span className="tgx-muted" style={{ fontSize: 12 }}>{tr("regAutoHelp")}</span></span>
          <Switch checked={s.autoApprove} label={tr("regAuto")} onChange={(v) => void put({ autoApprove: v })} />
        </div>)}
      <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("regPerHour", { n: s.perHour })}</span>
      {error && <div className="tgx-err" role="alert">{error}</div>}
    </div>);
}

type Group = { groupId: string; name: string; code: string | null; enabled: boolean; members: number };

export function JoinCodes() {
  const [rows, setRows] = useState<Group[] | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const { ask, dialog } = useConfirm();
  const load = useCallback(async () => { const r = await api<{ groups: Group[] }>("joincodes"); if (r.ok) setRows(r.data.groups); else setError(r.data.error ?? tr("error")); }, []);
  useEffect(() => { void load(); }, [load]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const act = async (g: Group, action: "rotate" | "disable" | "set") => {
    const r = await api("joincodes/" + g.groupId, "POST", action === "set" ? { action, phrase: draft[g.groupId] ?? "" } : { action });
    if (r.ok && action === "set") setDraft({ ...draft, [g.groupId]: "" });
    if (!r.ok) setError(r.data.error ?? tr("error")); else setError("");
    void load();
  };
  if (!rows) return null;
  return (
    <div className="tgx-card" data-tg-joincodes style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>{tr("jcTitle")}</strong>
      <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("jcHelp")}</span>
      {rows.length === 0 && <span className="tgx-muted">{tr("jcNone")}</span>}
      {rows.map((g) => (
        <div key={g.groupId} data-jc-group={g.name} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ minWidth: 120 }}>{g.name} <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("jcMembers", { n: g.members })}</span></span>
          {g.code ? <code data-jc-code style={{ fontSize: 16, opacity: g.enabled ? 1 : 0.4 }}>{g.code}</code> : <span className="tgx-muted">{tr("jcNoCode")}</span>}
          {g.code && !g.enabled && <span className="tgx-muted">({tr("jcOff")})</span>}
          {g.code && g.enabled && <button className="tgx-btn" onClick={() => { void navigator.clipboard?.writeText(g.code!).then(() => { setCopied(g.groupId); setTimeout(() => setCopied(""), 1500); }).catch(() => undefined); }}>{copied === g.groupId ? tr("jcCopied") : tr("jcCopy")}</button>}
          <input className="tgx-input" aria-label={tr("jcPlaceholder")} placeholder={tr("jcPlaceholder")} maxLength={80} style={{ minWidth: 200 }} value={draft[g.groupId] ?? ""} onChange={(e) => setDraft({ ...draft, [g.groupId]: e.target.value })} />
          <button className="tgx-btn primary" disabled={!(draft[g.groupId] ?? "").trim()} onClick={() => (g.code ? ask(tr("jcConfirmRotate"), tr("jcSet"), () => act(g, "set")) : void act(g, "set"))}>{tr("jcSet")}</button>
          <button className="tgx-btn" onClick={() => (g.code ? ask(tr("jcConfirmRotate"), tr("jcRotate"), () => act(g, "rotate")) : void act(g, "rotate"))}>{tr("jcRotate")}</button>
          {g.code && g.enabled && <button className="tgx-btn" onClick={() => ask(tr("jcConfirmDisable"), tr("jcDisable"), () => act(g, "disable"))}>{tr("jcDisable")}</button>}
        </div>))}
      {error && <div className="tgx-err" role="alert">{error}</div>}
      {dialog}
    </div>);
}

// ---------------------------------------------------------------- 等待核准的註冊 (one glance: grouped by the class the passphrase matched)

type Applicant = { userId: string; name: string; email: string; phrase: string; note: string; createdAt: number };
type ReqGroup = { groupId: string | null; groupName: string | null; applicants: Applicant[] };
let focusGroup: string | null | undefined;
/** The bell item sets the class to scroll to before the settings page opens. */
export function focusRequestGroup(id: string | null): void { focusGroup = id; }

export function RegisterRequests() {
  const [groups, setGroups] = useState<ReqGroup[] | null>(null);
  const [error, setError] = useState("");
  const { ask, dialog } = useConfirm();
  const load = useCallback(async () => { const r = await api<{ groups: ReqGroup[] }>("regrequests"); if (r.ok) setGroups(r.data.groups); else setError(r.data.error ?? tr("error")); }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!groups || focusGroup === undefined) return;
    document.querySelector(`[data-req-group="${focusGroup ?? "none"}"]`)?.scrollIntoView({ block: "center" });
    focusGroup = undefined;
  }, [groups]);
  const post = async (path: string, data: unknown) => { const r = await api(`regrequests/${path}`, "POST", data); setError(r.ok ? "" : r.data.error ?? tr("error")); void load(); };
  if (!groups) return null;
  const total = groups.reduce((n, g) => n + g.applicants.length, 0);
  return (
    <div className="tgx-card" data-tg-regrequests style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span><strong>{tr("rqTitle")}{total > 0 ? ` (${total})` : ""}</strong><br /><span className="tgx-muted" style={{ fontSize: 12 }}>{tr("rqHelp")}</span></span>
        {groups.length > 1 && <button className="tgx-btn" onClick={() => ask(tr("rqConfirmGroup", { n: total }), tr("rqApproveAll"), () => post("all", { action: "approve_all" }))}>{tr("rqApproveAll")}</button>}
      </div>
      {total === 0 && <span className="tgx-muted">{tr("rqNone")}</span>}
      {groups.map((g) => (
        <div key={g.groupId ?? "none"} data-req-group={g.groupId ?? "none"} style={{ border: "1px solid var(--border)", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <strong>{g.groupName ? tr("rqClassLine", { n: g.applicants.length, name: g.groupName }) : `${g.applicants.length} ${tr("rqNoClass")}`}</strong>
            <button className="tgx-btn primary" data-approve-group onClick={() => ask(tr("rqConfirmGroup", { n: g.applicants.length }), tr("rqApproveGroup"), () => post("group", { action: "approve_group", groupId: g.groupId }))}>{tr("rqApproveGroup")}</button>
          </div>
          {g.applicants.map((a) => (
            <div key={a.userId} data-applicant={a.email} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "2px 12px", flexWrap: "wrap" }}>
                <strong style={{ minWidth: 80 }}>{a.name}</strong><span>{a.email}</span>
                {a.phrase && <span className="tgx-muted">「{a.phrase}」</span>}
                <span className="tgx-muted">{fmtDateTime(a.createdAt)}</span>
              </span>
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="tgx-btn" onClick={() => void post(a.userId, { action: "approve" })}>{tr("rqApprove")}</button>
                <button className="tgx-btn" onClick={() => ask(tr("rqConfirmReject"), tr("rqReject"), () => post(a.userId, { action: "reject" }))}>{tr("rqReject")}</button>
              </span>
            </div>))}
        </div>))}
      {error && <div className="tgx-err" role="alert">{error}</div>}
      {dialog}
    </div>);
}
