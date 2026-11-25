#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0 && !(t.slice(0, eq).trim() in process.env)) {
      process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  }
}

loadEnv(path.join(rootDir, ".env.local"));
loadEnv(path.join(rootDir, ".env"));

if (process.env.ALLOW_HEAD_BOOTSTRAP !== "true") {
  console.error("Từ chối chạy: Đặt ALLOW_HEAD_BOOTSTRAP=true chỉ trong phiên bootstrap một lần rồi tắt ngay.");
  process.exit(1);
}

const [, , externalAccountId, username, displayName] = process.argv;
if (!externalAccountId || !username || !displayName) {
  console.error("Cách dùng: ALLOW_HEAD_BOOTSTRAP=true node scripts/bootstrap-head.mjs <externalAccountId> <username> <displayName>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL || "pglite://./.data/pglite";

async function main() {
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const existingHead = await pool.query(
      `SELECT id, username FROM members WHERE role = 'HEAD' AND access_enabled = true AND archived_at IS NULL`,
    );
    if (existingHead.rows[0]) {
      console.error(`Đã tồn tại HEAD hiệu lực (${existingHead.rows[0].username}). Hủy bootstrap.`);
      process.exit(1);
    }

    const inserted = await pool.query(
      `INSERT INTO members (member_code, provider, external_account_id, username, display_name, role, access_enabled, activity_status)
       VALUES ('BBT-001', 'tnth', $1, $2, $3, 'HEAD', true, 'ACTIVE')
       RETURNING id`,
      [externalAccountId, username, displayName],
    );
    const id = inserted.rows[0].id;
    await pool.query(`INSERT INTO member_profiles (member_id, full_name, joined_on) VALUES ($1, $2, CURRENT_DATE)`, [id, displayName]);
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, safe_diff)
       VALUES ($1, 'HEAD_BOOTSTRAPPED', 'MEMBER', $1, $2::jsonb)`,
      [id, JSON.stringify({ externalAccountId, username })],
    );
    console.log(`Đã khởi tạo tài khoản HEAD (${username}, id=${id}). Hãy đặt lại ALLOW_HEAD_BOOTSTRAP=false ngay lập tức.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
