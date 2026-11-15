"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 設定 › 管理 › 顧問包: shows whether the consultant package is installed and licensed, what it adds, and who to ask. Administrators only.
import { tr } from "../pages/i18n";
import { CONTACT } from "./layout";
import { useAddons } from "./addons";

const WHAT = ["addonWhat1", "addonWhat2", "addonWhat3", "addonWhat4"] as const;

export function AddonPage() {
  const list = useAddons();
  const pkg = list?.[0] ?? null;
  const state = !pkg ? "none" : pkg.active ? "on" : "off";
  return (
    <div data-tg-addon={state} style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 680 }}>
      <p className="tgx-muted" style={{ margin: 0 }}>{tr("addonIntro")}</p>
      <div className="tgx-card" style={{ padding: "12px 16px" }}>
        <strong>{tr("addonStatus")}</strong>
        <div data-tg-addon-status style={{ marginTop: 6 }}>
          {state === "none" && tr("addonNone")}
          {state === "on" && pkg && <>{tr("addonOn", { version: pkg.version })}{pkg.expires ? ` · ${tr("addonExpires", { date: pkg.expires })}` : ""}{pkg.org ? ` · ${pkg.org}` : ""}</>}
          {state === "off" && pkg && <>{tr("addonOff", { version: pkg.version })} · {tr(`addonWhy_${pkg.reason ?? "missing"}` as never) || pkg.reason}</>}
        </div>
      </div>
      <div className="tgx-card" style={{ padding: "12px 16px" }}>
        <strong>{tr("addonWhatTitle")}</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 20, listStyleType: "disc" }}>
          {WHAT.map((k) => <li key={k} style={{ display: "list-item" }}>{tr(k)}</li>)}
        </ul>
      </div>
      <div className="tgx-card" style={{ padding: "12px 16px" }}>
        <strong>{tr("addonContactTitle")}</strong>
        <div style={{ marginTop: 6 }}>{tr("addonContact")}</div>
        {CONTACT.map((c) => <div key={c.id}>{tr(c.labelKey as never)}:{c.href ? <a href={c.href}>{c.value}</a> : c.value}</div>)}
      </div>
    </div>
  );
}
