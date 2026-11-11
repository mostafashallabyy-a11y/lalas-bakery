-- Turnstile verification must finish before the order transaction can commit.
-- pg_net is asynchronous and starts requests only after commit, so it cannot
-- be used for a synchronous check inside submit_order_v2.
begin;

create schema if not exists extensions;
create extension if not exists http with schema extensions;

create or replace function verify_turnstile(p_token text, p_action text default null)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_secret text;
  v_url text := 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  v_status integer;
  v_content text;
  v_success text;
begin
  select s.value into v_secret
  from settings s
  where s.key = 'turnstile_secret';

  if coalesce(v_secret, '') = '' then
    return true;
  end if;

  if p_token is null or length(btrim(p_token)) = 0 or length(p_token) > 2048 then
    raise exception 'يرجى التحقق أنك مش روبوت قبل الحفظ' using errcode = 'P0001';
  end if;

  select response.status, response.content
  into v_status, v_content
  from extensions.http_post(
    v_url,
    jsonb_build_object('secret', v_secret, 'response', p_token)::text,
    'application/json'
  ) as response;

  if v_status < 200 or v_status >= 300 then
    raise exception 'تعذر التحقق الأمني حاليًا — حاول مرة أخرى' using errcode = 'P0001';
  end if;

  begin
    v_success := v_content::jsonb ->> 'success';
  exception when invalid_text_representation then
    v_success := null;
  end;

  if coalesce(v_success, '') <> 'true' then
    raise exception 'فشل التحقق من روبوت — جرب تاني' using errcode = 'P0001';
  end if;

  return true;
end $fn$;

commit;
