import { mkdirSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { PGlite } from "@electric-sql/pglite";
import { getConfig } from "@/server/config";

export interface DbClient {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number }>;
}

interface GlobalDbState {
  pgPool?: Pool;
  pglite?: PGlite;
  pgliteUrl?: string;
  pgliteReady?: Promise<PGlite>;
  pgliteTxLock?: Promise<void>;
}

const g = globalThis as unknown as { __tnthWorkDb?: GlobalDbState };
if (!g.__tnthWorkDb) g.__tnthWorkDb = {};
const state = g.__tnthWorkDb;

function isPgliteUrl(url: string): boolean {
  return url.startsWith("pglite://");
}

async function getPglite(url: string): Promise<PGlite> {
  if (state.pglite && state.pgliteUrl === url) return state.pglite;
  if (state.pgliteReady && state.pgliteUrl === url) return state.pgliteReady;

  state.pgliteUrl = url;
  state.pgliteReady = (async () => {
    const { PGlite: PGliteCtor } = await import("@electric-sql/pglite");
    const target = url.slice("pglite://".length);
    let instance: PGlite;
    if (target === "memory" || target === ":memory:" || target === "") {
      instance = new PGliteCtor();
    } else {
      const resolved = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
      mkdirSync(path.dirname(resolved), { recursive: true });
      instance = new PGliteCtor(resolved);
    }
    await instance.waitReady;
    state.pglite = instance;
    return instance;
  })();
  return state.pgliteReady;
}

function getPgPool(url: string, max: number): Pool {
  if (!state.pgPool) {
    state.pgPool = new Pool({
      connectionString: url,
      max,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return state.pgPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const cfg = getConfig();
  if (isPgliteUrl(cfg.databaseUrl)) {
    const db = await getPglite(cfg.databaseUrl);
    const res = await db.query<T>(sql, params);
    return res.rows;
  }
  const pool = getPgPool(cfg.databaseUrl, cfg.dbPoolMax);
  const res = await pool.query<T>(sql, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execSql(sql: string): Promise<void> {
  const cfg = getConfig();
  if (isPgliteUrl(cfg.databaseUrl)) {
    const db = await getPglite(cfg.databaseUrl);
    await db.exec(sql);
    return;
  }
  const pool = getPgPool(cfg.databaseUrl, cfg.dbPoolMax);
  await pool.query(sql);
}

/** Chạy transaction nguyên tử. PGlite được tuần tự hóa transaction qua queue lock nội bộ. */
export async function withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const cfg = getConfig();
  if (isPgliteUrl(cfg.databaseUrl)) {
    const db = await getPglite(cfg.databaseUrl);
    const prev = state.pgliteTxLock ?? Promise.resolve();
    let release!: () => void;
    state.pgliteTxLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await db.transaction(async (tx) => {
        const wrapper: DbClient = {
          async query<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
            const r = await tx.query<R>(sql, params);
            return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
          },
        };
        return await fn(wrapper);
      });
    } finally {
      release();
    }
  }

  const pool = getPgPool(cfg.databaseUrl, cfg.dbPoolMax);
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const wrapper: DbClient = {
      async query<R extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
        const r = await client.query<R>(sql, params);
        return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
      },
    };
    const result = await fn(wrapper);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDbReady(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await query("SELECT 1 AS ok");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "DB_UNAVAILABLE",
    };
  }
}

/** Dùng trong test để đóng/reset kết nối PGlite in-memory giữa các suite */
export async function resetDbForTests(): Promise<void> {
  if (state.pglite) {
    await state.pglite.close().catch(() => {});
    state.pglite = undefined;
    state.pgliteReady = undefined;
    state.pgliteUrl = undefined;
  }
  if (state.pgPool) {
    await state.pgPool.end().catch(() => {});
    state.pgPool = undefined;
  }
}
