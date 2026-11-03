CREATE TABLE IF NOT EXISTS chain_indexer_state (
  cluster TEXT NOT NULL,
  program_id TEXT NOT NULL,
  last_event_signature TEXT,
  last_event_slot BIGINT,
  last_event_scan_slot BIGINT,
  last_observed_slot BIGINT,
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_reconciliation_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cluster, program_id)
);

CREATE TABLE IF NOT EXISTS chain_account_projection (
  cluster TEXT NOT NULL,
  program_id TEXT NOT NULL,
  address TEXT NOT NULL,
  account_kind TEXT NOT NULL CHECK (
    account_kind IN (
      'platform',
      'passport',
      'deposit',
      'merchant',
      'authorization',
      'rental'
    )
  ),
  data_json TEXT NOT NULL,
  data_hash TEXT NOT NULL CHECK (data_hash ~ '^[0-9a-f]{64}$'),
  observed_slot BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cluster, program_id, address)
);

CREATE INDEX IF NOT EXISTS chain_account_projection_kind_idx
  ON chain_account_projection (cluster, program_id, account_kind);

CREATE TABLE IF NOT EXISTS chain_events (
  cluster TEXT NOT NULL,
  program_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  action SMALLINT NOT NULL CHECK (action BETWEEN 0 AND 13),
  action_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  owner TEXT NOT NULL,
  actor TEXT NOT NULL,
  amount TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  event_timestamp BIGINT NOT NULL,
  slot BIGINT NOT NULL,
  block_time BIGINT,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cluster, program_id, signature, log_index)
);

CREATE INDEX IF NOT EXISTS chain_events_action_timestamp_idx
  ON chain_events (cluster, program_id, action, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS chain_events_subject_timestamp_idx
  ON chain_events (cluster, program_id, subject, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS chain_events_owner_timestamp_idx
  ON chain_events (cluster, program_id, owner, event_timestamp DESC);

CREATE TABLE IF NOT EXISTS chain_reconciliation_runs (
  id TEXT PRIMARY KEY,
  cluster TEXT NOT NULL,
  program_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  snapshot_slot BIGINT NOT NULL,
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  deleted_count INTEGER NOT NULL DEFAULT 0 CHECK (deleted_count >= 0),
  unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS chain_reconciliation_runs_started_at_idx
  ON chain_reconciliation_runs (cluster, program_id, started_at DESC);

CREATE TABLE IF NOT EXISTS chain_reconciliation_findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES chain_reconciliation_runs(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  account_kind TEXT NOT NULL,
  finding TEXT NOT NULL CHECK (
    finding IN ('ADDED', 'UPDATED', 'REMOVED')
  ),
  old_data_hash TEXT,
  new_data_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS chain_reconciliation_findings_run_idx
  ON chain_reconciliation_findings (run_id);
