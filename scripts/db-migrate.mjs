#!/usr/bin/env node
import { readdirSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(path.join(rootDir, ".env.local"));
loadEnvFile(path.join(rootDir, ".env"));

const databaseUrl = process.env.DATABASE_URL || "pglite://./.data/pglite";
const migrationsDir = path.join(rootDir, "db", "migrations");
const listOnly = process.argv.includes("--list");

// Ràng buộc an toàn môi trường production
if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
  if (databaseUrl.startsWith("pglite://")) {
    console.error("LỖI: Không thể chạy pglite:// trong production.");
    process.exit(1);
  }
}

async function createRunner() {
  if (databaseUrl.startsWith("pglite://")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const target = databaseUrl.slice("pglite://".length);
    const resolved =
      target === "memory" || target === ":memory:"
        ? undefined
        : path.isAbsolute(target)
          ? target
          : path.resolve(rootDir, target);
    if (resolved) mkdirSync(path.dirname(resolved), { recursive: true });
    const db = resolved ? new PGlite(resolved) : new PGlite();
    await db.waitReady;
    return {
      query: async (sql, params = []) => (await db.query(sql, params)).rows,
      exec: async (sql) => db.exec(sql),
      close: async () => db.close(),
    };
  }

  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: databaseUrl, max: 2 });
  return {
    query: async (sql, params = []) => (await pool.query(sql, params)).rows,
    exec: async (sql) => {
      await pool.query(sql);
    },
    close: async () => pool.end(),
  };
}

async function main() {
  const db = await createRunner();
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    const appliedRows = await db.query("SELECT version, applied_at FROM schema_migrations ORDER BY version");
    const applied = new Set(appliedRows.map((r) => r.version));

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (listOnly) {
      for (const f of files) {
        console.log(`${applied.has(f) ? "[APPLIED]" : "[PENDING]"} ${f}`);
      }
      return;
    }

    let count = 0;
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = readFileSync(path.join(migrationsDir, f), "utf8");
      console.log(`Đang áp dụng migration: ${f}...`);
      await db.exec(sql);
      await db.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", [f]);
      count++;
      console.log(`Hoàn tất: ${f}`);
    }
    if (count === 0) {
      console.log("Tất cả migration đã được áp dụng.");
    } else {
      console.log(`Đã áp dụng thành công ${count} migration.`);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("Lỗi migration:", err);
  process.exit(1);
});
