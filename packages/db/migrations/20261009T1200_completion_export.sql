-- Root allocates this DripSign forward migration. No executed artifact or document is rewritten.
ALTER TABLE dripsign.signing_round ADD COLUMN completed_at timestamptz;
-- Original completion transaction's durable event time is retained for existing completed rounds.
-- A row lacking that original event stays undated and export refuses; ingestion time is no substitute.
UPDATE dripsign.signing_round r SET completed_at=o.created_at FROM dripsign.outbox o
  WHERE r.status='completed' AND o.tenant_id=r.tenant_id AND o.agreement_id=r.agreement_id
    AND o.kind='agreement_executed' AND o.dedupe_key='executed:'||r.id::text;
ALTER TABLE dripsign.signing_round ADD CONSTRAINT signing_completion_time_ck
  CHECK(completed_at IS NULL OR (status='completed' AND isfinite(completed_at))) NOT VALID;
ALTER TABLE dripsign.signing_round VALIDATE CONSTRAINT signing_completion_time_ck;
CREATE TABLE dripsign.completion_export_config (
  tenant_id uuid NOT NULL REFERENCES dripsign.tenant(id), revision bigint NOT NULL CHECK(revision>0),
  config jsonb NOT NULL CHECK(jsonb_typeof(config)='object' AND octet_length(config::text)<=4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(tenant_id,revision)
);
CREATE TABLE dripsign.completion_export (
  tenant_id uuid NOT NULL, round_id uuid NOT NULL,event_id uuid NOT NULL,
  body text NOT NULL CHECK(octet_length(body)<=1048576),
  body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
  freshness_seconds integer NOT NULL CHECK(freshness_seconds BETWEEN 1 AND 300),
  PRIMARY KEY(tenant_id,round_id),UNIQUE(tenant_id,event_id),
  FOREIGN KEY(tenant_id,round_id) REFERENCES dripsign.signing_round(tenant_id,id),
  FOREIGN KEY(tenant_id,event_id) REFERENCES dripsign.outbox(tenant_id,id)
);
CREATE FUNCTION dripsign.completion_export_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable completion export' USING ERRCODE='23514'; END $$;
CREATE TRIGGER completion_export_immutable BEFORE UPDATE OR DELETE ON dripsign.completion_export
  FOR EACH ROW EXECUTE FUNCTION dripsign.completion_export_immutable();
CREATE TRIGGER completion_export_config_immutable BEFORE UPDATE OR DELETE ON dripsign.completion_export_config
  FOR EACH ROW EXECUTE FUNCTION dripsign.completion_export_immutable();
