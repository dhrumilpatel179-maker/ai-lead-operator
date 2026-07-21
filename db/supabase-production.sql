-- Production reference schema. Apply only after review in a dedicated Supabase project.
-- Browser clients use user JWTs. Service-role credentials remain server-only.

create extension if not exists pgcrypto;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','advisor','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  vehicle_year integer,
  vehicle_make text,
  vehicle_model text,
  mileage integer check (mileage is null or mileage >= 0),
  service text not null,
  symptoms text not null,
  urgency text not null check (urgency in ('routine','soon','urgent')),
  source text not null,
  status text not null check (status in ('New','Contacted','Awaiting Customer','Qualified','Appointment Requested','Booked','Escalated','Lost','Closed')),
  authority text not null check (authority in ('green','yellow','red')),
  summary text not null,
  next_action text not null,
  next_follow_up timestamptz,
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_tenant_status_idx on public.leads(tenant_id, status);
create index leads_tenant_followup_idx on public.leads(tenant_id, next_follow_up);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  provider_message_id text,
  direction text not null check (direction in ('inbound','outbound')),
  channel text not null,
  body text not null,
  send_state text not null default 'received' check (send_state in ('received','pending','sent','failed','blocked')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, channel, provider_message_id)
);
create index messages_tenant_lead_idx on public.messages(tenant_id, lead_id, created_at);

create table public.response_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  body text not null,
  authority text not null check (authority in ('green','yellow','red')),
  state text not null check (state in ('pending','approved','rejected','sent','blocked')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index response_drafts_tenant_state_idx on public.response_drafts(tenant_id, state);

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  due_at timestamptz not null,
  state text not null check (state in ('scheduled','completed','cancelled')),
  created_at timestamptz not null default now()
);
create index follow_ups_tenant_due_idx on public.follow_ups(tenant_id, state, due_at);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  actor_type text not null check (actor_type in ('ai','user','system','integration')),
  actor_id text not null,
  action text not null,
  authority text check (authority in ('green','yellow','red')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_tenant_created_idx on public.audit_events(tenant_id, created_at desc);

create table public.business_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  timezone text not null default 'America/Chicago',
  business_hours jsonb not null default '{}'::jsonb,
  services jsonb not null default '[]'::jsonb,
  prohibited_claims jsonb not null default '[]'::jsonb,
  authority_rules jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.is_tenant_member(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id = target_tenant and m.user_id = auth.uid()
  );
$$;
revoke all on function public.is_tenant_member(uuid) from public;
grant execute on function public.is_tenant_member(uuid) to authenticated;

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.leads enable row level security;
alter table public.messages enable row level security;
alter table public.response_drafts enable row level security;
alter table public.follow_ups enable row level security;
alter table public.audit_events enable row level security;
alter table public.business_settings enable row level security;

create policy tenants_member_select on public.tenants for select to authenticated using (public.is_tenant_member(id));
create policy memberships_self_select on public.tenant_memberships for select to authenticated using (user_id = auth.uid());

create policy leads_member_select on public.leads for select to authenticated using (public.is_tenant_member(tenant_id));
create policy leads_member_insert on public.leads for insert to authenticated with check (public.is_tenant_member(tenant_id));
create policy leads_member_update on public.leads for update to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

create policy messages_member_select on public.messages for select to authenticated using (public.is_tenant_member(tenant_id));
create policy drafts_member_select on public.response_drafts for select to authenticated using (public.is_tenant_member(tenant_id));
create policy drafts_member_update on public.response_drafts for update to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
create policy followups_member_select on public.follow_ups for select to authenticated using (public.is_tenant_member(tenant_id));
create policy followups_member_update on public.follow_ups for update to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
create policy audit_member_select on public.audit_events for select to authenticated using (public.is_tenant_member(tenant_id));
create policy settings_member_select on public.business_settings for select to authenticated using (public.is_tenant_member(tenant_id));

-- Writes that cause external effects (messages, audit, settings and authority changes)
-- remain server-only through a verified application endpoint. No direct browser
-- INSERT/DELETE policies are intentionally created for these tables.

revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
