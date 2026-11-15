"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Our settings page: tabs on the left, content on the right (tabs stack on a phone). Tabs come from layout.ts.
// Opened by the 設定 / 模型 icons; leaving = the logo or 返回.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";
import { Audit, Groups, N8n, Org, Users } from "../pages/TgApp";
import { setLang, tr, currentLang, fmtDateTime, localizeError } from "../pages/i18n";
import { Select, Switch, api } from "./kit";
import { AddonPage } from "./AddonPage";
import { AddonTab, useAddonItems } from "./addons";
import { THEME_OPTIONS } from "@/lib/theme";
import { useI18n } from "@/hooks/useI18n";
import ModelsAdmin from "./ModelsAdmin";
import EmbeddedUpstream from "./EmbeddedUpstream";
import { TabbedModal } from "./TabbedModal";
import { openBulletin } from "./bulletin-store";
import AsrAdmin from "../wizards/meeting/ui/AsrAdmin";
import { PRODUCT_VERSION, SETTINGS_TABS, visibleItems } from "./layout";
import { useMe } from "./me";
import { closeSettings, openPanel, openSettings, useUi } from "./store";
import "../pages/tg.css";

export default function SettingsOverlay() {
  const ui = useUi();
  const { me } = useMe();
  // The 交辦單 tab is gone: its one entry point is the bell in the top bar. An old ?settings=assignments link opens the 公佈欄 instead.
  const old = ui.settings?.tab === "assignments";
  useEffect(() => { if (old) { closeSettings(); openBulletin("personal"); } }, [old]);
  // v9 moved these tabs: 提示詞 / AI 角色 / 提示詞上架 / 分享申請 live in the 技能 modal now. Old ?settings=<tab> links follow them.
  const moved = ui.settings ? ({ prompts: "prompts", roles: "roleAdmin", library: "library", approvals: "approvals" } as Record<string, string>)[ui.settings.tab] : undefined;
  useEffect(() => { if (moved) { closeSettings(); openPanel("skills", moved); } }, [moved]);
  const extra = useAddonItems("settingsTabs");
  if (!ui.settings || !me || old || moved) return null;
  const forced = me.mustChangePassword;
  const tab = forced ? "account" : ui.settings.tab;
  const tabs = visibleItems([...SETTINGS_TABS, ...extra], me);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const embed = current.action.kind === "embed" ? current.action.id : null;
  return (
    <TabbedModal title={tr("settings")} tabs={tabs} current={current.id} onPick={(id) => openSettings(id)} disabled={forced} dismissible={!forced} onClose={closeSettings} flush={embed !== null}>
      {embed ? <EmbeddedUpstream id={embed} onClose={closeSettings} /> : <Section id={current.id} />}
    </TabbedModal>
  );
}

function Section({ id }: { id: string }) {
  const { me } = useMe();
  if (!me) return null;
  switch (id) {
    case "account": return <Account />;
    case "users": return <Users />;
    case "groups": return <Groups />;
    case "org": return <Org />;
    case "models": return <><ModelsAdmin /><AsrAdmin /></>;
    case "n8n": return <N8n />;
    case "addon": return <AddonPage />;
    case "audit": return <Audit />;
    case "deleted": return <DeletedRooms />;
    default: return <AddonTab kind="settingsTabs" id={id} />;
  }
}

// ---------------------------------------------------------------- 帳號

function Account() {
  const { me } = useMe();
  const { preference, setThemePreference } = useTheme();
  const { t } = useI18n();
  // Every palette upstream ships (its own list and its own zh-TW names), grouped: 跟隨系統 first, then 淺色, then 深色.
  const themeOptions = [
    ...THEME_OPTIONS.filter((o) => o.scheme === null),
    ...THEME_OPTIONS.filter((o) => o.scheme === "light"),
    ...THEME_OPTIONS.filter((o) => o.scheme === "dark"),
  ].map((o) => ({ value: o.id as string, label: t(o.label), ...(o.scheme ? { group: tr(o.scheme === "light" ? "themeLight" : "themeDark") } : {}) }));
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [msg, setMsg] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api("account/password", "POST", { current, next });
    if (!r.ok) { setMsg(r.data.error ?? tr("error")); return; }
    window.location.replace("/");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="tgx-card"><div><strong>{me?.name}</strong></div><div className="tgx-muted">{me?.email}</div></div>
      <form className="tgx-card" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <strong>{tr("passwordTitle")}</strong>
        {me?.mustChangePassword && <div className="tgx-err" role="alert">{tr("mustChange")}</div>}
        <label>{tr("current")}<input className="tgx-input" style={{ width: "100%" }} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label>{tr("next")}<input className="tgx-input" style={{ width: "100%" }} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></label>
        {msg && <div className="tgx-err" role="alert">{msg}</div>}
        <div><button className="tgx-btn primary">{tr("save")}</button></div>
      </form>
      {!me?.mustChangePassword && (<>
        <div className="tgx-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>{tr("language")}</strong>
          <Select ariaLabel={tr("language")} width={240} value={currentLang()} options={[{ value: "zh", label: tr("langZh") }, { value: "en", label: tr("langEn") }]} onChange={(v) => { setLang(v as "zh" | "en"); window.location.reload(); }} />
        </div>
        <div className="tgx-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>{tr("theme")}</strong>
          <Select ariaLabel={tr("theme")} width={240} value={preference} options={themeOptions} onChange={(v) => setThemePreference(v as ThemePreference)} />
        </div>
      </>)}
      {me?.role === "admin" && !me.mustChangePassword && (
        <div className="tgx-card" data-tg-about style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <strong>{tr("about")}</strong>
          <span className="tgx-muted">{tr("product")} · {tr("versionLabel", { v: PRODUCT_VERSION })}</span>
        </div>)}
    </div>
  );
}

// ---------------------------------------------------------------- 已刪除頻道 (admin)

function DeletedRooms() {
  const [rows, setRows] = useState<{ id: string; name: string; deletedAt: number; deletedByName: string; daysLeft: number }[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => { const r = await api<{ rooms: typeof rows }>("admin/rooms/deleted"); if (r.ok) setRows(r.data.rooms); else setError(r.data.error ?? tr("loadFail")); }, []);
  useEffect(() => { void load(); }, [load]);
  return (<>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {rows.length === 0 && <div className="tgx-muted">{tr("delNone")}</div>}
    {rows.map((r) => (
      <div className="tgx-card" key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span><strong># {r.name}</strong><br /><span className="tgx-muted" style={{ fontSize: 12 }}>{tr("deletedBy")}: {r.deletedByName} · {fmtDateTime(r.deletedAt)} · {tr("daysLeft", { n: r.daysLeft })}</span></span>
        <button className="tgx-btn" onClick={async () => { const x = await api(`admin/rooms/${r.id}/restore`, "POST", {}); setError(x.ok ? "" : x.data.error ?? tr("error")); void load(); }}>{tr("restore")}</button>
      </div>))}
  </>);
}
