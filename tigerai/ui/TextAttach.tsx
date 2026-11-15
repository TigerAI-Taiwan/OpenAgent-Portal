"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// One-off text attachments in a member's own conversation. Upstream's attach button (and a drop on the composer) uploads non-image files into
// the working folder and leaves an @path for the AI to read, which a member's conversation cannot always do. When EVERY picked file is .md or
// .txt we take it over instead: the text is read here, checked (size, UTF-8) and written into the input like typed text, so it goes to the
// AI with this one message and is stored nowhere. Mixed or other files are left to upstream untouched. Wraps the composer, never edits it
// (same technique as HashPrompts: capture-phase listeners on a wrapper, native value setter + an input event). Nothing here is a boundary.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { tr } from "../pages/i18n";
import { attachBlock, checkAttachment, decodeAttachment, MAX_ATTACH_BYTES } from "../knowledge/attach";

function append(el: HTMLTextAreaElement, text: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  const cur = el.value;
  set?.call(el, cur ? `${cur.replace(/\s+$/, "")}\n\n${text}\n` : `${text}\n`);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}

const isTextOnly = (files: File[]): boolean => files.length > 0 && files.every((f) => /\.(md|txt)$/i.test(f.name));

export default function TextAttach({ children }: { children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const take = async (files: File[]) => {
      const area = el.querySelector("textarea");
      if (!area) return;
      const added: string[] = [];
      for (const f of files.slice(0, 5)) {
        const ok = checkAttachment({ name: f.name, size: f.size });
        if (!ok.ok) { setMsg({ bad: true, text: ok.reason === "type" ? tr("attType") : tr("attSize", { name: f.name, kb: MAX_ATTACH_BYTES / 1024 }) }); continue; }
        const text = decodeAttachment(new Uint8Array(await f.arrayBuffer()));
        if (text === null) { setMsg({ bad: true, text: tr("attNotText", { name: f.name }) }); continue; }
        append(area, attachBlock(f.name, text));
        added.push(f.name);
      }
      if (added.length) setMsg({ bad: false, text: tr("attAdded", { name: added.join("、") }) });
    };
    const onChange = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.type !== "file") return;
      const files = Array.from(t.files ?? []);
      if (!isTextOnly(files)) return; // images, mixed, other files: upstream as before
      e.stopPropagation();
      t.value = "";
      void take(files);
    };
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!isTextOnly(files)) return;
      e.preventDefault(); e.stopPropagation();
      void take(files);
    };
    el.addEventListener("change", onChange, true);
    el.addEventListener("drop", onDrop, true);
    return () => { el.removeEventListener("change", onChange, true); el.removeEventListener("drop", onDrop, true); };
  }, []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 7000); return () => clearTimeout(t); }, [msg]);
  return (
    <div ref={wrap} style={{ display: "contents" }} data-tg-textattach>
      {msg && <div role="status" className="tgx-muted" style={{ textAlign: "center", fontSize: 12, padding: "0 16px 4px", color: msg.bad ? "var(--text)" : undefined }}>{msg.text}</div>}
      {children}
    </div>
  );
}
