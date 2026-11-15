"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 設定 › 管理 › 模型 › 語音轉文字服務. Its own block under the model connection; the key is never shown back, only its last four characters.
import { useEffect, useState } from "react";
import { api } from "../../../ui/kit";
import { mt } from "./texts";

type View = { configured: boolean; url: string; model: string; language: string; hasKey: boolean; keyLast4: string | null };

export default function AsrAdmin() {
  const [st, setSt] = useState<View | null>(null);
  const [url, setUrl] = useState(""); const [model, setModel] = useState(""); const [lang, setLang] = useState(""); const [key, setKey] = useState("");
  const [msg, setMsg] = useState(""); const [test, setTest] = useState("");
  const apply = (v: View) => { setSt(v); setUrl(v.url); setModel(v.model); setLang(v.language); };
  useEffect(() => { void api<View>("admin/asr").then((r) => { if (r.ok) apply(r.data); else setMsg(r.data.error ?? ""); }); }, []);
  const runTest = async () => {
    setTest("…");
    const r = await api<{ ok: boolean; ms?: number; error?: string }>("admin/asr/test", "POST", { url: url || undefined, apiKey: key || undefined, model: model || undefined });
    setTest(r.data.ok ? mt("asrOk", { ms: r.data.ms ?? 0 }) : `${mt("asrFail")}: ${r.data.error ?? r.status}`);
  };
  const save = async (extra: Record<string, unknown> = {}) => {
    const body: Record<string, unknown> = { url, model, language: lang, ...extra };
    if (key && !("apiKey" in extra)) body.apiKey = key;
    const r = await api<View>("admin/asr", "PUT", body);
    if (!r.ok) { setMsg(r.data.error ?? ""); return; }
    setKey(""); setMsg(mt("asrSaved")); apply(r.data);
  };
  if (!st) return <div className="tgx-muted">{msg || "…"}</div>;
  return (
    <div className="tgx-card" data-tg-asr style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
      <strong>{mt("asrTitle")}</strong>
      <label>{mt("asrUrl")}<input className="tgx-input" style={{ width: "100%" }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={mt("asrUrlPh")} /></label>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 180px" }}>{mt("asrModel")}<input className="tgx-input" style={{ width: "100%" }} value={model} onChange={(e) => setModel(e.target.value)} /></label>
        <label style={{ flex: "1 1 180px" }}>{mt("asrLang")}<input className="tgx-input" style={{ width: "100%" }} value={lang} maxLength={12} onChange={(e) => setLang(e.target.value)} placeholder="zh" /></label>
      </div>
      <label>{mt("asrKey")}<input className="tgx-input" style={{ width: "100%" }} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={st.hasKey ? mt("asrKeyHas", { last4: st.keyLast4 ?? "" }) : mt("asrKeyNone")} /></label>
      <div className="tgx-muted" style={{ fontSize: 12 }}>{mt("asrHelp")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="tgx-btn" onClick={runTest}>{mt("asrTest")}</button>
        <button type="button" className="tgx-btn primary" onClick={() => void save()}>{mt("asrSave")}</button>
        {st.hasKey && <button type="button" className="tgx-btn" onClick={() => void save({ apiKey: null })}>{mt("asrClear")}</button>}
        {test && <span role="status">{test}</span>}
        {msg && <span role="status" className="tgx-muted">{msg}</span>}
      </div>
    </div>
  );
}
