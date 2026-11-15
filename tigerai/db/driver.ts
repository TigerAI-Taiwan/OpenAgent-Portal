// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft

/**
 * The storage seam. Community code only talks to this shape (the subset of
 * SQL handles that SQLite and a PostgreSQL adapter can both offer). The
 * community edition ships the SQLite driver only; a PostgreSQL driver is an
 * enterprise (.ee) package that calls `registerStoreDriver` at startup.
 * No PostgreSQL code lives in this repository.
 */
export interface SqlStatement {
  run(...args: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}
export interface SqlDb {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}
export interface StoreDriver {
  name: string;
  open(opts: { dataDir: string; schema: string }): SqlDb;
}

let custom: StoreDriver | null = null;

/** Reserved for the enterprise PostgreSQL package. Must be called before the first getDb(). */
export function registerStoreDriver(driver: StoreDriver): void {
  custom = driver;
}
export function registeredStoreDriver(): StoreDriver | null {
  return custom;
}
