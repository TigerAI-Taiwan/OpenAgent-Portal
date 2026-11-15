"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
/* eslint-disable @next/next/no-location-assign-relative-destination -- full page loads on purpose: a started conversation is opened by its deep link */
// The visible parts behind the slots. What each slot shows and for whom comes from ./layout.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentLang, tr, type Key } from "../pages/i18n";
import { AddonSection, useAddonFunctionItems } from "./addons";
import { CONTACT, FUNCTION_SOURCES, NEW_MENU, ROW_ICONS, SIDEBAR_BOTTOM, visibleItems, type Item } from "./layout";
import { useMe } from "./me";
import { useI18n } from "@/hooks/useI18n";
import { BRAND_SHORT } from "@/lib/brand";
import { BasedOn } from "./BasedOn";
import { anchorOf, api, ConfirmDialog, Dialog, Icon, TG_CSS, useOutsideClose } from "./kit";
import { closeRoom, openPanel, openRoom, openSettings, refreshRooms, clearRoomOnly, registerNewChat, setLastCwd, setPickedRole, useUi } from "./store";
import { startConversation } from "./start";
import { dismissToast, openBulletin, startPolling, useBulletin } from "./bulletin-store";
import "./role-fetch";
import "./i18n-overrides";

const SettingsOverlay = dynamic(() => import("./SettingsOverlay"), { ssr: false });
const NewAssignment = dynamic(() => import("./NewAssignment"), { ssr: false });
const BulletinOverlay = dynamic(() => import("./Bulletin"), { ssr: false });
const AgentsModal = dynamic(() => import("./AgentsModal"), { ssr: false });
const AssignmentsModal = dynamic(() => import("./AssignmentsModal"), { ssr: false });
const SkillsModal = dynamic(() => import("./SkillsModal"), { ssr: false });

export function BrandVersion() {
  const { me } = useMe();
  return (
    <span className="new-session-meta" style={{ display: "block", whiteSpace: "normal" }}>
      <style>{TG_CSS}</style>
      {me && <span data-tg-greeting style={{ display: "block", fontSize: 20, fontWeight: 600, marginBottom: 2, color: "var(--text)", fontFamily: "var(--font-ui)" }}>{tr("greeting", { name: me.name })}</span>}
      <HomeBulletin />
    </span>
  );
}

// ---------------------------------------------------------------- sidebar header: the product name

/** Upstream's name button scrambles into version numbers on a click. Ours opens a small popup with our contact details instead
 *  (the CONTACT list in layout.ts); no version number is shown to anyone here. Same look and class as upstream's button. */
export function BrandTitle() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <style>{TG_CSS}</style>
      <button type="button" className="sidebar-brand" data-tg-brand title={tr("product")} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{BRAND_SHORT}</button>
      {open && (
        <Dialog title={tr("product")} onClose={() => setOpen(false)}>
          <div data-tg-contact style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <BasedOn />
            <strong>{tr("contactTitle")}</strong>
            {CONTACT.map((c) => (
              <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className="tgx-muted" style={{ minWidth: 64 }}>{tr(c.labelKey as Key)}</span>
                {c.href ? <a href={c.href} style={{ color: "var(--accent)", overflowWrap: "anywhere" }}>{c.value}</a> : <span>{c.value}</span>}
              </div>))}
            <div data-tg-support style={{ userSelect: "text", marginTop: 4 }}>{tr("supportLine")}</div>
          </div>
        </Dialog>)}
    </>
  );
}

// ---------------------------------------------------------------- sidebar: "+" menu

export function NewButton({ onNewChat, anchor, ready }: { onNewChat: () => void; anchor: string | null; ready: boolean }) {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [order, setOrder] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const pop = useOutsideClose(open, close);
  useEffect(() => { registerNewChat(() => { onNewChat(); }, ready); return () => registerNewChat(null); }, [onNewChat, ready]);
  const run = (item: Item) => {
    setOpen(false);
    if (item.action.kind !== "command") return;
    if (item.action.id === "new-chat") { setPickedRole(null); clearRoomOnly(); closeRoom(); void api("personal-models/pick", "DELETE").finally(onNewChat); } // a plain new conversation goes back to the default model
    else if (item.action.id === "new-room") setDialog(true);
    else if (item.action.id === "new-assignment") setOrder(true);
    else if (item.action.id === "new-announcement") openBulletin("public", { compose: true });
  };
  return (
    <span style={{ display: "inline-flex" }}>
      <style>{TG_CSS}</style>
      <button ref={btn} type="button" className="sidebar-new-button" aria-haspopup="menu" aria-expanded={open} title={tr("newMenu")} aria-label={tr("newMenu")} onClick={() => setOpen((v) => !v)}>
        <Icon name="plus" size={14} />
      </button>
      {open && (
        <div ref={pop} className="tgx-pop" role="menu" style={anchorOf(btn.current)}>
          {visibleItems(NEW_MENU, me).map((item) => (
            <button key={item.id} role="menuitem" className="row" onClick={() => run(item)}>
              <Icon name={item.icon} size={15} /><span>{tr(item.labelKey as Key)}</span>
            </button>
          ))}
        </div>
      )}
      {dialog && <NewRoomDialog onClose={() => setDialog(false)} anchor={anchor} />}
      {order && <NewAssignment onClose={() => setOrder(false)} />}
    </span>
  );
}

function NewRoomDialog({ onClose, anchor }: { onClose: () => void; anchor: string | null }) {
  const [name, setName] = useState("");
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { me } = useMe();
  useEffect(() => { void api<{ users: { id: string; name: string }[] }>("users").then((r) => { if (r.ok) setUsers(r.data.users); }); }, []);
  const create = async () => {
    setBusy(true); setError("");
    const r = await api<{ room: { id: string } }>("rooms", "POST", { name: name.trim() });
    if (!r.ok) { setBusy(false); setError(r.data.error ?? tr("error")); return; }
    const id = r.data.room.id;
    for (const uid of picked) await api(`rooms/${id}/members`, "POST", { userId: uid });
    await refreshRooms();
    setBusy(false); onClose(); openRoom(id, anchor);
  };
  return (
    <Dialog title={tr("newRoomItem")} onClose={onClose}>
      <label>{tr("roomName")}<br /><input className="tgx-input" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <div>
        <div className="tgx-muted" style={{ marginBottom: 4 }}>{tr("pickMembers")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 220, overflow: "auto" }}>
          {users.filter((u) => u.id !== me?.id).map((u) => (
            <label key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 4px" }}>
              <input type="checkbox" checked={picked.includes(u.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, u.id] : picked.filter((x) => x !== u.id))} />{u.name}
            </label>))}
        </div>
      </div>
      {error && <div className="tgx-err" role="alert">{error}</div>}
      <div className="tgx-actions">
        <button className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
        <button className="tgx-btn primary" disabled={!name.trim() || busy} onClick={create}>{tr("createAndEnter")}</button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- sidebar: rooms in the same list

/** Remembered per person in this browser (a convenience, not state anyone else needs): which room groups are folded. */
function useFold(key: string): [boolean, (v: boolean) => void] {
  const [folded, setFolded] = useState(false);
  useEffect(() => { try { setFolded(localStorage.getItem(`tg-fold-${key}`) === "1"); } catch { /* blocked: stays open */ } }, [key]);
  return [folded, (v) => { setFolded(v); try { localStorage.setItem(`tg-fold-${key}`, v ? "1" : "0"); } catch { /* blocked */ } }];
}

function FoldHead({ label, count, folded, onToggle, extra }: { label: string; count: number; folded: boolean; onToggle: () => void; extra?: number }) {
  return (
    <button type="button" className="tgx-fold" aria-expanded={!folded} title={folded ? tr("unfoldRooms") : tr("foldRooms")} onClick={onToggle}>
      <span className="caret"><Icon name="chevron" size={12} /></span>
      <span>{label}</span><span style={{ opacity: .7 }}>({count})</span>
      {folded && (extra ?? 0) > 0 && <span className="tgx-badge" style={{ marginLeft: "auto" }}>{extra}</span>}
    </button>
  );
}

export function RoomListExtra({ anchor }: { anchor: string | null }) {
  const ui = useUi();
  const { me } = useMe();
  const [mineFolded, setMineFolded] = useFold(`rooms-${me?.id ?? "x"}`);
  const [viewFolded, setViewFolded] = useFold(`rooms-view-${me?.id ?? "x"}`);
  useEffect(() => {
    void refreshRooms();
    const id = setInterval(() => { if (document.visibilityState === "visible") void refreshRooms(); }, 15000);
    return () => clearInterval(id);
  }, []);
  // Choosing anything else in the conversation list leaves the room.
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("#session-sidebar-panel-sessions") && !el.closest("[data-tg-room-row]") && !el.closest("[data-tg-rooms]")) { closeRoom(); setPickedRole(null); clearRoomOnly(); }
    };
    document.addEventListener("click", on, true);
    return () => document.removeEventListener("click", on, true);
  }, []);
  if (ui.rooms.length === 0) return <style>{TG_CSS}</style>;
  const row = (r: (typeof ui.rooms)[number]) => (
    <button key={r.id} type="button" data-tg-room-row className="tgx-row" aria-current={ui.roomId === r.id} title={r.name} onClick={() => openRoom(r.id, anchor)}>
      <svg className="tgx-room-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ROW_ICONS.room} /></svg>
      <span className="name">{r.name}{r.closed ? ` (${tr("closedShort")})` : ""}</span>
      {r.unread > 0 && <span className="tgx-badge" title={tr("unreadN", { n: r.unread })}>{r.unread}</span>}
    </button>);
  // Rooms I am not in but may supervise (department head) or administer sit apart, so they are never mistaken for my own.
  const mine = ui.rooms.filter((r) => r.isMember !== false);
  const viewing = ui.rooms.filter((r) => r.isMember === false);
  const unread = (list: typeof mine) => list.reduce((n, r) => n + r.unread, 0);
  return (
    <div data-tg-rooms style={{ padding: "4px 6px" }}>
      <style>{TG_CSS}</style>
      {mine.length > 0 && <FoldHead label={tr("roomsGroup")} count={mine.length} folded={mineFolded} onToggle={() => setMineFolded(!mineFolded)} extra={unread(mine)} />}
      {!mineFolded && mine.map(row)}
      {viewing.length > 0 && <div data-tg-rooms-view><FoldHead label={tr("deptRoomsView")} count={viewing.length} folded={viewFolded} onToggle={() => setViewFolded(!viewFolded)} extra={unread(viewing)} /></div>}
      {!viewFolded && viewing.map(row)}
    </div>
  );
}

// ---------------------------------------------------------------- sidebar: footer icon row

export function SidebarBottom({ openUpstream }: { openUpstream: (section: string) => void }) {
  const { me } = useMe();
  const items = visibleItems(SIDEBAR_BOTTOM, me);
  const run = (item: Item) => {
    if (item.action.kind === "settings") openSettings(item.action.tab);
    else if (item.action.kind === "panel") openPanel(item.action.id);
    else if (item.action.kind === "upstream") openUpstream(item.action.section);
  };
  // flexWrap: on a narrow sidebar or a phone the four labelled buttons wrap onto a second line instead of squeezing each other.
  return (
    <div data-tg-bottom style={{ padding: "8px 6px", flexShrink: 0, display: "flex", flexWrap: "wrap", justifyContent: "space-around", gap: 2 }}>
      <style>{TG_CSS}</style>
      {items.map((item) => {
        const tip = item.id === "settings" ? tr("settingsOf", { name: me?.name ?? "" }) : tr(item.labelKey as Key);
        return (
          <button key={item.id} type="button" data-tg-bottom-item={item.id} className="tgx-icon-btn" style={{ flex: "1 1 auto", height: 34, gap: 4, fontSize: 12.5, padding: "0 4px", minWidth: 0 }} title={tip} aria-label={tip} onClick={() => run(item)}>
            <Icon name={item.icon} size={15} /><span style={{ whiteSpace: "nowrap" }}>{tr(item.labelKey as Key)}</span>
          </button>);
      })}
    </div>
  );
}


// ---------------------------------------------------------------- top bar: 提醒泡泡 (公佈欄)

/** The bell counts only what I must act on (assignments to me, 需要確認 not yet confirmed, approvals); red when something is overdue. */
export function BellButton() {
  const { me } = useMe();
  const b = useBulletin();
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => startPolling(), []);
  // Like the sign-out button: with no conversation open nothing before us pushes to the right, so the pair takes the free space.
  useEffect(() => {
    const el = btn.current;
    if (!el) return;
    let pushed = false;
    for (let n = el.previousElementSibling; n; n = n.previousElementSibling) if (/margin-left:\s*auto/.test(n.getAttribute("style") ?? "")) pushed = true;
    el.style.marginLeft = pushed ? "" : "auto";
  });
  if (!me) return null;
  const count = b.summary?.count ?? 0;
  const red = b.summary?.overdue === true;
  const tip = count > 0 ? `${tr("bulletinBell")} · ${count}` : tr("bulletinBell");
  return (
    <>
      <style>{TG_CSS}</style>
      <button type="button" ref={btn} className="tgx-icon-btn tgx-bell" data-tg-bell data-count={count} data-red={red ? "1" : "0"} style={{ position: "relative", width: "var(--top-bar-height)", height: "var(--top-bar-height)", flexShrink: 0, borderRadius: 0 }} title={tip} aria-label={tip} onClick={() => openBulletin("personal")}>
        <Icon name="bell" size={16} />
        {count > 0 && <span className="tgx-badge" style={{ position: "absolute", top: 4, right: 2, minWidth: 16, textAlign: "center", ...(red ? { background: "#d93025", color: "#fff" } : {}) }}>{count > 99 ? "99+" : count}</span>}
      </button>
      {b.open && <BulletinOverlay />}
      <AiToasts />
    </>
  );
}

/** 「AI 做完了:<標題>」: shown for a while, a click opens that order in 交辦. The bell count already moved by the same poll. */
function AiToasts() {
  const b = useBulletin();
  useEffect(() => {
    if (b.toasts.length === 0) return;
    const timers = b.toasts.map((t) => setTimeout(() => dismissToast(t.key), 30_000));
    return () => timers.forEach(clearTimeout);
  }, [b.toasts]);
  if (b.toasts.length === 0) return null;
  return (
    <div data-tg-toasts role="status" aria-live="polite" style={{ position: "fixed", right: 16, bottom: 16, zIndex: 3000, display: "flex", flexDirection: "column", gap: 8, maxWidth: "min(360px, calc(100vw - 32px))" }}>
      {b.toasts.map((t) => (
        <div key={t.key} data-tg-toast className="tgx-card" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", boxShadow: "0 6px 20px rgba(0,0,0,.25)", background: "var(--bg-panel, var(--bg))" }}>
          <button type="button" style={{ flex: 1, textAlign: "left", border: 0, background: "none", color: "var(--text)", font: "inherit", cursor: "pointer", padding: 0 }}
            onClick={() => { dismissToast(t.key); openPanel("assignments", "mine", t.id); }}>{t.text}</button>
          <button type="button" className="tgx-icon-btn" aria-label={tr("close")} onClick={() => dismissToast(t.key)}><Icon name="x" size={14} /></button>
        </div>))}
    </div>
  );
}

/** Under the greeting: the latest unread announcement(s) and the one or two most urgent things; each opens the 公佈欄. */
function HomeBulletin() {
  const { me } = useMe();
  const b = useBulletin();
  useEffect(() => startPolling(), []);
  const s = b.summary;
  const waiting = s?.aiReview ?? [];
  const urgent = (s?.urgent ?? []).filter((u) => !waiting.some((w) => w.id === u.id));
  if (!me || !s || (s.unread.latest.length === 0 && urgent.length === 0 && waiting.length === 0)) return null;
  const line = { display: "flex", gap: 8, alignItems: "baseline", width: "100%", textAlign: "left" as const, border: 0, background: "none", color: "var(--text)", padding: "3px 0", cursor: "pointer", font: "inherit", fontSize: 13 };
  return (
    <span data-tg-home-bulletin style={{ display: "block", margin: "6px 0 10px", maxWidth: 520 }}>
      {s.unread.latest.map((a) => (
        <button key={a.id} type="button" style={line} onClick={() => openBulletin("public", { announcementId: a.id })}>
          <Icon name="bell" size={13} /><strong style={{ fontWeight: 700 }}>{a.pinned ? `${tr("bPinned")} · ` : ""}{a.title}</strong><span className="tgx-muted" style={{ fontSize: 12 }}>{a.authorName}</span>
        </button>))}
      {waiting.map((w) => (
        <button key={`ai-${w.id}`} type="button" data-tg-home-ai style={line} onClick={() => openPanel("assignments", "mine", w.id)}>
          <Icon name="task" size={13} /><strong style={{ fontWeight: 700 }}>{w.title}</strong><span className="tgx-muted" style={{ fontSize: 12 }}>{tr("asAiWaiting")}</span>
        </button>))}
      {urgent.map((u) => (
        <button key={`${u.kind}-${u.id}`} type="button" style={line} onClick={() => openBulletin("personal")}>
          <Icon name="task" size={13} /><span style={u.overdue ? { color: "#d93025", fontWeight: 600 } : undefined}>{u.title}</span><span className="tgx-muted" style={{ fontSize: 12 }}>{tr(u.kind === "assignment" ? "bKindAssignment" : u.kind === "ack" ? "bRequireAck" : u.kind === "wizard" ? "bKindWizard" : "shareRequest")}{u.overdue ? ` · ${tr("bOverdue")}` : ""}</span>
        </button>))}
    </span>
  );
}

// ---------------------------------------------------------------- top bar: sign out

/** One language setting: ours (Settings › Account, default Traditional Chinese) also sets upstream's own i18n, which would
 *  otherwise follow the browser's language and leave Send / Compact / Copy ... in English. */
function useUpstreamLocale() {
  const { me } = useMe();
  const { locale, setLocale } = useI18n();
  useEffect(() => {
    if (!me) return;
    const want = currentLang() === "en" ? "en" : "zh-TW";
    if (locale !== want) setLocale(want);
  }, [me, locale, setLocale]);
}

/** Members never see server paths: upstream puts a folder's path into the title (tooltip) of its project rows and picker. */
function useScrubPathTitles() {
  const { me } = useMe();
  useEffect(() => {
    if (me?.role !== "member") return;
    const scrub = () => document.querySelectorAll<HTMLElement>("[title^='/'],[title^='\\\\'],[title*=':\\\\']").forEach((e) => { e.removeAttribute("title"); });
    scrub();
    const mo = new MutationObserver(scrub);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
    return () => mo.disconnect();
  }, [me?.role]);
}

export function SignOutButton() {
  const [ask, setAsk] = useState(false);
  useUpstreamLocale();
  useScrubPathTitles();
  const ui = useUi();
  const { me } = useMe();
  const btn = useRef<HTMLButtonElement>(null);
  // Sign-out belongs at the right end of the top bar. When a conversation is open upstream's debug button already pushes itself
  // and what follows to the right; with none open nothing before us does (only the file toggle after us, whose own push is
  // cancelled in kit.tsx), so this button takes the free space itself.
  useEffect(() => {
    const el = btn.current;
    if (!el) return;
    let pushed = false;
    for (let n = el.previousElementSibling; n; n = n.previousElementSibling) if (/margin-left:\s*auto/.test(n.getAttribute("style") ?? "")) pushed = true;
    el.style.marginLeft = pushed ? "" : "auto";
  });
  const out = async () => { await api("logout", "POST"); window.location.href = "/tg/login"; };
  return (
    <>
      <style>{TG_CSS}</style>
      <button type="button" ref={btn} className="tgx-icon-btn tgx-signout" style={{ width: "var(--top-bar-height)", height: "var(--top-bar-height)", flexShrink: 0, borderRadius: 0 }} title={tr("signOut")} aria-label={tr("signOut")} onClick={() => setAsk(true)}>
        <Icon name="logout" size={16} />
      </button>
      {/* The top bar exists on desktop and phone alike (the sidebar may be closed), so it hosts the settings page. */}
      {(ui.settings || me?.mustChangePassword) && <SettingsOverlay />}
      {ui.panel?.id === "agents" && <AgentsModal />}
      {ui.panel?.id === "assignments" && <AssignmentsModal />}
      {ui.panel?.id === "skills" && <SkillsModal />}
      {ask && <ConfirmDialog text={tr("signOutConfirm")} confirmLabel={tr("signOut")} onConfirm={out} onClose={() => setAsk(false)} />}
    </>
  );
}

// ---------------------------------------------------------------- composer: 功能

type App = { id: string; kind: string; name: string; label?: string; description: string };
type Role = { id: string; name: string; description: string; scope?: string };

export function FunctionsButton({ cwd }: { cwd: string | null }) {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [apps, setApps] = useState<App[] | null>(null);
  const picked = useUi().pickedRole;
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const pop = useOutsideClose(open, close);
  useEffect(() => {
    if (!open) return;
    void api<{ menu: Role[] }>("agents/menu").then((r) => setRoles(r.ok ? r.data.menu : []));
    void api<{ apps: App[] }>("n8n/apps").then((r) => setApps(r.ok ? r.data.apps : []));
  }, [open]);
  useEffect(() => setLastCwd(cwd), [cwd]);
  const start = async (role: { id: string; name: string } | null, hint = "") => {
    setOpen(false);
    if (!cwd) return;
    await startConversation(role, hint, cwd);
  };
  const sources = visibleItems(FUNCTION_SOURCES, me);
  const addonSections = useAddonFunctionItems();
  // Without a working folder (a room's composer, a session whose folder is gone) nothing can be started from here.
  if (!cwd) return null;
  const section = (item: Item) => {
    const list = item.id === "roles" ? roles : item.id === "n8n" ? apps : null;
    return (
      <div key={item.id}>
        {item.id !== "plain" && <div className="head">{tr(item.labelKey as Key)}</div>}
        {item.id === "plain" ? (
          <button className="row" onClick={() => start(null)}><Icon name={item.icon} size={15} /><span><span>{tr("fnPlain")}</span><span className="desc">{tr("fnPlainDesc")}</span></span></button>
        ) : list === null ? <div className="tgx-muted" style={{ padding: "6px 10px" }}>{tr("loading")}</div>
        : list.length === 0 ? <div className="tgx-muted" style={{ padding: "6px 10px", fontSize: 12 }}>{tr(item.id === "roles" ? "fnRolesEmpty" : "fnN8nEmpty")}</div>
        : list.map((x) => (
          <button key={x.id} className="row" onClick={() => (item.id === "roles" ? start({ id: x.id, name: x.name }) : start(null, tr("fnN8nHint", { name: (x as App).label ?? x.name })))}>
            <Icon name={item.icon} size={15} /><span><span>{(x as App).label ?? x.name}</span><span className="desc">{x.description || tr(item.descKey as Key)}</span></span>
          </button>))}
      </div>
    );
  };
  return (
    <span style={{ display: "inline-flex" }}>
      <style>{TG_CSS}</style>
      <button ref={btn} type="button" className="tgx-icon-btn" style={{ gap: 5, padding: "0 10px", height: 32, fontSize: 12 }} aria-haspopup="menu" aria-expanded={open} title={tr("functionsBtn")} onClick={() => setOpen((v) => !v)}>
        <Icon name="bolt" size={14} /><span>{picked ? `${tr("functionsBtn")} · ${picked.name}` : tr("functionsBtn")}</span>
      </button>
      {open && (
        <div ref={pop} className="tgx-pop" role="menu" style={anchorOf(btn.current, "above")}>
          {sources.map(section)}
          {cwd && addonSections.map((item) => <AddonSection key={item.id} id={item.id} cwd={cwd} close={() => setOpen(false)} />)}
        </div>)}
    </span>
  );
}
