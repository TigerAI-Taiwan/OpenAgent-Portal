// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { ChoiceField, Cond, Field, FormDef, MultiField, Problems, Rule, TextField } from "./types";

/**
 * Checks what a student gave against a form's field map. NOTHING is guessed: an absent value is reported as missing, a value that
 * is not one of the form's own choices is an error, two values that cannot both be true are reported as a contradiction, and a key the form
 * does not have is refused. Only when `missing` and `errors` are both empty may the PDF be drawn (render.ts).
 */

const LETTER_VALUE: Record<string, number> = Object.fromEntries([..."ABCDEFGHJKLMNPQRSTUVXYWZIO"].map((c, i) => [c, 10 + i]));
export function twIdOk(s: string): boolean {
  if (!/^[A-Z][12]\d{8}$/.test(s)) return false;
  const v = LETTER_VALUE[s[0]];
  const digits = [Math.floor(v / 10), v % 10, ...[...s.slice(1)].map(Number)];
  const w = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  return digits.reduce((a, d, i) => a + d * w[i], 0) % 10 === 0;
}
export function parseDate(s: unknown): { y: number; m: number; d: number; ms: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d, ms: dt.getTime() };
}
export function ageOn(birth: { y: number; m: number; d: number }, today: { y: number; m: number; d: number }): number {
  return today.y - birth.y - ((today.m < birth.m || (today.m === birth.m && today.d < birth.d)) ? 1 : 0);
}
export const todayParts = (now = new Date()): { y: number; m: number; d: number; ms: number } => {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TIGERAI_TZ || "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parseDate(iso)!;
};

/** Flatten the allowed keys of a map: "address.city" for a group's sub-field. */
export function allKeys(def: FormDef): Map<string, { field: Field; label: string; group?: string }> {
  const out = new Map<string, { field: Field; label: string; group?: string }>();
  for (const f of def.fields) {
    out.set(f.key, { field: f, label: f.label });
    if (f.type === "group") for (const s of f.fields) out.set(`${f.key}.${s.key}`, { field: s, label: `${f.label}${s.label}`, group: f.key });
  }
  return out;
}

const blank = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
export function get(data: Record<string, unknown>, key: string): unknown {
  let cur: unknown = data;
  for (const part of key.split(".")) { if (cur && typeof cur === "object" && !Array.isArray(cur)) cur = (cur as Record<string, unknown>)[part]; else return undefined; }
  return cur;
}

function cond(c: Cond, data: Record<string, unknown>, age: number | null): boolean {
  const v = c.field === "$age" ? (age ?? undefined) : get(data, c.field);
  if (c.present !== undefined && c.present !== !blank(v)) return false;
  if (c.eq !== undefined && v !== c.eq) return false;
  if (c.ne !== undefined && v === c.ne) return false;
  if (c.includes !== undefined && !(Array.isArray(v) && v.includes(c.includes))) return false;
  if (c.excludes !== undefined && Array.isArray(v) && v.includes(c.excludes)) return false;
  if (c.in && !c.in.includes(v)) return false;
  if (c.notIn && c.notIn.includes(v)) return false;
  const n = typeof v === "number" ? v : NaN;
  if (c.gte !== undefined && !(n >= c.gte)) return false;
  if (c.gt !== undefined && !(n > c.gt)) return false;
  if (c.lte !== undefined && !(n <= c.lte)) return false;
  if (c.lt !== undefined && !(n < c.lt)) return false;
  if (c.matches !== undefined && !(typeof v === "string" && new RegExp(c.matches).test(v))) return false;
  return true;
}
const holds = (c: Cond | Cond[], data: Record<string, unknown>, age: number | null) => (Array.isArray(c) ? c : [c]).every((x) => cond(x, data, age));

/** A copy of the data with the form's own printed defaults applied (a choice with `default` that the student left empty). */
export function withDefaults(def: FormDef, input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const data = { ...(input as Record<string, unknown>) };
  for (const f of def.fields) if (f.type === "choice" && f.default !== undefined && blank(data[f.key])) data[f.key] = f.default;
  return data;
}

export function validate(def: FormDef, input: unknown, today = todayParts()): Problems & { age: number | null } {
  const p: Problems = { missing: [], errors: [], warnings: [], ask: [] };
  const keys = allKeys(def);
  const addMissing = (key: string) => { const k = keys.get(key); if (!p.missing.some((m) => m.key === key)) p.missing.push({ key, label: k?.label ?? key, ...(k?.field.hint ? { hint: k.field.hint } : {}) }); };
  if (!input || typeof input !== "object" || Array.isArray(input)) { p.errors.push("資料必須是 JSON 物件"); return { ...p, age: null }; }
  const data = input as Record<string, unknown>;

  // Keys the form does not have are refused, never ignored: a guess about where they belong would put a value in the wrong box.
  for (const k of Object.keys(data)) {
    if (k.startsWith("_")) continue;
    const f = def.fields.find((x) => x.key === k);
    if (!f) { p.errors.push(`未知欄位 ${k}(表單上沒有這一格,不會猜測)`); continue; }
    if (f.type === "group" && data[k] && typeof data[k] === "object" && !Array.isArray(data[k])) {
      for (const sk of Object.keys(data[k] as object)) if (!f.fields.some((s) => s.key === sk)) p.errors.push(`${k}.${sk} 不是表單上有的欄位`);
    }
  }

  // Per field.
  let birth: ReturnType<typeof parseDate> = null;
  const one = (f: Field, key: string, label: string, v: unknown, optionalInside: boolean) => {
    const empty = blank(v);
    if (empty) {
      if ((f.required || (f.type === "bool" && f.mustBeTrue)) && !optionalInside) addMissing(key);
      else if (f.ask === true && !optionalInside && !p.ask!.some((a) => a.key === key)) p.ask!.push({ key, label, ...(f.hint ? { hint: f.hint } : {}) });
      return;
    }
    switch (f.type) {
      case "text": textCheck(f, key, v); break;
      case "choice": case "multi": optionCheck(f, key, v); break;
      case "bool": if (typeof v !== "boolean") p.errors.push(`${key} 必須是 true 或 false`); else if (f.mustBeTrue && v !== true) addMissing(key); break;
      case "date": {
        const d = parseDate(v);
        if (!d) p.errors.push(`${key} 必須是 YYYY-MM-DD 的西元日期,收到 ${JSON.stringify(v)}`);
        else if (f.notFuture && d.ms > today.ms) p.errors.push(`${key} ${String(v)} 在未來`);
        if (d && key === def.ageFrom) birth = d;
        break;
      }
      case "group":
        if (typeof v !== "object" || Array.isArray(v)) p.errors.push(`${key} 必須是物件`);
        break;
    }
  };
  const textCheck = (f: TextField, key: string, v: unknown) => {
    if (typeof v !== "string" && typeof v !== "number") { p.errors.push(`${key} 必須是文字`); return; }
    const s = String(v);
    if (f.minLength !== undefined && s.length < f.minLength) p.errors.push(`${key} 太短(至少 ${f.minLength} 個字)`);
    if (f.maxLength !== undefined && s.length > f.maxLength) p.errors.push(`${key} 太長(最多 ${f.maxLength} 個字)`);
    if (f.pattern && !new RegExp(f.pattern, "u").test(s)) p.errors.push(`${key} 格式不合${f.patternHint ? `:${f.patternHint}` : ""}:${JSON.stringify(s)}`);
    if (f.validator === "tw-id") {
      if (/^[A-Z][12]\d{8}$/.test(s)) { if (!twIdOk(s)) p.errors.push(`${key} 檢查碼不正確:${s}(請確認是否抄錯)`); }
      else if (/^[A-Z][A-D89]\d{8}$/.test(s)) p.warnings.push(`${key} 看起來是居留證號,僅檢查格式、未驗檢查碼`);
      else p.errors.push(`${key} 格式不合(應為 1 個大寫字母 + 9 位數字):${JSON.stringify(s)}`);
    }
    if (f.splitOn && s.split(f.splitOn).length !== (f.slots?.length ?? 2)) p.errors.push(`${key} 格式應為用「${f.splitOn}」分隔的 ${f.slots?.length ?? 2} 段${f.patternHint ? `(${f.patternHint})` : ""}`);
  };
  const optionCheck = (f: ChoiceField | MultiField, key: string, v: unknown) => {
    const allowed = Object.keys(f.options);
    const vals = f.type === "multi" ? (Array.isArray(v) ? v : null) : [v];
    if (!vals) { p.errors.push(`${key} 必須是清單,可選 ${JSON.stringify(allowed)}`); return; }
    for (const x of vals) if (typeof x !== "string" || !allowed.includes(x)) p.errors.push(`${key} 必須是 ${JSON.stringify(allowed)} 之一,收到 ${JSON.stringify(x)}`);
  };

  for (const f of def.fields) {
    const v = data[f.key];
    if (f.type === "group") {
      one(f, f.key, f.label, v, true);
      const obj = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
      for (const s of f.fields) one(s, `${f.key}.${s.key}`, `${f.label}${s.label}`, obj[s.key], false);
    } else one(f, f.key, f.label, v, false);
  }

  let age: number | null = null;
  if (def.ageFrom && birth) age = ageOn(birth, today);

  // Rules.
  for (const r of def.rules ?? []) applyRule(r, data, age, p, addMissing);
  return { ...p, age };
}

function applyRule(r: Rule, data: Record<string, unknown>, age: number | null, p: Problems, addMissing: (k: string) => void): void {
  switch (r.type) {
    case "requires": if (holds(r.if, data, age)) for (const f of r.fields) if (blank(get(data, f))) addMissing(f); break;
    case "forbids": if (holds(r.if, data, age) && r.fields.some((f) => !blank(get(data, f)))) p.errors.push(r.message); break;
    case "conflict": if (holds(r.when, data, age)) (r.severity === "warning" ? p.warnings : p.errors).push(r.message.replace(/\{age\}/g, String(age ?? "?"))); break;
    case "exactlyOne": {
      // `false` counts as "not given": a tick box left unticked is not a second answer.
      const given = r.fields.filter((f) => get(data, f) !== false && !blank(get(data, f)));
      if (given.length === 0) for (const f of r.fields) addMissing(f);
      else if (given.length > 1) p.errors.push(r.message);
      break;
    }
    case "age-matches": {
      const v = get(data, r.ageField);
      if (age !== null && !blank(v)) {
        if (typeof v !== "number" || !Number.isInteger(v)) p.errors.push(`${r.ageField} 必須是整數`);
        else if (v !== age) p.errors.push(`生日算出來是 ${age} 歲,但 ${r.ageField} 寫 ${v},互相矛盾;請確認哪個正確`);
      }
      break;
    }
  }
}

/** Structural check of a field map at import time, so a broken map is refused when the teacher uploads it, not when a student is waiting. */
export function checkDef(raw: unknown, pageSizes: { width: number; height: number }[]): { ok: true; def: FormDef } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const d = raw as FormDef;
  if (!d || typeof d !== "object" || d.version !== 1 || !Array.isArray(d.fields) || d.fields.length === 0) return { ok: false, errors: ["對照表必須是 {version:1, fields:[…]}"] };
  const seen = new Set<string>();
  const inPage = (what: string, page: number | undefined, x0: number, x1: number, y: number) => {
    const pg = pageSizes[page ?? 0];
    if (!pg) { errors.push(`${what}:沒有第 ${(page ?? 0) + 1} 頁`); return; }
    if (![x0, x1, y].every(Number.isFinite) || x0 < 0 || x1 > pg.width + 1 || y < 0 || y > pg.height + 1 || x1 <= x0 && x0 !== x1) errors.push(`${what}:座標超出頁面`);
  };
  const slot = (what: string, s: { page?: number; x0: number; x1: number; top: number } | undefined) => { if (s) inPage(what, s.page, s.x0, s.x1, s.top); };
  const opts = (what: string, o: Record<string, { label: string; check?: { page?: number; x: number; y: number }; circle?: { page?: number; x0: number; x1: number; y0: number; y1: number } }>) => {
    if (!o || typeof o !== "object" || Object.keys(o).length === 0) { errors.push(`${what}:沒有選項`); return; }
    for (const [k, v] of Object.entries(o)) {
      if (!v || typeof v.label !== "string") errors.push(`${what}.${k}:缺 label`);
      if (v?.check) inPage(`${what}.${k}`, v.check.page, v.check.x, v.check.x + 1, v.check.y);
      if (v?.circle) inPage(`${what}.${k}`, v.circle.page, v.circle.x0, v.circle.x1, v.circle.y1);
      if (!v?.check && !v?.circle) errors.push(`${what}.${k}:沒有 check 也沒有 circle,選了也畫不出來`);
    }
  };
  for (const f of d.fields) {
    if (!f || typeof f.key !== "string" || !/^[a-z][a-z0-9_]{0,40}$/.test(f.key)) { errors.push(`欄位代號不合(小寫英數與底線):${JSON.stringify((f as { key?: unknown })?.key)}`); continue; }
    if (seen.has(f.key)) errors.push(`欄位代號重複:${f.key}`); seen.add(f.key);
    if (typeof f.label !== "string" || !f.label) errors.push(`${f.key}:缺 label`);
    if (f.ask !== undefined && typeof f.ask !== "boolean") errors.push(`${f.key}:ask 必須是 true 或 false`);
    if (f.ask === true && (f.required || (f.type === "bool" && f.mustBeTrue))) errors.push(`${f.key}:ask 是給「建議填、不是必填」的欄位,必填欄位不需要`);
    switch (f.type) {
      case "text":
        if (!f.slot && !f.slots && !f.virtual) errors.push(`${f.key}:沒有 slot,寫不出來(只做檢查不寫入的欄位要設 virtual:true)`);
        slot(f.key, f.slot); f.slots?.forEach((s, i) => slot(`${f.key}.slots[${i}]`, s));
        if (f.pattern) { try { new RegExp(f.pattern, "u"); } catch { errors.push(`${f.key}:pattern 不是正確的正規表示式`); } }
        break;
      case "choice": case "multi": opts(f.key, f.options); if (f.type === "choice" && f.default !== undefined && !f.options[f.default]) errors.push(`${f.key}.default 不是選項之一`); break;
      case "bool": if (!f.check) { /* a consent flag need not be drawn */ } else inPage(f.key, f.check.page, f.check.x, f.check.x + 1, f.check.y); break;
      case "date": if (!f.parts || (!f.parts.year && !f.parts.month && !f.parts.day)) errors.push(`${f.key}:date 要有 parts`); slot(`${f.key}.year`, f.parts?.year); slot(`${f.key}.month`, f.parts?.month); slot(`${f.key}.day`, f.parts?.day); break;
      case "group":
        if (!Array.isArray(f.fields) || f.fields.length === 0) errors.push(`${f.key}:group 沒有子欄位`);
        for (const s of f.fields ?? []) { if (s.type !== "text" || !s.slot) errors.push(`${f.key}.${s.key}:group 的子欄位必須是有 slot 的 text`); else slot(`${f.key}.${s.key}`, s.slot); }
        break;
      default: errors.push(`${(f as { key: string }).key}:未知的欄位型態 ${JSON.stringify((f as { type?: unknown }).type)}`);
    }
  }
  const keys = d.fields.length ? allKeys(d) : new Map();
  const known = (k: string) => k === "$age" || keys.has(k);
  if (d.ageFrom && !keys.has(d.ageFrom)) errors.push(`ageFrom 指向不存在的欄位 ${d.ageFrom}`);
  const eras = d.fields.filter((f): f is Extract<Field, { type: "date" }> => f.type === "date" && !!f.eraField);
  for (const f of eras) if (!keys.has(f.eraField!)) errors.push(`${f.key}.eraField 指向不存在的欄位`);
  for (const [i, r] of (d.rules ?? []).entries()) {
    const refs: string[] = [];
    if (r.type === "requires" || r.type === "forbids") { refs.push(...r.fields); for (const c of Array.isArray(r.if) ? r.if : [r.if]) refs.push(c.field); }
    else if (r.type === "conflict") for (const c of r.when) refs.push(c.field);
    else if (r.type === "exactlyOne") refs.push(...r.fields);
    else if (r.type === "age-matches") refs.push(r.ageField);
    else { errors.push(`rules[${i}]:未知的規則 ${JSON.stringify((r as { type?: unknown }).type)}`); continue; }
    for (const k of refs) if (!known(k)) errors.push(`rules[${i}] 用到不存在的欄位 ${k}`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, def: d };
}
