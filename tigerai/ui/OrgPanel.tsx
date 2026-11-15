"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 組織 (administrators): org.xlsx download / preview / apply, 離職交接, 換部門 and the old head's list of project channels.
// The page only draws and sends; every rule (who may, what is refused) lives on the server (tigerai/org/*).
import { useCallback, useEffect, useState } from "react";
import { tr } from "../pages/i18n";
import { FilePick, Modal, Select, api, useConfirm } from "./kit";

type Issue = { sheet: string; row: number; col: string; message: string; code?: string };
type Change = { kind: string; sheet: string; row: number; target: string; fields: { field: string; from: string; to: string }[] };
type Plan = { errors: Issue[]; warnings: Issue[]; changes: Change[]; summary: { unitsCreate: number; unitsUpdate: number; hire: number; rejoin: number; update: number; leave: number }; digest: string };

const KIND_KEY = { "unit.create": "chUnitCreate", "unit.update": "chUnitUpdate", "member.create": "chMemberCreate", "member.update": "chMemberUpdate", "member.leave": "chMemberLeave", "member.rejoin": "chMemberRejoin" } as const;
/** The server keeps English messages (logs, API clients); the page shows Chinese for the codes it knows and falls back to the server text. */
const ISSUE_ZH: Record<string, string> = {
  already_active: "這個帳號已經是啟用狀態(不需要任職)", already_left: "這個人已經離職", leave_owns: "這個人名下有頻道、AI 角色或未完成的交辦單:頻道改由你(管理員)接手;角色與交辦單維持原狀,請到「成員」逐一交接",
  leaver_still_listed: "已離職的人仍列為這個單位的主管,請確認", confirmers_ignored: "確認人欄位這一版不使用,已忽略", unknown_column: "不認得的欄位名稱", missing_column: "缺少必要欄位", formula_like: "文字不可以以 = + - @ 開頭(防公式注入);單獨一個「-」才是清空",
  bad_email: "不是電子郵件格式", bad_action: "action 只能是 hire、leave 或空白", bad_role: "role 只能是 admin 或 member", no_account: "找不到這個帳號;要建立請在 action 寫 hire", duplicate: "在檔案中重複出現", employee_id_taken: "員編已被使用",
  bad_name: "姓名不符合規則(不能有空白或 @,也不能叫 AI)", bad_parent: "上層單位不存在、或會形成迴圈", bad_units: "單位不在檔案或系統中", left_user: "已離職的人不能被加進單位或指定為主管", last_admin: "不能停用或降級最後一位管理員", leave_self: "不能讓自己離職", self_lockout: "不能對自己的帳號這樣做", cannot_clear: "這個欄位不能清空",
};
const FIELD_ZH: Record<string, string> = { name: "姓名", role: "角色", status: "狀態", employeeId: "員編", units: "單位", parent: "上層", description: "說明", managers: "主管" };
const issueText = (i: Issue) => (i.code && ISSUE_ZH[i.code] ? `${ISSUE_ZH[i.code]}${i.code === "leave_owns" || i.code === "already_active" || i.code === "already_left" || i.code === "confirmers_ignored" || i.code === "leaver_still_listed" ? "" : ` (${i.message})`}` : i.message);
const where = (i: Issue) => (i.row ? tr("orgSheetRow", { sheet: i.sheet, row: i.row, col: i.col }) : i.sheet === "-" ? "" : i.sheet);

export function OrgPage() {
  const { ask, dialog } = useConfirm();
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [msg, setMsg] = useState("");
  const [csv, setCsv] = useState("");
  const send = async (apply: boolean) => {
    if (!file) return;
    setMsg(""); setCsv("");
    const url = `/api/tg/admin/org/${apply ? "apply" : "preview"}${apply && plan ? `?digest=${plan.digest}` : ""}`;
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file, cache: "no-store" });
    const j = await r.json().catch(() => ({} as Record<string, unknown>));
    if (!r.ok) {
      if (j.code === "stale_preview") { setMsg(tr("orgStale")); setPlan(null); return; }
      if (j.plan) setPlan(j.plan as Plan);
      setMsg(String(j.error ?? tr("error"))); return;
    }
    if (apply) { setCsv(String(j.initialPasswordsCsv ?? "")); setPlan(null); setFile(null); setMsg(tr("orgDone")); } else setPlan(j as unknown as Plan);
  };
  const canApply = !!plan && plan.errors.length === 0 && plan.changes.length > 0;
  return (<>
    <p className="tgx-muted" style={{ marginTop: 0 }}>{tr("orgIntro")}</p>
    <div className="tgx-card" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <a className="tgx-btn" href="/api/tg/admin/org/export" download="org.xlsx" data-org-export>{tr("orgExport")}</a>
      <FilePick accept=".xlsx" ariaLabel={tr("orgChoose")} file={file} onPick={(f) => { setFile(f); setPlan(null); setMsg(""); }} />
      <button className="tgx-btn" disabled={!file} onClick={() => void send(false)}>{tr("orgPreviewBtn")}</button>
      <button className="tgx-btn primary" disabled={!canApply} onClick={() => ask(tr("orgApplyAsk"), tr("orgApplyBtn"), () => send(true))}>{tr("orgApplyBtn")}</button>
    </div>
    {msg && <div className={msg === tr("orgDone") ? "tgx-card" : "tgx-err"} role="alert">{msg}</div>}
    {plan && (<div data-org-plan>
      <div className="tgx-muted" style={{ margin: "8px 0" }}>{tr("orgSummary", { uc: plan.summary.unitsCreate, uu: plan.summary.unitsUpdate, hire: plan.summary.hire, rejoin: plan.summary.rejoin, upd: plan.summary.update, leave: plan.summary.leave })}</div>
      {plan.errors.length > 0 && <div className="tgx-err" role="alert"><strong>{tr("orgErrors")}</strong>{plan.errors.map((e, i) => <div key={i}>{where(e)}: {issueText(e)}</div>)}</div>}
      {plan.warnings.length > 0 && <div className="tgx-card" style={{ borderColor: "#c9a227" }}><strong>{tr("orgWarnings")}</strong>{plan.warnings.map((e, i) => <div key={i} data-org-warning={e.code}>{where(e)}: {issueText(e)}</div>)}</div>}
      <div className="tgx-card" style={{ padding: 8, overflowX: "auto" }}>
        <strong style={{ padding: 8, display: "block" }}>{tr("orgChanges")}</strong>
        {plan.changes.length === 0 && <div className="tgx-muted" style={{ padding: 8 }}>{tr("orgNoChanges")}</div>}
        {plan.changes.length > 0 && <table className="tg-table" style={{ width: "100%" }}><tbody>
          {plan.changes.map((c, i) => (<tr key={i}>
            <td style={{ whiteSpace: "nowrap" }}>{tr(KIND_KEY[c.kind as keyof typeof KIND_KEY] ?? "chMemberUpdate")}</td>
            <td><strong>{c.target}</strong></td>
            <td>{c.fields.map((f) => <div key={f.field} style={{ fontSize: 12 }}><span className="tgx-muted">{FIELD_ZH[f.field] ?? f.field}:</span> {f.from || "∅"} → {f.to || "∅"}</div>)}</td>
          </tr>))}</tbody></table>}
      </div>
    </div>)}
    {csv && (<div className="tgx-card" data-org-passwords-box>
      <strong>{tr("orgPwTitle")}</strong>
      <pre data-testid="org-passwords" style={{ margin: "8px 0", whiteSpace: "pre-wrap" }}>{csv}</pre>
      <a className="tgx-btn" download="initial-passwords.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>{tr("orgPwDownload")}</a>
    </div>)}
    <UnitChanges all />
    {dialog}
  </>);
}

// ---------------------------------------------------------------- 換部門 後的專案頻道 (舊單位主管 / 管理員)

type Item = { id: string; userName: string; unitName: string; roomName: string; status: string };
export function UnitChanges({ all }: { all?: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { const r = await api<{ items: Item[] }>("unit-changes"); if (r.ok) setItems(r.data.items); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!items || (items.length === 0 && !all)) return null;
  const decide = async (id: string, decision: "keep" | "remove") => { const r = await api(`unit-changes/${id}`, "POST", { decision }); setError(r.ok ? "" : r.data.error ?? tr("error")); void load(); };
  return (<div className="tgx-card" data-unit-changes>
    <strong>{tr("ucTitle")}</strong>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {items.length === 0 && <div className="tgx-muted">{tr("ucNone")}</div>}
    {items.map((it) => (
      <div key={it.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 0" }}>
        <span>{tr("ucAbout", { user: it.userName, unit: it.unitName, room: it.roomName })}</span>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="tgx-btn" onClick={() => void decide(it.id, "keep")}>{tr("ucKeep")}</button>
          <button className="tgx-btn" onClick={() => void decide(it.id, "remove")}>{tr("ucRemove")}</button>
        </span>
      </div>))}
  </div>);
}

// ---------------------------------------------------------------- 離職

type Inv = {
  channels: { id: string; name: string; archived: boolean; members: number; schedules: number }[];
  agents: { id: string; name: string }[];
  assignments: { id: string; title: string; role: "assignee" | "applicant"; status: string }[];
  orders: { id: string; kind: string }[];
  conversations: number; keys: number; units: { id: string; name: string }[];
};
export type PersonLite = { id: string; name: string; status: string };

export function LeaveDialog({ user, people, onClose, onDone }: { user: PersonLite; people: PersonLite[]; onClose: () => void; onDone: () => void }) {
  const [inv, setInv] = useState<Inv | null>(null);
  const [successor, setSuccessor] = useState("");
  const [channels, setChannels] = useState<Record<string, "transfer" | "admin">>({});
  const [rows, setRows] = useState<Record<string, "transfer" | "keep">>({});
  const [error, setError] = useState("");
  useEffect(() => { void api<{ inventory: Inv }>(`admin/users/${user.id}/inventory`).then((r) => { if (r.ok) setInv(r.data.inventory); else setError(r.data.error ?? tr("error")); }); }, [user.id]);
  const owns = !!inv && inv.channels.length + inv.agents.length + inv.assignments.length + inv.orders.length > 0;
  const submit = async () => {
    const r = await api(`admin/users/${user.id}/leave`, "POST", { successorId: successor || undefined, channels, assignments: rows, orders: rows });
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    onDone();
  };
  return (<Modal title={tr("leaveTitle", { name: user.name })} size="md" onClose={onClose}>
    <p className="tgx-muted" style={{ marginTop: 0 }}>{tr("leaveIntro")}</p>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {inv && !owns && <div className="tgx-muted" data-leave-empty>{tr("leaveNothing")}</div>}
    {inv && owns && (<div data-leave-owns>
      <label>{tr("leaveSuccessor")}<br />
        <Select ariaLabel={tr("leaveSuccessor")} placeholder={tr("leavePick")} width={260} value={successor} onChange={setSuccessor} options={people.filter((p) => p.id !== user.id && p.status === "active").map((p) => ({ value: p.id, label: p.name }))} />
      </label>
      {inv.channels.length > 0 && <div style={{ marginTop: 10 }}><strong>{tr("leaveChannels")}</strong>
        {inv.channels.map((c) => (<div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "4px 0" }}>
          <span># {c.name}{c.schedules ? <span className="tgx-muted" style={{ fontSize: 12 }}> · {tr("leaveSchedules", { n: c.schedules })}</span> : null}</span>
          <Select ariaLabel={c.name} width={190} value={channels[c.id] ?? (successor ? "transfer" : "admin")} onChange={(v) => setChannels({ ...channels, [c.id]: v as "transfer" | "admin" })} options={[{ value: "transfer", label: tr("leaveToSuccessor") }, { value: "admin", label: tr("leaveToAdmin") }]} />
        </div>))}</div>}
      {inv.agents.length > 0 && <div style={{ marginTop: 10 }}><strong>{tr("leaveRoles")}</strong><div>{inv.agents.map((a) => a.name).join("、")}</div></div>}
      {inv.assignments.length + inv.orders.length > 0 && <div style={{ marginTop: 10 }}><strong>{tr("leaveOrders")}</strong>
        {inv.assignments.map((a) => (<div key={`${a.id}${a.role}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "4px 0" }}>
          <span>{a.title} <span className="tgx-chip" style={{ fontSize: 11 }}>{a.role === "assignee" ? tr("leaveAsAssignee") : tr("leaveAsApplicant")}</span></span>
          <Select ariaLabel={a.title} width={150} value={rows[a.id] ?? "transfer"} onChange={(v) => setRows({ ...rows, [a.id]: v as "transfer" | "keep" })} options={[{ value: "transfer", label: tr("leaveTransfer") }, { value: "keep", label: tr("leaveKeep") }]} />
        </div>))}
        {inv.orders.map((o) => (<div key={o.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "4px 0" }}>
          <span>{o.kind}</span>
          <Select ariaLabel={o.kind} width={150} value={rows[o.id] ?? "transfer"} onChange={(v) => setRows({ ...rows, [o.id]: v as "transfer" | "keep" })} options={[{ value: "transfer", label: tr("leaveTransfer") }, { value: "keep", label: tr("leaveKeep") }]} />
        </div>))}</div>}
    </div>)}
    {inv && <p className="tgx-muted" style={{ fontSize: 12 }}>{tr("leaveConv", { n: inv.conversations, k: inv.keys })}</p>}
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
      <button className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
      <button className="tgx-btn primary" data-leave-do disabled={!inv || (owns && !successor)} onClick={() => void submit()}>{tr("leaveDo")}</button>
    </div>
  </Modal>);
}

// ---------------------------------------------------------------- 換部門

type Preview = {
  removed: { name: string }[]; added: { name: string }[];
  leaveDefaultChannels: { id: string; name: string; unitName: string; owner: boolean }[];
  joinDefaultChannels: { id: string; name: string; unitName: string }[];
  projectChannels: { id: string; name: string; unitName: string }[];
  assignments: { id: string; title: string; role: string }[];
};
export function UnitChangeDialog({ user, units, current, people, onClose, onDone }: { user: PersonLite; units: { id: string; name: string }[]; current: string[]; people: PersonLite[]; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>(current);
  const [pv, setPv] = useState<Preview | null>(null);
  const [rows, setRows] = useState<Record<string, "transfer" | "keep">>({});
  const [assignTo, setAssignTo] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { void api<{ preview: Preview }>(`admin/users/${user.id}/unit-change?units=${picked.join(",")}`).then((r) => { if (r.ok) { setPv(r.data.preview); setError(""); } else setError(r.data.error ?? tr("error")); }); }, [picked, user.id]);
  const changed = !!pv && (pv.removed.length > 0 || pv.added.length > 0);
  return (<Modal title={tr("moveTitle", { name: user.name })} size="md" onClose={onClose}>
    <p className="tgx-muted" style={{ marginTop: 0 }}>{tr("moveIntro")}</p>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {units.map((u) => (<label key={u.id} className="tgx-chip" style={{ gap: 6, cursor: "pointer" }}>
        <input type="checkbox" checked={picked.includes(u.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, u.id] : picked.filter((x) => x !== u.id))} aria-label={u.name} />{u.name}
      </label>))}
    </div>
    {pv && !changed && <div className="tgx-muted" style={{ marginTop: 10 }}>{tr("moveNoChange")}</div>}
    {pv && changed && (<div style={{ marginTop: 10, fontSize: 13 }} data-unit-preview>
      <div>{pv.removed.length > 0 && <>− {pv.removed.map((x) => x.name).join("、")}</>} {pv.added.length > 0 && <>+ {pv.added.map((x) => x.name).join("、")}</>}</div>
      {pv.leaveDefaultChannels.map((c) => <div key={c.id}>{tr("moveLeaveCh", { unit: c.unitName, name: c.name })}</div>)}
      {pv.joinDefaultChannels.map((c) => <div key={c.id}>{tr("moveJoinCh", { unit: c.unitName, name: c.name })}</div>)}
      {pv.projectChannels.map((c) => <div key={c.id}>{tr("moveProject", { unit: c.unitName, name: c.name })}</div>)}
      {pv.assignments.length > 0 && <div style={{ marginTop: 8 }}><strong>{tr("moveOrders")}</strong>
        <label style={{ display: "block", margin: "4px 0" }}>{tr("moveAssignTo")}{" "}<Select ariaLabel={tr("moveAssignTo")} width={200} value={assignTo} onChange={setAssignTo} options={people.filter((p) => p.id !== user.id && p.status === "active").map((p) => ({ value: p.id, label: p.name }))} /></label>
        {pv.assignments.map((a) => (<div key={`${a.id}${a.role}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "3px 0" }}>
          <span>{a.title}</span>
          <Select ariaLabel={a.title} width={140} value={rows[a.id] ?? "keep"} onChange={(v) => setRows({ ...rows, [a.id]: v as "transfer" | "keep" })} options={[{ value: "keep", label: tr("leaveKeep") }, { value: "transfer", label: tr("leaveTransfer") }]} />
        </div>))}</div>}
    </div>)}
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
      <button className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
      <button className="tgx-btn primary" data-move-do disabled={!changed} onClick={async () => { const r = await api(`admin/users/${user.id}/units`, "PUT", { unitIds: picked, assignments: rows, assignTo: assignTo || undefined }); if (r.ok) onDone(); else setError(r.data.error ?? tr("error")); }}>{tr("moveDo")}</button>
    </div>
  </Modal>);
}
