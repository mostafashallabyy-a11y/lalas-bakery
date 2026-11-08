import pg from "pg";
const c = new pg.Client({
  host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432,
  user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const probe = await c.query("select email from auth.users where email = 'probe-test@x.com'");
console.log("probe-test rows (يجب 0):", probe.rowCount);
const users = await c.query("select email from auth.users order by created_at");
console.log("auth.users:", users.rows.map(r => r.email));
const b = await c.query("select name, left(description, 40) as desc from branches order by sort_order");
console.log(b.rows);
await c.end();
