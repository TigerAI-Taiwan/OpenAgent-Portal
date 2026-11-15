"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 會議摘要: paste a transcript or upload a recording, read the sourced draft, open an 交辦單 per action item (a person presses it).
// `roomId` set = started from a room: the draft is also posted into the room as an AI draft. Not set = a private conversation here.
// The server decides who sees what (wizards/meeting/service.ts); nothing in this file is a boundary.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, Modal, Segmented, api } from "../../../ui/kit";
import NewAssignment, { type AssignmentPrefill } from "../../../ui/NewAssignment";
import { fmtDateTime } from "../../../pages/i18n";
import { mt } from "./texts";

type Row = { id: string; title: string; status: "transcribing" | "summarizing" | "done" | "failed"; failedStage: string | null; error: string | null; roomId: string | null; source: string; mine: boolean; ownerName: string; createdAt: number; postedAt: number | null };
type Action = { idx: number; task: string; owner: string | null; due: string | null; lines: number[]; unowned: boolean; noDue: boolean; overdue: boolean };
type Detail = Row & {
  lines: string[]; links: { idx: number; assignmentId: string }[]; prefills: AssignmentPrefill[];
  summary: { decisions: { text: string; lines: number[] }[]; actions: Action[]; suggestions: { text: string; lines: number[] }[]; dropped: number } | null;
};
type Caps = { asrConfigured: boolean; maxAudioBytes: number };

const CSS = `
.tgmt-sec{display:flex;flex-direction:column;gap:6px}
.tgmt-sec h4{margin:8px 0 2px;font-size:13px;color:var(--text-muted);font-weight:600}
.tgmt-item{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--border);border-radius:14px;background:var(--bg-panel)}
.tgmt-item > div:first-child{flex:1;min-width:0;overflow-wrap:anywhere}
.tgmt-ref{border:1px solid var(--border);background:none;color:var(--text-muted);border-radius:10px;padding:0 6px;margin-left:4px;font:inherit;font-size:11px;cursor:pointer}
.tgmt-ref:hover{background:var(--bg-hover);color:var(--text)}
.tgmt-line{display:flex;gap:8px;padding:2px 6px;border-radius:6px;font-size:13px;overflow-wrap:anywhere}
.tgmt-line.hit{background:var(--bg-selected)}
.tgmt-n{flex:none;width:34px;text-align:right;color:var(--text-dim)}
.tgmt-bubble{padding:10px 14px;border-radius:14px;max-width:100%}
.tgmt-user{align-self:flex-end;background:var(--user-bg)}
.tgmt-ai{background:var(--bg-panel);border:1px solid var(--border);display:flex;flex-direction:column;gap:6px}
.tgmt-bar{height:6px;border-radius:3px;background:var(--bg-hover);overflow:hidden}.tgmt-bar > div{height:100%;background:var(--accent)}
.tgmt-tx{max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:12px;padding:6px}
.tgmt-row{display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:14px;background:var(--bg-panel);cursor:pointer;text-align:left;width:100%;color:var(--text);font:inherit}
.tgmt-row:hover{background:var(--bg-hover)}
`;

const running = (s: Row["status"]) => s === "transcribing" || s === "summarizing";
const stText = (r: Row) => (r.status === "transcribing" ? mt("transcribing") : r.status === "summarizing" ? mt("summarizing") : r.status === "failed" ? mt("failed") : mt("stDone"));

export default function MeetingModal({ roomId = null, onClose }: { roomId?: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<"new" | "list">("new");
  const [openId, setOpenId] = useState<string | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  useEffect(() => { void api<Caps>("meeting/capabilities").then((r) => { if (r.ok) setCaps(r.data); }); }, []);
  const created = (id: string) => { setOpenId(id); };
  // Portalled to <body>: opened from a room it would otherwise sit inside the room view's stacking context, under the sidebar.
  return createPortal(
    <Modal title={mt("title")} size="lg" onClose={onClose}>
      <style>{CSS}</style>
      {/* size lg has no body padding or scrolling of its own (the settings tabs bring theirs), so this is the body. */}
      <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto", minHeight: 0, flex: 1 }}>
      {openId ? <DetailView id={openId} onBack={() => { setOpenId(null); setTab("list"); }} />
        : (<>
          <Segmented ariaLabel={mt("title")} value={tab} onChange={(v) => setTab(v as typeof tab)} options={[{ value: "new", label: mt("tabNew") }, { value: "list", label: mt("tabList") }]} />
          {tab === "new" && <NewMeeting roomId={roomId} caps={caps} onCreated={created} />}
          {tab === "list" && <MeetingList roomId={roomId} onOpen={setOpenId} />}
        </>)}
      </div>
    </Modal>,
    document.body,
  );
}

function NewMeeting({ roomId, caps, onCreated }: { roomId: string | null; caps: Caps | null; onCreated: (id: string) => void }) {
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [title, setTitle] = useState(""); const [text, setText] = useState(""); const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [pct, setPct] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const asrOff = caps !== null && !caps.asrConfigured;
  const max = caps?.maxAudioBytes ?? 200 * 1024 * 1024;
  const pick = (f: File | null) => {
    setError(""); setFile(null);
    if (!f) return;
    if (!/\.(mp3|m4a|wav|webm)$/i.test(f.name)) { setError(mt("badType")); return; }
    if (f.size > max) { setError(mt("bigFile")); return; }
    setFile(f);
  };
  const runPaste = async () => {
    setBusy(true); setError("");
    const r = await api<{ meeting: Row }>("meeting", "POST", { title, transcript: text, ...(roomId ? { roomId } : {}) });
    setBusy(false);
    if (!r.ok) { setError(r.data.error ?? ""); return; }
    onCreated(r.data.meeting.id);
  };
  const runUpload = async () => {
    if (!file) return;
    setBusy(true); setError(""); setPct(0);
    try {
      const s = await api<{ uploadId: string; chunkBytes: number }>("meeting/uploads", "POST", { name: file.name, size: file.size, title, ...(roomId ? { roomId } : {}) });
      if (!s.ok) { setError(s.data.error ?? ""); return; }
      const { uploadId, chunkBytes } = s.data;
      for (let off = 0; off < file.size; off += chunkBytes) {
        // One chunk at a time; the server pipes it to disk, so memory stays at one chunk on both ends.
        const res = await fetch(`/api/tg/meeting/uploads/${uploadId}?offset=${off}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file.slice(off, off + chunkBytes) });
        if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; setError(j.error ?? String(res.status)); return; }
        setPct(Math.min(100, Math.round(((off + chunkBytes) / file.size) * 100)));
      }
      const f = await api<{ meeting: Row }>(`meeting/uploads/${uploadId}/finish`, "POST", {});
      if (!f.ok) { setError(f.data.error ?? ""); return; }
      onCreated(f.data.meeting.id);
    } finally { setBusy(false); setPct(null); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
      <input className="tgx-input" aria-label={mt("fTitle")} placeholder={mt("fTitlePh")} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
      <Segmented ariaLabel={mt("title")} value={mode} onChange={(v) => setMode(v as typeof mode)} options={[{ value: "paste", label: mt("modePaste") }, { value: "upload", label: mt("modeUpload") }]} />
      {mode === "paste" ? (<>
        <textarea className="tgx-input" rows={10} aria-label={mt("modePaste")} placeholder={mt("pastePh")} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="tgx-actions"><button type="button" className="tgx-btn primary" disabled={busy || !text.trim()} onClick={() => void runPaste()}>{mt("run")}</button></div>
      </>) : (<>
        {asrOff ? (
          <div role="status" data-tg-asr-off style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button type="button" className="tgx-btn" disabled aria-disabled="true">{mt("asrOff")}</button>
            <span className="tgx-muted" style={{ fontSize: 12 }}>{mt("asrOffHint")}</span>
          </div>
        ) : (<>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input ref={input} type="file" accept=".mp3,.m4a,.wav,.webm,audio/*" aria-label={mt("chooseAudio")} style={{ display: "none" }} onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            <button type="button" className="tgx-btn" onClick={() => input.current?.click()}>{mt("chooseAudio")}</button>
            <span className="tgx-muted">{file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : mt("noAudio")}</span>
          </div>
          <div className="tgx-muted" style={{ fontSize: 12 }}>{mt("audioHint")}</div>
          {pct !== null && <div><div className="tgmt-bar" role="progressbar" aria-valuenow={pct}><div style={{ width: `${pct}%` }} /></div><span className="tgx-muted" style={{ fontSize: 12 }}>{mt("uploading", { pct })}</span></div>}
          <div className="tgx-actions"><button type="button" className="tgx-btn primary" disabled={busy || !file} onClick={() => void runUpload()}>{mt("runUpload")}</button></div>
        </>)}
      </>)}
      {error && <div className="tgx-err" role="alert">{error}</div>}
    </div>
  );
}

function MeetingList({ roomId, onOpen }: { roomId: string | null; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { void api<{ meetings: Row[] }>(`meeting${roomId ? `?room=${encodeURIComponent(roomId)}` : ""}`).then((r) => setRows(r.ok ? r.data.meetings : [])); }, [roomId]);
  if (!rows) return <div className="tgx-muted" style={{ marginTop: 10 }}>…</div>;
  if (rows.length === 0) return <div className="tgx-muted" style={{ marginTop: 10 }}>{mt("noMeetings")}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
      {rows.map((r) => (
        <button key={r.id} type="button" className="tgmt-row" onClick={() => onOpen(r.id)}>
          <span style={{ flex: 1, minWidth: 0 }}><strong>{r.title}</strong><br /><span className="tgx-muted" style={{ fontSize: 12 }}>{fmtDateTime(r.createdAt)} · {mt("by")} {r.ownerName}</span></span>
          <span className="tgx-muted" style={{ fontSize: 12 }}>{stText(r)}</span>
        </button>))}
    </div>
  );
}

function DetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [hit, setHit] = useState<number[]>([]);
  const [form, setForm] = useState<number | null>(null);
  const tx = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => { const r = await api<{ meeting: Detail }>(`meeting/${id}`); if (r.ok) setD(r.data.meeting); else setError(r.data.error ?? ""); }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!d || !running(d.status)) return; const t = setTimeout(() => void load(), 2000); return () => clearTimeout(t); }, [d, load]);
  const jump = (lines: number[]) => { setHit(lines); const el = tx.current?.querySelector<HTMLElement>(`[data-line="${lines[0]}"]`); el?.scrollIntoView({ block: "nearest" }); };
  const retry = async () => { const r = await api(`meeting/${id}/retry`, "POST", {}); if (!r.ok) setError(r.data.error ?? ""); await load(); };
  if (!d) return <div className="tgx-muted">{error || "…"}</div>;
  const s = d.summary;
  const refs = (lines: number[]) => lines.map((n) => <button key={n} type="button" className="tgmt-ref" title={d.lines[n - 1]} onClick={() => jump([n])}>{mt("line", { n })}</button>);
  const linked = (idx: number) => d.links.some((l) => l.idx === idx);
  const personal = !d.roomId;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-tg-meeting={d.id}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="tgx-btn" onClick={onBack}>{mt("back")}</button>
        <strong style={{ flex: 1, minWidth: 0 }}>{d.title}</strong>
        <span className="tgx-muted" style={{ fontSize: 12 }}>{stText(d)}</span>
      </div>
      {personal && <div className="tgmt-bubble tgmt-user">{mt("askUser", { title: d.title })}</div>}
      {running(d.status) && <div role="status" className="tgmt-bubble tgmt-ai">{stText(d)}</div>}
      {d.status === "failed" && (
        <div role="alert" className="tgmt-bubble tgmt-ai"><span className="tgx-err">{d.error}</span>
          {d.mine && <div><button type="button" className="tgx-btn" onClick={() => void retry()}>{mt("retry")}</button></div>}</div>)}
      {s && (
        <div className="tgmt-bubble tgmt-ai" data-tg-summary>
          <div className="tgx-muted" style={{ fontSize: 12 }}>{mt("draftNote")}{d.postedAt ? ` ${mt("inRoom")}` : ""}</div>
          <div className="tgmt-sec"><h4>{mt("secDecisions")}</h4>
            {s.decisions.length === 0 && <div className="tgx-muted">{mt("none")}</div>}
            {s.decisions.map((x, i) => <div key={i} className="tgmt-item"><div>{i + 1}. {x.text}{refs(x.lines)}</div></div>)}</div>
          <div className="tgmt-sec"><h4>{mt("secActions")}</h4>
            {s.actions.length === 0 && <div className="tgx-muted">{mt("none")}</div>}
            {s.actions.map((a) => (
              <div key={a.idx} className="tgmt-item" data-action={a.idx}>
                <div>{a.task}<br /><span className="tgx-muted" style={{ fontSize: 12 }}>{mt("owner")}:{a.owner ?? mt("noOwner")} · {mt("due")}:{a.due ?? mt("noDue")}{a.overdue ? ` (${mt("overdue")})` : ""}</span>{refs(a.lines)}</div>
                {d.mine && (linked(a.idx) ? <span className="tgx-muted" style={{ fontSize: 12 }}>{mt("opened")}</span>
                  : <button type="button" className="tgx-btn" onClick={() => setForm(a.idx)}>{mt("openAssignment")}</button>)}
              </div>))}</div>
          {personal && <div className="tgmt-sec"><h4>{mt("secSupervise")}</h4>
            {s.actions.filter((a) => a.unowned).length === 0 && <div className="tgx-muted">{mt("none")}</div>}
            {s.actions.filter((a) => a.unowned).map((a) => <div key={a.idx} className="tgmt-item"><div>{a.task}{refs(a.lines)}</div></div>)}</div>}
          <div className="tgmt-sec"><h4>{mt("secSuggest")}</h4>
            {s.suggestions.length === 0 && <div className="tgx-muted">{mt("none")}</div>}
            {s.suggestions.map((x, i) => <div key={i} className="tgmt-item"><div>{i + 1}. {x.text}{refs(x.lines)}</div></div>)}</div>
          {s.dropped > 0 && <div className="tgx-muted" style={{ fontSize: 12 }}>{mt("dropped", { n: s.dropped })}</div>}
        </div>)}
      {d.lines.length > 0 && (<>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ flex: 1 }}>{mt("transcript")}</strong>
          <a className="tgx-btn" href={`/api/tg/meeting/${d.id}/transcript`} download style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="down" size={14} />{mt("download")}</a>
        </div>
        <div className="tgmt-tx" ref={tx} data-tg-transcript>
          {d.lines.map((l, i) => <div key={i} data-line={i + 1} className={`tgmt-line${hit.includes(i + 1) ? " hit" : ""}`}><span className="tgmt-n">{i + 1}</span><span>{l}</span></div>)}
        </div></>)}
      {error && <div className="tgx-err" role="alert">{error}</div>}
      {form !== null && d.prefills[form] && (
        <NewAssignment prefill={d.prefills[form]} onClose={() => setForm(null)}
          onCreated={(assignmentId) => { const idx = form; void api(`meeting/${d.id}/actions/${idx}`, "POST", { assignmentId }).then(() => load()); }} />)}
    </div>
  );
}
