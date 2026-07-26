-- Production Postgres/Supabase reference migration.
-- This file is implemented and tested statically, but is not applied by this repository.
-- Apply only to a dedicated project after review. Service-role credentials stay server-only.

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
  escalation_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(escalation_reasons) = 'array'),
  immediate_escalation boolean not null default false,
  disposition text not null default 'reply' check (disposition in ('reply','no_action','language_review','attachment_review')),
  summary text not null,
  next_action text not null,
  next_follow_up timestamptz,
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index leads_tenant_status_idx on public.leads(tenant_id, status);
create index leads_tenant_followup_idx on public.leads(tenant_id, next_follow_up);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null,
  provider_message_id text,
  idempotency_key text,
  direction text not null check (direction in ('inbound','outbound')),
  channel text not null,
  body text not null,
  send_state text not null default 'received' check (send_state in ('received','pending','sent','failed','blocked')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, lead_id) references public.leads(tenant_id, id) on delete cascade,
  unique (tenant_id, channel, provider_message_id),
  unique (tenant_id, idempotency_key)
);
create index messages_tenant_lead_idx on public.messages(tenant_id, lead_id, created_at);

create table public.response_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null,
  body text not null,
  authority text not null check (authority in ('green','yellow','red')),
  state text not null check (state in ('pending','approved','rejected','sent','blocked')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  transition_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, lead_id) references public.leads(tenant_id, id) on delete cascade,
  unique (tenant_id, id)
);
create index response_drafts_tenant_state_idx on public.response_drafts(tenant_id, state);

create table public.approval_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null,
  draft_id uuid not null,
  decision text not null check (decision in ('approved','rejected','blocked')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  actor_role text not null check (actor_role in ('owner','manager','advisor','viewer')),
  authority text not null check (authority in ('green','yellow','red')),
  body_hash text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, lead_id) references public.leads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, draft_id) references public.response_drafts(tenant_id, id) on delete cascade,
  unique (tenant_id, idempotency_key)
);

create table public.send_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null,
  draft_id uuid not null,
  idempotency_key text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('sent','failed','blocked')),
  transport text not null check (transport in ('simulation')),
  provider_message_id text,
  failure_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (tenant_id, lead_id) references public.leads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, draft_id) references public.response_drafts(tenant_id, id) on delete cascade,
  unique (tenant_id, idempotency_key),
  unique (tenant_id, draft_id),
  unique (tenant_id, id)
);

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null,
  due_at timestamptz not null,
  state text not null check (state in ('scheduled','completed','cancelled')),
  source_send_operation_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, lead_id) references public.leads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_send_operation_id) references public.send_operations(tenant_id, id) on delete restrict,
  unique (tenant_id, source_send_operation_id)
);
create index follow_ups_tenant_due_idx on public.follow_ups(tenant_id, state, due_at);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid,
  actor_type text not null check (actor_type in ('ai','user','system','integration')),
  actor_id text not null,
  actor_role text check (actor_role in ('owner','manager','advisor','viewer')),
  action text not null,
  authority text check (authority in ('green','yellow','red')),
  target_type text not null,
  target_id text,
  correlation_id text not null,
  details jsonb not null default '{}'::jsonb,
  previous_event_hash text,
  event_hash text not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, lead_id) references public.leads(tenant_id, id) on delete set null,
  unique (tenant_id, correlation_id, action),
  unique (tenant_id, event_hash)
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

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null,
  external_account_id text not null,
  status text not null default 'pending'
    check (status in ('pending','active','reconnect_required','revoked','error')),
  granted_scopes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(granted_scopes) = 'array'),
  credential_envelope_ciphertext text not null check (length(credential_envelope_ciphertext) > 0),
  credential_envelope_nonce text not null check (length(credential_envelope_nonce) > 0),
  credential_envelope_auth_tag text not null check (length(credential_envelope_auth_tag) > 0),
  credential_key_version text not null check (length(credential_key_version) > 0),
  gmail_watch_expires_at timestamptz,
  gmail_history_id text,
  reconnect_required_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, external_account_id),
  unique (tenant_id, id),
  unique (tenant_id, id, provider)
);
create index provider_connections_tenant_status_idx
  on public.provider_connections(tenant_id, status);

create table public.inbound_provider_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null,
  provider text not null,
  external_event_id text not null,
  processing_state text not null default 'received'
    check (processing_state in ('received','processing','processed','failed','rejected')),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  non_sensitive_metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(non_sensitive_metadata) = 'object'
      and octet_length(non_sensitive_metadata::text) <= 2048
    ),
  attachment_present boolean not null default false,
  attachment_count integer not null default 0 check (attachment_count >= 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  deletion_due_at timestamptz not null,
  failure_classification text,
  rejection_classification text,
  foreign key (tenant_id, connection_id, provider)
    references public.provider_connections(tenant_id, id, provider) on delete cascade,
  unique (connection_id, external_event_id),
  check (
    (attachment_present and attachment_count > 0)
    or (not attachment_present and attachment_count = 0)
  ),
  check (deletion_due_at >= received_at)
);
create index inbound_provider_events_tenant_state_idx
  on public.inbound_provider_events(tenant_id, processing_state);
create index inbound_provider_events_tenant_deletion_idx
  on public.inbound_provider_events(tenant_id, deletion_due_at);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  normalized_customer_identity text not null,
  channel text not null,
  status text not null default 'reply_only'
    check (status in ('reply_only','granted','revoked','suppressed')),
  source text not null,
  evidence_metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(evidence_metadata) = 'object'
      and octet_length(evidence_metadata::text) <= 4096
    ),
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  check (status <> 'revoked' or revoked_at is not null)
);
create index consent_records_tenant_identity_channel_idx
  on public.consent_records(tenant_id, normalized_customer_identity, channel, recorded_at);
create index consent_records_tenant_status_idx
  on public.consent_records(tenant_id, status);

alter table public.approval_events
  add constraint approval_events_outbox_chain_unique
  unique (tenant_id, lead_id, draft_id, id);

create table public.provider_send_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null,
  lead_id uuid not null,
  draft_id uuid not null,
  approval_id uuid not null,
  idempotency_key text not null,
  approved_body_hash text not null check (approved_body_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'queued'
    check (state in (
      'queued','claimed','sending','sent','failed',
      'needs_reconciliation','cancelled'
    )),
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deletion_due_at timestamptz not null,
  foreign key (tenant_id, connection_id)
    references public.provider_connections(tenant_id, id) on delete restrict,
  foreign key (tenant_id, lead_id, draft_id, approval_id)
    references public.approval_events(tenant_id, lead_id, draft_id, id) on delete restrict,
  unique (tenant_id, idempotency_key),
  unique (tenant_id, approval_id),
  check (deletion_due_at >= created_at),
  check (
    (
      state in ('claimed','sending')
      and claim_token is not null
      and claimed_at is not null
      and claim_expires_at is not null
      and claim_expires_at > claimed_at
    )
    or (
      state not in ('claimed','sending')
      and claim_token is null
      and claimed_at is null
      and claim_expires_at is null
    )
  )
);
create index provider_send_outbox_tenant_state_attempt_idx
  on public.provider_send_outbox(tenant_id, state, next_attempt_at);
create index provider_send_outbox_tenant_claim_expiry_idx
  on public.provider_send_outbox(tenant_id, state, claim_expires_at);

create or replace function public.enforce_provider_send_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and not exists (
    select 1
    from public.provider_connections connection
    join public.leads lead
      on lead.tenant_id = new.tenant_id and lead.id = new.lead_id
    join public.response_drafts draft
      on draft.tenant_id = new.tenant_id
      and draft.id = new.draft_id
      and draft.lead_id = new.lead_id
    join public.approval_events approval
      on approval.tenant_id = new.tenant_id
      and approval.id = new.approval_id
      and approval.lead_id = new.lead_id
      and approval.draft_id = new.draft_id
    where connection.tenant_id = new.tenant_id
      and connection.id = new.connection_id
      and connection.status = 'active'
      and approval.decision = 'approved'
      and approval.body_hash = new.approved_body_hash
  ) then
    raise exception 'provider outbox tenant or approval chain mismatch';
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id <> old.tenant_id
      or new.connection_id <> old.connection_id
      or new.lead_id <> old.lead_id
      or new.draft_id <> old.draft_id
      or new.approval_id <> old.approval_id
      or new.idempotency_key <> old.idempotency_key then
      raise exception 'provider outbox relationship is immutable';
    end if;
    if new.approved_body_hash <> old.approved_body_hash then
      raise exception 'approved body hash is immutable';
    end if;
    if old.state in ('claimed','sending')
      and new.state = old.state
      and (
        new.claim_token is distinct from old.claim_token
        or new.claimed_at is distinct from old.claimed_at
        or new.claim_expires_at is distinct from old.claim_expires_at
      ) then
      raise exception 'provider outbox claim is already held';
    end if;
    if new.state <> old.state and not (
      (old.state = 'queued' and new.state in ('claimed','cancelled'))
      or (old.state = 'claimed' and new.state in ('sending','failed','cancelled'))
      or (
        old.state = 'claimed'
        and new.state = 'queued'
        and old.claim_expires_at <= new.updated_at
      )
      or (old.state = 'sending' and new.state in ('sent','failed','needs_reconciliation'))
      or (old.state = 'failed' and new.state in ('queued','cancelled'))
      or (old.state = 'needs_reconciliation' and new.state in ('sent','failed','cancelled'))
    ) then
      raise exception 'illegal provider outbox state transition';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_provider_send_outbox() from public;

create trigger provider_send_outbox_enforce
before insert or update on public.provider_send_outbox
for each row execute function public.enforce_provider_send_outbox();

create or replace function public.current_tenant_role(target_tenant uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.tenant_memberships m
  where m.tenant_id = target_tenant and m.user_id = auth.uid()
$$;
revoke all on function public.current_tenant_role(uuid) from public;
grant execute on function public.current_tenant_role(uuid) to authenticated;

create or replace function public.is_tenant_member(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_tenant_role(target_tenant) is not null
$$;
revoke all on function public.is_tenant_member(uuid) from public;
grant execute on function public.is_tenant_member(uuid) to authenticated;

create or replace function public.can_write_tenant(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_tenant_role(target_tenant) in ('owner','manager','advisor'), false)
$$;
revoke all on function public.can_write_tenant(uuid) from public;
grant execute on function public.can_write_tenant(uuid) to authenticated;

create or replace function public.seal_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prior_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 0));
  select event_hash into prior_hash
  from public.audit_events
  where tenant_id = new.tenant_id
  order by created_at desc, id desc
  limit 1;
  new.previous_event_hash := prior_hash;
  new.event_hash := encode(digest(concat_ws('|',
    coalesce(prior_hash, ''), new.id::text, new.tenant_id::text,
    coalesce(new.lead_id::text, ''), new.actor_type, new.actor_id,
    coalesce(new.actor_role, ''), new.action, coalesce(new.authority, ''),
    new.target_type, coalesce(new.target_id, ''), new.correlation_id,
    new.details::text, new.created_at::text
  ), 'sha256'), 'hex');
  return new;
end;
$$;

create trigger audit_events_seal_before_insert
before insert on public.audit_events
for each row execute function public.seal_audit_event();

create or replace function public.reject_immutable_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'immutable security record';
end;
$$;

create trigger audit_events_immutable
before update or delete on public.audit_events
for each row execute function public.reject_immutable_mutation();
create trigger approval_events_immutable
before update or delete on public.approval_events
for each row execute function public.reject_immutable_mutation();
create trigger send_operations_immutable
before update or delete on public.send_operations
for each row execute function public.reject_immutable_mutation();

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.leads enable row level security;
alter table public.messages enable row level security;
alter table public.response_drafts enable row level security;
alter table public.approval_events enable row level security;
alter table public.send_operations enable row level security;
alter table public.follow_ups enable row level security;
alter table public.audit_events enable row level security;
alter table public.business_settings enable row level security;
alter table public.provider_connections enable row level security;
alter table public.inbound_provider_events enable row level security;
alter table public.consent_records enable row level security;
alter table public.provider_send_outbox enable row level security;

create policy tenants_member_select on public.tenants
  for select to authenticated using (public.is_tenant_member(id));
create policy memberships_self_select on public.tenant_memberships
  for select to authenticated using (user_id = auth.uid());

create policy leads_member_select on public.leads
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy leads_writer_insert on public.leads
  for insert to authenticated with check (public.can_write_tenant(tenant_id));
create policy leads_writer_update on public.leads
  for update to authenticated
  using (public.can_write_tenant(tenant_id))
  with check (public.can_write_tenant(tenant_id));

create policy messages_member_select on public.messages
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy drafts_member_select on public.response_drafts
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy approvals_member_select on public.approval_events
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy sends_member_select on public.send_operations
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy followups_member_select on public.follow_ups
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy audit_member_select on public.audit_events
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy settings_member_select on public.business_settings
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy provider_connections_member_select on public.provider_connections
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy inbound_provider_events_member_select on public.inbound_provider_events
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy consent_records_member_select on public.consent_records
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy provider_send_outbox_member_select on public.provider_send_outbox
  for select to authenticated using (public.is_tenant_member(tenant_id));

-- Browser JWTs may read their tenant and mutate ordinary lead records only when
-- their role permits. Draft state, approvals, sends, follow-ups, audit events,
-- settings, and memberships have no browser write policy and are server-only.
revoke all on public.tenant_memberships, public.messages, public.response_drafts,
  public.approval_events, public.send_operations, public.follow_ups,
  public.audit_events, public.business_settings, public.provider_connections,
  public.inbound_provider_events, public.consent_records,
  public.provider_send_outbox from anon, authenticated;
grant select on public.tenant_memberships, public.messages, public.response_drafts,
  public.approval_events, public.send_operations, public.follow_ups,
  public.audit_events, public.business_settings, public.provider_connections,
  public.inbound_provider_events, public.consent_records,
  public.provider_send_outbox to authenticated;
grant select, insert, update on public.leads to authenticated;
grant select on public.tenants to authenticated;
