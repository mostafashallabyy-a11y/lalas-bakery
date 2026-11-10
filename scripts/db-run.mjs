// أداة تنفيذ ملفات SQL على قاعدة Supabase (استخدام واحد للتهيئة)
import fs from "node:fs";
import { Client } from "pg";

const [,, file] = process.argv;
const pass = process.env.DB_PASS;
if (!file) { console.error("usage: node scripts/db-run.mjs <file.sql>"); process.exit(1); }

const client = new Client({
  host: "aws-1-eu-central-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.lnyodqfksuvgmqkamvbp",
  password: pass,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const sql = fs.readFileSync(file, "utf8");
  console.log(`▶ running ${file} (${sql.length} chars)...`);
  const result = await client.query(sql);
  const sets = Array.isArray(result) ? result : [result];
  let printed = 0;
  for (const r of sets) {
    if (!r || !Array.isArray(r.rows)) continue;
    for (const row of r.rows) {
      console.log(JSON.stringify(row));
      printed++;
      if (printed >= 140) {
        console.log("… (output truncated)");
        break;
      }
    }
    if (printed >= 140) break;
  }
  console.log(`✅ done: ${file} — ${printed} row(s) printed`);
} catch (e) {
  console.error(`❌ ${file}: ${e.message}`);
  console.error(e.detail || "");
  process.exitCode = 1;
} finally {
  await client.end();
}
