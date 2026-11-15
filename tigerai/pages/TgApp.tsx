"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BRAND_LOGO } from "@/lib/brand";
import { call } from "./api";
import { BasedOn } from "../ui/BasedOn";
import { FilePick, Select, useConfirm } from "../ui/kit";
import { fmtDateTime, tr, useT } from "./i18n";
import "./tg.css";

type Me = { id: string; name: string; email: string; role: "admin" | "member"; mustChangePassword: boolean };

export default function TgApp() {
  const path = usePathname() ?? "/tg";
  if (path.startsWith("/tg/login")) return <Login />;
  return <Authed path={path} />;
}

function Login() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
          {error && <div className="tg-err" role="alert">{error}</div>}
          <button className="tg-btn primary" disabled={busy}>{t("signIn")}</button>
        </form>
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

type UserRowT = { id: string; email: string; name: string; role: string; status: string; groups: string[] };
type GroupT = { id: string; name: string; members: { user_id: string; is_manager: number }[] };

export function Users() {
  const t = useT();
  const [users, setUsers] = useState<UserRowT[]>([]);
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [role, setRole] = useState("member");
  const [error, setError] = useState(""); const [secret, setSecret] = useState<{ who: string; pw: string } | null>(null);
  const load = useCallback(async () => { const r = await call<{ users: UserRowT[] }>("admin/users"); if (r.ok) setUsers(r.data.users); }, []);
  useEffect(() => { void load(); }, [load]);
  const add = async (e: FormEvent) => {
    e.preventDefault(); setError("");
    const r = await call<{ initialPassword: string }>("admin/users", "POST", { email, name, role });
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    setSecret({ who: email, pw: r.data.initialPassword }); setEmail(""); setName(""); void load();
  };
  const patch = async (id: string, body: object) => { const r = await call("admin/users/" + id, "PATCH", body); if (!r.ok) setError(r.data.error ?? tr("error")); else setError(""); void load(); };
  const { ask, dialog } = useConfirm();
  const reset = async (u: UserRowT) => { const r = await call<{ initialPassword: string }>(`admin/users/${u.id}/reset`, "POST", {}); if (r.ok) setSecret({ who: u.email, pw: r.data.initialPassword }); void load(); };
  return (<>
    <form className="tg-card" onSubmit={add} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <label>{t("email")}<br /><input className="tg-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>{t("name")}<br /><input className="tg-input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label>{t("role")}<br /><Select ariaLabel={t("role")} width={140} value={role} onChange={setRole} options={[{ value: "member", label: t("member") }, { value: "admin", label: t("administrator") }]} /></label>
      <button className="tg-btn primary">{t("newUser")}</button>
    </form>
    {error && <div className="tg-err" role="alert">{error}</div>}
    {secret && <div className="tg-card" role="status"><div className="tg-muted">{t("oneTimePw")} - {secret.who}</div><code data-testid="one-time-password" style={{ fontSize: 16 }}>{secret.pw}</code></div>}
    <div className="tg-card"><table className="tg-table">
      <thead><tr><th>{t("name")}</th><th>{t("email")}</th><th>{t("role")}</th><th>{t("status")}</th><th /></tr></thead>
      <tbody>{users.map((u) => (
        <tr key={u.id}>
          <td>{u.name}</td><td>{u.email}</td><td>{u.role === "admin" ? t("administrator") : t("member")}</td><td>{u.status === "active" ? t("active") : t("disabled")}</td>
          <td style={{ whiteSpace: "nowrap" }}>
            <button className="tg-btn" onClick={() => (u.status === "active" ? ask(tr("cfDisableUser", { name: u.name }), t("disable"), () => patch(u.id, { status: "disabled" })) : void patch(u.id, { status: "active" }))}>{u.status === "active" ? t("disable") : t("enable")}</button>{" "}
            <button className="tg-btn" onClick={() => ask(tr("cfResetPw", { name: u.name }), t("reset"), () => reset(u))}>{t("reset")}</button>
          </td>
        </tr>))}</tbody>
    </table></div>
    {dialog}
  </>);
}

export function Groups() {
  const t = useT();
  const { ask, dialog } = useConfirm();
  const [groups, setGroups] = useState<GroupT[]>([]);
  const [users, setUsers] = useState<UserRowT[]>([]);
  const [name, setName] = useState(""); const [error, setError] = useState("");
  const load = useCallback(async () => {
    const [g, u] = await Promise.all([call<{ groups: GroupT[] }>("admin/groups"), call<{ users: UserRowT[] }>("admin/users")]);
    if (g.ok) setGroups(g.data.groups); if (u.ok) setUsers(u.data.users);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const add = async (e: FormEvent) => { e.preventDefault(); const r = await call("admin/groups", "POST", { name }); if (!r.ok) setError(r.data.error ?? tr("error")); else { setError(""); setName(""); void load(); } };
  const member = async (g: string, userId: string, present: boolean, isManager = false) => { await call(`admin/groups/${g}/members`, "PUT", { userId, present, isManager }); void load(); };
  return (<>
    <form className="tg-card" onSubmit={add} style={{ display: "flex", gap: 8 }}>
      <input className="tg-input" placeholder={t("groupName")} aria-label={t("groupName")} value={name} onChange={(e) => setName(e.target.value)} required />
      <button className="tg-btn primary">{t("create")}</button>
    </form>
    {error && <div className="tg-err" role="alert">{error}</div>}
    {groups.map((g) => (
      <div className="tg-card" key={g.id}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><strong>{g.name}</strong>
          <button className="tg-btn" onClick={() => ask(tr("cfDelGroup", { name: g.name }), t("remove"), async () => { await call("admin/groups/" + g.id, "DELETE"); void load(); })}>{t("remove")}</button></div>
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
    {dialog}
  </>);
}

type PromptT = { id: string; name: string; description: string; body: string; enabled: boolean; source_id?: string | null; ticks?: string[]; shareStatus?: string | null };
type OrderT = { id: string; kind: string; applicant_id: string; payload: { name?: string; body?: string; description?: string }; status: string; created_at: number };

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
          <strong>{t("shareRequest")}: /{o.payload.name}</strong><span className="tg-badge">{t(`status_${o.status}` as never)}</span>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>{o.payload.body}</pre>
        <div className="tg-muted" style={{ fontSize: 12 }}>{o.applicant_id} · {fmtDateTime(o.created_at)}</div>
        {o.status === "pending" && <div style={{ marginTop: 8 }}>
          <button className="tg-btn primary" onClick={() => ask(tr("cfApprove", { name: o.payload.name ?? "" }), t("approve"), () => decide(o.id, true))}>{t("approve")}</button>{" "}
          <button className="tg-btn" onClick={() => ask(tr("cfReject", { name: o.payload.name ?? "" }), t("reject"), () => decide(o.id, false))}>{t("reject")}</button></div>}
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
type N8nItem = { id: string; name: string; display_name?: string; url: string; description?: string; group_ids: string[]; enabled: boolean; hasToken?: boolean; hasHeader?: boolean; allow_tools?: string[] };
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
  const [fh, setFh] = useState({ name: "", display_name: "", url: "", description: "", header: "" });
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
    <form className="tg-card" style={{ display: "flex", flexDirection: "column", gap: 8 }} onSubmit={async (e) => { e.preventDefault(); const r = await call("admin/n8n/webhooks", "POST", fh); fail(r); if (r.ok) setFh({ name: "", display_name: "", url: "", description: "", header: "" }); void load(); }}>
      <input className="tg-input" placeholder={t("n8nDisplay")} aria-label={t("n8nDisplay")} maxLength={40} value={fh.display_name} onChange={(e) => setFh({ ...fh, display_name: e.target.value })} />
      <input className="tg-input" placeholder={t("n8nName")} aria-label={t("n8nName")} value={fh.name} onChange={(e) => setFh({ ...fh, name: e.target.value })} required />
      <input className="tg-input" placeholder="https://…/webhook/…" aria-label={tr("whUrl")} value={fh.url} onChange={(e) => setFh({ ...fh, url: e.target.value })} required />
      <textarea className="tg-input" rows={2} placeholder={t("n8nInputHelp")} aria-label={t("n8nInputHelp")} value={fh.description} onChange={(e) => setFh({ ...fh, description: e.target.value })} />
      <input className="tg-input" type="password" autoComplete="off" placeholder={t("n8nHeader")} aria-label={t("n8nHeader")} value={fh.header} onChange={(e) => setFh({ ...fh, header: e.target.value })} />
      <div><button className="tg-btn primary">{t("create")}</button></div>
    </form>
    {hooks.map((h) => (
      <div className="tg-card" key={h.id}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong>{h.display_name || h.name} <span className="tg-muted" style={{ fontWeight: 400 }}>({h.name})</span></strong><span className="tg-muted">{h.url}{h.hasHeader ? ` · ${tr("headerStored")}` : ""}</span>
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

type OrgPreview = { errors: { sheet: string; row: number; col: string; message: string }[]; summary: Record<string, number>; token?: string; passwords?: never };

export function Org() {
  const t = useT();
  const { ask, dialog } = useConfirm();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OrgPreview | null>(null);
  const [msg, setMsg] = useState("");
  const [csv, setCsv] = useState("");
  const send = async (apply: boolean) => {
    if (!file) return;
    setMsg("");
    const r = await fetch(`/api/tg/admin/org/${apply ? "apply" : "preview"}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error ?? tr("error")); return; }
    if (apply) { setCsv(j.initialPasswordsCsv ?? ""); setPreview(null); setMsg(`${tr("saved")}: ${JSON.stringify(j.summary)}`); } else setPreview(j);
  };
  return (<div className="tg-card">
    <p className="tg-muted">{t("orgHelp")}</p>
    <FilePick accept=".xlsx" ariaLabel={t("orgUpload")} file={file} onPick={(f) => { setFile(f); setPreview(null); }} />{" "}
    <button className="tg-btn" disabled={!file} onClick={() => send(false)}>{t("preview")}</button>{" "}
    <button className="tg-btn primary" disabled={!file || !preview || preview.errors.length > 0} onClick={() => ask(tr("cfOrgApply"), t("apply"), () => send(true))}>{t("apply")}</button>
    {msg && <div className="tg-err" role="alert">{msg}</div>}
    {preview && <div><pre>{JSON.stringify(preview.summary, null, 1)}</pre>{preview.errors.map((e, i) => <div className="tg-err" key={i}>{e.sheet} {e.col}{e.row}: {e.message}</div>)}</div>}
    {csv && <div><div className="tg-muted">initial-passwords.csv</div><pre data-testid="org-passwords">{csv}</pre></div>}
    {dialog}
  </div>);
}

