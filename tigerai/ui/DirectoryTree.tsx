"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 目錄: a read-only tree of the company (全公司 / 部門 / 頻道, 個人), a reader for the files in it (Markdown shown as a page, with
// its links clickable) and an export button. The server decides what each person sees (tigerai/directory/tree.ts); this only draws.
import { useCallback, useEffect, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { fmtDateTime, tr } from "../pages/i18n";
import { Icon, api } from "./kit";

type Entry = { id: string; name: string; kind: "folder" | "file" | "link"; size?: number; modified?: number; note?: string; disabled?: boolean };
type Crumb = { id: string; name: string };
type Folder = { kind: "folder"; id: string; name: string; crumbs: Crumb[]; entries: Entry[]; note?: string };
type FileView = { kind: "file"; id: string; name: string; crumbs: Crumb[]; file: { name: string; size: number; mime: string; text: string | null; truncated: boolean; markdown: boolean } };
type View = Folder | FileView;

const href = (path: string, node: string, extra = "") => `/api/tg/dir/${path}?node=${encodeURIComponent(node)}${extra}`;
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function DirectoryTree() {
  const [node, setNode] = useState("root");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async (id: string) => {
    const r = await api<View>(`dir?node=${encodeURIComponent(id)}`);
    if (!r.ok) { setError(r.data.error ?? tr("dirOpenFail")); return; }
    setError(""); setNode(id); setView(r.data as View);
  }, []);
  // ?settings=dir&node=<id> (the link in a 「確認」 交辦單) opens that folder or file; anything the server refuses falls back to the root.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("node");
    void (async () => { if (want) { const r = await api<View>(`dir?node=${encodeURIComponent(want)}`); if (r.ok) { setError(""); setNode(want); setView(r.data as View); return; } } await load("root"); })();
  }, [load]);
  const doExport = async (fmt: "pdf" | "pptx") => {
    if (!view || view.kind !== "file") return;
    setBusy(fmt); setError("");
    const res = await fetch(href("export", view.id, `&format=${fmt}`), { cache: "no-store" });
    setBusy("");
    if (!res.ok) { const j = await res.json().catch(() => ({} as { error?: string })); setError(j.error ?? tr("dirOpenFail")); return; }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${view.name.replace(/\.(md|markdown)$/i, "")}.${fmt}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  return (<div data-dir-tree>
    <nav aria-label="breadcrumb" style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginBottom: 10 }}>
      {(view?.crumbs ?? [{ id: "root", name: tr("dirRoot") }]).map((c, i, a) => (
        <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {i < a.length - 1 ? <button type="button" className="tgx-btn" onClick={() => void load(c.id)}>{c.name}</button> : <strong>{c.name}</strong>}
          {i < a.length - 1 && <span className="tgx-muted">/</span>}
        </span>))}
      <span className="tgx-muted" style={{ marginLeft: "auto", fontSize: 12 }}>{tr("dirReadOnly")}</span>
    </nav>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {view?.kind === "folder" && (<>
      {view.note && <p className="tgx-muted" style={{ marginTop: 0 }}>{view.note}</p>}
      {view.entries.length === 0 && <div className="tgx-muted">{tr("dirEmpty")}</div>}
      {view.entries.map((e) => (
        <button key={e.id} type="button" className="tgx-row" data-dir-entry={e.name} disabled={e.disabled} title={e.disabled ? tr("dirNoLink") : undefined}
          onClick={() => void load(e.id)} style={{ justifyContent: "space-between", gap: 12, width: "100%", opacity: e.disabled ? 0.55 : 1 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Icon name={e.kind === "file" ? "file" : "folder"} />
            <span className="name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}{e.kind === "link" ? " ↗" : ""}</span>
            {e.note && <span className="tgx-chip" style={{ fontSize: 11 }}>{e.note}</span>}
          </span>
          <span className="tgx-muted" style={{ fontSize: 12, flex: "none" }}>{e.size !== undefined ? size(e.size) : ""}{e.modified ? ` · ${fmtDateTime(e.modified)}` : ""}</span>
        </button>))}
    </>)}
    {view?.kind === "file" && (<div data-dir-file={view.name}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <strong style={{ flex: "1 1 160px" }}>{view.name}</strong>
        <span className="tgx-muted" style={{ fontSize: 12 }}>{size(view.file.size)}</span>
        <a className="tgx-btn" href={href("file", view.id, "&download=1")} download>{tr("dirDownload")}</a>
        {view.file.markdown && <>
          <button type="button" className="tgx-btn" disabled={busy !== ""} onClick={() => void doExport("pdf")}>{tr("dirExportPdf")}</button>
          <button type="button" className="tgx-btn" disabled={busy !== ""} onClick={() => void doExport("pptx")}>{tr("dirExportPptx")}</button>
        </>}
      </div>
      <div className="tgx-card" style={{ padding: 16 }}>
        {view.file.markdown && view.file.text !== null && <MarkdownBody>{view.file.text}</MarkdownBody>}
        {!view.file.markdown && view.file.text !== null && <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{view.file.text}</pre>}
        {view.file.text !== null && view.file.truncated && <div className="tgx-muted">{tr("dirTruncated")}</div>}
        {view.file.text === null && /^image\//.test(view.file.mime) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={href("file", view.id)} alt={view.name} style={{ maxWidth: "100%" }} />)}
        {view.file.text === null && view.file.mime === "application/pdf" && <iframe title={view.name} src={href("file", view.id)} style={{ width: "100%", height: "60vh", border: 0 }} />}
        {view.file.text === null && !/^image\//.test(view.file.mime) && view.file.mime !== "application/pdf" && <div className="tgx-muted">{tr("dirTooBig")}</div>}
      </div>
    </div>)}
    <span hidden data-dir-node={node} />
  </div>);
}
