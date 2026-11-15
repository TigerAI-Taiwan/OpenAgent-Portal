"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 精靈 UI: the card a wizard leaves in a channel (確認 / 採用 / 不需要 / 重跑), the per-channel settings dialog, and the row a private result
// takes in the 公佈欄 個人區. The server decides who may press what (tigerai/wizards/engine.ts); the buttons here only follow the flags it sent.
import { useCallback, useEffect, useState } from "react";
import { fmtDateTime, tr, type Key } from "../pages/i18n";
import { Dialog, Select, Switch, api } from "./kit";
import { openPanel, openRoomAt } from "./store";

export type WSource = { t: "m" | "a" | "x"; seq?: number; id?: string; quote?: string; roomId: string | null; label: string };
export type WItem = {
  id: string; runId: string; roomId: string | null; roomName: string | null; aspect: string; aspectZh: string; category: string | null; text: string;
  sources: WSource[]; state: string; createdAt: number; extra: Record<string, unknown> | null;
};
export type WRun = {
  id: string; kind: string; kindZh: string; roomId: string | null; status: "running" | "done" | "failed" | "skipped"; error: string | null; trigger: string; period: string | null;
  createdAt: number; finishedAt: number | null; postSeq: number | null; confirmState: "draft" | "confirmed" | null; confirmedByName: string | null; confirmedAt: number | null;
};

const btn = { padding: "3px 12px", fontSize: 13 } as const;

/** 出處: each chip opens the channel at that message (or the work order). */
export function Sources({ sources, after }: { sources: WSource[]; after?: () => void }) {
  if (sources.length === 0) return null;
  const go = (s: WSource) => {
    if (s.t === "m" && s.seq && s.roomId) { openRoomAt(s.roomId, s.seq); after?.(); }
    else if (s.t === "a" && s.id) { openPanel("assignments", "assigned", s.id); after?.(); }
  };
  return (
    <span data-tg-sources style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      <span className="tgx-muted" style={{ fontSize: 11 }}>{tr("wizSources")}</span>
      {sources.map((s, i) => s.t === "x" ? (
        <span key={`x${i}`} className="tgx-chip" style={{ padding: "1px 8px", fontSize: 12 }} title={s.quote}>{s.label}{s.quote ? `:「${s.quote}」` : ""}</span>
      ) : (
        <button key={`${s.t}${s.seq ?? s.id}${i}`} type="button" className="tgx-chip" style={{ cursor: "pointer", color: "var(--text)", padding: "1px 8px", font: "inherit", fontSize: 12 }} title={tr("wizOpenSource")} onClick={() => go(s)}>{s.label}</button>))}
    </span>
  );
}

// ---------------------------------------------------------------- the card in a channel

export function WizardCard({ run, items, can, text, onChanged }: { run: WRun | undefined; items: WItem[]; can: boolean; text: string; onChanged: () => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const act = async (key: string, path: string, body?: unknown) => {
    setBusy(key);
    const r = await api(path, "POST", body ?? {});
    setError(r.ok ? "" : r.data.error ?? tr("error"));
    setBusy("");
    onChanged();
  };
  if (!run) return <div className="tgx-card" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</div>;
  const mine = items.filter((i) => i.runId === run.id);
  const section = (aspect: string) => mine.filter((i) => i.aspect === aspect);
  const failed = run.status === "failed";
  return (
    <div data-tg-wizard-card data-run={run.id} data-status={run.status} data-confirm={run.confirmState ?? ""} className="tgx-card" style={{ margin: 0, maxWidth: "none", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong>{run.kindZh}</strong>
        <span className="tgx-muted" style={{ fontSize: 12 }}>
          {failed ? tr("wizCardFailed") : run.confirmState === "confirmed" ? tr("wizCardConfirmed", { name: run.confirmedByName ?? "?" }) : tr("wizCardDraft")}
        </span>
      </div>
      {failed ? (
        <div style={{ marginTop: 6 }}>
          <div className="tgx-err" role="alert" style={{ margin: "4px 0" }}>{run.error}</div>
          {can && <button className="tgx-btn" style={btn} disabled={busy !== ""} onClick={() => act("rerun", `wizards/rooms/${run.roomId}/run`, { kind: run.kind })}>{tr("wizRerun")}</button>}
        </div>
      ) : (<>
        {(["record", "suggest"] as const).map((a) => section(a).length > 0 && (
          <div key={a} style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{tr((a === "record" ? "wizAspRecord" : "wizAspSuggest") as Key)}</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              {section(a).map((i) => (
                <li key={i.id} data-item={i.id} data-state={i.state}>
                  <div style={{ overflowWrap: "anywhere" }}>{i.category ? <span className="tgx-muted">〔{i.category}〕</span> : null}{i.text}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
                    <Sources sources={i.sources} />
                    {a === "suggest" && i.state === "open" && can && (<>
                      <button className="tgx-btn primary" style={btn} disabled={busy !== ""} onClick={() => act(i.id, `wizards/items/${i.id}/adopt`)}>{tr("wizAdopt")}</button>
                      <button className="tgx-btn" style={btn} disabled={busy !== ""} onClick={() => act(i.id, `wizards/items/${i.id}/dismiss`)}>{tr("wizDismiss")}</button>
                    </>)}
                    {a === "suggest" && i.state === "adopted" && <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("wizAdopted")}</span>}
                    {a === "suggest" && i.state === "dismissed" && <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("wizDismissed")}</span>}
                  </div>
                </li>))}
            </ul>
          </div>))}
        {mine.length === 0 && <div className="tgx-muted" style={{ marginTop: 6 }}>{tr("wizNothing")}</div>}
        {run.kind === "weekly" && <WeeklyTable text={text} />}
        {run.confirmState === "draft" && can && (
          <div style={{ marginTop: 12 }}><button className="tgx-btn primary" style={btn} disabled={busy !== ""} onClick={() => act("confirm", `wizards/runs/${run.id}/confirm`)}>{tr("wizConfirm")}</button></div>)}
      </>)}
      {error && <div className="tgx-err" role="alert">{error}</div>}
    </div>
  );
}

/** The work-order table of a weekly report is the program's own text; it is shown as it was written. */
function WeeklyTable({ text }: { text: string }) {
  const at = text.indexOf("### 交辦單狀態");
  if (at < 0) return null;
  const rows = text.slice(at).split("\n").slice(1).filter((l) => l.startsWith("- "));
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>交辦單狀態</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{rows.map((r, i) => <li key={i} style={{ overflowWrap: "anywhere" }}>{r.slice(2).replace("〔交辦單〕", "").trim()}</li>)}</ul>
    </div>
  );
}

// ---------------------------------------------------------------- settings

type Setting = { enabled: boolean; at: string; weekday: number | null };
type Settings = { daily: Setting; weekly: Setting; skill: Setting; aspects: Record<string, boolean> };
type Info = { settings: Settings; runs: WRun[]; kinds: string[]; tick?: { mode: "builtin" | "external"; lastRunAt: number | null; stale: boolean; anyEnabled: boolean } };
const KINDS = ["daily", "weekly", "skill"] as const;
const ASPECTS = ["record", "suggest", "supervise", "audit", "remind"] as const;

export function ago(ms: number | null, now = Date.now()): string {
  if (ms === null) return "-";
  const m = Math.max(0, Math.floor((now - ms) / 60_000));
  if (m < 1) return tr("wizAgoNow");
  if (m < 60) return tr("wizAgoMin", { n: m });
  if (m < 1440) return tr("wizAgoHour", { n: Math.floor(m / 60) });
  return tr("wizAgoDay", { n: Math.floor(m / 1440) });
}

export function WizardSettings({ roomId, roomName, onClose }: { roomId: string; roomName: string; onClose: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [running, setRunning] = useState("");
  const load = useCallback(async () => {
    const r = await api<Info>(`wizards/rooms/${roomId}/settings`);
    if (r.ok) setInfo(r.data); else setError(r.data.error ?? tr("error"));
  }, [roomId]);
  useEffect(() => { void load(); }, [load]);
  // While a run is going the list refreshes by itself.
  useEffect(() => {
    if (!info?.runs.some((r) => r.status === "running")) return;
    const t = setTimeout(() => void load(), 2000);
    return () => clearTimeout(t);
  }, [info, load]);
  const save = async (patch: unknown) => {
    const r = await api<{ settings: Settings }>(`wizards/rooms/${roomId}/settings`, "PATCH", patch);
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    setError(""); setInfo((x) => (x ? { ...x, settings: r.data.settings } : x));
  };
  const runNow = async (kind: string) => {
    setRunning(kind); setNote("");
    const r = await api<{ run: WRun }>(`wizards/rooms/${roomId}/run`, "POST", { kind });
    setRunning("");
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    setError("");
    setNote(r.data.run.status === "skipped" ? `${tr(`wizSt_skipped`)}:${r.data.run.error ?? ""}` : tr("wizRunQueued"));
    void load();
  };
  const text = (k: (typeof KINDS)[number]): [Key, Key] => (k === "daily" ? ["wizDaily", "wizDailyDesc"] : k === "weekly" ? ["wizWeekly", "wizWeeklyDesc"] : ["wizSkill", "wizSkillDesc"]);
  const tick = info?.tick;
  return (
    <Dialog title={tr("wizTitle", { room: roomName })} onClose={onClose} size="md">
      <div data-tg-wizard-settings style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="tgx-muted" style={{ fontSize: 13 }}>{tr("wizIntro")}</div>
        {!info && <div className="tgx-muted">{error || tr("loading")}</div>}
        {info && KINDS.map((k) => { const s = info.settings[k]; const [name, desc] = text(k); return (
          <div key={k} data-wizard={k} className="tgx-card" style={{ margin: 0, maxWidth: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Switch checked={s.enabled} label={tr(name)} onChange={(v) => void save({ [k]: { enabled: v } })} />
              <strong style={{ flex: 1 }}>{tr(name)}</strong>
              <button className="tgx-btn" style={btn} disabled={running !== ""} onClick={() => void runNow(k)}>{running === k ? tr("wizRunning") : tr("wizRunNow")}</button>
            </div>
            <div className="tgx-muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>{tr(desc)}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {s.weekday !== null && (
                <Select ariaLabel={`${tr(name)} ${tr("wizWeekday")}`} width={150} value={String(s.weekday)} onChange={(v) => void save({ [k]: { weekday: Number(v) } })}
                  options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: tr(`wizDay${d}` as Key) }))} />)}
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("wizTime")}</span>
                <input type="time" className="tgx-input" aria-label={`${tr(name)} ${tr("wizTime")}`} value={s.at} onChange={(e) => { if (e.target.value) void save({ [k]: { at: e.target.value } }); }} />
              </label>
            </div>
          </div>); })}
        {info && (
          <div className="tgx-card" style={{ margin: 0, maxWidth: "none" }}>
            <strong>{tr("wizAspects")}</strong>
            <div className="tgx-muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>{tr("wizAspectsHelp")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ASPECTS.map((a) => { const key = `wizAsp${a[0].toUpperCase()}${a.slice(1)}` as Key; return (
                <div key={a} data-aspect={a} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <Switch checked={info.settings.aspects[a] === true} label={tr(key)} onChange={(v) => void save({ aspects: { [a]: v } })} />
                  <div><div>{tr(key)}</div><div className="tgx-muted" style={{ fontSize: 12 }}>{tr(`${key}Desc` as Key)}</div></div>
                </div>); })}
            </div>
          </div>)}
        {tick && (
          <div data-tg-tick style={{ fontSize: 13, ...(tick.stale && tick.anyEnabled ? { color: "#d93025", fontWeight: 600 } : { color: "var(--text-muted)" }) }}>
            {tick.mode === "builtin"
              ? (tick.lastRunAt === null ? tr("wizTickBuiltinNever") : tick.stale ? `${tr("wizTickBuiltin", { ago: ago(tick.lastRunAt) })} · ${tr("wizTickBuiltinStale")}` : tr("wizTickBuiltin", { ago: ago(tick.lastRunAt) }))
              : (tick.lastRunAt === null ? tr("wizTickExternalStale") : tick.stale ? `${tr("wizTickExternal", { ago: ago(tick.lastRunAt) })} · ${tr("wizTickExternalStale")}` : tr("wizTickExternal", { ago: ago(tick.lastRunAt) }))}
          </div>)}
        {info && (
          <div>
            <strong style={{ fontSize: 13 }}>{tr("wizRecent")}</strong>
            {info.runs.length === 0 && <div className="tgx-muted" style={{ fontSize: 13 }}>{tr("wizNoRuns")}</div>}
            <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
              {info.runs.map((r) => <li key={r.id} data-run={r.id} data-status={r.status}>{fmtDateTime(r.createdAt)} · {r.kindZh} · {tr(`wizSt_${r.status}` as Key)} · {tr(`wizTrig_${r.trigger}` as Key)}{r.error ? ` · ${r.error}` : ""}</li>)}
            </ul>
          </div>)}
        {note && <div role="status" className="tgx-muted">{note}</div>}
        {error && <div className="tgx-err" role="alert">{error}</div>}
        <div className="tgx-actions"><button className="tgx-btn" onClick={onClose}>{tr("close")}</button></div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 公佈欄 個人區

/** A private result (監督 / 稽核 / 提醒) or a skill proposal. Only the buttons the server would accept are shown. */
export function WizardPersonal({ item, admin, onDone, after }: { item: WItem; admin: boolean; onDone: () => void; after: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const decide = async (d: "ack" | "adopt" | "dismiss") => {
    setBusy(true);
    const r = await api<{ state: string; skill?: string }>(`wizards/items/${item.id}/${d}`, "POST", {});
    setBusy(false);
    if (!r.ok) { setError(r.data.error ?? tr("error")); return; }
    if (d === "adopt" && r.data.skill) { setDone(tr("wizSkillAdoptedAs", { name: String(item.extra?.name ?? item.text) })); setTimeout(onDone, 1800); } else onDone();
  };
  const skill = item.aspect === "skill";
  const x = item.extra as { name?: string; when?: string; steps?: string[]; roomName?: string } | null;
  return (
    <div data-tg-wizard-item data-aspect={item.aspect} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="tgx-muted" style={{ fontSize: 12 }}>{skill ? tr("bKindSkill") : `${tr("bKindWizard")} · ${item.aspectZh}`}{item.roomName ? ` · ${tr("wizFromRoom", { room: item.roomName })}` : ""}</div>
      {skill && x ? (<>
        <div><strong>{x.name}</strong></div>
        <div><span className="tgx-muted">{tr("wizSkillWhen")}:</span> {x.when}</div>
        <div><span className="tgx-muted">{tr("wizSkillSteps")}:</span><ol style={{ margin: "2px 0 0", paddingLeft: 20 }}>{(x.steps ?? []).map((s, i) => <li key={i}>{s}</li>)}</ol></div>
        <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("wizSkillNote")}</div>
      </>) : <div style={{ overflowWrap: "anywhere" }}>{item.text}</div>}
      <Sources sources={item.sources} after={after} />
      {done ? <div role="status">{done}</div> : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {skill && admin ? (<>
            <button className="tgx-btn primary" style={btn} disabled={busy} onClick={() => decide("adopt")}>{tr("wizAdopt")}</button>
            <button className="tgx-btn" style={btn} disabled={busy} onClick={() => decide("dismiss")}>{tr("wizDismiss")}</button>
          </>) : !skill ? <button className="tgx-btn" style={btn} disabled={busy} onClick={() => decide("ack")}>{tr("wizAck")}</button> : null}
        </div>)}
      {error && <div className="tgx-err" role="alert">{error}</div>}
    </div>
  );
}
