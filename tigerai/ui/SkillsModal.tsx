"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 技能 = the AI I use for work, as shortcuts. Everyone: 我的提示詞, AI 角色, n8n 應用 (what my groups may use), 可用技能 (installed,
// read-only, each "用這個開對話"). Administrators add how it is stocked: 安裝技能 and 子代理 (upstream screens embedded), AI 角色上架,
// 提示詞上架, 分享申請. Tabs come from SKILL_TABS in layout.ts. Every permission is checked on the server.
import { useEffect, useRef, useState } from "react";
import { Prompts, Roles, MyPrompts, WorkOrders } from "../pages/TgApp";
import { tr } from "../pages/i18n";
import { AgentBrowse } from "./AgentsModal";
import EmbeddedUpstream from "./EmbeddedUpstream";
import { TabbedModal } from "./TabbedModal";
import { api } from "./kit";
import { SKILL_TABS, visibleItems } from "./layout";
import { AddonTab, useAddonItems } from "./addons";
import { useMe } from "./me";
import { startConversation } from "./start";
import { closePanel, openPanel, useUi } from "./store";

export default function SkillsModal() {
  const ui = useUi();
  const { me } = useMe();
  const extra = useAddonItems("skillTabs");
  if (!me || ui.panel?.id !== "skills") return null;
  const tabs = visibleItems([...SKILL_TABS, ...extra], me);
  const current = tabs.find((t) => t.id === ui.panel?.tab) ?? tabs[0];
  const embed = current.action.kind === "embed" ? current.action.id : null;
  return (
    <TabbedModal title={tr("skillsTitle")} tabs={tabs} current={current.id} onPick={(id) => openPanel("skills", id)} onClose={closePanel} flush={embed !== null}>
      {embed ? <EmbeddedUpstream id={embed} onClose={closePanel} /> : <Body id={current.id} />}
    </TabbedModal>
  );
}

function Body({ id }: { id: string }) {
  const { me } = useMe();
  if (!me) return null;
  switch (id) {
    case "prompts": return <MyPrompts me={{ ...me }} />;
    case "roles": return <><div className="tgx-muted" style={{ marginBottom: 10 }}>{tr("skRolesNote")}</div><AgentBrowse onClosePanel={closePanel} /></>;
    default: return <AddonTab kind="skillTabs" id={id} />;
    case "n8napps": return <N8nApps />;
    case "available": return <Installed />;
    case "roleAdmin": return <Roles />;
    case "library": return <Prompts />;
    case "approvals": return <WorkOrders />;
  }
}

function UseRow({ name, description, onUse }: { name: string; description: string; onUse: () => void }) {
  return (
    <div className="tgx-card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, padding: "10px 14px" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</strong>
        {description && <span className="tgx-muted" style={{ fontSize: 12, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{description}</span>}
      </span>
      <button type="button" className="tgx-btn" onClick={onUse}>{tr("useThis")}</button>
    </div>
  );
}

function useLoad<T>(path: string, pick: (d: Record<string, unknown>) => T): { rows: T | null; error: string } {
  const [rows, setRows] = useState<T | null>(null);
  const [error, setError] = useState("");
  const pickRef = useRef(pick);
  useEffect(() => { void api<Record<string, unknown>>(path).then((r) => { if (r.ok) setRows(pickRef.current(r.data)); else setError(r.data.error ?? tr("loadFail")); }); }, [path]);
  return { rows, error };
}

function N8nApps() {
  const { me } = useMe();
  const { rows, error } = useLoad("n8n/apps", (d) => d.apps as { id: string; kind: string; name: string; label?: string; description: string }[]);
  if (!rows) return <div className="tgx-muted">{error || tr("loading")}</div>;
  return (<>
    <div className="tgx-muted" style={{ marginBottom: 10 }}>{tr("skN8nHint")}</div>
    {rows.length === 0 && <div className="tgx-muted">{tr("fnN8nEmpty")}</div>}
    {rows.map((a) => {
      const name = a.label ?? a.name;
      return <UseRow key={a.id} name={name} description={a.description} onUse={() => { closePanel(); void startConversation(null, tr("fnN8nHint", { name }), null, me?.homeDir ?? null); }} />;
    })}
  </>);
}


function Installed() {
  const { me } = useMe();
  const { rows, error } = useLoad("skills", (d) => d.skills as { name: string; description: string }[]);
  if (!rows) return <div className="tgx-muted">{error || tr("loading")}</div>;
  return (<>
    <div className="tgx-muted" style={{ marginBottom: 10 }}>{tr("skInstalledNote")}</div>
    {rows.length === 0 && <div className="tgx-muted">{tr("skAvailEmpty")}</div>}
    {rows.map((s) => <UseRow key={s.name} name={s.name} description={s.description} onUse={() => { closePanel(); void startConversation(null, `/skill:${s.name} `, null, me?.homeDir ?? null); }} />)}
  </>);
}
