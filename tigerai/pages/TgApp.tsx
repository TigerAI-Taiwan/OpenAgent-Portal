"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BRAND_LOGO } from "@/lib/brand";
import { call } from "./api";
import { BasedOn } from "../ui/BasedOn";
import { PurgeDialog } from "../ui/Purge";
import { IdleAdmin } from "../ui/IdleAdmin";
import { RegisterAdmin, RegisterRequests } from "../ui/Register";
import { Modal, Select, useConfirm } from "../ui/kit";
import { LeaveDialog, UnitChangeDialog } from "../ui/OrgPanel";
import { fmtDateTime, tr, useT } from "./i18n";
import "./tg.css";

type Me = { id: string; name: string; email: string; role: "admin" | "member"; mustChangePassword: boolean };

export default function TgApp() {
  const path = usePathname() ?? "/tg";
  if (path.startsWith("/tg/login")) return <Login />;
  if (path.startsWith("/tg/register")) return <Register />;
  return <Authed path={path} />;
}

function Login() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [idled, setIdled] = useState(false); // sent here by the idle sign-out
  useEffect(() => { setIdled(new URLSearchParams(window.location.search).get("idle") === "1"); }, []);
  const [canRegister, setCanRegister] = useState(false); // 學生自行註冊: only while the administrator's switch is on
  useEffect(() => { void call<{ open?: boolean }>("register/status").then((r) => { if (r.ok && r.data.open) setCanRegister(true); }); }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await call<{ mustChangePassword?: boolean }>("login", "POST", { email, password });
    setBusy(false);
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    const next = new URLSearchParams(window.location.search).get("next");
    const dest = r.data.mustChangePassword ? "/tg/account" : next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    window.location.replace(dest);
  };
  return (
    <div className="tg-shell" style={{ justifyContent: "center" }}>
      <div className="tg-login">
        <h1 className="tg-brand"><Image src={BRAND_LOGO} width={40} height={40} alt="" priority />{t("product")}</h1>
        <div style={{ textAlign: "center", marginTop: -8, marginBottom: 12 }}><BasedOn /></div>
        <form onSubmit={submit} className="tg-card">
          <label>{t("email")}<input className="tg-input" style={{ width: "100%" }} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>{t("password")}<input className="tg-input" style={{ width: "100%" }} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {idled && !error && <div className="tg-muted" role="status">{t("idleLoggedOut")}</div>}
          {error && <div className="tg-err" role="alert">{error}</div>}
          <button className="tg-btn primary" disabled={busy}>{t("signIn")}</button>
          {canRegister && <Link className="tg-btn" href="/tg/register" data-tg-register-link style={{ textAlign: "center" }}>{t("regLink")}</Link>}
        </form>
        <div className="tg-muted" data-tg-support style={{ textAlign: "center", fontSize: 12, marginTop: 12, userSelect: "text" }}>{t("supportLine")}</div>
      </div>
    </div>
  );
}

function Register() {
  const t = useT();
  const [f, setF] = useState({ name: "", email: "", password: "", code: "" });
  const [state, setState] = useState<{ open: boolean; requireCode: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false); // 待核准: the account exists but cannot sign in yet
  useEffect(() => { void call<{ open?: boolean; requireCode?: boolean }>("register/status").then((r) => setState({ open: !!r.data.open, requireCode: r.data.requireCode !== false })); }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await call("register", "POST", f);
    setBusy(false);
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    if ((r.data as { pending?: boolean }).pending) { setDone(true); return; }
    window.location.replace("/");
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="tg-shell" style={{ justifyContent: "center" }}>
      <div className="tg-login">
        <h1 className="tg-brand"><Image src={BRAND_LOGO} width={40} height={40} alt="" priority />{t("product")}</h1>
        {done ? <div className="tg-card" role="status" data-tg-register-pending><strong>{t("regPendingTitle")}</strong><span className="tg-muted">{t("regPendingHelp")}</span></div>
        : state && !state.open ? <div className="tg-card" role="status">{t("regClosed")}</div> : (
          <form onSubmit={submit} className="tg-card" data-tg-register-form>
            <strong>{t("regTitle")}</strong>
            <span className="tg-muted" style={{ fontSize: 12 }}>{t("regIntro")}</span>
            <label>{t("regNameV")}<input className="tg-input" style={{ width: "100%" }} autoComplete="name" placeholder={t("regNamePh")} value={f.name} onChange={set("name")} required maxLength={80} /><span className="tg-muted" style={{ fontSize: 12 }}>{t("regNameHint")}</span></label>
            <label>{t("regEmail")}<input className="tg-input" style={{ width: "100%" }} type="email" autoComplete="username" value={f.email} onChange={set("email")} required /></label>
            <label>{t("regPassword")}<input className="tg-input" style={{ width: "100%" }} type="password" autoComplete="new-password" value={f.password} onChange={set("password")} required minLength={8} /></label>
            <label>{state?.requireCode === false ? t("regCodeOptional") : t("regCode")}<input className="tg-input" style={{ width: "100%" }} autoComplete="off" value={f.code} onChange={set("code")} required={state?.requireCode !== false} maxLength={80} /><span className="tg-muted" style={{ fontSize: 12 }}>{t("regCodeHint")}</span></label>
            {error && <div className="tg-err" role="alert">{error}</div>}
            <button className="tg-btn primary" disabled={busy}>{t("regSubmit")}</button>
          </form>)}
        <div style={{ textAlign: "center", marginTop: 8 }}><Link href="/tg/login">{t("regBack")}</Link></div>
      </div>
    </div>
  );
}

/**
 * Old addresses keep working: they redirect into the one app (the conversation page and its settings overlay).
 * A person who must choose a new password never reaches the app: the gate sends every page to /tg/account, and
 * this page then shows the change form itself (redirecting to the app would bounce back here forever).
 */
function Authed({ path }: { path: string }) {
  const t = useT();
  const [forced, setForced] = useState(false);
  useEffect(() => {
    void call<Me>("me").then((r) => {
      if (!r.ok) { window.location.replace("/tg/login"); return; }
      if (r.data.mustChangePassword) { setForced(true); return; }
      const room = /^\/tg\/rooms\/([^/]+)/.exec(path)?.[1];
      let dest = "/";
      if (room) dest = `/?room=${encodeURIComponent(room)}`;
      else if (path.startsWith("/tg/account")) dest = "/?settings=account";
      else if (path.startsWith("/tg/prompts")) dest = "/?settings=prompts";
      else if (path.startsWith("/tg/admin")) dest = "/?settings=users";
      window.location.replace(dest);
    });
  }, [path]);
  if (forced) return <ForcedPasswordChange />;
  return <div className="tg-shell"><div className="tg-body tg-muted">{t("loading")}</div></div>;
}

export function ForcedPasswordChange() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await call("account/password", "POST", { current, next });
    setBusy(false);
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    window.location.replace("/");
  };
  const signOut = async () => { await call("logout", "POST"); window.location.replace("/tg/login"); };
  return (
    <div className="tg-shell" style={{ justifyContent: "center" }}>
      <div className="tg-login">
        <h1 className="tg-brand"><Image src={BRAND_LOGO} width={40} height={40} alt="" priority />{t("product")}</h1>
        <form onSubmit={submit} className="tg-card" data-testid="forced-password-change">
          <strong>{t("changePw")}</strong>
          <div className="tg-err" role="alert">{t("mustChange")}</div>
          <label>{t("current")}<input className="tg-input" style={{ width: "100%" }} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
          <label>{t("next")}<input className="tg-input" style={{ width: "100%" }} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></label>
          {error && <div className="tg-err" role="alert">{error}</div>}
          <button className="tg-btn primary" disabled={busy}>{t("save")}</button>
          <button type="button" className="tg-btn" onClick={signOut}>{t("signOut")}</button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- admin

type UserRowT = { id: string; email: string; name: string; role: string; status: string; groups: string[]; isVendor?: boolean; left_at?: number | null };
type GroupT = { id: string; name: string; parent_id: string | null; description?: string; archivedAt?: number | null; members: { user_id: string; is_manager: number }[] };

/** 營運處 / 業務部: the names from the top unit down. */
function unitPath(groups: GroupT[], id: string): string {
  const names: string[] = []; const seen = new Set<string>(); let cur: string | null = id;
  while (cur && !seen.has(cur)) { seen.add(cur); const g = groups.find((x) => x.id === cur); if (!g) break; names.unshift(g.name); cur = g.parent_id; }
  return names.join(" / ");
}

export function Users() {
  const t = useT();
  const [users, setUsers] = useState<UserRowT[]>([]);
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [role, setRole] = useState("member");
  const [error, setError] = useState(""); const [secret, setSecret] = useState<{ who: string; pw: string } | null>(null);
  const [allGroups, setAllGroups] = useState<GroupT[]>([]);
  const [leaving, setLeaving] = useState<UserRowT | null>(null);
  const [moving, setMoving] = useState<UserRowT | null>(null);
  const load = useCallback(async () => {
    const [r, g] = await Promise.all([call<{ users: UserRowT[] }>("admin/users"), call<{ groups: GroupT[] }>("admin/groups")]);
    if (r.ok) setUsers(r.data.users);
    if (g.ok) setAllGroups(g.data.groups);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const add = async (e: FormEvent) => {
    e.preventDefault(); setError("");
    const r = await call<{ initialPassword: string }>("admin/users", "POST", { email, name, role });
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    setSecret({ who: email, pw: r.data.initialPassword }); setEmail(""); setName(""); void load();
  };
  const patch = async (id: string, body: object) => { const r = await call("admin/users/" + id, "PATCH", body); if (!r.ok) setError(r.data.error ?? tr("error")); else setError(""); void load(); };
  const { ask, dialog } = useConfirm();
  const [purging, setPurging] = useState<string | null>(null);
  const reset = async (u: UserRowT) => { const r = await call<{ initialPassword: string }>(`admin/users/${u.id}/reset`, "POST", {}); if (r.ok) setSecret({ who: u.email, pw: r.data.initialPassword }); void load(); };
  return (<>
    <RegisterRequests />
    <RegisterAdmin />
    <IdleAdmin />
    <form className="tg-card" onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <label>{t("email")}<br /><input className="tg-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>{tr("acName")}<br /><input className="tg-input" value={name} placeholder={tr("acNamePh")} onChange={(e) => setName(e.target.value)} required /></label>
      <label>{t("role")}<br /><Select ariaLabel={t("role")} width={140} value={role} onChange={setRole} options={[{ value: "member", label: t("member") }, { value: "admin", label: t("administrator") }]} /></label>
      <button className="tg-btn primary">{t("newUser")}</button>
    </form>
    {error && <div className="tg-err" role="alert">{error}</div>}
    {secret && <div className="tg-card" role="status"><div className="tg-muted">{t("oneTimePw")} - {secret.who}</div><code data-testid="one-time-password" style={{ fontSize: 16 }}>{secret.pw}</code></div>}
    <div className="tg-card"><table className="tg-table">
      <thead><tr><th>{t("name")}</th><th>{t("email")}</th><th>{tr("unitsCol")}</th><th>{t("role")}</th><th>{t("status")}</th><th /></tr></thead>
      <tbody>{users.map((u) => (
        <tr key={u.id} data-user-row={u.name}>
          <td>{u.name}{u.isVendor && <span className="tg-muted"> · {t("vendorTag")}</span>}</td><td>{u.email}</td>
          <td>{u.groups.map((id) => allGroups.find((g) => g.id === id)?.name).filter(Boolean).join("、")}</td>
          <td>{u.role === "admin" ? t("administrator") : t("member")}</td><td>{u.status === "active" ? t("active") : u.left_at ? tr("leftTag") : t("disabled")}</td>
          <td style={{ whiteSpace: "nowrap" }}>
            {u.status === "active" && !u.isVendor && <button className="tg-btn" data-move-user={u.name} onClick={() => setMoving(u)}>{tr("moveBtn")}</button>}{" "}
            {!u.isVendor && <button className="tg-btn" data-leave-user={u.name} onClick={() => (u.status === "active" ? setLeaving(u) : void patch(u.id, { status: "active" }))}>{u.status === "active" ? tr("leaveBtn") : tr("rejoinBtn")}</button>}{" "}
            {!u.isVendor && <button className="tg-btn" onClick={() => ask(tr("cfResetPw", { name: u.name }), t("reset"), () => reset(u))}>{t("reset")}</button>}
            {!u.isVendor && u.status === "disabled" && <button className="tg-btn" data-tg-purge-open onClick={() => setPurging(u.id)}>{tr("purgeDo")}</button>}
          </td>
        </tr>))}</tbody>
    </table></div>
    {purging && <PurgeDialog userId={purging} onClose={() => setPurging(null)} onDone={() => { setPurging(null); void load(); }} />}
    {leaving && <LeaveDialog user={leaving} people={users} onClose={() => setLeaving(null)} onDone={() => { setLeaving(null); void load(); }} />}
    {moving && <UnitChangeDialog user={moving} people={users} units={allGroups.map((g) => ({ id: g.id, name: unitPath(allGroups, g.id) }))} current={moving.groups} onClose={() => setMoving(null)} onDone={() => { setMoving(null); void load(); }} />}
    {dialog}
  </>);
}

export function Groups() {
  const t = useT();
  const { ask, dialog } = useConfirm();
  const [groups, setGroups] = useState<GroupT[]>([]);
  const [users, setUsers] = useState<UserRowT[]>([]);
  const [name, setName] = useState(""); const [error, setError] = useState("");
  const [parentId, setParentId] = useState("");
  const [editing, setEditing] = useState<GroupT | null>(null);
  const load = useCallback(async () => {
    const [g, u] = await Promise.all([call<{ groups: GroupT[] }>("admin/groups"), call<{ users: UserRowT[] }>("admin/users")]);
    if (g.ok) setGroups(g.data.groups); if (u.ok) setUsers(u.data.users);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const add = async (e: FormEvent) => { e.preventDefault(); const r = await call("admin/groups", "POST", { name, parentId: parentId || null }); if (!r.ok) setError(r.data.error ?? tr("error")); else { setError(""); setName(""); setParentId(""); void load(); } };
  const parentOptions = (exceptId?: string) => [{ value: "", label: tr("grpNoParent") }, ...groups.filter((g) => g.id !== exceptId).map((g) => ({ value: g.id, label: unitPath(groups, g.id) }))];
  const member = async (g: string, userId: string, present: boolean, isManager = false) => { await call(`admin/groups/${g}/members`, "PUT", { userId, present, isManager }); void load(); };
  return (<>
    <form className="tg-card" onSubmit={add} style={{ display: "flex", gap: 8 }}>
      <input className="tg-input" placeholder={t("groupName")} aria-label={t("groupName")} value={name} onChange={(e) => setName(e.target.value)} required />
      <Select ariaLabel={tr("grpParent")} width={220} value={parentId} onChange={setParentId} options={parentOptions()} />
      <button className="tg-btn primary">{t("create")}</button>
    </form>
    {error && <div className="tg-err" role="alert">{error}</div>}
    {groups.map((g) => (
      <div className="tg-card" key={g.id}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong data-unit-path={unitPath(groups, g.id)}>{unitPath(groups, g.id)}{g.archivedAt && <span className="tg-muted" data-tg-archived> · {tr("archBadge")}</span>}</strong>
          <span style={{ display: "flex", gap: 8 }}>
            <button className="tg-btn" data-unit-edit={g.name} onClick={() => setEditing(g)}>{tr("grpEdit")}</button>
            {g.archivedAt ? <button className="tg-btn" onClick={async () => { await call(`admin/groups/${g.id}/archive`, "POST", { archived: false }); void load(); }}>{tr("archUndo")}</button>
              : <button className="tg-btn" data-tg-archive onClick={() => ask(tr("archAsk", { name: g.name }), tr("archTitle"), async () => { await call(`admin/groups/${g.id}/archive`, "POST", { archived: true }); void load(); })}>{tr("archTitle")}</button>}
            <button className="tg-btn" onClick={() => ask(tr("cfDelGroup2", { name: g.name }), t("remove"), async () => { await call("admin/groups/" + g.id, "DELETE"); void load(); })}>{t("remove")}</button>
          </span></div>
        <div style={{ margin: "8px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {g.members.map((m) => {
            const u = users.find((x) => x.id === m.user_id); const head = m.is_manager === 1; const nm = u?.name ?? m.user_id;
            return (
              <span key={m.user_id} className="tgx-chip" style={{ paddingRight: 4, gap: 6 }}>
                {nm}
                <button type="button" className={`tgx-btn${head ? " primary" : ""}`} style={{ padding: "0 8px", fontSize: 11, borderRadius: 999 }} aria-pressed={head} title={head ? t("unsetHead") : t("setHead")} aria-label={`${head ? t("unsetHead") : t("setHead")} ${nm}`} onClick={() => member(g.id, m.user_id, true, !head)}>{t("headLabel")}</button>
                <button type="button" className="rm" style={{ display: "inline-flex" }} aria-label={`${t("remove")} ${nm}`} title={t("remove")} onClick={() => ask(tr("cfRemoveGroupMember", { name: nm, group: g.name }), t("remove"), () => member(g.id, m.user_id, false))}>×</button>
              </span>);
          })}
        </div>
        <Select ariaLabel={t("addMember")} placeholder={`${t("addMember")}...`} width={220} value="" onChange={(v) => v && member(g.id, v, true)} options={users.filter((u) => !g.members.some((m) => m.user_id === u.id)).map((u) => ({ value: u.id, label: u.name }))} />
      </div>))}
    {editing && <GroupEdit group={editing} options={parentOptions(editing.id)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    {dialog}
  </>);
}

/** Rename a unit and/or move it under another one (the server refuses a loop; the folder on disk never changes). */
function GroupEdit({ group, options, onClose, onSaved }: { group: GroupT; options: { value: string; label: string }[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group.name);
  const [parent, setParent] = useState(group.parent_id ?? "");
  const [error, setError] = useState("");
  return (<Modal title={`${tr("grpEdit")}: ${group.name}`} onClose={onClose}>
    {error && <div className="tg-err" role="alert">{error}</div>}
    <label>{tr("grpRename")}<br /><input className="tg-input" aria-label={tr("grpRename")} value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} /></label>
    <label style={{ display: "block", marginTop: 10 }}>{tr("grpParent")}<br /><Select ariaLabel={tr("grpParent")} width={260} value={parent} onChange={setParent} options={options} /></label>
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
      <button className="tg-btn" onClick={onClose}>{tr("cancel")}</button>
      <button className="tg-btn primary" data-unit-save onClick={async () => { const r = await call(`admin/groups/${group.id}`, "PATCH", { name, parentId: parent || null }); if (r.ok) onSaved(); else setError(r.data.error ?? tr("error")); }}>{tr("grpSave")}</button>
    </div>
  </Modal>);
}

type PromptT = { id: string; name: string; description: string; body: string; enabled: boolean; source_id?: string | null; ticks?: string[]; shareStatus?: string | null };
type OrderT = { id: string; kind: string; applicant_id: string; applicant_name?: string; payload: { name?: string; body?: string; description?: string }; status: string; created_at: number };

/** Admin: publish into the company library. Groups are not assigned here: department heads tick. */
export function Prompts() {
  const t = useT();
  const { ask, dialog } = useConfirm();
  const [items, setItems] = useState<PromptT[]>([]);
  const [f, setF] = useState({ name: "", description: "", body: "" });
  const [error, setError] = useState("");
  const load = useCallback(async () => { const p = await call<{ prompts: PromptT[] }>("admin/prompts"); if (p.ok) setItems(p.data.prompts); }, []);
  useEffect(() => { void load(); }, [load]);
  const add = async (e: FormEvent) => { e.preventDefault(); const r = await call("admin/prompts", "POST", f); if (!r.ok) setError(r.data.error ?? tr("error")); else { setError(""); setF({ name: "", description: "", body: "" }); void load(); } };
  return (<>
    <p className="tg-muted">{t("libraryHelp")}</p>
    <form className="tg-card" onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input className="tg-input" placeholder={t("promptName")} aria-label={t("promptName")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      <input className="tg-input" placeholder={t("promptDesc")} aria-label={t("promptDesc")} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <textarea className="tg-input" rows={4} placeholder={t("promptBody")} aria-label={t("promptBody")} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required />
      <div><button className="tg-btn primary">{t("publish")}</button></div>
    </form>
    {error && <div className="tg-err" role="alert">{error}</div>}
    {items.map((p) => (
      <div className="tg-card" key={p.id}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <strong>/{p.name}</strong>
          <span><button className="tg-btn" onClick={async () => { await call("admin/prompts/" + p.id, "PATCH", { enabled: !p.enabled }); void load(); }}>{p.enabled ? t("disable") : t("enable")}</button>{" "}
            <button className="tg-btn" onClick={() => ask(tr("cfDelPrompt", { name: p.name }), t("delete"), async () => { await call("admin/prompts/" + p.id, "DELETE"); void load(); })}>{t("delete")}</button></span>
        </div>
        <div className="tg-muted">{p.description}</div>
        <div className="tg-muted" style={{ fontSize: 12 }}>{t("ticksCount")}: {p.ticks?.length ?? 0}</div>
      </div>))}
    {dialog}
  </>);
}

export function WorkOrders() {
  const t = useT();
  const { ask, dialog } = useConfirm();
  const [orders, setOrders] = useState<OrderT[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => { const r = await call<{ orders: OrderT[] }>("admin/workorders"); if (r.ok) setOrders(r.data.orders); }, []);
  useEffect(() => { void load(); }, [load]);
  const decide = async (id: string, approve: boolean) => { const r = await call(`admin/workorders/${id}/decide`, "POST", { approve }); setError(r.ok ? "" : (r.data.error ?? tr("error"))); void load(); };
  return (<>
    {error && <div className="tg-err" role="alert">{error}</div>}
    {orders.length === 0 && <div className="tg-muted">{t("noOrders")}</div>}
    {orders.map((o) => (
      <div className="tg-card" key={o.id}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <strong>{t("shareRequest")}: {o.kind === "prompt_share" ? "/" : ""}{o.payload.name}</strong><span className="tg-badge">{t(`status_${o.status}` as never)}</span>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>{o.payload.body}</pre>
        <div className="tg-muted" style={{ fontSize: 12 }}>{o.applicant_name ?? o.applicant_id} · {fmtDateTime(o.created_at)}</div>
        {o.status === "pending" && <div style={{ marginTop: 8 }}>
          <button className="tg-btn primary" onClick={() => ask(tr(o.kind === "prompt_share" ? "cfApprove" : "cfApproveN", { name: o.payload.name ?? "" }), t("approve"), () => decide(o.id, true))}>{t("approve")}</button>{" "}
          <button className="tg-btn" onClick={() => ask(tr(o.kind === "prompt_share" ? "cfReject" : "cfRejectN", { name: o.payload.name ?? "" }), t("reject"), () => decide(o.id, false))}>{t("reject")}</button></div>}
      </div>))}
    {dialog}
  </>);
}

type LibraryView = { library: PromptT[]; groups: { id: string; name: string; prompts: PromptT[] }[] };

/** Everyone: own prompts (private) and "submit for sharing". Department heads: tick library prompts for their groups. */
export function MyPrompts({ me }: { me: Me }) {
  const t = useT();
  const { ask, dialog } = useConfirm();
  const [mine, setMine] = useState<PromptT[]>([]);
  const [lib, setLib] = useState<LibraryView | null>(null);
  const [f, setF] = useState({ name: "", description: "", body: "" });
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const [m, l] = await Promise.all([call<{ prompts: PromptT[] }>("prompts/mine"), call<LibraryView>("prompts/library")]);
    if (m.ok) setMine(m.data.prompts);
    setLib(l.ok ? l.data : null);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const add = async (e: FormEvent) => { e.preventDefault(); const r = await call("prompts", "POST", f); if (!r.ok) setError(r.data.error ?? tr("error")); else { setError(""); setF({ name: "", description: "", body: "" }); void load(); } };
  const share = async (id: string) => { const r = await call(`prompts/${id}/share`, "POST", {}); setError(r.ok ? "" : (r.data.error ?? tr("error"))); void load(); };
  const tick = async (pid: string, gid: string, on: boolean) => { const r = await call(`prompts/${pid}/ticks`, "POST", { groupId: gid, on }); setError(r.ok ? "" : (r.data.error ?? tr("error"))); void load(); };
  void me;
  return (<>
    <h3>{t("myPrompts")}</h3>
    <form className="tg-card" onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input className="tg-input" placeholder={t("promptName")} aria-label={t("promptName")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      <input className="tg-input" placeholder={t("promptDesc")} aria-label={t("promptDesc")} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <textarea className="tg-input" rows={3} placeholder={t("promptBody")} aria-label={t("promptBody")} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required />
      <div><button className="tg-btn primary">{t("create")}</button></div>
    </form>
    {error && <div className="tg-err" role="alert">{error}</div>}
    {mine.map((p) => (
      <div className="tg-card" key={p.id}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <strong>/{p.name}</strong>
          <span>{p.shareStatus && <span className="tg-badge" style={{ marginRight: 6 }}>{tr(`status_${p.shareStatus}` as never)}</span>}
            <button className="tg-btn" disabled={p.shareStatus === "pending"} onClick={() => share(p.id)}>{t("submitShare")}</button>{" "}
            <button className="tg-btn" onClick={() => ask(tr("cfDelPrompt", { name: p.name }), t("delete"), async () => { await call("prompts/" + p.id, "DELETE"); void load(); })}>{t("delete")}</button></span>
        </div>
        <div className="tg-muted">{p.description}</div>
      </div>))}
    {lib && <>
      <h3>{t("deptLibrary")}</h3>
      <p className="tg-muted">{t("deptHelp")}</p>
      {lib.library.map((p) => (
        <div className="tg-card" key={p.id}>
          <strong>/{p.name}</strong> <span className="tg-muted">{p.description}</span>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
            {lib.groups.map((g) => <label key={g.id}><input type="checkbox" checked={p.ticks?.includes(g.id) ?? false} onChange={(e) => tick(p.id, g.id, e.target.checked)} /> {g.name}</label>)}
          </div>
        </div>))}
    </>}
    {dialog}
  </>);
}

type RoleT = { id: string; name: string; description: string; system_prompt: string; knowledge_dir: string | null; model: { provider: string; modelId: string } | null; group_ids: string[]; enabled: boolean };

export function Roles() {
  const t = useT();
  const { ask, dialog } = useConfirm();
  const [items, setItems] = useState<RoleT[]>([]);
  const [groups, setGroups] = useState<GroupT[]>([]);
  const [f, setF] = useState({ name: "", description: "", system_prompt: "", model: "", knowledge_dir: "" });
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const [a, g] = await Promise.all([call<{ agents: RoleT[] }>("admin/agents"), call<{ groups: GroupT[] }>("admin/groups")]);
    if (a.ok) setItems(a.data.agents); if (g.ok) setGroups(g.data.groups);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const [provider, ...rest] = f.model.split("/");
    const model = f.model.includes("/") ? { provider, modelId: rest.join("/") } : null;
    const r = await call("admin/agents", "POST", { name: f.name, description: f.description, system_prompt: f.system_prompt, knowledge_dir: f.knowledge_dir || null, model });
    if (!r.ok) setError(r.data.error ?? tr("error")); else { setError(""); setF({ name: "", description: "", system_prompt: "", model: "", knowledge_dir: "" }); void load(); }
  };
  const tick = async (a: RoleT, gid: string) => {
    const next = a.group_ids.includes(gid) ? a.group_ids.filter((x) => x !== gid) : [...a.group_ids, gid];
    await call("admin/agents/" + a.id, "PATCH", { group_ids: next }); void load();
  };
  return (<>
    <form className="tg-card" onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input className="tg-input" placeholder={t("name")} aria-label={t("name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      <input className="tg-input" placeholder={t("promptDesc")} aria-label={t("promptDesc")} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <textarea className="tg-input" rows={4} placeholder={t("rolePrompt")} aria-label={t("rolePrompt")} value={f.system_prompt} onChange={(e) => setF({ ...f, system_prompt: e.target.value })} />
      <input className="tg-input" placeholder={t("roleModel")} aria-label={t("roleModel")} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
      <input className="tg-input" placeholder={t("roleKnowledge")} aria-label={t("roleKnowledge")} value={f.knowledge_dir} onChange={(e) => setF({ ...f, knowledge_dir: e.target.value })} />
      <div><button className="tg-btn primary">{t("create")}</button></div>
    </form>
    {error && <div className="tg-err" role="alert">{error}</div>}
    {items.map((a) => (
      <div className="tg-card" key={a.id}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><strong>@{a.name}</strong>
          <button className="tg-btn" onClick={() => { const run = async () => { await call("admin/agents/" + a.id, a.enabled ? "DELETE" : "PATCH", a.enabled ? undefined : { enabled: true }); void load(); }; if (a.enabled) ask(tr("cfDisableRole", { name: a.name }), t("disable"), run); else void run(); }}>{a.enabled ? t("disable") : t("enable")}</button></div>
        <div className="tg-muted">{a.description}</div>
        <div style={{ marginTop: 8 }}><span className="tg-muted">{t("visibleTo")}: </span>{a.group_ids.length === 0 && <span>{t("everyone")}</span>}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
            {groups.map((g) => <label key={g.id}><input type="checkbox" checked={a.group_ids.includes(g.id)} onChange={() => tick(a, g.id)} /> {g.name}</label>)}
          </div></div>
      </div>))}
    {dialog}
  </>);
}

/** n8n webhooks (community scope): webhooks the AI may call, and keys for n8n to call the Portal. */
type N8nItem = { method?: "GET" | "POST"; id: string; name: string; display_name?: string; url: string; description?: string; group_ids: string[]; enabled: boolean; hasToken?: boolean; hasHeader?: boolean; allow_tools?: string[] };
type KeyT = { id: string; name: string; prefix: string; agent_id: string | null; room_id: string | null; revoked_at: number | null; last_used: number | null };

export function N8n() {
  const t = useT();
  const { ask, dialog } = useConfirm();
  const lock = useRef(new Set<string>()); // checkboxes being saved: a second click on the same one is ignored
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [hooks, setHooks] = useState<N8nItem[]>([]);
  const [keys, setKeys] = useState<KeyT[]>([]);
  const [groups, setGroups] = useState<GroupT[]>([]);
  const [roles, setRoles] = useState<RoleT[]>([]);
  const [fh, setFh] = useState({ name: "", display_name: "", url: "", method: "POST", description: "", header: "" });
  const [fk, setFk] = useState({ name: "", agent_id: "" });
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const [h, k, g, a] = await Promise.all([
      call<{ webhooks: N8nItem[] }>("admin/n8n/webhooks"), call<{ keys: KeyT[] }>("admin/n8n/keys"),
      call<{ groups: GroupT[] }>("admin/groups"), call<{ agents: RoleT[] }>("admin/agents"),
    ]);
    if (h.ok) setHooks(h.data.webhooks); if (k.ok) setKeys(k.data.keys);
    if (g.ok) setGroups(g.data.groups); if (a.ok) setRoles(a.data.agents);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const fail = (r: { ok: boolean; data: { error?: string } }) => setError(r.ok ? "" : (r.data.error ?? tr("error")));
  // The box changes at once and is disabled until the server answered, so a second click cannot undo the first (it did, when
  // the box waited for the answer). A refused save puts the old state back.
  const tick = async (kind: "webhooks", it: N8nItem, gid: string) => {
    const key = `${kind}:${it.id}`;
    if (lock.current.has(key)) return;
    const prev = it.group_ids;
    const next = prev.includes(gid) ? prev.filter((x) => x !== gid) : [...prev, gid];
    const show = (ids: string[]) => setHooks((xs) => xs.map((x) => (x.id === it.id ? { ...x, group_ids: ids } : x)));
    lock.current.add(key); setSaving(new Set(lock.current)); show(next);
    const r = await call(`admin/n8n/${kind}/${it.id}`, "PATCH", { group_ids: next });
    if (!r.ok) show(prev);
    fail(r);
    lock.current.delete(key); setSaving(new Set(lock.current));
    void load();
  };
  const rename = async (h: N8nItem, display: string) => { if (display.trim() === (h.display_name ?? "")) return; fail(await call("admin/n8n/webhooks/" + h.id, "PATCH", { display_name: display })); void load(); };
  const ticks = (kind: "webhooks", it: N8nItem) => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
      <span className="tg-muted">{t("n8nGroups")}:</span>
      {it.group_ids.length === 0 && <span className="tg-muted">{t("n8nNobody")}</span>}
      {groups.map((g) => <label key={g.id}><input type="checkbox" checked={it.group_ids.includes(g.id)} disabled={saving.has(`${kind}:${it.id}`)} onChange={() => void tick(kind, it, g.id)} /> {g.name}</label>)}
    </div>
  );
  return (<>
    {error && <div className="tg-err" role="alert">{error}</div>}
    <h3>{t("n8nWebhooks")}</h3>
    <p className="tg-muted">{t("n8nWebhookHelp")}</p>
    <form className="tg-card" style={{ display: "flex", flexDirection: "column", gap: 8 }} onSubmit={async (e) => { e.preventDefault(); const r = await call("admin/n8n/webhooks", "POST", fh); fail(r); if (r.ok) setFh({ name: "", display_name: "", url: "", method: "POST", description: "", header: "" }); void load(); }}>
      <input className="tg-input" placeholder={t("n8nDisplay")} aria-label={t("n8nDisplay")} maxLength={40} value={fh.display_name} onChange={(e) => setFh({ ...fh, display_name: e.target.value })} />
      <input className="tg-input" placeholder={t("n8nName")} aria-label={t("n8nName")} value={fh.name} onChange={(e) => setFh({ ...fh, name: e.target.value })} required />
      <input className="tg-input" placeholder="https://…/webhook/…" aria-label={tr("whUrl")} value={fh.url} onChange={(e) => setFh({ ...fh, url: e.target.value })} required />
      <label className="tg-muted">{tr("whMethod")} <select className="tg-input" data-testid="wh-method" value={fh.method} onChange={(e) => setFh({ ...fh, method: e.target.value })}><option value="POST">POST</option><option value="GET">GET</option></select> <span style={{ fontSize: 12 }}>{tr("whMethodHint")}</span></label>
      <textarea className="tg-input" rows={2} placeholder={t("n8nInputHelp")} aria-label={t("n8nInputHelp")} value={fh.description} onChange={(e) => setFh({ ...fh, description: e.target.value })} />
      <input className="tg-input" type="password" autoComplete="off" placeholder={t("n8nHeader")} aria-label={t("n8nHeader")} value={fh.header} onChange={(e) => setFh({ ...fh, header: e.target.value })} />
      <div><button className="tg-btn primary">{t("create")}</button></div>
    </form>
    {hooks.map((h) => (
      <div className="tg-card" key={h.id}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong>{h.display_name || h.name} <span className="tg-muted" style={{ fontWeight: 400 }}>({h.name})</span></strong><span className="tg-muted">{h.method ?? "POST"} {h.url}{h.hasHeader ? ` · ${tr("headerStored")}` : ""}</span>
          <button className="tg-btn" onClick={() => ask(tr("cfDelWebhook", { name: h.display_name || h.name }), t("delete"), async () => { fail(await call("admin/n8n/webhooks/" + h.id, "DELETE")); void load(); })}>{t("delete")}</button></div>
        <input key={`${h.id}:${h.display_name ?? ""}`} className="tg-input" style={{ marginTop: 6, width: "100%", boxSizing: "border-box" }} placeholder={t("n8nDisplay")} aria-label={`${t("n8nDisplay")} ${h.name}`} maxLength={40} defaultValue={h.display_name ?? ""} onBlur={(e) => void rename(h, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
        <div className="tg-muted">{h.description}</div>
        {ticks("webhooks", h)}
      </div>))}
    <h3>{t("n8nInbound")}</h3>
    <p className="tg-muted">{t("n8nInboundHelp")}</p>
    <form className="tg-card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }} onSubmit={async (e) => { e.preventDefault(); const r = await call<{ plaintext: string }>("admin/n8n/keys", "POST", { name: fk.name, agent_id: fk.agent_id || null }); fail(r); if (r.ok) { setSecret(r.data.plaintext); setFk({ name: "", agent_id: "" }); } void load(); }}>
      <input className="tg-input" placeholder={t("n8nName")} aria-label={`${t("n8nInbound")} ${t("n8nName")}`} value={fk.name} onChange={(e) => setFk({ ...fk, name: e.target.value })} required />
      <Select ariaLabel={t("n8nAnswerBy")} width={220} value={fk.agent_id} onChange={(v) => setFk({ ...fk, agent_id: v })} options={[{ value: "", label: `AI（${t("n8nPlain")}）` }, ...roles.filter((r) => r.enabled).map((r) => ({ value: r.id, label: `@${r.name}` }))]} />
      <button className="tg-btn primary">{t("create")}</button>
    </form>
    {secret && <div className="tg-card" role="status"><div className="tg-muted">{t("n8nKeyOnce")}</div><code data-testid="hook-key">{secret}</code></div>}
    {keys.map((k) => (
      <div className="tg-card" key={k.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span><strong>{k.name}</strong> <span className="tg-muted">{k.prefix}…</span></span>
        <span>{k.revoked_at ? <span className="tg-badge">{tr("revoked")}</span> : <button className="tg-btn" onClick={() => ask(tr("cfRevokeKey", { name: k.name }), t("n8nRevoke"), async () => { fail(await call("admin/n8n/keys/" + k.id, "DELETE")); void load(); })}>{t("n8nRevoke")}</button>}</span>
      </div>))}
    {dialog}
  </>);
}

export function Audit() {
  const t = useT();
  type Row = { id: number; ts: number; action: string; actionZh: string; actor_id: string | null; actorName: string | null; summary: string };
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState("");
  useEffect(() => { void call<{ rows: Row[] }>("admin/audit?limit=300" + (filter ? `&action=${encodeURIComponent(filter)}` : "")).then((r) => { if (r.ok) setRows(r.data.rows); }); }, [filter]);
  // Fixed layout and wrapping text: the table always fits its card (no clipped columns, also on a phone).
  return (<>
    <input className="tg-input" placeholder={t("filter")} aria-label={t("filter")} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
    <div className="tg-card" style={{ marginTop: 10, padding: 8 }}><table className="tg-table" style={{ tableLayout: "fixed", width: "100%" }}>
      <thead><tr><th style={{ width: "26%" }}>{t("when")}</th><th style={{ width: "22%" }}>{t("action")}</th><th style={{ width: "18%" }}>{t("actor")}</th><th>{t("details")}</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id} style={{ overflowWrap: "anywhere" }}>
          <td>{fmtDateTime(r.ts)}</td><td title={r.action}>{r.actionZh}</td><td>{r.actorName ?? (r.actor_id ? t("unknownUser") : t("systemActor"))}</td><td className="tg-muted" style={{ fontSize: 12 }}>{r.summary}</td>
        </tr>))}</tbody>
    </table></div>
  </>);
}



