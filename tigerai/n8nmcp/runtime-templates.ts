// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { addonConnectorTemplates } from "../addons/registry";
import { N8N_TEMPLATE, type ConnectorTemplate } from "./templates";

/** Templates usable right now: n8n always, plus whatever an ACTIVE add-on package contributes. A lapsed licence removes them at once. */
export function connectorTemplates(): ConnectorTemplate[] {
  const extra = addonConnectorTemplates().filter((t) => t.id !== N8N_TEMPLATE.id);
  return [N8N_TEMPLATE, ...extra.filter((t, i) => extra.findIndex((x) => x.id === t.id) === i)];
}
export const templateOf = (id: string | null | undefined): ConnectorTemplate | undefined => connectorTemplates().find((t) => t.id === id);
export const isTemplateId = (id: unknown): id is string => typeof id === "string" && connectorTemplates().some((t) => t.id === id);

/** The server name the AI runtime sees. pi turns "-" into "_" inside tool names, so keep to "_" here. */
export function serverKey(template: string, name: string): string {
  return `${templateOf(template)?.prefix ?? template}_${name}`;
}
/** True when an MCP server name belongs to a connector (so every call of it is checked against the person's groups). */
export function isConnectorServer(serverName: string): boolean {
  return connectorTemplates().some((t) => serverName.replace(/-/g, "_").startsWith(`${t.prefix}_`));
}
