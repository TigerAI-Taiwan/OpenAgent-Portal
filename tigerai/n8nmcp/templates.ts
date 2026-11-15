// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
/**
 * 系統連接 (connectors) of the community edition: the community edition opens MCP for n8n ONLY, as the MCP demonstration.
 * Other systems (Gitea, Zabbix, custom MCP servers, ...) are templates a consultant add-on contributes through
 * `AddonModule.connectorTemplates`; they only exist while that add-on is licensed (tigerai/addons/registry.ts).
 * No imports from React or the database, so the admin form in the browser, the API and the tests read this one file's data.
 */

/** The wording the Founder fixed for every place the community edition shows or refuses another MCP system. */
export const CE_MCP_NOTICE = "社群版只開放 n8n 的 MCP，當作 MCP 示範；其他系統的 MCP 請洽顧問或虎智科技（tiger.ai.tw@gmail.com）。";

export interface ConnectorTemplate {
  id: string;
  /** Prefix of the MCP server name inside the AI's tool names: mcp__<prefix>_<name>__<tool>. */
  prefix: string;
  label: string;
  description: string;
  nameHint: string;
  urlHint: string;
  tokenLabel: string;
  /** Tools switched on at creation. Read tools only (see N8N_READ_TOOLS). */
  defaultAllow: string[];
  /** One line telling the administrator which groups usually get it. */
  suggestedGroups: string;
}

/**
 * Tools of n8n's instance-level MCP server that only read. Everything else an n8n server offers (create, update, publish,
 * execute, ...) is treated as a WRITE (audited with write:true; no approval since 1.1.0-ce, grants.ts).
 * The list is deliberately closed: a tool that is not on it is a write, so a tool a newer n8n adds can never slip through as a read.
 * Names taken from a live n8n 2.44.6 `tools/list` (every tool there carries readOnlyHint). list_credentials and the agent tools also say
 * readOnly but are left off on purpose: they reveal credential names / run other AI agents, which is not what a course demo needs.
 */
export const N8N_READ_TOOLS = [
  "search_workflows", "get_workflow_details", "get_workflow_execution", "search_workflow_executions", "get_workflow_history", "get_workflow_version",
  "get_workflow_versions_diff", "list_workflow_tags", "search_projects", "search_data_tables", "get_data_table_rows", "search_nodes", "get_node_types",
  "get_workflow_best_practices", "get_workflow_sdk_reference", "validate_workflow", "validate_node_config", "prepare_workflow_pin_data",
];
/** Reads plus the tools a person needs to build, try, and switch on (publish_workflow = n8n's "activate") or off their own workflow; the ownership rule keeps them to workflows they made. Since 1.1.0-ce writes need no approval (publishing for others does). */
export const DEFAULT_MCP_ALLOW = ["search_workflows", "get_workflow_details", "get_workflow_execution", "search_workflow_executions", "create_workflow_from_code", "update_workflow", "execute_workflow", "publish_workflow", "unpublish_workflow"];

export const N8N_TEMPLATE: ConnectorTemplate = {
  id: "n8n", prefix: "n8n", label: "n8n",
  description: "讓 AI 搜尋、查看、建立、修改、試跑 n8n 流程,不需要核准(每次呼叫都會記稽核)。要把流程「上架」給別人用,才需要管理員審查。",
  nameHint: "n8n", urlHint: "https://<n8n 網址>/mcp-server/http", tokenLabel: "n8n MCP 存取權杖", defaultAllow: DEFAULT_MCP_ALLOW,
  suggestedGroups: "要用 n8n 流程的部門",
};

/** Name pattern of a tool that probably writes: only labels a tool list in the admin form. The runtime fence is N8N_READ_TOOLS + the allow list. */
export const LOOKS_LIKE_WRITE = /(^|_)(write|create|update|delete|publish|unpublish|archive|acknowledge|unacknowledge|close|suppress|unsuppress|annotate|change|restore|mutate|execute|add|remove|merge|push|activate|deactivate|run|import)(_|$)/i;

/** For n8n tools: true when the tool name is not a known read tool. Fail closed. */
export const isN8nWriteTool = (tool: string): boolean => !N8N_READ_TOOLS.includes(tool);
