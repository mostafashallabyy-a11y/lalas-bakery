-- ============================================================
-- Lala's Bakery — 0020: Block sign-ups with leaked passwords (free)
-- Sibling of 0019_leaked_password_check. The Auth hook on this plan
-- supports "Before User Created" only (Password Verification hook is
-- Team/Enterprise) — so this breaks the leaked-password chain at the
-- one door available to Free: signup.
--
-- Signature matches Supabase's "before_user_created" hook contract:
--   event.user.password  (and event.user.email, unused here)
-- ============================================================
begin;

create or replace function public.before_user_created_leaked_password_check(event jsonb)
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
  v_password := event #>> '{user, password}';
  if v_password is null or length(v_password) < 6 then
    return '{}'::jsonb;
  end if;

  v_hash_hex := upper(encode(digest(v_password, 'sha1'), 'hex'));
  v_prefix   := substr(v_hash_hex, 1, 5);
  v_suffix   := substr(v_hash_hex, 6);
  v_url      := 'https://api.pwnedpasswords.com/range/' || v_prefix;

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
      -- fail-open if HIBP unreachable to avoid lockouts on signup;
      -- leaked creds still can't sign in without MFA.
      return '{}'::jsonb;
  end;

  return '{}'::jsonb;
end $fn$;

revoke all on function public.before_user_created_leaked_password_check(jsonb) from public;
revoke all on function public.before_user_created_leaked_password_check(jsonb) from anon, authenticated;

commit;
