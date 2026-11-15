"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// `#` in the input calls up prompts. A wrapper around upstream's composer (never an edit of it): it listens to the textarea inside it
// (input + a capture-phase keydown, so ↑↓ Enter Esc reach the popup before upstream's send handler) and writes the picked text back the
// way a person typing would (native value setter + an input event), so upstream's own state sees it. It only inserts text, never sends.
// Used by slot composer.state (conversations) and by the room composer. See DECISIONS "Batch v11" for why `#`.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tr } from "../pages/i18n";
import { Dialog, api } from "./kit";
import { useMe } from "./me";
import { extractPromptQuery, filterPrompts, missingRequired, renderPrompt, replaceQuery, variablesOf, type PromptQueryMatch } from "../prompts/pick";

type P = { id: string; name: string; description: string; body: string; mine: boolean };
let cache: { at: number; list: P[] } | null = null;
async function loadPrompts(): Promise<P[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.list;
  const r = await api<{ prompts: P[] }>("prompts/pick");
  const list = r.ok ? r.data.prompts : [];
  cache = { at: Date.now(), list };
  return list;
}

/** Write text into a React-controlled textarea so React notices (assigning .value alone is ignored by React). */
function writeValue(el: HTMLTextAreaElement, value: string, caret: number): void {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  el.setSelectionRange(caret, caret);
}

type Open = { el: HTMLTextAreaElement; match: PromptQueryMatch; caret: number };

export default function HashPrompts({ children }: { children: ReactNode }) {
  const { me } = useMe();
  const wrap = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<P[] | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [sel, setSel] = useState(0);
  const [form, setForm] = useState<{ prompt: P; target: Open } | null>(null);
  const dismissed = useRef("");
  const state = useRef({ open, sel, list });
  state.current = { open, sel, list };

  const shown = open && list ? filterPrompts(list, open.match.query) : [];

  const insert = useCallback((target: Open, text: string) => {
    const el = target.el;
    // The value may have moved on while a dialog was open: re-read the current value, replace only the `#query` span.
    const cur = el.value;
    const end = Math.min(target.caret, cur.length);
    const at = cur.slice(target.match.start, target.match.start + 1) === "#" ? target.match : { ...target.match, start: Math.min(target.match.start, cur.length) };
    const r = replaceQuery(cur, at, end, text);
    writeValue(el, r.text, r.caret);
  }, []);

  const pick = useCallback((p: P, target: Open) => {
    setOpen(null);
    if (variablesOf(p.body).some((v) => !v.system)) { setForm({ prompt: p, target }); return; }
    insert(target, renderPrompt(p.body, {}, { userName: me?.name, userEmail: me?.email }));
  }, [insert, me]);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => {
    const root = wrap.current;
    if (!root) return;
    const onInput = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el.tagName !== "TEXTAREA") return;
      const ta = el as HTMLTextAreaElement;
      const caret = ta.selectionStart ?? ta.value.length;
      const match = extractPromptQuery(ta.value.slice(0, caret));
      if (!match) { setOpen(null); return; }
      if (dismissed.current === `${match.start}:${match.query}`) return;
      dismissed.current = "";
      if (state.current.list === null) void loadPrompts().then(setList);
      setSel(0);
      setOpen({ el: ta, match, caret });
    };
    const onKey = (e: KeyboardEvent) => {
      const { open: o, sel: s, list: l } = state.current;
      if (!o || !l || e.isComposing) return;
      const items = filterPrompts(l, o.match.query);
      if (items.length === 0) return; // nothing matches: `#3` is just text, every key goes on to the input
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === "ArrowDown") { stop(); setSel((s + 1) % items.length); }
      else if (e.key === "ArrowUp") { stop(); setSel((s + items.length - 1) % items.length); }
      else if (e.key === "Enter" || e.key === "Tab") { stop(); pickRef.current(items[Math.min(s, items.length - 1)], o); }
      else if (e.key === "Escape") { stop(); dismissed.current = `${o.match.start}:${o.match.query}`; setOpen(null); }
    };
    root.addEventListener("input", onInput);
    root.addEventListener("keydown", onKey, true);
    // Caret moved by mouse or arrows away from the `#query`: close.
    const onSelect = () => {
      const o = state.current.open;
      if (!o) return;
      const m = extractPromptQuery(o.el.value.slice(0, o.el.selectionStart ?? o.el.value.length));
      if (!m || m.start !== o.match.start) setOpen(null);
    };
    document.addEventListener("selectionchange", onSelect);
    return () => { root.removeEventListener("input", onInput); root.removeEventListener("keydown", onKey, true); document.removeEventListener("selectionchange", onSelect); };
  }, []);

  const rect = open?.el.closest("form, [data-tg-composer], .chat-input-card")?.getBoundingClientRect() ?? open?.el.getBoundingClientRect();
  const mine = shown.filter((p) => p.mine), company = shown.filter((p) => !p.mine);
  const rows = [...mine, ...company];
  return (
    <div ref={wrap} data-tg-hash style={{ display: "contents" }}>
      {children}
      {open && rows.length > 0 && rect && typeof document !== "undefined" && createPortal(
        <div className="tgx-pop" data-tg-hash-pop role="listbox" aria-label={tr("hashTitle")} style={{ left: Math.max(8, Math.min(rect.left, window.innerWidth - 380)), bottom: window.innerHeight - rect.top + 6, width: Math.min(rect.width, 460), maxHeight: "50dvh" }}>
          {[["hashMine", mine], ["hashCompany", company]].map(([label, group]) => (group as P[]).length > 0 && (
            <div key={label as string}>
              <div className="head">{tr(label as "hashMine" | "hashCompany")}</div>
              {(group as P[]).map((p) => { const i = rows.indexOf(p); return (
                <button key={p.id} type="button" role="option" aria-selected={i === sel} className="row" style={i === sel ? { background: "var(--bg-selected)" } : undefined}
                  onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); pick(p, open); }}>
                  <span><span>#{p.name}</span>{p.description && <span className="desc">{p.description}</span>}</span>
                </button>); })}
            </div>))}
        </div>, document.body)}
      {form && <VariablesDialog prompt={form.prompt} onClose={() => setForm(null)} onInsert={(text) => { const f = form; setForm(null); insert(f.target, text); }} />}
    </div>
  );
}

function VariablesDialog({ prompt, onClose, onInsert }: { prompt: P; onClose: () => void; onInsert: (text: string) => void }) {
  const { me } = useMe();
  const vars = variablesOf(prompt.body).filter((v) => !v.system);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(vars.map((v) => [v.name, v.defaultValue])));
  const [tried, setTried] = useState(false);
  const missing = missingRequired(prompt.body, values);
  const ctx = { userName: me?.name, userEmail: me?.email };
  return (
    <Dialog title={`#${prompt.name}`} onClose={onClose} size="md">
      <form data-tg-hash-form style={{ display: "flex", flexDirection: "column", gap: 10 }} onSubmit={(e) => { e.preventDefault(); setTried(true); if (missing.length === 0) onInsert(renderPrompt(prompt.body, values, ctx)); }}>
        {vars.map((v, i) => (
          <label key={v.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>{v.name} <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("hashRequired")}</span></span>
            <textarea className="tgx-input" rows={2} autoFocus={i === 0} aria-label={v.name} aria-invalid={tried && missing.includes(v.name)} value={values[v.name] ?? ""} onChange={(e) => setValues({ ...values, [v.name]: e.target.value })} />
            {tried && missing.includes(v.name) && <span className="tgx-err" role="alert">{tr("hashFill", { name: v.name })}</span>}
          </label>))}
        <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("hashPreview")}</div>
        <div data-tg-hash-preview className="tgx-card" style={{ whiteSpace: "pre-wrap", margin: 0, maxHeight: 160, overflow: "auto" }}>{renderPrompt(prompt.body, values, ctx)}</div>
        <div className="tgx-actions">
          <button type="button" className="tgx-btn" onClick={onClose}>{tr("cancel")}</button>
          <button className="tgx-btn primary">{tr("hashInsert")}</button>
        </div>
      </form>
    </Dialog>
  );
}
