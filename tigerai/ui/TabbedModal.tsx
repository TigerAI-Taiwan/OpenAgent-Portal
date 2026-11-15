"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// The one tabs-left / content-right modal shape (tabs stack on a phone) shared by 設定 and 技能. Tabs come from layout.ts;
// `group: "admin"` ones sit under the 管理 heading. Uses the shared Modal, so no back button.
import type { ReactNode } from "react";
import { tr, type Key } from "../pages/i18n";
import { Icon, Modal } from "./kit";
import type { Item } from "./layout";

const CSS = `
.tgs-body{flex:1;display:flex;min-height:0;height:100%}
.tgs-tabs{width:240px;flex:none;border-right:1px solid var(--border);background:var(--bg-panel);overflow:auto;padding:8px;display:flex;flex-direction:column;gap:2px}
.tgs-tabs .grp{padding:10px 10px 4px;font-size:11px;color:var(--text-dim)}
.tgs-main{flex:1;min-width:0;overflow:auto;padding:18px 20px}
.tgs-main.flush{padding:0;display:flex;flex-direction:column;overflow:hidden}
.tgs-col{width:100%;max-width:var(--chat-content-max-width,820px);margin:0 auto}
.tgs-col .tgx-card,.tgs-col .tg-card{max-width:none;width:100%;box-sizing:border-box}
.tgs-main h2{margin:0 0 14px;font-size:18px}
@media (max-width:760px){
  .tgs-body{flex-direction:column}
  .tgs-tabs{width:auto;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;border-right:0;border-bottom:1px solid var(--border);padding:6px}
  .tgs-tabs .grp{display:none}
  .tgs-tabs .tgx-row{width:auto;white-space:nowrap;flex:none}
  .tgs-main{padding:12px}
  .tgs-main.flush{padding:0}
}
`;

export function TabbedModal({ title, tabs, current, onPick, onClose, disabled = false, dismissible = true, flush = false, heading = true, children }: {
  title: string; tabs: Item[]; current: string; onPick: (id: string) => void; onClose: () => void; disabled?: boolean; dismissible?: boolean;
  /** `flush`: the content fills the pane edge to edge (an embedded upstream screen brings its own padding). */
  flush?: boolean; heading?: boolean; children: ReactNode;
}) {
  const row = (t: Item) => (
    <button key={t.id} type="button" className="tgx-row" aria-current={current === t.id} disabled={disabled} onClick={() => onPick(t.id)}>
      <Icon name={t.icon} size={15} /><span className="name">{tr(t.labelKey as Key)}</span>
    </button>
  );
  const cur = tabs.find((t) => t.id === current) ?? tabs[0];
  return (
    <Modal title={title} size="lg" dismissible={dismissible} onClose={onClose}>
      <style>{CSS}</style>
      <div className="tgs-body">
        <nav className="tgs-tabs" aria-label={title}>
          {tabs.filter((t) => !t.group).map(row)}
          {tabs.some((t) => t.group === "admin") && <div className="grp">{tr("tabAdmin")}</div>}
          {tabs.filter((t) => t.group === "admin").map(row)}
        </nav>
        <main className={`tgs-main${flush ? " flush" : ""}`}>
          {flush ? children : (
            <div className="tgs-col">
              {heading && cur && <h2>{tr(cur.labelKey as Key)}</h2>}
              {children}
            </div>)}
        </main>
      </div>
    </Modal>
  );
}
