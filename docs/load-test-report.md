# Load Test Report — Part 1 (staging)

**Date:** 2026-11-10
**Environment:** staging Supabase project `clzdajzsgacivzfenmyq` only (never production)
**Targets:** production site `https://lalas-bakery.pages.dev` / staging API
**k6 version:** installed via winget on the dev machine

## Tests run

| Test | Script | Result |
|---|---|---|
| Smoke | `tests/load/scenarios.js --scenario smoke` | **PASS** — 5 iterations, 50/50 checks |
| Stock concurrency | `tests/load/stock-concurrency.js` | **PASS** — 10 iterations, 9 orders succeeded, 1 rejected, stock 85 → **76** (exactly −9), no overselling |

## What the stock-concurrency test proves

- `submit_order_v2` decrements `products.stock_qty` under a row lock (`select … for update`).
- 10 concurrent order attempts from the same IP: 9 were accepted and committed atomically, the 10th was rejected before any stock was removed.
- `STOCK_FINAL` was reported by the k6 teardown; value ≠ negative, and the sum of accepted orders exactly equals the stock delta (9).
- Root cause of the earlier 100%-rejection runs was **PostgREST PGRST203** (two `submit_order_v2` overloads — the 5-arg canonical from migration 0005 and a broken 6-arg draft applied to staging). Migration `0016_drop_duplicate_submit_order_v2.sql` drops the 6-arg overload; after `0013–0016` were pushed to staging, orders succeed again.

## Findings / follow-ups

1. The observed 9-of-10 acceptance is higher than the 5-orders-per-30-minute rate limit suggests. `rate_ok()` hashes `x-forwarded-for`; behavior should be checked with a single-client burst if deterministic rate limiting matters for launch sizing. Not a correctness issue for overselling protection (locking is independent of rate limiting).
2. The `average`/`stress` profiles in `scenarios.js` exercise `submit_order_v2` at 50 VUs, which by design trips the per-IP rate limit and will fail `http_req_failed < 1%` thresholds. For the launch review, either:
   - run the browse/menu/track paths at 50 VUs and keep checkout covered by the concurrency test only, or
   - temporarily raise the order rate limit **in staging only** (`rate_ok('order', 5, …)`), and revert afterwards.
   Do NOT change the limit in production without a deliberate decision.
3. Staging migrations 0001–0012 were applied manually (SQL Editor) and have now been **baselined** with `supabase migration repair --status applied 0001 … 0012`; 0013–0016 were pushed via CLI and verified with `migration list --remote`. Production still needs its own baseline (0001–0011 only) + push of 0012–0016 — see README / launch checklist.

## Verdict (Part 1, checkout path)

The order-creation path is safe under concurrency on staging. Load characteristics of the read paths at 50 VU can be measured with the scenarios above once the rate-limit question is decided.
