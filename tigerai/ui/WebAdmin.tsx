"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 設定 › 管理 › 上網查資料: the switch, the search service (address / key / 測試), which groups, and the 文件轉檔服務 (address / 測試).
// The page only draws and sends; every rule (who may, what is refused) is in tigerai/web and tigerai/slides on the server.
import { useEffect, useState } from "react";
import { tr } from "../pages/i18n";
import { Select, Switch, api } from "./kit";

type View = { enabled: boolean; provider: "searxng" | "brave" | "tavily"; searxUrl: string; groupIds: string[]; converterUrl: string; hasKey: boolean; keyLast4: string | null; groups: { id: string; name: string }[] };

export default function WebAdmin() {
  const [v, setV] = useState<View | null>(null);
  const [provider, setProvider] = useState<View["provider"]>("searxng");
  const [url, setUrl] = useState(""); const [key, setKey] = useState(""); const [conv, setConv] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [msg, setMsg] = useState(""); const [searchTest, setSearchTest] = useState(""); const [convTest, setConvTest] = useState("");
  const apply = (d: View) => { setV(d); setProvider(d.provider); setUrl(d.searxUrl); setConv(d.converterUrl); setGroupIds(d.groupIds); };
  useEffect(() => { void api<View>("admin/web").then((r) => { if (r.ok) apply(r.data); else setMsg(r.data.error ?? tr("error")); }); }, []);
  const put = async (extra: Record<string, unknown>) => {
    const r = await api<View>("admin/web", "PUT", extra);
    if (!r.ok) { setMsg(r.data.error ?? tr("error")); return false; }
    apply(r.data); setMsg(tr("wbSaved")); return true;
  };
  const formBody = (): Record<string, unknown> => { const b: Record<string, unknown> = { provider, searxUrl: url, converterUrl: conv, groupIds }; if (key) b.apiKey = key; return b; };
  const saveAll = async () => { if (await put(formBody())) setKey(""); };
  const runSearchTest = async () => {
    setSearchTest("…");
    const r = await api<{ ok: boolean; results?: number; ms?: number; error?: string }>("admin/web/test", "POST", { provider, searxUrl: url, apiKey: key || undefined });
    setSearchTest(r.data.ok ? tr("wbTestOk", { n: r.data.results ?? 0, ms: r.data.ms ?? 0 }) : `${tr("wbTestFail")}: ${r.data.error ?? r.status}`);
  };
  const runConvTest = async () => {
    setConvTest("…");
    const r = await api<{ ok: boolean; bytes?: number; ms?: number; error?: string }>("admin/web/test-converter", "POST", { url: conv });
    setConvTest(r.data.ok ? tr("cvTestOk", { bytes: r.data.bytes ?? 0, ms: r.data.ms ?? 0 }) : `${tr("cvTestFail")}: ${r.data.error ?? r.status}`);
  };
  if (!v) return <div className="tgx-muted">{msg || tr("loading")}</div>;
  const toggle = (id: string) => setGroupIds(groupIds.includes(id) ? groupIds.filter((g) => g !== id) : [...groupIds, id]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="tgx-card" data-tg-web style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <strong>{tr("wbTitle")}</strong>
        <div className="tgx-muted" style={{ fontSize: 13 }}>{tr("wbHelp")}</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Switch checked={v.enabled} label={tr("wbEnabled")} onChange={(on) => void put({ ...formBody(), enabled: on })} />
          <div><div>{tr("wbEnabled")}</div><div className="tgx-muted" style={{ fontSize: 12 }}>{tr("wbEnabledDesc")}</div></div>
        </div>
        <label>{tr("wbProvider")}<br /><Select ariaLabel={tr("wbProvider")} width={320} value={provider} onChange={(x) => setProvider(x as View["provider"])} options={[{ value: "searxng", label: tr("wbSearx") }, { value: "brave", label: tr("wbBrave") }, { value: "tavily", label: tr("wbTavily") }]} /></label>
        {provider === "searxng"
          ? <label>{tr("wbUrl")}<input className="tgx-input" style={{ width: "100%" }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={tr("wbUrlPh")} /></label>
          : <label>{tr("wbKey")}<input className="tgx-input" style={{ width: "100%" }} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={v.hasKey ? tr("wbKeyHas", { last4: v.keyLast4 ?? "" }) : tr("wbKeyNone")} /></label>}
        <div>
          <strong style={{ fontSize: 13 }}>{tr("wbGroups")}</strong>
          <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("wbGroupsHelp")}</div>
          {v.groups.length === 0 && <div className="tgx-muted">{tr("wbGroupsNone")}</div>}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
            {v.groups.map((g) => (<label key={g.id} style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={groupIds.includes(g.id)} onChange={() => toggle(g.id)} />{g.name}</label>))}
          </div>
        </div>
        <div className="tgx-muted" style={{ fontSize: 12 }}>{tr("wbSafety")}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="tgx-btn" onClick={() => void runSearchTest()}>{tr("wbTest")}</button>
          <button type="button" className="tgx-btn primary" onClick={() => void saveAll()}>{tr("wbSave")}</button>
          {v.hasKey && <button type="button" className="tgx-btn" onClick={() => void put({ apiKey: null })}>{tr("wbKeyClear")}</button>}
          {searchTest && <span role="status" data-tg-web-test>{searchTest}</span>}
        </div>
      </div>
      <div className="tgx-card" data-tg-converter style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <strong>{tr("cvTitle")}</strong>
        <div className="tgx-muted" style={{ fontSize: 13 }}>{tr("cvHelp")}</div>
        <label>{tr("cvUrl")}<input className="tgx-input" style={{ width: "100%" }} value={conv} onChange={(e) => setConv(e.target.value)} placeholder={tr("cvUrlPh")} /></label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="tgx-btn" onClick={() => void runConvTest()}>{tr("cvTest")}</button>
          <button type="button" className="tgx-btn primary" onClick={() => void saveAll()}>{tr("wbSave")}</button>
          {convTest && <span role="status" data-tg-conv-test>{convTest}</span>}
        </div>
      </div>
      {msg && <div className="tgx-muted" role="status">{msg}</div>}
    </div>
  );
}
