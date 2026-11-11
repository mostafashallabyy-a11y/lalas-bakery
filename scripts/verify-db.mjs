// Post-push verification for Lala's Bakery.
//
//   $env:DB_PASS = "your-database-password"   # typed by you, never stored
//   node scripts/verify-db.mjs
//
// Reads the pooler URL from supabase/.temp/pooler-url (created by
// `supabase link`) and prints functions, tables + RLS status, policies,
// storage buckets and the migration history in one readable report.
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const pass = process.env.DB_PASS;
if (!pass) {
  console.error("DB_PASS is not set. Run:  $env:DB_PASS = \"<db password>\"");
  process.exit(1);
}

let connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  const poolerFile = path.join(process.cwd(), "supabase", ".temp", "pooler-url");
  if (!fs.existsSync(poolerFile)) {
    console.error("supabase/.temp/pooler-url not found - run `supabase link` first.");
    process.exit(1);
  }
  const url = new URL(fs.readFileSync(poolerFile, "utf8").trim());
  url.password = pass;
  connectionString = url.toString();
}

const reports = [
  {
    title: "FUNCTIONS in public (name, security, search_path)",
    sql: `
      select n.nspname || '.' || p.proname || '(' ||
             pg_get_function_identity_arguments(p.oid) || ')' as function,
             case when p.prosecdef then 'definer' else 'invoker' end as security,
             coalesce(array_to_string(p.proconfig, ', '), '') as config
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
      order by 1`,
  },
  {
    title: "DUPLICATE FUNCTION NAMES (must be empty - PGRST203 guard)",
    sql: `
      select p.proname, count(*) as overloads,
             string_agg(pg_get_function_identity_arguments(p.oid), ' | ' order by 1) as signatures
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
      group by p.proname
      having count(*) > 1
      order by 1`,
  },
  {
    title: "TABLES / VIEWS in public (RLS enabled + forced + policy count)",
    sql: `
      select c.relname as name,
             case c.relkind when 'r' then 'table' when 'v' then 'view'
                            when 'm' then 'matview' when 'p' then 'partitioned' end as kind,
             c.relrowsecurity as rls_enabled,
             c.relforcerowsecurity as rls_forced,
             (select count(*) from pg_policies pol
               where pol.schemaname = 'public' and pol.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','v','m','p')
      order by 1`,
  },
  {
    title: "RLS GAPS (public tables/views without RLS - must be empty)",
    sql: `
      select c.relname as missing_rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r','v','m','p')
        and not c.relrowsecurity
      order by 1`,
  },
  {
    title: "POLICIES in public",
    sql: `
      select tablename, policyname, cmd, roles::text as roles,
             coalesce(qual, '') as using_expr,
             coalesce(with_check, '') as with_check
      from pg_policies
      where schemaname = 'public'
      order by tablename, policyname`,
  },
  {
    title: "STORAGE BUCKETS (public flag)",
    sql: `
      select id, name, public from storage.buckets order by id`,
  },
  {
    title: "MIGRATION HISTORY (supabase_migrations.schema_migrations)",
    sql: `
      select case
        when to_regclass('supabase_migrations.schema_migrations') is null
          then 'NO HISTORY TABLE - all previous applies were dashboard/manual'
        else coalesce(
          (select string_agg(version, ', ' order by version)
           from supabase_migrations.schema_migrations),
          'EMPTY - all previous applies were dashboard/manual')
      end as applied_versions`,
  },
];

function printTable(rows) {
  if (!rows || rows.length === 0) {
    console.log("  (no rows)");
    return;
  }
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length))
  );
  const line = (cells) =>
    cells.map((v, i) => String(v ?? "").padEnd(widths[i])).join("  ");
  console.log("  " + line(cols));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log("  " + line(cols.map((c) => r[c])));
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  for (const report of reports) {
    const res = await client.query(report.sql);
    console.log("\n=== " + report.title + " ===");
    printTable(res.rows);
  }
  console.log("\nOK - verification report complete");
} catch (e) {
  console.error("verification failed: " + e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
