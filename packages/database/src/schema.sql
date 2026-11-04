-- ASO Web Core Database Schema (Blueprint Chapter 7.4)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'team')),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 3650),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','developer','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('local','github','new')),
  repository_ref TEXT,
  default_runtime TEXT NOT NULL CHECK (default_runtime IN ('local','cloud')),
  default_provider TEXT NOT NULL DEFAULT 'auto',
  execution_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic','google')),
  mode TEXT NOT NULL CHECK (mode IN ('LOCAL_NATIVE_CLI','USER_API_KEY','ORG_API_KEY','PARTNER_OAUTH_APPROVED')),
  status TEXT NOT NULL DEFAULT 'not_configured',
  secret_ref TEXT,
  billing_owner TEXT NOT NULL,
  legal_gate TEXT NOT NULL DEFAULT 'pending',
  policy_version TEXT NOT NULL,
  display_name TEXT NOT NULL,
  last_health_check_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_provider_connections_workspace ON provider_connections(workspace_id);

CREATE TABLE IF NOT EXISTS runner_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','revoked')),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_runner_devices_workspace ON runner_devices(workspace_id);

CREATE TABLE IF NOT EXISTS runner_pairing_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  initiated_by UUID NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  created_by UUID NOT NULL REFERENCES users(id),
  raw_request TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  execution_mode TEXT NOT NULL DEFAULT 'auto',
  runtime TEXT NOT NULL CHECK (runtime IN ('local','cloud')),
  provider_preference TEXT NOT NULL DEFAULT 'auto',
  budget JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_runs_workspace_created ON runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_project_status ON runs(project_id, status);

CREATE TABLE IF NOT EXISTS run_requirements (
  run_id UUID PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  refined_spec JSONB NOT NULL,
  spec_version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  plan_json JSONB NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, version)
);

CREATE TABLE IF NOT EXISTS run_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  capability_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_provider TEXT,
  assigned_runner_id UUID REFERENCES runner_devices(id),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  result JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE(run_id, task_key)
);
CREATE INDEX IF NOT EXISTS idx_run_tasks_run_state ON run_tasks(run_id, state);

CREATE TABLE IF NOT EXISTS run_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_run_events_replay ON run_events(run_id, sequence);

CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id UUID REFERENCES run_tasks(id),
  requested_by TEXT NOT NULL,
  command_digest TEXT NOT NULL,
  scope JSONB NOT NULL,
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  decided_by UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  version TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  license_id TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level TEXT NOT NULL DEFAULT 'unreviewed',
  enabled BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(canonical_name, source_commit)
);

CREATE TABLE IF NOT EXISTS run_skill_bindings (
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES run_tasks(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES skill_registry(id),
  selection_reason TEXT NOT NULL,
  PRIMARY KEY(run_id, task_id, skill_id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delete_after TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id UUID REFERENCES run_tasks(id),
  provider TEXT NOT NULL,
  model TEXT,
  connection_mode TEXT NOT NULL,
  input_tokens BIGINT,
  output_tokens BIGINT,
  cached_input_tokens BIGINT,
  cache_write_tokens BIGINT,
  duration_ms BIGINT,
  measured_cost_usd NUMERIC(18, 8),
  cost_confidence TEXT NOT NULL DEFAULT 'unavailable',
  source TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(workspace_id, idempotency_key)
);

