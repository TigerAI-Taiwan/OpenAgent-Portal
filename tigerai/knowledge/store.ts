// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { dataDir } from "../config";
import { ServiceError } from "../accounts/service";
import { writeAudit } from "../accounts/audit";
import { getAgent, type AgentRow } from "../agents/service";
import { buildKnowledgePrompt, estimateTokens, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, planKnowledge, UNKNOWN_WINDOW, type FileInfo, type Plan } from "./budget";

/**
 * The managed knowledge folder of one AI role: <data dir>/knowledge/<role id>/*.md|*.txt. Names are sanitised, only .md/.txt, UTF-8 text only,
 * written atomically, and no path ever leaves the role's folder. Who may call these is decided one layer up (access.ts); the functions here
 * only enforce what a file may be.
 */

export const knowledgeRoot = (): string => join(dataDir(), "knowledge");
const ROLE_ID = /^a[0-9a-f]{12}$/;

export function roleDir(agentId: string): string {
  if (!ROLE_ID.test(agentId)) throw new ServiceError("bad_role", "Not a company AI role", 400);
  return join(knowledgeRoot(), agentId);
}

/** A file name that is safe on disk. Refuses anything that tries to name a place (separators, ..), cleans the rest. */
export function cleanName(raw: string): string {
  let name = raw.normalize("NFC");
  if (/[\\/\0]/.test(name) || name.includes("..")) throw new ServiceError("bad_name", "File name must not contain / \\ or ..");
  name = name.replace(/[\u0000-\u001f\u007f:*?"<>|]/g, "_").trim();
  if (!name || name.startsWith(".")) throw new ServiceError("bad_name", "File name is empty or starts with a dot");
  if (Buffer.byteLength(name) > 120) throw new ServiceError("bad_name", "File name is too long");
  if (!/\.(md|txt)$/i.test(name)) throw new ServiceError("bad_type", "Only .md and .txt files are accepted");
  return name;
}

function fileIn(agentId: string, name: string): string {
  const dir = resolve(roleDir(agentId));
  const p = resolve(dir, cleanName(name));
  if (!p.startsWith(dir + sep)) throw new ServiceError("bad_name", "File name is not allowed"); // belt and braces: cleanName already refuses separators
  return p;
}

/** Strict UTF-8 text: invalid bytes or NUL mean it is not a text file. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new ServiceError("not_text", "This is not a text file (it contains binary data)");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""); } catch { throw new ServiceError("not_text", "The file must be UTF-8 text"); }
}

export interface StoredFile { name: string; bytes: number; mtime: number }

export function listFiles(agentId: string): StoredFile[] {
  const dir = roleDir(agentId);
  if (!existsSync(dir)) return [];
  const out: StoredFile[] = [];
  for (const name of readdirSync(dir)) {
    if (!/\.(md|txt)$/i.test(name)) continue;
    const st = lstatSync(join(dir, name));
    if (st.isFile()) out.push({ name, bytes: st.size, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function readFileText(agentId: string, name: string): string {
  const p = fileIn(agentId, name);
  if (!existsSync(p)) throw new ServiceError("not_found", "No such file", 404);
  return readFileSync(p, "utf8");
}

export function putFile(actorId: string, agentId: string, rawName: string, bytes: Uint8Array): { name: string; replaced: boolean; bytes: number } {
  if (!getAgent(agentId) || !ROLE_ID.test(agentId)) throw new ServiceError("not_found", "No such role", 404);
  if (bytes.length === 0) throw new ServiceError("empty", "The file is empty");
  if (bytes.length > MAX_FILE_BYTES) throw new ServiceError("too_big", `One file may be at most ${MAX_FILE_BYTES / 1024} KB`, 413);
  decodeText(bytes);
  const p = fileIn(agentId, rawName);
  const name = cleanName(rawName);
  const existing = listFiles(agentId);
  const had = existing.find((f) => f.name === name);
  if (!had && existing.length >= MAX_FILES) throw new ServiceError("too_many", `A role may hold at most ${MAX_FILES} files`, 409);
  const total = existing.filter((f) => f.name !== name).reduce((n, f) => n + f.bytes, 0) + bytes.length;
  if (total > MAX_TOTAL_BYTES) throw new ServiceError("too_big_total", `All files of one role may be at most ${MAX_TOTAL_BYTES / 1024 / 1024} MB`, 413);
  mkdirSync(roleDir(agentId), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes, { mode: 0o600 });
  renameSync(tmp, p);
  writeAudit(had ? "knowledge.replace" : "knowledge.add", actorId, { agentId, file: name, bytes: bytes.length });
  return { name, replaced: !!had, bytes: bytes.length };
}

export function deleteFile(actorId: string, agentId: string, rawName: string): void {
  const p = fileIn(agentId, rawName);
  if (!existsSync(p)) throw new ServiceError("not_found", "No such file", 404);
  unlinkSync(p);
  writeAudit("knowledge.delete", actorId, { agentId, file: cleanName(rawName) });
}

/** The context window of the role's model from models.json (what the runtime itself uses); the default model when the role names none. */
export function contextWindowFor(model: { provider: string; modelId: string } | null): { window: number; known: boolean } {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const readJson = (f: string): Record<string, unknown> | null => { try { return JSON.parse(readFileSync(join(agentDir, f), "utf8")) as Record<string, unknown>; } catch { return null; } };
  let target = model;
  if (!target) {
    const s = readJson("settings.json");
    if (s && typeof s.defaultProvider === "string" && typeof s.defaultModel === "string") target = { provider: s.defaultProvider, modelId: s.defaultModel };
  }
  const providers = (readJson("models.json") as { providers?: Record<string, { models?: { id?: string; contextWindow?: number }[] }> } | null)?.providers;
  const hit = target ? providers?.[target.provider]?.models?.find((m) => m.id === target!.modelId) : undefined;
  return hit && typeof hit.contextWindow === "number" && hit.contextWindow > 0 ? { window: hit.contextWindow, known: true } : { window: UNKNOWN_WINDOW, known: false };
}

export interface KnowledgeView { files: (FileInfo & { mode: "inline" | "ondemand"; mtime: number })[]; plan: Plan }

export function viewKnowledge(agent: Pick<AgentRow, "id" | "model">): KnowledgeView {
  const stored = listFiles(agent.id);
  const infos: FileInfo[] = stored.map((f) => ({ name: f.name, bytes: f.bytes, tokens: estimateTokens(safeText(agent.id, f.name)) }));
  const { window, known } = contextWindowFor(agent.model);
  const plan = planKnowledge(infos, window, known);
  return { files: infos.map((f) => ({ ...f, mtime: stored.find((s) => s.name === f.name)!.mtime, mode: plan.inline.includes(f.name) ? "inline" as const : "ondemand" as const })), plan };
}

function safeText(agentId: string, name: string): string { try { return readFileText(agentId, name); } catch { return ""; } }

/** The notes part of the role's prompt ("" when the role has no files). Read at conversation start, so a change reaches new conversations only. */
export function knowledgePromptFor(agent: Pick<AgentRow, "id" | "model">): string {
  if (!ROLE_ID.test(agent.id)) return "";
  const v = viewKnowledge(agent);
  if (!v.files.length) return "";
  return buildKnowledgePrompt(v.plan.inline.map((name) => ({ name, text: safeText(agent.id, name) })), v.plan.onDemand, roleDir(agent.id));
}

/** The folder the AI may read from for this role, when it has files (added to the file fence). */
export function managedRoot(agent: Pick<AgentRow, "id">): string | null {
  return ROLE_ID.test(agent.id) && existsSync(roleDir(agent.id)) && statSync(roleDir(agent.id)).isDirectory() ? roleDir(agent.id) : null;
}
