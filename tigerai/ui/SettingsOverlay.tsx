"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Our settings page: tabs on the left, content on the right (tabs stack on a phone). Tabs come from layout.ts.
// Opened by the 設定 / 模型 icons; leaving = the logo or 返回.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";
import { Audit, Groups, N8n, Users } from "../pages/TgApp";
import { OrgPage } from "./OrgPanel";
import DirectoryTree from "./DirectoryTree";
import { setLang, tr, currentLang, fmtDateTime, localizeError } from "../pages/i18n";
import { ConfirmDialog, Modal, Select, Switch, api } from "./kit";
import { AddonPage } from "./AddonPage";
import { Connectors } from "./Connectors";
import Forms from "./Forms";
import { AddonTab, useAddonItems } from "./addons";
import { THEME_OPTIONS } from "@/lib/theme";
import { useI18n } from "@/hooks/useI18n";
import UserLog from "./UserLog";
import { SystemStatus } from "./SystemStatus";
import { N8nPublishPolicy } from "./N8nPublish";
import WebAdmin from "./WebAdmin";
import ModelsAdmin from "./ModelsAdmin";
import PersonalModels, { PersonalAdmin } from "./PersonalModels";
import EmbeddedUpstream from "./EmbeddedUpstream";
import { TabbedModal } from "./TabbedModal";
import { openBulletin } from "./bulletin-store";
import AsrAdmin from "../wizards/meeting/ui/AsrAdmin";
import { PRODUCT_VERSION, SETTINGS_TABS, VENDOR_TABS, visibleItems } from "./layout";
import { loadMe, useMe } from "./me";
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
  // 使用者紀錄: a head sees the tab only while the switch is on (the server refuses it anyway).
  const tabs = visibleItems([...SETTINGS_TABS, ...extra], me).filter((t) => t.id !== "userlog" || me.role === "admin" || me.canUserLog).filter((t) => !me.isVendor || VENDOR_TABS.has(t.id));
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
    case "org": return <OrgPage />;
    case "dir": return <DirectoryTree />;
    case "models": return <><ModelsAdmin /><PersonalAdmin /><AsrAdmin /></>;
    case "n8n": return <><N8n /><N8nPublishPolicy /></>;
    case "web": return <WebAdmin />;
    case "connectors": return <Connectors />;
    case "forms": return <Forms />;
    case "addon": return <AddonPage />;
    case "system": return <SystemStatus />;
    case "audit": return <Audit />;
    case "userlog": return <UserLog />;
    case "deleted": return <DeletedRooms />;
    default: return <AddonTab kind="settingsTabs" id={id} />;
  }
}

// ---------------------------------------------------------------- 帳號

function ProfileForm() {
  const { me } = useMe();
  const [name, setName] = useState(me?.name ?? ""); const [email, setEmail] = useState(me?.email ?? ""); const [current, setCurrent] = useState("");
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState(false);
  const emailChanged = email.trim().toLowerCase() !== (me?.email ?? "").toLowerCase();
  const save = async (e: FormEvent) => {
    e.preventDefault(); setMsg(""); setOk(false);
    const r = await api("account/profile", "POST", { name, email, current });
    if (!r.ok) { setMsg(r.data.error ?? tr("error")); return; }
    setOk(true); setCurrent(""); loadMe(true);
  };
  return (
    <form className="tgx-card" onSubmit={save} data-tg-profile style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <strong>{tr("acProfileTitle")}</strong>
      <label>{tr("acName")}<input className="tgx-input" style={{ width: "100%" }} value={name} placeholder={tr("acNamePh")} maxLength={80} onChange={(e) => setName(e.target.value)} required /></label>
      <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("acNameHint")}</span>
      <label>{tr("acEmail")}<input className="tgx-input" style={{ width: "100%" }} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <span className="tgx-muted" style={{ fontSize: 12 }}>{tr("acEmailNote")}</span>
      {emailChanged && <label>{tr("acEmailPw")}<input className="tgx-input" style={{ width: "100%" }} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>}
      {msg && <div className="tgx-err" role="alert">{msg}</div>}
      {ok && <div className="tgx-muted" role="status">{tr("acSaved")}</div>}
      <div><button className="tgx-btn primary">{tr("acSaveProfile")}</button></div>
    </form>);
}

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
      {!me?.mustChangePassword && <ProfileForm />}
      <form className="tgx-card" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <strong>{tr("passwordTitle")}</strong>
        {me?.mustChangePassword && <div className="tgx-err" role="alert">{tr("mustChange")}</div>}
        <label>{tr("current")}<input className="tgx-input" style={{ width: "100%" }} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label>{tr("next")}<input className="tgx-input" style={{ width: "100%" }} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></label>
        {msg && <div className="tgx-err" role="alert">{msg}</div>}
        <div><button className="tgx-btn primary">{tr("save")}</button></div>
      </form>
      {!me?.mustChangePassword && (<>
        {!me?.isVendor && <PersonalModels isAdmin={me?.role === "admin"} />}
        {!me?.isVendor && <div className="tgx-card tgx-muted" data-tg-userlog-notice>{tr("ulNotice")}</div>}
        <div className="tgx-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>{tr("language")}</strong>
          <Select ariaLabel={tr("language")} width={240} value={currentLang()} options={[{ value: "zh", label: tr("langZh") }, { value: "en", label: tr("langEn") }]} onChange={(v) => { setLang(v as "zh" | "en"); window.location.reload(); }} />
        </div>
        <div className="tgx-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>{tr("theme")}</strong>
          <Select ariaLabel={tr("theme")} width={240} value={preference} options={themeOptions} onChange={(v) => setThemePreference(v as ThemePreference)} />
        </div>
      </>)}
      <div className="tgx-card tgx-muted" data-tg-support style={{ userSelect: "text" }}>{tr("supportLine")}</div>
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
  const [rows, setRows] = useState<{ id: string; name: string; deletedAt: number; deletedByName: string; messages: number }[]>([]);
  const [error, setError] = useState("");
  const [purge, setPurge] = useState<{ id: string; name: string; messages: number; step: 1 | 2 } | null>(null);
  const [typed, setTyped] = useState("");
  const load = useCallback(async () => { const r = await api<{ rooms: typeof rows }>("admin/rooms/deleted"); if (r.ok) setRows(r.data.rooms); else setError(r.data.error ?? tr("loadFail")); }, []);
  useEffect(() => { void load(); }, [load]);
  return (<>
    <p className="tgx-muted" style={{ marginTop: 0 }}>{tr("archivedKeep")}</p>
    {error && <div className="tgx-err" role="alert">{error}</div>}
    {rows.length === 0 && <div className="tgx-muted">{tr("delNone")}</div>}
    {rows.map((r) => (
      <div className="tgx-card" key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span><strong># {r.name}</strong><br /><span className="tgx-muted" style={{ fontSize: 12 }}>{tr("deletedBy")}: {r.deletedByName} · {fmtDateTime(r.deletedAt)} · {tr("daysLeft")}</span></span>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="tgx-btn" onClick={async () => { const x = await api(`admin/rooms/${r.id}/restore`, "POST", {}); setError(x.ok ? "" : x.data.error ?? tr("error")); void load(); }}>{tr("restore")}</button>
          <button className="tgx-btn" data-purge={r.name} onClick={() => { setTyped(""); setPurge({ id: r.id, name: r.name, messages: r.messages, step: 1 }); }}>{tr("purgeBtn")}</button>
        </span>
      </div>))}
    {purge && purge.step === 1 && <ConfirmDialog text={tr("purgeAsk1", { name: purge.name, n: purge.messages })} confirmLabel={tr("purgeBtn")} onClose={() => setPurge(null)} onConfirm={() => setPurge({ ...purge, step: 2 })} />}
    {purge && purge.step === 2 && (
      <Modal title={tr("purgeBtn")} onClose={() => setPurge(null)}>
        <p>{tr("purgeAsk2", { name: purge.name })}</p>
        <input className="tg-input" aria-label={tr("purgeTyped")} placeholder={tr("purgeTyped")} value={typed} onChange={(e) => setTyped(e.target.value)} style={{ width: "100%" }} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button className="tgx-btn" onClick={() => setPurge(null)}>{tr("cancel")}</button>
          <button className="tgx-btn primary" disabled={typed !== purge.name} onClick={async () => { const x = await api(`admin/rooms/${purge.id}/purge`, "POST", { confirm: true, typedName: typed }); setError(x.ok ? "" : x.data.error ?? tr("error")); setPurge(null); void load(); }}>{tr("purgeBtn")}</button>
        </div>
      </Modal>)}
  </>);
}
