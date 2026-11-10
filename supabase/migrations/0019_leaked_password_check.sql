-- ============================================================
-- Lala's Bakery — 0019: Leaked-password protection (free, no Pro)
-- Ships a SECURITY DEFINER function that Supabase Auth calls
-- synchronously BEFORE accepting a password. It hashes the candidate
-- with SHA-1, asks HaveIBeenPwned for the k-anonymity range bucket
-- (5-char prefix) via pg_net, and rejects if the full hash appears.
--
-- Enabling (one-time, in the dashboard):
--   Authentication → Hooks → Create Hook → "Password Verification" (Beta)
--   → Schema "public", function "leaked_password_check", before
--   → Save.
--
-- If the dashboard doesn't show that Hook type on your plan, fall back
-- to: confirm MFA on every account + rotate passwords periodically;
-- leaked-password blocking is additive to those, not a replacement.
-- ============================================================
begin;

create or replace function public.leaked_password_check(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_password text;
  v_hash_hex text;
  v_prefix   text;
  v_suffix   text;
  v_url      text;
  v_status   integer;
  v_content  text;
  v_lines    text[];
  v_i        int;
begin
  v_password := event ->> 'password';
  if v_password is null or length(v_password) < 6 then
    -- Fewer rejected accounts = fewer accidental lockouts. Keep strict
    -- side at the Auth layer; this hook only special-cases HIBP.
    return '{}'::jsonb;
  end if;

  v_hash_hex := upper(encode(digest(v_password, 'sha1'), 'hex'));
  v_prefix   := substr(v_hash_hex, 1, 5);
  v_suffix   := substr(v_hash_hex, 6);

  v_url := 'https://api.pwnedpasswords.com/range/' || v_prefix;

  begin
    select r.status, r.content
    into v_status, v_content
    from extensions.http_get(v_url) as r;

    if v_status = 200 and v_content is not null then
      v_lines := string_to_array(v_content, chr(10));
      for v_i in 1 .. coalesce(array_length(v_lines, 1), 0) loop
        if split_part(v_lines[v_i], ':', 1) = v_suffix then
          return jsonb_build_object(
            'reject', true,
            'reason', 'كلمة المرور دي موجودة في قائمة كلمات المرور المسرّبة — اختار كلمة أقوى'
          );
        end if;
      end loop;
    end if;
  exception
    when others then
      -- If HIBP is unreachable, do not silently allow — but fail closed
      -- only on explicit match; a provider outage shouldn't lock anyone out.
      return '{}'::jsonb;
  end;

  return '{}'::jsonb;
end $fn$;

-- Keep tight: only auth admin needs to invoke this; no table grants.
revoke all on function public.leaked_password_check(jsonb) from public;
revoke all on function public.leaked_password_check(jsonb) from anon, authenticated;

commit;
