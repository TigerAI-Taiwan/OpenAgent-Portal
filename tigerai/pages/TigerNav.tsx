"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { TG_CSS } from "../ui/kit";
import { useMe } from "../ui/me";

// Members cannot use Models/Skills/Plugins/MCP (the server answers 403), so those entry points are hidden by CSS
// instead of editing the upstream components. Positions: sidebar footer buttons 1-2 (Models, Skills);
// Settings tabs and the phone list keep only "General" (the first entry). Members also never see folder tools:
// the files panel and "open another project" (they work in their own workspace folder, see H24).
const MEMBER_CSS = `
.sidebar-container > div[style*="flex-shrink"][style*="space-between"] > button:nth-child(-n+2){display:none !important}
.settings-section-tabs > .settings-section-tab:nth-child(n+2){display:none !important}
.settings-phone-home > .settings-phone-home-item:nth-child(n+2){display:none !important}
.sidebar-files-panel,.sidebar-files-resize-handle,#session-sidebar-tab-files,[data-row-key="footer-open"],.new-session-context,[data-mobile-toolbar-more],button[aria-controls="file-panel"],#file-panel,.right-panel-resize-handle{display:none !important}
`;

/** Sidebar footer host (hook H11). The visible footer is the sidebar.bottom slot; this keeps the member safety-net CSS
 *  (in case that slot fails and the upstream footer shows). Renders nothing when accounts are off. */
export default function TigerNav() {
  const { status, me } = useMe();
  if (status !== "on" || !me) return null;
  return (
    <>
      <style>{TG_CSS}</style>
      {me.role === "member" && <style>{MEMBER_CSS}</style>}
    </>
  );
}
