-- Additive, versioned schema. All runtime logical records retain their typed domain contracts.
CREATE TABLE IF NOT EXISTS rydr_records (
  namespace text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, key),
  CHECK (length(namespace) BETWEEN 1 AND 80),
  CHECK (length(key) BETWEEN 1 AND 1024)
);
CREATE INDEX IF NOT EXISTS rydr_records_prefix_idx ON rydr_records(namespace, key text_pattern_ops);
