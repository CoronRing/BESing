-- BESing Browser Sync - Self-Hosted Supabase Schema
--
-- Run this SQL once in your Supabase project's SQL Editor, then register your
-- personal sync space hash (generated inside BESing > Browser Sync > Setup):
--
--   insert into public.besing_sync_spaces (space_hash, label, retention_days)
--   values ('<64-hex-sha256-of-your-secret>', 'personal', 7)
--   on conflict (space_hash) do nothing;
--
-- Security model:
--   * All tables have Row Level Security (RLS) enabled with zero policies and
--     no direct privileges for `anon` or `authenticated`.
--   * Browser clients only call the four SECURITY DEFINER RPC functions using
--     the project's publishable/anon key + a high-entropy random secret.
--   * Only pre-registered space hashes in `besing_sync_spaces` are accepted.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.besing_sync_spaces (
    space_hash       text primary key check (space_hash ~ '^[0-9a-f]{64}$'),
    label            text not null default 'default',
    max_devices      integer not null default 12 check (max_devices between 1 and 50),
    retention_days   integer not null default 7 check (retention_days between 1 and 90),
    created_at       timestamptz not null default now(),
    last_activity_at timestamptz not null default now(),
    last_prune_at    timestamptz
);

create table if not exists public.besing_sync_devices (
    space_hash    text not null references public.besing_sync_spaces(space_hash) on delete cascade,
    instance_id   text not null check (char_length(instance_id) between 4 and 80),
    device_name   text not null default 'Device' check (char_length(device_name) <= 80),
    browser       text not null default 'unknown' check (char_length(browser) <= 32),
    platform      text not null default 'unknown' check (char_length(platform) <= 32),
    mode          text not null default 'userscript' check (mode in ('extension', 'userscript')),
    account_label text not null default '' check (char_length(account_label) <= 120),
    tabs_json     jsonb not null default '[]'::jsonb,
    groups_json   jsonb not null default '[]'::jsonb,
    closed_json   jsonb not null default '[]'::jsonb,
    snapshot_hash text not null default '' check (char_length(snapshot_hash) <= 64),
    updated_at    timestamptz not null default now(),
    primary key (space_hash, instance_id)
);

create table if not exists public.besing_sync_history (
    id             bigserial primary key,
    space_hash     text not null references public.besing_sync_spaces(space_hash) on delete cascade,
    instance_id    text not null,
    device_name    text not null,
    browser        text not null,
    url            text not null check (char_length(url) <= 500),
    url_hash       text not null,
    host           text not null check (char_length(host) <= 160),
    title          text not null default '' check (char_length(title) <= 200),
    visited_at     timestamptz not null,
    visited_bucket bigint not null,
    visit_count    integer not null default 1 check (visit_count >= 1),
    synced_at      timestamptz not null default now(),
    unique (space_hash, instance_id, url_hash, visited_bucket)
);

create index if not exists idx_besing_sync_history_space_visited
    on public.besing_sync_history (space_hash, visited_at desc);

create index if not exists idx_besing_sync_history_space_synced
    on public.besing_sync_history (space_hash, synced_at desc);

create table if not exists public.besing_sync_usage (
    space_hash     text not null references public.besing_sync_spaces(space_hash) on delete cascade,
    instance_id    text not null,
    day            date not null,
    host           text not null check (char_length(host) <= 160),
    active_seconds integer not null default 0 check (active_seconds between 0 and 86400),
    visits         integer not null default 0 check (visits >= 0),
    updated_at     timestamptz not null default now(),
    primary key (space_hash, instance_id, day, host)
);

create index if not exists idx_besing_sync_usage_space_updated
    on public.besing_sync_usage (space_hash, updated_at desc);

alter table public.besing_sync_spaces  enable row level security;
alter table public.besing_sync_devices enable row level security;
alter table public.besing_sync_history enable row level security;
alter table public.besing_sync_usage   enable row level security;

revoke all on table public.besing_sync_spaces  from public, anon, authenticated;
revoke all on table public.besing_sync_devices from public, anon, authenticated;
revoke all on table public.besing_sync_history from public, anon, authenticated;
revoke all on table public.besing_sync_usage   from public, anon, authenticated;
revoke all on sequence public.besing_sync_history_id_seq from public, anon, authenticated;

create or replace function public._besing_sync_auth(p_secret text)
returns public.besing_sync_spaces
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_hash  text;
    v_space public.besing_sync_spaces;
begin
    if p_secret is null or char_length(p_secret) < 16 or char_length(p_secret) > 256 then
        raise exception 'unauthorized' using errcode = '42501';
    end if;

    v_hash := encode(extensions.digest(convert_to(p_secret, 'utf8'), 'sha256'), 'hex');

    select * into v_space
    from public.besing_sync_spaces
    where space_hash = v_hash;

    if not found then
        raise exception 'unauthorized' using errcode = '42501';
    end if;

    return v_space;
end;
$$;

revoke all on function public._besing_sync_auth(text) from public, anon, authenticated;

create or replace function public._besing_clean_url(p_url text)
returns text
language plpgsql
immutable
as $$
declare
    v_url text;
begin
    if p_url is null then
        return null;
    end if;
    v_url := left(btrim(p_url), 500);
    if v_url !~* '^https?://[^[:space:]]+' then
        return null;
    end if;
    return v_url;
end;
$$;

revoke all on function public._besing_clean_url(text) from public, anon, authenticated;

create or replace function public.besing_sync_push(
    p_secret  text,
    p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space         public.besing_sync_spaces;
    v_now           timestamptz := now();
    v_instance_id   text;
    v_device_name   text;
    v_browser       text;
    v_platform      text;
    v_mode          text;
    v_account_label text;
    v_device_exists boolean;
    v_device_count  integer;
    v_tabs          jsonb;
    v_groups        jsonb;
    v_closed        jsonb;
    v_snapshot_hash text;
    v_has_snapshot  boolean := false;
    v_hist_item     jsonb;
    v_url           text;
    v_host          text;
    v_title         text;
    v_visited_at    timestamptz;
    v_bucket        bigint;
    v_hist_count    integer := 0;
    v_usage_item    jsonb;
    v_day           date;
    v_seconds       integer;
    v_visits        integer;
    v_usage_count   integer := 0;
    v_pruned_hist   integer := 0;
    v_pruned_usage  integer := 0;
begin
    v_space := public._besing_sync_auth(p_secret);

    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'invalid payload' using errcode = '22023';
    end if;

    if octet_length(p_payload::text) > 262144 then
        raise exception 'payload too large' using errcode = '22023';
    end if;

    v_instance_id := left(btrim(coalesce(p_payload ->> 'instance_id', '')), 80);
    if char_length(v_instance_id) < 4 then
        raise exception 'invalid instance_id' using errcode = '22023';
    end if;

    v_device_name   := left(coalesce(nullif(btrim(p_payload ->> 'device_name'), ''), 'Device'), 80);
    v_browser       := left(lower(coalesce(nullif(btrim(p_payload ->> 'browser'), ''), 'unknown')), 32);
    v_platform      := left(lower(coalesce(nullif(btrim(p_payload ->> 'platform'), ''), 'unknown')), 32);
    v_mode          := case when (p_payload ->> 'mode') = 'extension' then 'extension' else 'userscript' end;
    v_account_label := left(btrim(coalesce(p_payload ->> 'account_label', '')), 120);

    select exists(
        select 1 from public.besing_sync_devices
        where space_hash = v_space.space_hash and instance_id = v_instance_id
    ) into v_device_exists;

    if not v_device_exists then
        select count(*) into v_device_count
        from public.besing_sync_devices
        where space_hash = v_space.space_hash;

        if v_device_count >= v_space.max_devices then
            raise exception 'device limit reached' using errcode = '54000';
        end if;
    end if;

    if p_payload ? 'tabs' or p_payload ? 'groups' or p_payload ? 'closed' then
        v_has_snapshot := true;

        if p_payload ? 'tabs' and jsonb_typeof(p_payload -> 'tabs') = 'array' then
            select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_tabs
            from (
                select jsonb_build_object(
                    'id', left(coalesce(t ->> 'id', ''), 64),
                    'url', public._besing_clean_url(t ->> 'url'),
                    'title', left(coalesce(t ->> 'title', ''), 200),
                    'groupId', coalesce(t ->> 'groupId', ''),
                    'windowId', coalesce(t ->> 'windowId', ''),
                    'active', coalesce((t ->> 'active')::boolean, false),
                    'pinned', coalesce((t ->> 'pinned')::boolean, false),
                    'lastActiveAt', coalesce(t ->> 'lastActiveAt', '')
                ) as elem
                from jsonb_array_elements(p_payload -> 'tabs') with ordinality as arr(t, ord)
                where ord <= 200
                  and public._besing_clean_url(t ->> 'url') is not null
            ) sub;
        end if;

        if p_payload ? 'groups' and jsonb_typeof(p_payload -> 'groups') = 'array' then
            select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_groups
            from (
                select jsonb_build_object(
                    'id', left(coalesce(g ->> 'id', ''), 64),
                    'windowId', left(coalesce(g ->> 'windowId', ''), 64),
                    'title', left(coalesce(g ->> 'title', ''), 120),
                    'color', left(coalesce(g ->> 'color', 'grey'), 24),
                    'collapsed', coalesce((g ->> 'collapsed')::boolean, false)
                ) as elem
                from jsonb_array_elements(p_payload -> 'groups') with ordinality as arr(g, ord)
                where ord <= 50
            ) sub;
        end if;

        if p_payload ? 'closed' and jsonb_typeof(p_payload -> 'closed') = 'array' then
            select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_closed
            from (
                select jsonb_build_object(
                    'url', public._besing_clean_url(c ->> 'url'),
                    'title', left(coalesce(c ->> 'title', ''), 200),
                    'closedAt', left(coalesce(c ->> 'closedAt', ''), 40)
                ) as elem
                from jsonb_array_elements(p_payload -> 'closed') with ordinality as arr(c, ord)
                where ord <= 50
                  and public._besing_clean_url(c ->> 'url') is not null
            ) sub;
        end if;
    end if;

    if not v_device_exists then
        v_tabs   := coalesce(v_tabs, '[]'::jsonb);
        v_groups := coalesce(v_groups, '[]'::jsonb);
        v_closed := coalesce(v_closed, '[]'::jsonb);
        v_snapshot_hash := encode(extensions.digest(
            convert_to(v_device_name || '|' || v_browser || '|' || v_account_label || '|' || v_tabs::text || '|' || v_groups::text || '|' || v_closed::text, 'utf8'),
            'sha256'
        ), 'hex');

        insert into public.besing_sync_devices (
            space_hash, instance_id, device_name, browser, platform, mode, account_label,
            tabs_json, groups_json, closed_json, snapshot_hash, updated_at
        ) values (
            v_space.space_hash, v_instance_id, v_device_name, v_browser, v_platform, v_mode, v_account_label,
            v_tabs, v_groups, v_closed, v_snapshot_hash, v_now
        );
    elsif v_has_snapshot then
        update public.besing_sync_devices d
        set device_name   = v_device_name,
            browser       = v_browser,
            platform      = v_platform,
            mode          = v_mode,
            account_label = v_account_label,
            tabs_json     = coalesce(v_tabs, d.tabs_json),
            groups_json   = coalesce(v_groups, d.groups_json),
            closed_json   = coalesce(v_closed, d.closed_json),
            snapshot_hash = encode(extensions.digest(
                convert_to(
                    v_device_name || '|' || v_browser || '|' || v_account_label || '|' ||
                    coalesce(v_tabs, d.tabs_json)::text || '|' ||
                    coalesce(v_groups, d.groups_json)::text || '|' ||
                    coalesce(v_closed, d.closed_json)::text,
                    'utf8'
                ),
                'sha256'
            ), 'hex'),
            updated_at    = v_now
        where d.space_hash = v_space.space_hash and d.instance_id = v_instance_id;
    else
        update public.besing_sync_devices d
        set device_name   = v_device_name,
            browser       = v_browser,
            platform      = v_platform,
            mode          = v_mode,
            account_label = v_account_label,
            updated_at    = v_now
        where d.space_hash = v_space.space_hash and d.instance_id = v_instance_id;
    end if;

    if p_payload ? 'history' and jsonb_typeof(p_payload -> 'history') = 'array' then
        for v_hist_item in
            select elem
            from jsonb_array_elements(p_payload -> 'history') with ordinality as arr(elem, ord)
            where ord <= 100
        loop
            v_url := public._besing_clean_url(v_hist_item ->> 'url');
            if v_url is null then
                continue;
            end if;

            v_host := left(lower(coalesce(nullif(btrim(v_hist_item ->> 'host'), ''), '')), 160);
            if v_host = '' then
                v_host := left(lower(coalesce((regexp_match(v_url, '^https?://([^/:?#]+)'))[1], 'unknown')), 160);
            end if;
            v_title := left(coalesce(v_hist_item ->> 'title', ''), 200);

            begin
                v_visited_at := coalesce((v_hist_item ->> 'visitedAt')::timestamptz, v_now);
            exception when others then
                v_visited_at := v_now;
            end;

            if v_visited_at < v_now - make_interval(days => v_space.retention_days)
               or v_visited_at > v_now + interval '10 minutes' then
                continue;
            end if;
            if v_visited_at > v_now then
                v_visited_at := v_now;
            end if;

            v_bucket := floor(extract(epoch from v_visited_at) / 300)::bigint;

            insert into public.besing_sync_history (
                space_hash, instance_id, device_name, browser, url, url_hash,
                host, title, visited_at, visited_bucket, visit_count, synced_at
            ) values (
                v_space.space_hash, v_instance_id, v_device_name, v_browser, v_url,
                encode(extensions.digest(convert_to(v_url, 'utf8'), 'sha256'), 'hex'),
                v_host, v_title, v_visited_at, v_bucket, 1, v_now
            )
            on conflict (space_hash, instance_id, url_hash, visited_bucket) do update
            set visited_at  = greatest(public.besing_sync_history.visited_at, excluded.visited_at),
                title       = case when excluded.title <> '' then excluded.title else public.besing_sync_history.title end,
                device_name = excluded.device_name,
                visit_count = least(public.besing_sync_history.visit_count + 1, 999),
                synced_at   = v_now;

            v_hist_count := v_hist_count + 1;
        end loop;
    end if;

    if p_payload ? 'usage' and jsonb_typeof(p_payload -> 'usage') = 'array' then
        for v_usage_item in
            select elem
            from jsonb_array_elements(p_payload -> 'usage') with ordinality as arr(elem, ord)
            where ord <= 100
        loop
            v_host := left(lower(btrim(coalesce(v_usage_item ->> 'host', ''))), 160);
            if v_host = '' or v_host ~ '[[:space:]]' then
                continue;
            end if;

            begin
                v_day := coalesce((v_usage_item ->> 'day')::date, current_date);
            exception when others then
                v_day := current_date;
            end;

            if v_day < (current_date - v_space.retention_days) or v_day > (current_date + 1) then
                continue;
            end if;

            begin
                v_seconds := greatest(0, least(3600, coalesce((v_usage_item ->> 'seconds')::integer, 0)));
                v_visits  := greatest(0, least(200, coalesce((v_usage_item ->> 'visits')::integer, 0)));
            exception when others then
                continue;
            end;

            if v_seconds = 0 and v_visits = 0 then
                continue;
            end if;

            insert into public.besing_sync_usage (
                space_hash, instance_id, day, host, active_seconds, visits, updated_at
            ) values (
                v_space.space_hash, v_instance_id, v_day, v_host, v_seconds, v_visits, v_now
            )
            on conflict (space_hash, instance_id, day, host) do update
            set active_seconds = least(86400, public.besing_sync_usage.active_seconds + excluded.active_seconds),
                visits         = least(100000, public.besing_sync_usage.visits + excluded.visits),
                updated_at     = v_now;

            v_usage_count := v_usage_count + 1;
        end loop;
    end if;

    if v_space.last_prune_at is null or v_space.last_prune_at < v_now - interval '1 hour' then
        delete from public.besing_sync_history
        where space_hash = v_space.space_hash
          and visited_at < v_now - make_interval(days => v_space.retention_days);
        get diagnostics v_pruned_hist = row_count;

        delete from public.besing_sync_usage
        where space_hash = v_space.space_hash
          and day < (current_date - v_space.retention_days);
        get diagnostics v_pruned_usage = row_count;

        update public.besing_sync_spaces
        set last_activity_at = v_now,
            last_prune_at    = v_now
        where space_hash = v_space.space_hash;
    else
        update public.besing_sync_spaces
        set last_activity_at = v_now
        where space_hash = v_space.space_hash;
    end if;

    return jsonb_build_object(
        'ok', true,
        'server_time', v_now,
        'history_accepted', v_hist_count,
        'usage_accepted', v_usage_count,
        'pruned', v_pruned_hist + v_pruned_usage,
        'retention_days', v_space.retention_days
    );
end;
$$;

create or replace function public.besing_sync_pull(
    p_secret        text,
    p_since         timestamptz default null,
    p_device_hashes jsonb default '{}'::jsonb,
    p_history_limit integer default 150
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space   public.besing_sync_spaces;
    v_now     timestamptz := now();
    v_limit   integer := greatest(1, least(500, coalesce(p_history_limit, 150)));
    v_hashes  jsonb := case when p_device_hashes is not null and jsonb_typeof(p_device_hashes) = 'object'
                            then p_device_hashes else '{}'::jsonb end;
    v_devices jsonb;
    v_history jsonb;
    v_usage   jsonb;
begin
    v_space := public._besing_sync_auth(p_secret);

    select coalesce(jsonb_agg(
        case
            when d.snapshot_hash <> '' and (v_hashes ->> d.instance_id) = d.snapshot_hash then
                jsonb_build_object(
                    'instance_id', d.instance_id,
                    'device_name', d.device_name,
                    'browser', d.browser,
                    'platform', d.platform,
                    'mode', d.mode,
                    'account_label', d.account_label,
                    'snapshot_hash', d.snapshot_hash,
                    'updated_at', d.updated_at,
                    'unchanged', true
                )
            else
                jsonb_build_object(
                    'instance_id', d.instance_id,
                    'device_name', d.device_name,
                    'browser', d.browser,
                    'platform', d.platform,
                    'mode', d.mode,
                    'account_label', d.account_label,
                    'tabs', d.tabs_json,
                    'groups', d.groups_json,
                    'closed', d.closed_json,
                    'snapshot_hash', d.snapshot_hash,
                    'updated_at', d.updated_at,
                    'unchanged', false
                )
        end
        order by d.updated_at desc
    ), '[]'::jsonb)
    into v_devices
    from public.besing_sync_devices d
    where d.space_hash = v_space.space_hash;

    select coalesce(jsonb_agg(row_obj), '[]'::jsonb)
    into v_history
    from (
        select jsonb_build_object(
            'id', h.id,
            'instance_id', h.instance_id,
            'device_name', h.device_name,
            'browser', h.browser,
            'url', h.url,
            'host', h.host,
            'title', h.title,
            'visitedAt', h.visited_at,
            'visitCount', h.visit_count
        ) as row_obj
        from public.besing_sync_history h
        where h.space_hash = v_space.space_hash
          and h.visited_at >= v_now - make_interval(days => v_space.retention_days)
          and (p_since is null or h.synced_at > p_since)
        order by h.visited_at desc
        limit v_limit
    ) sub;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'instance_id', u.instance_id,
            'day', u.day,
            'host', u.host,
            'seconds', u.active_seconds,
            'visits', u.visits,
            'updatedAt', u.updated_at
        )
    ), '[]'::jsonb)
    into v_usage
    from public.besing_sync_usage u
    where u.space_hash = v_space.space_hash
      and u.day >= (current_date - v_space.retention_days)
      and (p_since is null or u.updated_at > p_since);

    return jsonb_build_object(
        'ok', true,
        'server_time', v_now,
        'retention_days', v_space.retention_days,
        'delta', (p_since is not null),
        'devices', v_devices,
        'history', v_history,
        'usage', v_usage
    );
end;
$$;

create or replace function public.besing_sync_delete_device(
    p_secret      text,
    p_instance_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space   public.besing_sync_spaces;
    v_deleted integer := 0;
begin
    v_space := public._besing_sync_auth(p_secret);

    delete from public.besing_sync_devices
    where space_hash = v_space.space_hash and instance_id = p_instance_id;
    get diagnostics v_deleted = row_count;

    delete from public.besing_sync_history
    where space_hash = v_space.space_hash and instance_id = p_instance_id;

    delete from public.besing_sync_usage
    where space_hash = v_space.space_hash and instance_id = p_instance_id;

    return jsonb_build_object('ok', true, 'deleted', v_deleted > 0);
end;
$$;

create or replace function public.besing_sync_set_retention(
    p_secret         text,
    p_retention_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space        public.besing_sync_spaces;
    v_days         integer := greatest(1, least(90, coalesce(p_retention_days, 7)));
    v_pruned_hist  integer := 0;
    v_pruned_usage integer := 0;
begin
    v_space := public._besing_sync_auth(p_secret);

    update public.besing_sync_spaces
    set retention_days = v_days,
        last_prune_at  = now()
    where space_hash = v_space.space_hash;

    delete from public.besing_sync_history
    where space_hash = v_space.space_hash
      and visited_at < now() - make_interval(days => v_days);
    get diagnostics v_pruned_hist = row_count;

    delete from public.besing_sync_usage
    where space_hash = v_space.space_hash
      and day < (current_date - v_days);
    get diagnostics v_pruned_usage = row_count;

    return jsonb_build_object(
        'ok', true,
        'retention_days', v_days,
        'pruned', v_pruned_hist + v_pruned_usage
    );
end;
$$;

revoke all on function public.besing_sync_push(text, jsonb) from public;
revoke all on function public.besing_sync_pull(text, timestamptz, jsonb, integer) from public;
revoke all on function public.besing_sync_delete_device(text, text) from public;
revoke all on function public.besing_sync_set_retention(text, integer) from public;

grant execute on function public.besing_sync_push(text, jsonb) to anon, authenticated;
grant execute on function public.besing_sync_pull(text, timestamptz, jsonb, integer) to anon, authenticated;
grant execute on function public.besing_sync_delete_device(text, text) to anon, authenticated;
grant execute on function public.besing_sync_set_retention(text, integer) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Shared Cloud Modules: Generic Namespaced LWW KV (Settings Sync + future scripts)
-- & Quick Transfer (text/image/file drops up to 5 MB, 2-day auto-expiry)
-- ---------------------------------------------------------------------------

create table if not exists public.besing_script_kv (
    space_hash text not null references public.besing_sync_spaces(space_hash) on delete cascade,
    namespace  text not null check (namespace ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
    item_key   text not null check (char_length(item_key) between 1 and 160),
    value_json jsonb not null default 'null'::jsonb,
    deleted    boolean not null default false,
    updated_ms bigint not null check (updated_ms >= 0),
    updated_by text not null default '' check (char_length(updated_by) <= 80),
    synced_at  timestamptz not null default now(),
    expires_at timestamptz,
    primary key (space_hash, namespace, item_key)
);

create index if not exists idx_besing_script_kv_space_ns_synced
    on public.besing_script_kv (space_hash, namespace, synced_at desc);

alter table public.besing_script_kv enable row level security;
revoke all on table public.besing_script_kv from public, anon, authenticated;

create or replace function public.besing_kv_sync(
    p_secret    text,
    p_namespace text,
    p_entries   jsonb default '[]'::jsonb,
    p_since     timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space       public.besing_sync_spaces;
    v_now         timestamptz := now();
    v_now_ms      bigint := floor(extract(epoch from v_now) * 1000)::bigint;
    v_ns          text;
    v_entry       jsonb;
    v_key         text;
    v_val         jsonb;
    v_deleted     boolean;
    v_updated_ms  bigint;
    v_updated_by  text;
    v_expires_at  timestamptz;
    v_existing_ct integer;
    v_accepted    integer := 0;
    v_conflicts   integer := 0;
    v_rows        jsonb;
begin
    v_space := public._besing_sync_auth(p_secret);

    v_ns := lower(btrim(coalesce(p_namespace, '')));
    if v_ns !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then
        raise exception 'invalid namespace' using errcode = '22023';
    end if;

    if p_entries is not null then
        if jsonb_typeof(p_entries) <> 'array' then
            raise exception 'entries must be an array' using errcode = '22023';
        end if;
        if octet_length(p_entries::text) > 262144 then
            raise exception 'payload too large' using errcode = '22023';
        end if;

        select count(*) into v_existing_ct
        from public.besing_script_kv
        where space_hash = v_space.space_hash and namespace = v_ns;

        for v_entry in
            select elem
            from jsonb_array_elements(p_entries) with ordinality as arr(elem, ord)
            where ord <= 100
        loop
            if jsonb_typeof(v_entry) <> 'object' then continue; end if;
            v_key := left(btrim(coalesce(v_entry ->> 'key', '')), 160);
            if char_length(v_key) = 0 then continue; end if;
            v_val := coalesce(v_entry -> 'value', 'null'::jsonb);
            if octet_length(v_val::text) > 65536 then continue; end if;
            v_deleted := coalesce((v_entry ->> 'deleted')::boolean, false);
            begin
                v_updated_ms := coalesce((v_entry ->> 'updated_ms')::bigint, v_now_ms);
            exception when others then
                v_updated_ms := v_now_ms;
            end;
            if v_updated_ms > v_now_ms + 120000 or v_updated_ms < 0 then
                v_updated_ms := v_now_ms;
            end if;
            v_updated_by := left(btrim(coalesce(v_entry ->> 'updated_by', '')), 80);

            v_expires_at := null;
            if v_entry ? 'ttl_hours' then
                begin
                    v_expires_at := v_now + make_interval(hours => greatest(1, least(720, (v_entry ->> 'ttl_hours')::integer)));
                exception when others then
                    v_expires_at := null;
                end;
            elsif v_deleted then
                v_expires_at := v_now + interval '30 days';
            end if;

            if not exists (
                select 1 from public.besing_script_kv
                where space_hash = v_space.space_hash and namespace = v_ns and item_key = v_key
            ) then
                if v_existing_ct >= 500 then continue; end if;
                insert into public.besing_script_kv (
                    space_hash, namespace, item_key, value_json, deleted,
                    updated_ms, updated_by, synced_at, expires_at
                ) values (
                    v_space.space_hash, v_ns, v_key, v_val, v_deleted,
                    v_updated_ms, v_updated_by, v_now, v_expires_at
                );
                v_existing_ct := v_existing_ct + 1;
                v_accepted := v_accepted + 1;
            else
                update public.besing_script_kv
                set value_json = v_val, deleted = v_deleted, updated_ms = v_updated_ms,
                    updated_by = v_updated_by, synced_at = v_now, expires_at = v_expires_at
                where space_hash = v_space.space_hash and namespace = v_ns
                  and item_key = v_key and updated_ms <= v_updated_ms;
                if found then v_accepted := v_accepted + 1; else v_conflicts := v_conflicts + 1; end if;
            end if;
        end loop;
    end if;

    delete from public.besing_script_kv
    where space_hash = v_space.space_hash and namespace = v_ns
      and expires_at is not null and expires_at < v_now;

    update public.besing_sync_spaces set last_activity_at = v_now where space_hash = v_space.space_hash;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'key', k.item_key, 'value', k.value_json, 'deleted', k.deleted,
            'updated_ms', k.updated_ms, 'updated_by', k.updated_by, 'synced_at', k.synced_at
        ) order by k.updated_ms desc
    ), '[]'::jsonb)
    into v_rows
    from public.besing_script_kv k
    where k.space_hash = v_space.space_hash and k.namespace = v_ns
      and (p_since is null or k.synced_at > p_since);

    return jsonb_build_object(
        'ok', true, 'server_time', v_now, 'namespace', v_ns,
        'accepted', v_accepted, 'stale_ignored', v_conflicts, 'entries', v_rows
    );
end;
$$;

create table if not exists public.besing_transfers (
    id           uuid primary key default gen_random_uuid(),
    space_hash   text not null references public.besing_sync_spaces(space_hash) on delete cascade,
    title        text not null default 'Untitled' check (char_length(title) <= 160),
    kind         text not null check (kind in ('text', 'image', 'file')),
    mime_type    text not null default 'text/plain' check (char_length(mime_type) <= 120),
    file_name    text not null default '' check (char_length(file_name) <= 180),
    size_bytes   integer not null check (size_bytes between 0 and 5242880),
    content_text text not null,
    preview_text text not null default '' check (char_length(preview_text) <= 240),
    sender_name  text not null default '' check (char_length(sender_name) <= 80),
    created_at   timestamptz not null default now(),
    expires_at   timestamptz not null default (now() + interval '2 days')
);

create index if not exists idx_besing_transfers_space_created
    on public.besing_transfers (space_hash, created_at desc);

create index if not exists idx_besing_transfers_expires
    on public.besing_transfers (expires_at);

alter table public.besing_transfers enable row level security;
revoke all on table public.besing_transfers from public, anon, authenticated;

create or replace function public.besing_transfer_put(p_secret text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
    v_space public.besing_sync_spaces; v_now timestamptz := now();
    v_kind text; v_title text; v_mime text; v_file_name text; v_content text;
    v_preview text; v_sender text; v_size_bytes integer; v_ttl_hours integer;
    v_total_bytes bigint; v_total_count integer; v_id uuid; v_expires_at timestamptz;
begin
    v_space := public._besing_sync_auth(p_secret);
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'invalid payload' using errcode = '22023';
    end if;
    delete from public.besing_transfers where space_hash = v_space.space_hash and expires_at < v_now;
    v_kind := lower(btrim(coalesce(p_payload ->> 'kind', 'text')));
    if v_kind not in ('text', 'image', 'file') then raise exception 'invalid kind' using errcode = '22023'; end if;
    v_content := coalesce(p_payload ->> 'content', '');
    if char_length(v_content) = 0 then raise exception 'empty content' using errcode = '22023'; end if;
    if char_length(v_content) > 7200000 then raise exception 'transfer exceeds 5 MB limit' using errcode = '22023'; end if;
    if v_kind = 'text' then v_size_bytes := octet_length(v_content);
    else
        begin v_size_bytes := coalesce((p_payload ->> 'size_bytes')::integer, floor(char_length(v_content) * 3 / 4)::integer);
        exception when others then v_size_bytes := floor(char_length(v_content) * 3 / 4)::integer; end;
    end if;
    if v_size_bytes < 0 or v_size_bytes > 5242880 then raise exception 'transfer exceeds 5 MB limit' using errcode = '22023'; end if;
    select count(*), coalesce(sum(size_bytes), 0) into v_total_count, v_total_bytes from public.besing_transfers where space_hash = v_space.space_hash;
    if v_total_count >= 50 then raise exception 'too many active transfers (max 50); delete older items first' using errcode = '54000'; end if;
    if v_total_bytes + v_size_bytes > 41943040 then raise exception 'active transfer storage limit reached (40 MB); delete older items first' using errcode = '54000'; end if;
    v_title := left(coalesce(nullif(btrim(p_payload ->> 'title'), ''), 'Untitled'), 160);
    v_mime := left(coalesce(nullif(btrim(p_payload ->> 'mime_type'), ''), case when v_kind = 'text' then 'text/plain' else 'application/octet-stream' end), 120);
    v_file_name := left(btrim(coalesce(p_payload ->> 'file_name', '')), 180);
    v_sender := left(btrim(coalesce(p_payload ->> 'sender_name', '')), 80);
    v_preview := left(coalesce(nullif(btrim(p_payload ->> 'preview_text'), ''), case when v_kind = 'text' then regexp_replace(left(v_content, 240), '\s+', ' ', 'g') else v_file_name end), 240);
    begin v_ttl_hours := greatest(1, least(48, coalesce((p_payload ->> 'ttl_hours')::integer, 48)));
    exception when others then v_ttl_hours := 48; end;
    v_expires_at := v_now + make_interval(hours => v_ttl_hours);
    insert into public.besing_transfers (space_hash, title, kind, mime_type, file_name, size_bytes, content_text, preview_text, sender_name, created_at, expires_at)
    values (v_space.space_hash, v_title, v_kind, v_mime, v_file_name, v_size_bytes, v_content, v_preview, v_sender, v_now, v_expires_at)
    returning id into v_id;
    update public.besing_sync_spaces set last_activity_at = v_now where space_hash = v_space.space_hash;
    return jsonb_build_object('ok', true, 'id', v_id, 'title', v_title, 'kind', v_kind, 'size_bytes', v_size_bytes, 'created_at', v_now, 'expires_at', v_expires_at);
end;
$$;

create or replace function public.besing_transfer_list(p_secret text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_space public.besing_sync_spaces; v_now timestamptz := now(); v_items jsonb;
begin
    v_space := public._besing_sync_auth(p_secret);
    delete from public.besing_transfers where space_hash = v_space.space_hash and expires_at < v_now;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'kind', t.kind, 'mime_type', t.mime_type, 'file_name', t.file_name,
        'size_bytes', t.size_bytes, 'preview_text', t.preview_text,
        'inline_text', case when t.kind = 'text' and t.size_bytes <= 2048 then t.content_text else null end,
        'sender_name', t.sender_name, 'created_at', t.created_at, 'expires_at', t.expires_at
    ) order by t.created_at desc), '[]'::jsonb) into v_items
    from public.besing_transfers t where t.space_hash = v_space.space_hash;
    return jsonb_build_object('ok', true, 'server_time', v_now, 'items', v_items);
end;
$$;

create or replace function public.besing_transfer_get(p_secret text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_space public.besing_sync_spaces; v_now timestamptz := now(); v_row public.besing_transfers;
begin
    v_space := public._besing_sync_auth(p_secret);
    select * into v_row from public.besing_transfers where space_hash = v_space.space_hash and id = p_id and expires_at >= v_now;
    if not found then raise exception 'transfer not found or expired' using errcode = 'P0002'; end if;
    return jsonb_build_object('ok', true, 'id', v_row.id, 'title', v_row.title, 'kind', v_row.kind, 'mime_type', v_row.mime_type, 'file_name', v_row.file_name, 'size_bytes', v_row.size_bytes, 'content', v_row.content_text, 'sender_name', v_row.sender_name, 'created_at', v_row.created_at, 'expires_at', v_row.expires_at);
end;
$$;

create or replace function public.besing_transfer_delete(p_secret text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_space public.besing_sync_spaces; v_deleted integer := 0;
begin
    v_space := public._besing_sync_auth(p_secret);
    delete from public.besing_transfers where space_hash = v_space.space_hash and id = p_id;
    get diagnostics v_deleted = row_count;
    return jsonb_build_object('ok', true, 'deleted', v_deleted > 0);
end;
$$;

revoke all on function public.besing_kv_sync(text, text, jsonb, timestamptz) from public;
revoke all on function public.besing_transfer_put(text, jsonb) from public;
revoke all on function public.besing_transfer_list(text) from public;
revoke all on function public.besing_transfer_get(text, uuid) from public;
revoke all on function public.besing_transfer_delete(text, uuid) from public;

grant execute on function public.besing_kv_sync(text, text, jsonb, timestamptz) to anon, authenticated;
grant execute on function public.besing_transfer_put(text, jsonb) to anon, authenticated;
grant execute on function public.besing_transfer_list(text) to anon, authenticated;
grant execute on function public.besing_transfer_get(text, uuid) to anon, authenticated;
grant execute on function public.besing_transfer_delete(text, uuid) to anon, authenticated;
