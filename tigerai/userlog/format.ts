// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// No imports: the page and the test both load this directly.

/** 「剛剛」「3 分鐘前」「2 小時前」, then 「昨天 14:05」 and 「11/12 14:05」 (the year only when it is not this year). */
export function relativeZh(ms: number | null, now = Date.now()): string {
  if (ms === null) return "從未上線";
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return "剛剛";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  const d = new Date(ms), t = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameDay = d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  if (sameDay) return `${Math.floor(diff / 3_600_000)} 小時前`;
  const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
  if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return `昨天 ${hm}`;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear() === t.getFullYear() ? "" : `${d.getFullYear()}/`}${md} ${hm}`;
}

/** 「1 小時 5 分」 / 「12 分」 / 「0 分」: time spent, from a number of milliseconds. */
export function stayZh(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} 分`;
  const h = Math.floor(min / 60); const m = min % 60;
  return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
}
