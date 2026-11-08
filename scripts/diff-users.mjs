import pg from "pg";
const c = new pg.Client({
  host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432,
  user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const cols = await c.query(`select column_name, data_type from information_schema.columns
  where table_schema='auth' and table_name='users' order by ordinal_position`).then(r => r.rows);
const native = await c.query(`select * from auth.users where email='probe-test@x.com'`);
const ours = await c.query(`select * from auth.users where email='manager@lalas.app'`);
const n = native.rows[0], o = ours.rows[0];
for (const col of cols) {
  const k = col.column_name;
  const nv = JSON.stringify(n[k])?.slice(0, 60);
  const ov = JSON.stringify(o[k])?.slice(0, 60);
  if (nv !== ov) console.log(`• ${k} (${col.data_type}): gotrue=${nv} | ours=${ov}`);
}
// وكذا جلسات السشن والهويات
const ni = await c.query(`select provider_id, identity_data::text from auth.identities where user_id=$1`, [n.id]);
const oi = await c.query(`select provider_id, identity_data::text from auth.identities where user_id=$1`, [o.id]);
console.log("native identities:", ni.rows);
console.log("our identities:", oi.rows);
await c.end();
