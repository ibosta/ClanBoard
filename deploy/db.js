import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.POSTGRES_USER || "hyperush"}:${
    process.env.POSTGRES_PASSWORD || "hyperush"
  }@${process.env.POSTGRES_HOST || "db"}:${process.env.POSTGRES_PORT || 5432}/${
    process.env.POSTGRES_DB || "hyperush"
  }`;

export const pool = new pg.Pool({ connectionString, max: 10 });

export async function query(text, params) {
  return pool.query(text, params);
}

export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const dir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const applied = await pool.query("SELECT 1 FROM _migrations WHERE name = $1", [file]);
    if (applied.rowCount > 0) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    console.log(`[migrate] applying ${file}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations(name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  console.log("[migrate] done");
}
