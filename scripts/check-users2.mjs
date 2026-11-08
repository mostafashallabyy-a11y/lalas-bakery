import pg from "pg";
const c = new pg.Client({
  host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432,
  user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const r = await c.query("select email, role::text as role, is_active, full_name from profiles order by role desc");
console.table(r.rows.map(r => ({ email: r.email, role: r.role, active: r.is_active, name: r.full_name })));
const auth = await c.query("select email from auth.users order by created_at desc");
console.log("auth.users:", auth.rows.map(r => r.email));
await c.end();
