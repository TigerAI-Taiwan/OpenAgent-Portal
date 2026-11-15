"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// A room, drawn as the conversation page: one column, the upstream MessageView for every message
// (so markdown renders exactly as in a conversation) and the upstream ChatInput card as the composer.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChatInput, type ChatInputHandle } from "@/components/ChatInput";
import HashPrompts from "./HashPrompts";
import { MessageView } from "@/components/MessageView";
import type { AgentMessage } from "@/lib/types";
import { fmtClock, tr } from "../pages/i18n";
import { DisabledComposer } from "./ComposerState";
import { ConfirmDialog, Dialog, Icon, Select, TG_CSS, anchorOf, api, useConfirm, useOutsideClose } from "./kit";
import { useMe } from "./me";
import { adoptAnchor, clearFocusSeq, clearRoomOnly, closeRoom, markRoomRead, openRoom, refreshRooms, useUi } from "./store";
import { AnalysisDialog, WizardCard, WizardSettings, type WItem, type WRun } from "./Wizards";
import { mt } from "../wizards/meeting/ui/texts";
import MeetingModal from "../wizards/meeting/ui/MeetingModal";

type Msg = { seq: number; author_id: string; author: string; text: string; ts: number; kind?: string };
type Member = { id: string; name: string };
type Info = {
  room: { id: string; name: string; owner_id: string; unit_id?: string | null; is_unit_default?: number };
  members: Member[]; messages: Msg[]; ai?: { busy: boolean; queued: number };
  isMember: boolean; canPost: boolean; canJoin: boolean; closed: boolean; deleted: boolean; myRole: string;
  can: { warn: boolean; close: boolean; reopen: boolean; delete: boolean; manageMembers: boolean; wizards?: boolean };
  /** What the 精靈 left in this channel: the latest runs and their channel items (re-sent on every poll, so a 確認 shows up for everyone). */
  wizard?: { runs: WRun[]; items: WItem[] };
};

export default function RoomView({ anchor, upstream }: { anchor: string | null; upstream: ReactNode }) {
  const ui = useUi();
  const latest = useRef(anchor);
  latest.current = anchor;
  // A room opened from a link has no anchor yet: take the conversation the app settles on, then watch for changes.
  useEffect(() => {
    if (!ui.roomId || ui.anchor !== null) return;
    adoptAnchor(anchor);
    const id = setTimeout(() => adoptAnchor(latest.current), 1500);
    return () => clearTimeout(id);
  }, [ui.roomId, ui.anchor, anchor]);
  useEffect(() => { if (ui.roomId && ui.anchor !== null && ui.anchor !== anchor) closeRoom(); }, [ui.roomId, ui.anchor, anchor]);
  if (ui.roomOnly && !ui.roomId) return (
    <div data-tg-roomonly style={{ position: "absolute", inset: 0, zIndex: 5, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <style>{TG_CSS}</style>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center" }}>
        <div>{tr("roomOnlyBody")}</div>
        {ui.roomOnly.roomId && <button className="tgx-btn primary" onClick={() => { const id = ui.roomOnly!.roomId!; clearRoomOnly(); openRoom(id, anchor); }}>{tr("goToRoom")}</button>}
      </div>
      <DisabledComposer reason={tr("roomOnly")} />
    </div>);
  if (!ui.roomId || (ui.anchor !== null && ui.anchor !== anchor)) return <>{upstream}</>;
  // Laid over the (still mounted) conversation, so nothing of it is torn down while a room is open.
  return <div style={{ position: "absolute", inset: 0, zIndex: 5, background: "var(--bg)" }}><Room key={ui.roomId} id={ui.roomId} /></div>;
}

function toAgentMessage(m: Msg): AgentMessage {
  if (m.kind === "ai") return { role: "assistant", content: [{ type: "text", text: m.text }], model: "", provider: "", stopReason: "stop", timestamp: m.ts } as unknown as AgentMessage;
  return { role: "user", content: m.text, timestamp: m.ts } as unknown as AgentMessage;
}
const clock = fmtClock;
export const POLL_MS = 2000;

function Room({ id }: { id: string }) {
  const { me } = useMe();
  const [info, setInfo] = useState<Info | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [bots, setBots] = useState<Member[]>([{ id: "ai", name: "AI" }]);
  const [menu, setMenu] = useState(false);
  const [dlg, setDlg] = useState<null | "members" | "warn" | "close" | "delete" | "wizards" | "analysis" | "meeting" | "unit">(null);
  const focusSeq = useUi().focusSeq;
  const last = useRef(0);
  const busy = useRef(false);
  const kick = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<ChatInputHandle>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  const menuRef = useOutsideClose(menu, closeMenu);

  const poll = useCallback(async () => {
    const r = await api<Info>(`rooms/${id}?after=${last.current}&read=1`);
    if (!r.ok) { setDenied(true); return; }
    const d = r.data;
    setInfo(d);
    busy.current = !!d.ai?.busy;
    if (d.messages?.length) {
      const seen = last.current;
      setMsgs((m) => [...m, ...d.messages.filter((x) => x.seq > seen && !m.some((y) => y.seq === x.seq))]);
      last.current = d.messages[d.messages.length - 1].seq;
      if (d.isMember) markRoomRead(id);
      void refreshRooms();
    }
  }, [id]);
  useEffect(() => {
    // While the room is in view a new message shows within ~2 s (it used to take up to 15 s unless the AI was busy).
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (document.visibilityState === "visible") { kick.current = false; await poll(); }
      if (!stopped) timer = setTimeout(loop, POLL_MS);
    };
    void loop();
    return () => { stopped = true; clearTimeout(timer); };
  }, [poll]);
  useEffect(() => { if (focusSeq === null) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs.length, focusSeq]);
  // A 精靈 source chip was clicked: bring that message into view once it is loaded, and mark it for a moment.
  useEffect(() => {
    if (focusSeq === null) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-seq="${focusSeq}"]`);
    if (!el) { const t = setTimeout(clearFocusSeq, 6000); return () => clearTimeout(t); }
    el.scrollIntoView({ block: "center" });
    el.setAttribute("data-focus", "1");
    const t = setTimeout(() => { el.removeAttribute("data-focus"); clearFocusSeq(); }, 2500);
    return () => clearTimeout(t);
  }, [focusSeq, msgs.length]);
  useEffect(() => { void api<{ agents: Member[] }>("agents").then((r) => { if (r.ok) setBots([{ id: "ai", name: "AI" }, ...r.data.agents.map((a) => ({ id: a.id, name: a.name }))]); }); }, []);

  const send = useCallback(async (text: string) => {
    const r = await api(`rooms/${id}/messages`, "POST", { text });
    if (!r.ok) { setError(r.data.error ?? tr("error")); input.current?.restoreSubmission(text); return; }
    setError(""); kick.current = true; void poll();
  }, [id, poll]);
  const act = async (path: string, method = "POST", body: unknown = {}) => {
    const r = await api(`rooms/${id}${path}`, method, method === "DELETE" ? undefined : body);
    setError(r.ok ? "" : r.data.error ?? tr("error"));
    if (r.ok) { last.current = 0; setMsgs([]); void poll(); }
    return r.ok;
  };

  if (denied) return <div style={{ padding: 24 }}>{tr("noAccess")}</div>;
  if (!info) return <div style={{ padding: 24 }} className="tgx-muted">{tr("loading")}</div>;

  const viewing = !info.isMember && (me?.role === "admin" || info.myRole === "head-viewer");
  let composer: ReactNode;
  if (info.deleted) composer = <DisabledComposer reason={tr("roomDeleted")} />;
  else if (!info.isMember) composer = <DisabledComposer reason={tr("notMember")} actionLabel={info.canJoin ? tr("joinRoom") : undefined} onAction={() => { void act("/join"); }} />;
  else if (info.closed) composer = <DisabledComposer reason={tr("roomClosed")} />;
  else composer = <Composer id={id} send={send} handle={input} members={info.members} bots={bots} />;

  const items: { id: string; label: string; show: boolean; run: () => void }[] = [
    { id: "members", label: tr("roomMembers"), show: true, run: () => setDlg("members") },
    { id: "wizards", label: tr("wizSettings"), show: info.can.wizards === true && !info.closed, run: () => setDlg("wizards") },
    { id: "analysis", label: tr("wizAnalysisTitle"), show: !info.closed && !info.deleted && (info.isMember || info.can.wizards === true), run: () => setDlg("analysis") },
    { id: "meeting", label: mt("roomMenu"), show: info.isMember && !info.closed && !info.deleted, run: () => setDlg("meeting") },
    { id: "unit", label: tr("roomUnit"), show: info.can.manageMembers, run: () => setDlg("unit") },
    { id: "warn", label: tr("warn"), show: info.can.warn, run: () => setDlg("warn") },
    { id: "close", label: info.closed ? tr("reopenRoom") : tr("closeRoom"), show: info.closed ? info.can.reopen : info.can.close, run: () => { if (info.closed) void act("/reopen"); else setDlg("close"); } },
    { id: "delete", label: tr("deleteRoom"), show: info.can.delete, run: () => setDlg("delete") },
  ];
  return (
    <div data-tg-room style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg)" }}>
      <style>{TG_CSS}</style>
      <style>{`[data-seq][data-focus]{outline:2px solid var(--accent);outline-offset:4px;border-radius:10px;transition:outline-color .3s}`}</style>
      <style>{`.tg-left-user > div:last-child > div:last-child{align-items:flex-start!important}.tg-left-user > div:last-child > div:last-child > div:last-child{justify-content:flex-start!important}`}</style>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap", minHeight: 48 }}>
        <strong style={{ flex: "1 1 120px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}># {info.room.name}{info.closed ? ` (${tr("roomClosed")})` : ""}</strong>
        <button type="button" className="tgx-icon-btn" style={{ gap: 0, padding: 2 }} aria-label={tr("roomMembers")} title={tr("roomMembers")} onClick={() => setDlg("members")}>
          {info.members.slice(0, 5).map((m, i) => (
            <span key={m.id} style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--bg-selected)", border: "2px solid var(--bg)", marginLeft: i ? -8 : 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--text)" }}>{m.name.slice(0, 1).toUpperCase()}</span>))}
          {info.members.length > 5 && <span className="tgx-muted" style={{ marginLeft: 4, fontSize: 12 }}>+{info.members.length - 5}</span>}
        </button>
        <button ref={moreBtn} type="button" className="tgx-icon-btn" style={{ width: 32, height: 32 }} aria-haspopup="menu" aria-expanded={menu} aria-label={tr("moreMenu")} title={tr("moreMenu")} onClick={() => setMenu((v) => !v)}><Icon name="more" /></button>
        {menu && (
          <div ref={menuRef} className="tgx-pop" role="menu" style={{ ...anchorOf(moreBtn.current), left: "auto", right: 12 }}>
            {items.filter((i) => i.show).map((i) => <button key={i.id} role="menuitem" className="row" onClick={() => { setMenu(false); i.run(); }}>{i.label}</button>)}
          </div>)}
      </div>
      {viewing && <div role="status" style={{ padding: "6px 16px", background: "var(--bg-hover)", borderBottom: "1px solid var(--border)", fontSize: 13 }}>{me?.role === "admin" ? tr("adminViewing") : tr("headViewing")}</div>}
      {error && <div className="tgx-err" role="alert" style={{ margin: "8px 16px" }}>{error}</div>}
      <div ref={scroller} data-testid="room-messages" style={{ flex: 1, overflow: "auto", padding: "16px 16px 8px" }}>
        <div style={{ width: "100%", maxWidth: "var(--chat-content-max-width, 820px)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {msgs.map((m) => {
            if (m.kind === "system") return <div key={m.seq} data-seq={m.seq} className="tgx-muted" style={{ textAlign: "center", fontSize: 12 }}>{m.text} · {clock(m.ts)}</div>;
            if (m.kind === "wizard") {
              const run = info.wizard?.runs.find((r) => `wizard:${r.id}` === m.author_id);
              return (
                <div key={m.seq} data-seq={m.seq} data-msg-kind="wizard" className="tg-left" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tgx-muted" style={{ fontSize: 11, marginBottom: 2 }}>{tr("wizLabel")} · {clock(m.ts)}</div>
                    <WizardCard run={run} items={info.wizard?.items ?? []} can={info.can.wizards === true && !info.closed} text={m.text} onChanged={() => void poll()} />
                  </div>
                </div>);
            }
            if (m.kind === "warning") return (
              <div key={m.seq} data-seq={m.seq} role="alert" style={{ border: "2px solid var(--accent)", background: "color-mix(in srgb, var(--accent) 16%, var(--bg))", borderRadius: 12, padding: "10px 14px" }}>
                <strong>{tr("warning")} · {m.author}</strong> <span className="tgx-muted" style={{ fontSize: 12 }}>{clock(m.ts)}</span>
                <div style={{ marginTop: 4, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.text}</div>
              </div>);
            const ai = m.kind === "ai";
            const mine = !ai && m.author_id === me?.id;
            const avatar = <span aria-hidden style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--bg-selected)", color: "var(--text)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0, marginTop: 2 }}>{(ai ? (m.author || "AI") : m.author).slice(0, 1).toUpperCase()}</span>;
            // Only my own messages are the right-hand "user" bubble. Everyone else (people and AI) sits on the left with an avatar and a name.
            if (mine) return (
              <div key={m.seq} data-seq={m.seq} data-msg-kind="human" data-mine>
                <MessageView message={toAgentMessage(m)} />
              </div>);
            return (
              <div key={m.seq} data-seq={m.seq} data-msg-kind={ai ? "ai" : "human"} className={ai ? "tg-left" : "tg-left tg-left-user"} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                {!ai && avatar}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tgx-muted" style={{ fontSize: 11, marginBottom: 2 }}>{ai ? (m.author || "AI") : m.author} · {clock(m.ts)}</div>
                  <MessageView message={toAgentMessage(m)} />
                </div>
              </div>);
          })}
          {info.ai?.busy && <div className="tgx-muted" role="status">{tr("aiWorking")}{info.ai.queued > 0 ? ` (+${info.ai.queued})` : ""}</div>}
        </div>
      </div>
      {composer}
      {dlg === "members" && <MembersDialog info={info} onClose={() => setDlg(null)} onChanged={() => { last.current = 0; setMsgs([]); void poll(); }} />}
      {dlg === "wizards" && <WizardSettings roomId={id} roomName={info.room.name} onClose={() => setDlg(null)} />}
      {dlg === "analysis" && <AnalysisDialog roomId={id} manager={info.can.wizards === true} onClose={() => setDlg(null)} onStarted={() => { kick.current = true; void poll(); }} />}
      {dlg === "meeting" && <MeetingModal roomId={id} onClose={() => setDlg(null)} />}
      {dlg === "unit" && <RoomUnitDialog roomId={id} unitId={info.room.unit_id ?? ""} isDefault={info.room.is_unit_default === 1} isAdmin={me?.role === "admin"} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); void poll(); }} />}
      {dlg === "warn" && <WarnDialog onClose={() => setDlg(null)} onSend={async (text) => { if (await act("/warn", "POST", { text })) setDlg(null); }} />}
      {dlg === "close" && <ConfirmDialog text={tr("cfCloseRoom")} confirmLabel={tr("closeRoom")} onClose={() => setDlg(null)} onConfirm={() => { setDlg(null); void act("/close"); }} />}
      {dlg === "delete" && <ConfirmDialog text={tr("deleteConfirm")} confirmLabel={tr("deleteRoom")} onClose={() => setDlg(null)} onConfirm={async () => { setDlg(null); const r = await api(`rooms/${id}`, "DELETE"); if (r.ok) { await refreshRooms(); closeRoom(); } else setError(r.data.error ?? tr("error")); }} />}
    </div>
  );
}

/** Upstream ChatInput card; the @ popup of members and AI roles is laid over it (the card itself stays upstream). */
function Composer({ id, send, handle, members, bots }: { id: string; send: (t: string) => void; handle: React.RefObject<ChatInputHandle | null>; members: Member[]; bots: Member[] }) {
  const [pop, setPop] = useState<{ q: string; sel: number; start: number; end: number } | null>(null);
  const cands = pop ? [...members, ...bots].filter((c, i, a) => a.findIndex((x) => x.name === c.name) === i && c.name.toLowerCase().startsWith(pop.q.toLowerCase())) : [];
  const pick = (name: string) => {
    if (!pop) return;
    const ta = document.querySelector<HTMLTextAreaElement>("[data-tg-composer] textarea");
    const v = ta?.value ?? "";
    handle.current?.setText(`${v.slice(0, pop.start)}@${name} ${v.slice(pop.end)}`);
    setPop(null);
    handle.current?.focus();
  };
  const onInput = (e: React.FormEvent) => {
    const el = e.target as HTMLTextAreaElement;
    if (el.tagName !== "TEXTAREA") return;
    const caret = el.selectionStart ?? el.value.length;
    const m = /@([^\s@]*)$/.exec(el.value.slice(0, caret));
    setPop(m ? { q: m[1], sel: 0, start: caret - m[0].length, end: caret } : null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!pop || cands.length === 0) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === "ArrowDown") { stop(); setPop({ ...pop, sel: (pop.sel + 1) % cands.length }); }
    else if (e.key === "ArrowUp") { stop(); setPop({ ...pop, sel: (pop.sel + cands.length - 1) % cands.length }); }
    else if ((e.key === "Enter" && !e.nativeEvent.isComposing) || e.key === "Tab") { stop(); pick(cands[pop.sel].name); }
    else if (e.key === "Escape") { stop(); setPop(null); }
  };
  return (
    <div data-tg-composer style={{ position: "relative", flexShrink: 0, padding: "0 16px 12px" }} onInput={onInput} onKeyDownCapture={onKey}>
      {/* Room messages are text only (the send above drops images), so the image-attach button is hidden here. */}
      <style>{`[data-tg-composer] .chat-input-controls > div:first-child > button:first-child{display:none !important}`}</style>
      <div style={{ position: "relative", width: "100%", maxWidth: "var(--chat-content-max-width, 820px)", margin: "0 auto" }}>
      {pop && cands.length > 0 && (
          <div className="tgx-pop" role="listbox" style={{ position: "absolute", bottom: "100%", left: 0, right: "auto", marginBottom: 4 }}>
            {cands.map((c, i) => <button key={c.id} role="option" aria-selected={i === pop.sel} className="row" style={i === pop.sel ? { background: "var(--bg-selected)" } : undefined} onMouseDown={(e) => { e.preventDefault(); pick(c.name); }}>@{c.name}</button>)}
          </div>)}
        <HashPrompts><ChatInput ref={handle} isStreaming={false} onAbort={() => {}} onSend={(t) => send(t)} draftKey={`tg-room:${id}`} /></HashPrompts>
      </div>
    </div>
  );
}

function MembersDialog({ info, onClose, onChanged }: { info: Info; onClose: () => void; onChanged: () => void }) {
  const [all, setAll] = useState<Member[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void api<{ users: Member[] }>("users").then((r) => { if (r.ok) setAll(r.data.users); }); }, []);
  const add = async (uid: string) => { const r = await api(`rooms/${info.room.id}/members`, "POST", { userId: uid }); setError(r.ok ? "" : r.data.error ?? tr("error")); onChanged(); };
  const { ask, dialog } = useConfirm();
  const remove = async (uid: string) => { const r = await api(`rooms/${info.room.id}/members/${uid}`, "DELETE"); setError(r.ok ? "" : r.data.error ?? tr("error")); onChanged(); };
  return (<>
    <Dialog title={tr("roomMembers")} onClose={onClose}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {info.members.map((m) => (
          <span key={m.id} className="tgx-chip">{m.name}
            {info.can.manageMembers && m.id !== info.room.owner_id && (
              <button type="button" className="rm" aria-label={`${tr("removeMember")} ${m.name}`} title={tr("removeMember")} onClick={() => ask(tr("cfRemoveRoomMember", { name: m.name }), tr("removeMember"), () => remove(m.id))}><Icon name="x" size={11} /></button>)}
          </span>))}
      </div>
      {info.can.manageMembers && (
        <Select ariaLabel={tr("addToRoom")} placeholder={`${tr("addToRoom")}...`} value="" onChange={(v) => v && void add(v)} options={all.filter((u) => !info.members.some((m) => m.id === u.id)).map((u) => ({ value: u.id, label: u.name }))} />)}
      {error && <div className="tgx-err" role="alert">{error}</div>}
      <div className="tgx-actions"><button className="tgx-btn" onClick={onClose}>{tr("close")}</button></div>
    </Dialog>
    {dialog}
  </>);
}

/** File a channel under a unit (the directory shows it there) or under none = 跨部門頻道. Display only: it changes who can open nothing. */
function RoomUnitDialog({ roomId, unitId, isDefault, isAdmin, onClose, onSaved }: { roomId: string; unitId: string; isDefault: boolean; isAdmin: boolean; onClose: () => void; onSaved: () => void }) {
  const [units, setUnits] = useState<{ id: string; path: string }[]>([]);
  const [unit, setUnit] = useState(unitId);
  const [dflt, setDflt] = useState(isDefault);
  const [error, setError] = useState("");
  useEffect(() => { void api<{ units: { id: string; path: string }[] }>("units").then((r) => { if (r.ok) setUnits(r.data.units); }); }, []);
  return (
    <Dialog title={tr("roomUnit")} onClose={onClose}>
      <p className="tgx-muted" style={{ marginTop: 0 }}>{tr("roomUnitHint")}</p>
      {error && <div className="tgx-err" role="alert">{error}</div>}
      <Select ariaLabel={tr("roomUnit")} width={280} value={unit} onChange={setUnit} options={[{ value: "", label: tr("roomUnitNone") }, ...units.map((u) => ({ value: u.id, label: u.path }))]} />
      {isAdmin && unit && <label style={{ display: "flex", gap: 6, marginTop: 10 }}><input type="checkbox" checked={dflt} onChange={(e) => setDflt(e.target.checked)} />{tr("roomUnitDefault")}</label>}
      <div className="tgx-actions">
        <button className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
        <button className="tgx-btn primary" data-room-unit-save onClick={async () => { const r = await api(`rooms/${roomId}`, "PATCH", { unitId: unit || null, isDefault: !!unit && dflt }); if (r.ok) onSaved(); else setError(r.data.error ?? tr("error")); }}>{tr("roomUnitSave")}</button>
      </div>
    </Dialog>
  );
}

function WarnDialog({ onClose, onSend }: { onClose: () => void; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Dialog title={tr("warn")} onClose={onClose}>
      <textarea className="tgx-input" rows={4} maxLength={500} aria-label={tr("warnText")} placeholder={tr("warnText")} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div className="tgx-actions">
        <button className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
        <button className="tgx-btn primary" disabled={!text.trim()} onClick={() => onSend(text.trim())}>{tr("sendWarn")}</button>
      </div>
    </Dialog>
  );
}
