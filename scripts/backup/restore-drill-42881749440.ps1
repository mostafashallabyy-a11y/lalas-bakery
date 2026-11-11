<#
.SYNOPSIS
  Backup restore drill for db-backup-42881749440 (scratch/staging only).
.DESCRIPTION
  Run on a machine with Docker and PostgreSQL client tools (pg_restore/psql).
  Optionally uses gh to download the GitHub Actions artifact and/or supabase CLI for linked dump.
  NEVER restores into production.
#>

param(
  [ValidateSet("artifact","linked-dump")]
  [string]$Mode = "artifact",
  [string]$RunId = "42881749440",
  [string]$ArtifactName = "db-backup-42881749440",
  [string]$WorkDir = "./restore-drill",
  [string]$ContainerName = "lalas-restore-drill",
  [int]$Port = 54329,
  [string]$DumpPath = "",              # for artifact mode: path to .dump; auto-detected if empty
  [string]$SqlDumpPath = "scripts/local/prod.sql" # for linked-dump mode
)

$ErrorActionPreference = "Stop"

function Require-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $name"
  }
}

Write-Host "== Lala's Bakery restore drill ==" -ForegroundColor Cyan
Write-Host "Mode=$Mode RunId=$RunId Target=scratch (localhost:$Port)"

Require-Cmd docker

# Start scratch Postgres
if (docker ps -a --format '{{.Names}}' | Select-String -SimpleMatch $ContainerName) {
  Write-Host "Removing existing container $ContainerName"
  docker rm -f $ContainerName | Out-Null
}
Write-Host "Starting scratch Postgres container..."
docker run --name $ContainerName -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres -p "$Port`:5432" -d postgres:15 | Out-Null
Start-Sleep -Seconds 3

$conn = "postgresql://postgres:postgres@localhost:$Port/postgres"

if ($Mode -eq "artifact") {
  Require-Cmd pg_restore
  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  if (-not $DumpPath) {
    if (Get-Command gh -ErrorAction SilentlyContinue) {
      Write-Host "Downloading artifact via gh..."
      gh run download $RunId -n $ArtifactName -D $WorkDir
    } else {
      Write-Warning "gh not found. Download artifact '$ArtifactName' (run $RunId) manually into $WorkDir"
    }
    $dump = Get-ChildItem -Path $WorkDir -Filter *.dump -Recurse | Select-Object -First 1
    if (-not $dump) { throw "No .dump file found in $WorkDir. Set -DumpPath explicitly." }
    $DumpPath = $dump.FullName
  }
  Write-Host "Restoring dump: $DumpPath"
  pg_restore --no-owner --no-privileges --dbname=$conn $DumpPath
} else {
  Require-Cmd supabase
  Require-Cmd psql
  Write-Host "Dumping linked database to $SqlDumpPath ..."
  supabase db dump --linked -f $SqlDumpPath
  if (-not (Test-Path $SqlDumpPath)) { throw "Dump file not created: $SqlDumpPath" }
  Write-Host "Replaying into scratch..."
  psql $conn -v ON_ERROR_STOP=1 -f $SqlDumpPath
}

Write-Host "`n== Verification counts ==" -ForegroundColor Cyan
$verifySql = @"
select 'orders' as table_name, count(*)::bigint as row_count from public.orders
union all select 'order_items', count(*)::bigint from public.order_items
union all select 'stock_movements', count(*)::bigint from public.stock_movements
union all select 'order_events', count(*)::bigint from public.order_events
union all select 'products', count(*)::bigint from public.products
union all select 'categories', count(*)::bigint from public.categories
union all select 'branches', count(*)::bigint from public.branches
union all select 'profiles', count(*)::bigint from public.profiles
union all select 'feedback', count(*)::bigint from public.feedback
union all select 'shifts', count(*)::bigint from public.shifts
union all select 'branch_promos', count(*)::bigint from public.branch_promos
union all select 'low_stock_alerts', count(*)::bigint from public.low_stock_alerts
union all select 'social_links', count(*)::bigint from public.social_links
union all select 'settings', count(*)::bigint from public.settings
order by table_name;
"@

if (Get-Command psql -ErrorAction SilentlyContinue) {
  psql $conn -c $verifySql
} else {
  Write-Warning "psql not found; run verification manually against $conn"
  Write-Host $verifySql
}

Write-Host "`nDrill restore complete (scratch). Record counts, then clean up:" -ForegroundColor Yellow
Write-Host "  docker rm -f $ContainerName"
Write-Host "  Remove $WorkDir / dump copies if no longer needed."
