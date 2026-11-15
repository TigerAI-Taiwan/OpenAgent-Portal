"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Upstream's own MCP / plugin / skill-install / subagent screens, shown inside OUR modal instead of upstream's second settings
// window. Import only; upstream files are not edited. They take `embedded`, the administrator's own workspace folder as `cwd`
// (never a path typed by the client) and the folder's trust status from the existing project-trust API. Administrators only:
// the server answers 403 to anyone else on every one of their routes, this just does not offer them.
import { Component, useEffect, useState, type ReactNode } from "react";
import { AgentsConfig } from "@/components/AgentsConfig";
import { McpConfig } from "@/components/McpConfig";
import { PluginsConfig } from "@/components/PluginsConfig";
import { SkillsConfig } from "@/components/SkillsConfig";
import type { ProjectTrustStatus } from "@/lib/api-types";
import { tr } from "../pages/i18n";
import type { EmbedId } from "./layout";
import { useMe } from "./me";

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("[tigerai] embedded upstream screen failed:", error); }
  render() { return this.state.failed ? <div className="tgx-err" role="alert" style={{ margin: 16 }}>{tr("embedFailed")}</div> : this.props.children; }
}

export default function EmbeddedUpstream({ id, onClose }: { id: EmbedId; onClose: () => void }) {
  const { me } = useMe();
  const cwd = me?.homeDir ?? null;
  const [trust, setTrust] = useState<ProjectTrustStatus | null>(null);
  useEffect(() => {
    if (!cwd) return;
    const c = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(cwd)}`, { signal: c.signal, cache: "no-store" })
      .then(async (r) => { const d = (await r.json()) as ProjectTrustStatus & { error?: string }; if (r.ok && !d.error) setTrust(d); })
      .catch(() => undefined);
    return () => c.abort();
  }, [cwd]);
  if (!cwd) return <div className="tgx-err" role="alert" style={{ margin: 16 }}>{tr("embedNeedFolder")}</div>;
  return (
    <div data-tg-embed={id} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
      <Boundary>
        {id === "skills" && <SkillsConfig embedded key={cwd} cwd={cwd} trust={trust} onClose={onClose} />}
        {id === "agents" && <AgentsConfig embedded key={cwd} cwd={cwd} sessionId={null} trust={trust} onClose={onClose} />}
        {id === "plugins" && <PluginsConfig embedded key={cwd} cwd={cwd} sessionId={null} trust={trust} onClose={onClose} />}
        {id === "mcp" && <McpConfig embedded key={cwd} cwd={cwd} trust={trust} onClose={onClose} />}
      </Boundary>
    </div>
  );
}
