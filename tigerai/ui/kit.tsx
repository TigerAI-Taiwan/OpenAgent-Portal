"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Small shared pieces: icons, one stylesheet (only upstream CSS variables), a dialog, a popover position helper.
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { localizeError, tr } from "../pages/i18n";
import { ROW_ICONS } from "./layout";

const P: Record<string, string> = {
  cpu: "M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM9 9h6v6H9z",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  hash: "M4 9h16M4 15h16M10 3L8 21M16 3l-2 18",
  task: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  prompt: "M4 6h16M4 12h16M4 18h10",
  org: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1",
  flow: "M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6M6 3a2 2 0 1 0 0 .01M18 21a2 2 0 1 0 0 .01",
  robot: "M5 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM12 7V4M9 12h.01M15 12h.01M9 16h6",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  trash: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  back: "M15 18l-6-6 6-6",
  x: "M18 6L6 18M6 6l12 12",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  chevron: "M6 9l6 6 6-6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  layers: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  plug: "M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z",
  up: "M12 19V5M5 12l7-7 7 7",
  down: "M12 5v14M19 12l-7 7-7-7",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  copy: "M9 9h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6",
};
/** A stroke icon as a CSS mask, so a stylesheet rule can paint it in the text colour (used for the conversation-row icon). */
const maskOf = (d: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='${d}'/></svg>`)}")`;
/** An app switch (not a native checkbox): role=switch, keyboard-operable. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" className="tgx-switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.more} />
    </svg>
  );
}

/** One stylesheet for every tigerai UI part. Inline (not a .css import) because upstream unit tests load these files. */
export const TG_CSS = `
.session-tree-session .session-tree-main::before{content:"";flex:none;width:13px;height:13px;margin-right:2px;background:currentColor;opacity:.55;-webkit-mask:${maskOf(ROW_ICONS.conversation)} center/contain no-repeat;mask:${maskOf(ROW_ICONS.conversation)} center/contain no-repeat}
.session-tree-session.is-selected .session-tree-main::before{opacity:.9}
.tgx-room-ico{flex:none;opacity:.6}
.new-session-brand-name{display:none}
/* The terminal is closed for everyone (gate.ts); its 「>_」 button in the files row is hidden in every UI language. */
button[title="開啟工作區終端機"],button[title="Open workspace terminal"],button[title="打开工作区终端"]{display:none !important}
.tgx-switch{position:relative;width:36px;height:20px;border-radius:999px;border:1px solid var(--border);background:var(--bg-hover);padding:0;cursor:pointer;flex:none;transition:background .12s}
.tgx-switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--text-dim);transition:transform .12s,background .12s}
.tgx-switch[aria-checked="true"]{background:var(--accent);border-color:var(--accent)}
.tgx-switch[aria-checked="true"]::after{transform:translateX(16px);background:var(--accent-contrast,#fff)}
.tgx-switch:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent)}
.tgx-row[aria-current="true"] .tgx-room-ico{opacity:.9}
/* Batch v12: a workspace group row in the left list looks like the 頻道 row (.tgx-fold): same size, colour, weight, hover. Conversation rows are not touched. */
.session-tree-group .session-tree-group-toggle,.session-tree-group.is-current .session-tree-group-toggle,.session-tree-group:hover .session-tree-group-toggle{font-size:11px;font-weight:400;color:var(--text-muted);padding-left:10px;gap:4px}
.session-tree-group .session-tree-chevron,.session-tree-group:hover .session-tree-chevron{color:inherit}
.session-tree-group .session-tree-group-pin{color:inherit;opacity:.7}
.tgx-fold{display:flex;align-items:center;gap:4px;width:100%;border:0;background:none;color:var(--text-muted);font:inherit;font-size:11px;padding:4px 10px;cursor:pointer;text-align:left;border-radius:8px}
.tgx-fold:hover{background:var(--bg-hover)}
.tgx-fold .caret{display:inline-flex;transition:transform .12s;transform:rotate(-90deg)}
.tgx-fold[aria-expanded="true"] .caret{transform:none}
.tgx-btn{border:1px solid var(--border);background:var(--bg-panel);color:var(--text);border-radius:999px;padding:6px 16px;cursor:pointer;font:inherit}
.tgx-btn:hover:not(:disabled){background:var(--bg-hover)}
.tgx-btn.primary{background:var(--accent);color:var(--accent-contrast,var(--bg));border-color:var(--accent)}
.tgx-btn.primary:hover:not(:disabled){background:var(--accent);filter:brightness(.93)}
.tgx-btn:disabled{opacity:.5;cursor:default}
.tgx-input{border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:12px;padding:6px 9px;font:inherit;min-width:0}
.tgx-select{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;text-align:left;min-width:140px;width:100%}
.tgx-select-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tgx-input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
.tgx-icon-btn{display:flex;align-items:center;justify-content:center;border:0;background:none;color:var(--text-muted);cursor:pointer;border-radius:9px}
.tgx-icon-btn:hover{background:var(--bg-hover);color:var(--text)}
.tgx-pop{position:fixed;z-index:1500;background:var(--bg-panel);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:4px;min-width:200px;max-width:min(360px,calc(100vw - 24px));max-height:70dvh;overflow:auto}
.tgx-pop button.row{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;border:0;background:none;color:var(--text);padding:8px 10px;border-radius:8px;cursor:pointer;font:inherit}
.tgx-pop button.row:hover{background:var(--bg-hover)}
.tgx-pop .desc{display:block;font-size:12px;color:var(--text-muted)}
.tgx-pop .head{padding:6px 10px 2px;font-size:11px;color:var(--text-dim);text-transform:none}
.tgx-muted{color:var(--text-muted)}
.tgx-badge{background:var(--accent);color:var(--accent-contrast,var(--bg));border-radius:10px;padding:0 7px;font-size:11px;line-height:17px;flex:none}
.tgx-card{background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;padding:14px;margin-bottom:14px;max-width:880px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.tgx-err{border:1px solid var(--border);background:var(--bg-hover);border-radius:8px;padding:6px 10px;margin:8px 0}
.tgm-backdrop{position:fixed;inset:0;z-index:1400;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;padding:16px}
.tgm{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:20px;box-shadow:0 16px 48px rgba(0,0,0,.25);display:flex;flex-direction:column;max-width:100%;max-height:calc(100dvh - 32px);overflow:hidden;font-size:14px}
.tgm[data-size=sm]{width:420px}
.tgm[data-size=md]{width:640px}
.tgm[data-size=lg]{width:1080px;height:84vh}
.tgm-head{display:flex;align-items:center;gap:10px;min-height:52px;padding:0 10px 0 20px;flex-shrink:0}
.tgm[data-size=lg]>.tgm-head{border-bottom:1px solid var(--border)}
.tgm-head h3{margin:0;font-size:16px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tgm-x{width:34px;height:34px;flex:none}
.tgm-body{padding:0 20px 20px;display:flex;flex-direction:column;gap:12px;overflow:auto;min-height:0;flex:1}
.tgm[data-size=lg]>.tgm-body{padding:0;gap:0;overflow:hidden}
.tgm textarea{resize:none}
.tgm input[type=checkbox]{appearance:none;-webkit-appearance:none;width:16px;height:16px;flex:none;margin:0;border:1.5px solid var(--text-dim);border-radius:5px;background:var(--bg);cursor:pointer;display:inline-grid;place-content:center;vertical-align:middle}
.tgm input[type=checkbox]:checked{background:var(--accent);border-color:var(--accent)}
.tgm input[type=checkbox]:checked::after{content:"";width:8px;height:4px;border-left:2px solid var(--accent-contrast,#fff);border-bottom:2px solid var(--accent-contrast,#fff);transform:rotate(-45deg) translate(1px,-1px)}
.tgm input[type=checkbox]:focus-visible{outline:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent)}
.tgm input[type=checkbox]:disabled{opacity:.5;cursor:default}
.tgx-cal{padding:8px;width:260px}
.tgx-cal .top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.tgx-cal .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}
.tgx-cal .grid .dow{font-size:11px;color:var(--text-dim);padding:2px 0}
.tgx-cal .grid button{border:0;background:none;color:var(--text);border-radius:8px;padding:6px 0;cursor:pointer;font:inherit;font-size:13px}
.tgx-cal .grid button:hover{background:var(--bg-hover)}
.tgx-cal .grid button[aria-pressed=true]{background:var(--accent);color:var(--accent-contrast,var(--bg))}
.tgx-cal .foot{display:flex;justify-content:space-between;margin-top:6px}
.tgx-link{border:0;background:none;color:var(--accent);cursor:pointer;font:inherit;padding:2px 6px}
@media (max-width:760px){
  .tgm-backdrop:has(.tgm:not([data-size=sm])){padding:0}
  .tgm:not([data-size=sm]){width:100%;height:100dvh;max-height:100dvh;border:0;border-radius:0;box-shadow:none}
  .tgm-x{width:44px;height:44px}
}
.tgx-signout ~ button[aria-controls="file-panel"]{margin-left:0 !important}
.tgx-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.tgx-row{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:0;border-radius:10px;background:none;color:var(--text);cursor:pointer;font:inherit;text-align:left;font-size:13px}
.tgx-row:hover{background:var(--bg-hover)}
.tgx-row[aria-current="true"]{background:var(--bg-selected)}
.tgx-row .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tgx-chip{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--border);border-radius:999px;padding:1px 4px 1px 10px;font-size:12px;background:var(--bg-panel)}
.tgx-chip .rm{display:none;width:18px;height:18px;border-radius:50%;border:0;background:var(--bg-hover);color:var(--text-muted);cursor:pointer;align-items:center;justify-content:center;padding:0}
.tgx-chip:hover .rm,.tgx-chip:focus-within .rm{display:inline-flex}
.tgx-chip:not(:has(.rm)){padding-right:10px}
@media (hover:none){.tgx-chip .rm{display:inline-flex}}
`;

export function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", on);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", on); document.removeEventListener("keydown", key); };
  }, [open, close]);
  return ref;
}

/** The app's own drop-down (replaces <select>): a button showing the choice, a popover list under it. */
export function Select({ value, options, onChange, ariaLabel, placeholder, width }: { value: string; options: { value: string; label: string; group?: string }[]; onChange: (v: string) => void; ariaLabel: string; placeholder?: string; width?: number | string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const pop = useOutsideClose(open, close);
  const current = options.find((o) => o.value === value);
  return (
    <span style={{ display: "inline-block", width }}>
      <button ref={btn} type="button" className="tgx-input tgx-select" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((v) => !v)}>
        <span className="tgx-select-text" style={current ? undefined : { color: "var(--text-muted)" }}>{current?.label ?? placeholder ?? ""}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div ref={pop} className="tgx-pop" role="listbox" aria-label={ariaLabel} style={{ ...fitBelowOrAbove(btn.current), minWidth: btn.current?.offsetWidth }}>
          {options.map((o, i) => (
            <Fragment key={o.value}>
              {o.group && o.group !== options[i - 1]?.group && <div className="head" role="presentation">{o.group}</div>}
              <button type="button" role="option" aria-selected={o.value === value} className="row" style={o.value === value ? { background: "var(--bg-selected)" } : undefined} onClick={() => { setOpen(false); onChange(o.value); }}>{o.label}</button>
            </Fragment>
          ))}
        </div>)}
    </span>
  );
}

/** The app's own date field (replaces <input type=date>): value is YYYY-MM-DD, shown as 2026/11/30, picked in a month grid. */
export function DateField({ value, onChange, ariaLabel, placeholder }: { value: string; onChange: (v: string) => void; ariaLabel: string; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const pop = useOutsideClose(open, close);
  const today = new Date();
  const base = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : today;
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const first = new Date(view.y, view.m, 1).getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const iso = (d: number) => `${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const move = (n: number) => { const d = new Date(view.y, view.m + n, 1); setView({ y: d.getFullYear(), m: d.getMonth() }); };
  const names = tr("weekdays").split(",");
  return (
    <span style={{ display: "inline-block" }}>
      <button ref={btn} type="button" className="tgx-input tgx-select" style={{ minWidth: 180 }} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((v) => !v)}>
        <span className="tgx-select-text" style={value ? undefined : { color: "var(--text-muted)" }}>{value ? value.replace(/-/g, "/") : placeholder ?? tr("pickDate")}</span>
        <Icon name="calendar" size={14} />
      </button>
      {open && (
        <div ref={pop} className="tgx-pop tgx-cal" role="dialog" aria-label={ariaLabel} style={anchorOf(btn.current)}>
          <div className="top">
            <button type="button" className="tgx-icon-btn" style={{ width: 28, height: 28 }} aria-label={tr("prevMonth")} onClick={() => move(-1)}><Icon name="back" size={14} /></button>
            <strong>{view.y} / {String(view.m + 1).padStart(2, "0")}</strong>
            <button type="button" className="tgx-icon-btn" style={{ width: 28, height: 28, transform: "scaleX(-1)" }} aria-label={tr("nextMonth")} onClick={() => move(1)}><Icon name="back" size={14} /></button>
          </div>
          <div className="grid">
            {names.map((n) => <span className="dow" key={n}>{n}</span>)}
            {Array.from({ length: first }, (_, i) => <span key={`b${i}`} />)}
            {Array.from({ length: days }, (_, i) => <button type="button" key={i} aria-pressed={value === iso(i + 1)} onClick={() => { onChange(iso(i + 1)); setOpen(false); }}>{i + 1}</button>)}
          </div>
          <div className="foot">
            <button type="button" className="tgx-link" onClick={() => { onChange(""); setOpen(false); }}>{tr("clear")}</button>
            <button type="button" className="tgx-link" onClick={() => { onChange(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`); setOpen(false); }}>{tr("today")}</button>
          </div>
        </div>)}
    </span>
  );
}

/** The app's own file chooser (replaces the browser's "Choose File / No file chosen", which follows the browser language). */
export function FilePick({ accept, ariaLabel, file, onPick }: { accept: string; ariaLabel: string; file: File | null; onPick: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <input ref={ref} type="file" accept={accept} aria-label={ariaLabel} style={{ display: "none" }} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <button type="button" className="tgx-btn" onClick={() => ref.current?.click()}>{tr("chooseFile")}</button>
      <span className="tgx-muted">{file ? file.name : tr("noFile")}</span>
    </span>
  );
}

/** A row of exclusive choices (replaces radio buttons). */
export function Segmented({ value, options, onChange, ariaLabel }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; ariaLabel: string }) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value} className={`tgx-btn${o.value === value ? " primary" : ""}`} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

// One modal for everything (settings, 模型, new room, new work order, room actions, confirmations). Same sizes
// (sm / md / lg), same radius, ✕ at the top right, Esc and a click on the dimmed backdrop close it, and it returns to
// where the person was because nothing was navigated away from. On a phone md/lg fill the screen with the ✕ (no back button).
const modalStack: symbol[] = [];
export type ModalSize = "sm" | "md" | "lg";
export function Modal({ title, onClose, size = "sm", dismissible = true, children }: { title: string; onClose: () => void; size?: ModalSize; dismissible?: boolean; children: ReactNode }) {
  const pressed = useRef(false);
  useEffect(() => {
    const me = Symbol("modal");
    modalStack.push(me);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && dismissible && modalStack[modalStack.length - 1] === me) { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); modalStack.splice(modalStack.indexOf(me), 1); };
  }, [onClose, dismissible]);
  return (
    <div className="tgm-backdrop" onMouseDown={(e) => { pressed.current = e.target === e.currentTarget; }} onClick={(e) => { if (dismissible && pressed.current && e.target === e.currentTarget) onClose(); pressed.current = false; }}>
      <style>{TG_CSS}</style>
      <div className="tgm" data-size={size} role="dialog" aria-modal="true" aria-label={title}>
        <div className="tgm-head">
          <h3>{title}</h3>
          {dismissible && <button type="button" className="tgx-icon-btn tgm-x" title={tr("close")} aria-label={tr("close")} onClick={onClose}><Icon name="x" size={18} /></button>}
        </div>
        <div className="tgm-body">{children}</div>
      </div>
    </div>
  );
}

/** A small modal (kept under its old name: confirmations, short forms). */
export function Dialog({ title, onClose, children, size = "sm" }: { title: string; onClose: () => void; children: ReactNode; size?: ModalSize }) {
  return <Modal title={title} onClose={onClose} size={size}>{children}</Modal>;
}

export function ConfirmDialog({ text, confirmLabel, onConfirm, onClose }: { text: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog title={text} onClose={onClose}>
      <div className="tgx-actions">
        <button className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
        <button className="tgx-btn primary" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}

/**
 * Every destructive click goes through this: `ask(text, label, run)` opens the shared dialog and runs `run` only on the
 * confirm button. Render `dialog` once in the component. One place, so no page invents its own (or forgets one).
 */
export function useConfirm(): { ask: (text: string, confirmLabel: string, run: () => void | Promise<void>) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<{ text: string; label: string; run: () => void | Promise<void> } | null>(null);
  const close = useCallback(() => setPending(null), []);
  const ask = useCallback((text: string, label: string, run: () => void | Promise<void>) => setPending({ text, label, run }), []);
  const dialog = pending ? <ConfirmDialog text={pending.text} confirmLabel={pending.label} onClose={close} onConfirm={() => { const p = pending; setPending(null); void p.run(); }} /> : null;
  return { ask, dialog };
}

/** A text question in the app's own dialog (replaces window.prompt). `required`: confirm stays off until something is typed. */
export function TextPromptDialog({ title, label, confirmLabel, required, onSubmit, onClose }: { title: string; label: string; confirmLabel: string; required: boolean; onSubmit: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const ok = !required || text.trim().length > 0;
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(text.trim()); }}>
        <textarea className="tgx-input" rows={3} autoFocus maxLength={2000} aria-label={label} placeholder={label} value={text} onChange={(e) => setText(e.target.value)} style={{ width: "100%" }} />
        <div className="tgx-actions">
          <button type="button" className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
          <button className="tgx-btn primary" disabled={!ok}>{confirmLabel}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Like anchorOf, but a long list never runs off the screen: it opens below when there is room, else above, and is capped to the space it has. */
function fitBelowOrAbove(el: HTMLElement | null): React.CSSProperties {
  if (!el) return anchorOf(el);
  const r = el.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 16, above = r.top - 16;
  const useAbove = below < 240 && above > below;
  return { ...anchorOf(el, useAbove ? "above" : "below"), maxHeight: Math.max(160, useAbove ? above : below) };
}

/** Fixed-position anchor under (or above) a button; keeps the popover on screen. */
export function anchorOf(el: HTMLElement | null, placement: "below" | "above" = "below"): React.CSSProperties {
  if (!el) return { top: 60, left: 8 };
  const r = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 220));
  return placement === "below" ? { top: r.bottom + 6, left } : { bottom: window.innerHeight - r.top + 6, left };
}

export async function api<T = Record<string, unknown>>(path: string, method = "GET", data?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(`/api/tg/${path}`, { method, headers: data === undefined ? undefined : { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data), cache: "no-store" });
  let json = {} as T & { error?: string };
  try { json = await res.json(); } catch { /* empty body */ }
  const j = json as { error?: unknown; code?: unknown };
  if (!res.ok && typeof j.error === "string") j.error = localizeError(j.code, j.error);
  return { ok: res.ok, status: res.status, data: json };
}
