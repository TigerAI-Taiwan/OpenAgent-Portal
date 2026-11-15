// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
/**
 * The field map of a form package (the JSON a teacher uploads beside the blank PDF). Coordinates are PDF points measured from the
 * TOP-left of the page, the way a viewer or PyMuPDF reports word boxes. Nothing here runs code: the map is data, and the engine
 * (validate.ts, render.ts) is the only thing that interprets it.
 */
export interface Slot {
  page?: number;
  /** Left and right edge of the writing area; text is centred (or left aligned) inside and shrunk to fit. */
  x0: number; x1: number;
  /** Baseline, measured from the top of the page. */
  top: number;
  size?: number; minSize?: number; align?: "center" | "left";
}
export interface CheckPos { page?: number; x: number; y: number }
export interface CirclePos { page?: number; x0: number; x1: number; y0: number; y1: number }
export interface Option { label: string; check?: CheckPos; circle?: CirclePos }

interface Base {
  key: string; label: string; hint?: string; required?: boolean;
  /**
   * Recommended but not required (1.1.2-ce). While it is empty the AI has to ASK the person about it, and may only leave it blank when the
   * person said so (fill_form `leave_blank`): a field the form does not insist on used to be skipped without a word (報價有效期限).
   */
  ask?: boolean;
}
export interface TextField extends Base {
  type: "text";
  pattern?: string; patternHint?: string; minLength?: number; maxLength?: number;
  /** Named extra check. "tw-id": Taiwan national ID checksum (a residence-permit number is only format checked and gets a warning). */
  validator?: "tw-id";
  slot?: Slot;
  /** Checked (pattern, required) but not drawn anywhere: e.g. an age the student states, used to catch a wrong birthday. */
  virtual?: boolean;
  /** The value is "area-number" style: split on `splitOn` and written into `slots` in order. */
  splitOn?: string; slots?: Slot[];
  /** Printed unit characters already on the form (e.g. 縣市): one of them at the end of the value is dropped when drawn. */
  stripSuffix?: string;
}
export interface ChoiceField extends Base { type: "choice"; options: Record<string, Option>;
  /** Used when the student gave nothing (a printed default of the form itself, not a guess about the person). */
  default?: string }
export interface MultiField extends Base { type: "multi"; options: Record<string, Option> }
export interface BoolField extends Base { type: "bool"; mustBeTrue?: boolean; check?: CheckPos }
export interface DateField extends Base {
  type: "date";
  /** Key of a choice field whose value "roc" turns the year into a 民國 year (year - 1911). */
  eraField?: string;
  notFuture?: boolean;
  /** Always write the year as a 民國 year (year - 1911), whatever the era field says. */
  rocYear?: boolean;
  parts: { year?: Slot; month?: Slot; day?: Slot };
}
export interface GroupField extends Base { type: "group"; fields: TextField[] }
export type Field = TextField | ChoiceField | MultiField | BoolField | DateField | GroupField;

export interface Cond { field: string; eq?: unknown; ne?: unknown; in?: unknown[]; notIn?: unknown[]; present?: boolean; includes?: unknown; excludes?: unknown; gte?: number; gt?: number; lte?: number; lt?: number; matches?: string }
export type Rule =
  | { type: "requires"; if: Cond | Cond[]; fields: string[] }
  | { type: "forbids"; if: Cond | Cond[]; fields: string[]; message: string }
  | { type: "conflict"; when: Cond[]; message: string; severity?: "error" | "warning" }
  | { type: "exactlyOne"; fields: string[]; message: string }
  | { type: "age-matches"; ageField: string };

export interface FormDef {
  version: 1;
  /** Key of the date field whose age the pseudo-field `$age` reads in conditions. */
  ageFrom?: string;
  fields: Field[];
  rules?: Rule[];
  /** What the AI must tell the student, e.g. that the signature stays blank. Shown in list_forms and after filling. */
  leftBlank?: string[];
  notes?: string[];
}

export interface Problems { missing: { key: string; label: string; hint?: string }[]; errors: string[]; warnings: string[]; /** empty `ask` fields (not required): to be asked about, not an error */ ask?: { key: string; label: string; hint?: string }[] }
