import pg from "pg";
const c = new pg.Client({
  host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432,
  user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const ids = await c.query("select count(*)::int n from auth.identities");
console.log("identities:", ids.rows[0].n);
const u = await c.query("select id, email, is_sso_user, confirmation_token::text is not null as has_ct, email_confirmed_at from auth.users where email like '%lalas.app'");
console.log(u.rows);
const cols = await c.query(`select column_name, is_nullable, column_default from information_schema.columns
  where table_schema='auth' and table_name='users' and is_nullable='NO' and column_default is null`);
console.log("required non-null cols:", cols.rows.map(r => r.column_name));
const icols = await c.query(`select column_name, is_nullable from information_schema.columns where table_schema='auth' and table_name='identities'`);
console.log("identity cols:", icols.rows.map(r => `${r.column_name}${r.is_nullable === 'NO' ? '*' : ''}`));
await c.end();
