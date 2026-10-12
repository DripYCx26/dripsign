-- DripSign baseline schema. Edited in place; there are no migrations.
-- Limits mirror LIMITS in src/schema.ts as a floor only; the application validates first.

CREATE SCHEMA dripsign;

CREATE DOMAIN dripsign.email AS text
  CHECK (VALUE = lower(VALUE) AND length(VALUE) BETWEEN 3 AND 254);

CREATE DOMAIN dripsign.sha256 AS text
  CHECK (VALUE ~ '^[a-f0-9]{64}$');

CREATE TABLE dripsign.schema_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  sha256 dripsign.sha256 NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Tenancy ------------------------------------------------------------------------------------

CREATE TABLE dripsign.tenant (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The only source of staff membership.
CREATE TABLE dripsign.staff (
  tenant_id uuid NOT NULL REFERENCES dripsign.tenant (id),
  email dripsign.email NOT NULL,
  name text CHECK (length(name) BETWEEN 1 AND 200),
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  added_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, email)
);

CREATE INDEX staff_live_by_email ON dripsign.staff (email) WHERE revoked_at IS NULL;

-- Agreements ---------------------------------------------------------------------------------

CREATE TABLE dripsign.agreement (
  tenant_id uuid NOT NULL REFERENCES dripsign.tenant (id),
  -- Globally unique as well: recipient URLs carry only the agreement id.
  id uuid NOT NULL UNIQUE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'negotiating', 'signing', 'signed', 'void')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  current_revision_id uuid,
  draft jsonb NOT NULL CHECK (octet_length(draft::text) <= 600000),
  draft_dirty boolean NOT NULL DEFAULT true,
  created_by dripsign.email NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by dripsign.email,
  void_reason text CHECK (length(void_reason) BETWEEN 1 AND 1000),
  PRIMARY KEY (tenant_id, id),
  CHECK ((status = 'void') = (voided_at IS NOT NULL)),
  CHECK ((voided_at IS NULL) = (voided_by IS NULL)),
  CHECK (void_reason IS NULL OR voided_at IS NOT NULL),
  CHECK (status IN ('draft', 'void') OR current_revision_id IS NOT NULL)
);

CREATE INDEX agreement_staff_list ON dripsign.agreement (tenant_id, updated_at DESC, id DESC);

CREATE TABLE dripsign.recipient (
  tenant_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  id uuid NOT NULL,
  email dripsign.email NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  is_signer boolean NOT NULL,
  -- Orders the signature page (then id); clock time, so it follows the order rows were added.
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_invited_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, agreement_id, id),
  FOREIGN KEY (tenant_id, agreement_id) REFERENCES dripsign.agreement (tenant_id, id)
);

CREATE UNIQUE INDEX recipient_live_email
  ON dripsign.recipient (tenant_id, agreement_id, email)
  WHERE revoked_at IS NULL;

CREATE INDEX recipient_inbox
  ON dripsign.recipient (email, agreement_id)
  WHERE revoked_at IS NULL;

CREATE TABLE dripsign.revision (
  tenant_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  document_sha256 dripsign.sha256 NOT NULL,
  document_bytes integer NOT NULL CHECK (document_bytes > 0),
  -- 200 pages of terms plus up to 4 signature pages for 10 signers.
  page_count integer NOT NULL CHECK (page_count BETWEEN 1 AND 204),
  source jsonb NOT NULL CHECK (octet_length(source::text) <= 500000),
  signing_fields jsonb NOT NULL CHECK (jsonb_typeof(signing_fields) = 'array'),
  signer_ids uuid[] NOT NULL CHECK (cardinality(signer_ids) BETWEEN 1 AND 10),
  published_by dripsign.email NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, agreement_id, id),
  UNIQUE (tenant_id, agreement_id, number),
  FOREIGN KEY (tenant_id, agreement_id) REFERENCES dripsign.agreement (tenant_id, id)
);

ALTER TABLE dripsign.agreement
  ADD FOREIGN KEY (tenant_id, id, current_revision_id)
  REFERENCES dripsign.revision (tenant_id, agreement_id, id);

CREATE TABLE dripsign.proposal (
  tenant_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  id uuid NOT NULL,
  base_revision_id uuid NOT NULL,
  author_capacity text NOT NULL CHECK (author_capacity IN ('staff', 'recipient')),
  author_email dripsign.email NOT NULL,
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 10000),
  replacement_source jsonb CHECK (octet_length(replacement_source::text) <= 500000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  supersedes_id uuid,
  decided_by dripsign.email,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, agreement_id, id),
  FOREIGN KEY (tenant_id, agreement_id) REFERENCES dripsign.agreement (tenant_id, id),
  FOREIGN KEY (tenant_id, agreement_id, base_revision_id)
    REFERENCES dripsign.revision (tenant_id, agreement_id, id),
  FOREIGN KEY (tenant_id, agreement_id, supersedes_id)
    REFERENCES dripsign.proposal (tenant_id, agreement_id, id),
  CHECK ((status IN ('accepted', 'rejected')) = (decided_at IS NOT NULL)),
  CHECK ((decided_at IS NULL) = (decided_by IS NULL))
);

CREATE UNIQUE INDEX one_pending_proposal
  ON dripsign.proposal (tenant_id, agreement_id)
  WHERE status = 'pending';

CREATE INDEX proposal_thread ON dripsign.proposal (tenant_id, agreement_id, created_at);

CREATE TABLE dripsign.message (
  tenant_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  id uuid NOT NULL,
  author_capacity text NOT NULL CHECK (author_capacity IN ('staff', 'recipient')),
  author_email dripsign.email NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, agreement_id) REFERENCES dripsign.agreement (tenant_id, id)
);

CREATE INDEX message_thread ON dripsign.message (tenant_id, agreement_id, created_at);

-- Signing ------------------------------------------------------------------------------------

CREATE TABLE dripsign.signing_round (
  tenant_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  id uuid NOT NULL,
  revision_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'finalizing', 'completed', 'void')),
  document_sha256 dripsign.sha256 NOT NULL,
  consent_version text NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 100),
  consent_text text NOT NULL CHECK (length(consent_text) BETWEEN 1 AND 2000),
  consent_hash dripsign.sha256 NOT NULL
    CHECK (consent_hash = encode(sha256(convert_to(consent_text, 'UTF8')), 'hex')),
  requested_by dripsign.email NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalizing_at timestamptz,
  ended_at timestamptz,
  end_reason text
    CHECK (end_reason IN ('cancelled', 'signer_proposal', 'signer_removed', 'agreement_voided')),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, agreement_id, id),
  FOREIGN KEY (tenant_id, agreement_id, revision_id)
    REFERENCES dripsign.revision (tenant_id, agreement_id, id),
  CHECK ((status IN ('finalizing', 'completed')) = (finalizing_at IS NOT NULL)),
  CHECK ((status IN ('completed', 'void')) = (ended_at IS NOT NULL)),
  CHECK ((status = 'void') = (end_reason IS NOT NULL))
);

CREATE UNIQUE INDEX one_live_round
  ON dripsign.signing_round (tenant_id, agreement_id)
  WHERE status IN ('active', 'finalizing');

CREATE INDEX signing_round_finalizing
  ON dripsign.signing_round (finalizing_at)
  WHERE status = 'finalizing';

CREATE TABLE dripsign.round_signer (
  tenant_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  round_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email dripsign.email NOT NULL,
  PRIMARY KEY (tenant_id, round_id, recipient_id),
  UNIQUE (tenant_id, agreement_id, round_id, recipient_id),
  FOREIGN KEY (tenant_id, agreement_id, round_id)
    REFERENCES dripsign.signing_round (tenant_id, agreement_id, id),
  FOREIGN KEY (tenant_id, agreement_id, recipient_id)
    REFERENCES dripsign.recipient (tenant_id, agreement_id, id)
);

CREATE TABLE dripsign.signature (
  tenant_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  round_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  typed_name text NOT NULL CHECK (
    length(typed_name) BETWEEN 1 AND 200
    AND typed_name = btrim(typed_name)
    AND typed_name !~ '[[:cntrl:]]'
  ),
  consent_version text NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 100),
  consent_text text NOT NULL CHECK (length(consent_text) BETWEEN 1 AND 2000),
  consent_hash dripsign.sha256 NOT NULL
    CHECK (consent_hash = encode(sha256(convert_to(consent_text, 'UTF8')), 'hex')),
  document_sha256 dripsign.sha256 NOT NULL,
  -- No foreign key: sessions are swept while signatures are kept forever.
  session_id uuid NOT NULL,
  verified_at timestamptz NOT NULL,
  -- Clock time at insert, after the signer's lock waits, never the transaction start.
  signed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ip_address text CHECK (length(ip_address) <= 64),
  user_agent text CHECK (length(user_agent) <= 500),
  PRIMARY KEY (tenant_id, round_id, recipient_id),
  CONSTRAINT verified_before_signed CHECK (verified_at <= signed_at),
  FOREIGN KEY (tenant_id, agreement_id, round_id, recipient_id)
    REFERENCES dripsign.round_signer (tenant_id, agreement_id, round_id, recipient_id)
);

CREATE TABLE dripsign.artifact (
  tenant_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  round_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('signed_document', 'audit_record')),
  sha256 dripsign.sha256 NOT NULL,
  byte_length integer NOT NULL CHECK (byte_length > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, round_id, kind),
  FOREIGN KEY (tenant_id, agreement_id, round_id)
    REFERENCES dripsign.signing_round (tenant_id, agreement_id, id)
);

-- Private staff assistant --------------------------------------------------------------------

CREATE TABLE dripsign.ai_suggestion (
  tenant_id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  id uuid NOT NULL,
  requested_by dripsign.email NOT NULL,
  instruction text NOT NULL CHECK (length(instruction) BETWEEN 1 AND 4000),
  proposal_id uuid,
  base_source jsonb NOT NULL CHECK (octet_length(base_source::text) <= 500000),
  base_source_sha256 dripsign.sha256 NOT NULL,
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'ready', 'failed', 'applied')),
  result jsonb CHECK (octet_length(result::text) <= 600000),
  error text CHECK (length(error) <= 2000),
  reserved_micros bigint NOT NULL CHECK (reserved_micros > 0),
  cost_micros bigint CHECK (cost_micros >= 0),
  -- The daily spend window is a UTC day regardless of session time zone.
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  applied_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, agreement_id) REFERENCES dripsign.agreement (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES dripsign.staff (tenant_id, email),
  FOREIGN KEY (tenant_id, agreement_id, proposal_id)
    REFERENCES dripsign.proposal (tenant_id, agreement_id, id),
  CHECK ((status IN ('ready', 'applied')) = (result IS NOT NULL)),
  CHECK ((status = 'applied') = (applied_at IS NOT NULL))
);

CREATE INDEX ai_suggestion_spend ON dripsign.ai_suggestion (tenant_id, day);

CREATE INDEX ai_suggestion_agreement
  ON dripsign.ai_suggestion (tenant_id, agreement_id, created_at DESC);

-- Jobs ---------------------------------------------------------------------------------------

CREATE TABLE dripsign.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES dripsign.tenant (id),
  agreement_id uuid,
  kind text NOT NULL CHECK (kind IN ('email', 'pdf_prepare', 'archive', 'ai_suggest')),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 65536),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Claims and renewals set available_at to the lease's end, when it is claimable again.
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  dedupe_key text UNIQUE CHECK (length(dedupe_key) BETWEEN 1 AND 300),
  last_error text CHECK (length(last_error) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (tenant_id, agreement_id) REFERENCES dripsign.agreement (tenant_id, id),
  -- MATCH SIMPLE skips the foreign key when tenant_id is null, so forbid that combination.
  CHECK (agreement_id IS NULL OR tenant_id IS NOT NULL),
  CHECK ((status = 'running') = (lease_token IS NOT NULL)),
  CHECK ((status IN ('done', 'failed')) = (finished_at IS NOT NULL))
);

CREATE INDEX outbox_ready ON dripsign.outbox (available_at) WHERE status IN ('pending', 'running');

CREATE INDEX outbox_finished ON dripsign.outbox (finished_at) WHERE status IN ('done', 'failed');

CREATE INDEX outbox_agreement ON dripsign.outbox (tenant_id, agreement_id, kind);

-- Auth ---------------------------------------------------------------------------------------

-- Every code request inserts a row, known address or not, so responses cannot enumerate.
CREATE TABLE dripsign.otp_challenge (
  id uuid PRIMARY KEY,
  email dripsign.email NOT NULL,
  token_hash dripsign.sha256 NOT NULL UNIQUE,
  code_hash dripsign.sha256 NOT NULL,
  known boolean NOT NULL,
  -- Set for a step-up: the code refreshes this session instead of creating one.
  session_id uuid,
  ip_address text CHECK (length(ip_address) <= 64),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX otp_challenge_email ON dripsign.otp_challenge (email, created_at DESC);

CREATE INDEX otp_challenge_created ON dripsign.otp_challenge (created_at);

CREATE TABLE dripsign.auth_session (
  id uuid PRIMARY KEY,
  token_hash dripsign.sha256 NOT NULL UNIQUE,
  email dripsign.email NOT NULL,
  staff_tenant_id uuid REFERENCES dripsign.tenant (id),
  embed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX auth_session_expiry ON dripsign.auth_session (expires_at);

CREATE TABLE dripsign.rate_limit (
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 300),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  PRIMARY KEY (key, window_start)
);

CREATE INDEX rate_limit_window ON dripsign.rate_limit (window_start);

CREATE TABLE dripsign.bridge_nonce (
  jti text PRIMARY KEY CHECK (length(jti) BETWEEN 16 AND 200),
  expires_at timestamptz NOT NULL
);

CREATE INDEX bridge_nonce_expiry ON dripsign.bridge_nonce (expires_at);

-- Idempotency: the only replay mechanism. result is null only inside the executing transaction.
CREATE TABLE dripsign.command_receipt (
  tenant_id uuid NOT NULL REFERENCES dripsign.tenant (id),
  actor_email dripsign.email NOT NULL,
  key text NOT NULL CHECK (length(key) BETWEEN 8 AND 200),
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 100),
  capacity text NOT NULL CHECK (capacity IN ('staff', 'recipient')),
  resource_id uuid,
  payload_sha256 dripsign.sha256 NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_email, key)
);

CREATE INDEX command_receipt_created ON dripsign.command_receipt (created_at);

-- Evidence guards ----------------------------------------------------------------------------

CREATE FUNCTION dripsign.reject_evidence_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Immutable evidence cannot be changed: %', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER immutable_revision
  BEFORE UPDATE OR DELETE ON dripsign.revision
  FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_change();

CREATE TRIGGER immutable_message
  BEFORE UPDATE OR DELETE ON dripsign.message
  FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_change();

CREATE TRIGGER immutable_round_signer
  BEFORE UPDATE OR DELETE ON dripsign.round_signer
  FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_change();

CREATE TRIGGER immutable_signature
  BEFORE UPDATE OR DELETE ON dripsign.signature
  FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_change();

CREATE TRIGGER immutable_artifact
  BEFORE UPDATE OR DELETE ON dripsign.artifact
  FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_change();

CREATE TRIGGER immutable_signing_round_delete
  BEFORE DELETE ON dripsign.signing_round
  FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_change();

CREATE FUNCTION dripsign.round_missing_signatures(p_tenant uuid, p_round uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
      SELECT 1 FROM dripsign.round_signer WHERE tenant_id = p_tenant AND round_id = p_round
    )
    OR EXISTS (
      SELECT 1
      FROM dripsign.round_signer r
      LEFT JOIN dripsign.signature s
        ON s.tenant_id = r.tenant_id AND s.round_id = r.round_id AND s.recipient_id = r.recipient_id
      WHERE r.tenant_id = p_tenant AND r.round_id = p_round AND s.recipient_id IS NULL
    );
$$;

-- Frozen evidence never changes; status moves active -> finalizing -> completed, or
-- active -> void. Terminal rounds accept no update at all.
CREATE FUNCTION dripsign.guard_signing_round() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('completed', 'void') THEN
    RAISE EXCEPTION 'A % signing round cannot change', OLD.status;
  END IF;
  IF ROW(NEW.tenant_id, NEW.agreement_id, NEW.id, NEW.revision_id, NEW.document_sha256,
         NEW.consent_version, NEW.consent_text, NEW.consent_hash, NEW.requested_by, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.agreement_id, OLD.id, OLD.revision_id, OLD.document_sha256,
         OLD.consent_version, OLD.consent_text, OLD.consent_hash, OLD.requested_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Frozen signing evidence cannot be changed';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A signing round update must change its status';
  END IF;
  IF NOT ((OLD.status = 'active' AND NEW.status IN ('finalizing', 'void'))
          OR (OLD.status = 'finalizing' AND NEW.status = 'completed')) THEN
    RAISE EXCEPTION 'Signing round cannot move from % to %', OLD.status, NEW.status;
  END IF;
  IF NEW.status IN ('finalizing', 'completed')
     AND dripsign.round_missing_signatures(NEW.tenant_id, NEW.id) THEN
    RAISE EXCEPTION 'Every required signature is required';
  END IF;
  IF NEW.status = 'finalizing' AND EXISTS (
    SELECT 1 FROM dripsign.signature
    WHERE tenant_id = NEW.tenant_id AND round_id = NEW.id AND signed_at > NEW.finalizing_at
  ) THEN
    RAISE EXCEPTION 'Every signature must precede finalizing';
  END IF;
  IF NEW.status = 'completed' AND (
    SELECT count(*) FROM dripsign.artifact WHERE tenant_id = NEW.tenant_id AND round_id = NEW.id
  ) <> 2 THEN
    RAISE EXCEPTION 'Both archived artifacts are required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER signing_round_state_machine
  BEFORE UPDATE ON dripsign.signing_round
  FOR EACH ROW EXECUTE FUNCTION dripsign.guard_signing_round();

-- A signature binds the live round's frozen document hash and consent text, after it opened.
CREATE FUNCTION dripsign.require_matching_round() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dripsign.signing_round
    WHERE tenant_id = NEW.tenant_id
      AND agreement_id = NEW.agreement_id
      AND id = NEW.round_id
      AND status = 'active'
      AND document_sha256 = NEW.document_sha256
      AND consent_version = NEW.consent_version
      AND consent_hash = NEW.consent_hash
      AND created_at <= NEW.signed_at
  ) THEN
    RAISE EXCEPTION 'A signature must match an active round';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER signature_matches_round
  BEFORE INSERT ON dripsign.signature
  FOR EACH ROW EXECUTE FUNCTION dripsign.require_matching_round();

CREATE FUNCTION dripsign.require_finalizing_round() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM dripsign.signing_round
    WHERE tenant_id = NEW.tenant_id
      AND agreement_id = NEW.agreement_id
      AND id = NEW.round_id
      AND status = 'finalizing'
  ) THEN
    RAISE EXCEPTION 'Artifacts belong to a finalizing round';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER artifact_requires_finalizing
  BEFORE INSERT ON dripsign.artifact
  FOR EACH ROW EXECUTE FUNCTION dripsign.require_finalizing_round();

-- Only a pending proposal changes, and only its decision columns.
CREATE FUNCTION dripsign.guard_proposal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'A decided proposal cannot change';
  END IF;
  IF ROW(NEW.tenant_id, NEW.agreement_id, NEW.id, NEW.base_revision_id, NEW.author_capacity,
         NEW.author_email, NEW.text, NEW.replacement_source, NEW.supersedes_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.agreement_id, OLD.id, OLD.base_revision_id, OLD.author_capacity,
         OLD.author_email, OLD.text, OLD.replacement_source, OLD.supersedes_id, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Proposal wording cannot change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER proposal_decision_only
  BEFORE UPDATE ON dripsign.proposal
  FOR EACH ROW EXECUTE FUNCTION dripsign.guard_proposal();

-- signed and void are terminal; signed needs the completed round for the current revision with
-- every signature and both artifacts.
CREATE FUNCTION dripsign.require_completed_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  finished_round uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('signed', 'void') THEN
    RAISE EXCEPTION 'A % agreement cannot change status', OLD.status;
  END IF;
  IF NEW.status = 'signed' THEN
    SELECT id INTO finished_round
    FROM dripsign.signing_round
    WHERE tenant_id = NEW.tenant_id
      AND agreement_id = NEW.id
      AND revision_id = NEW.current_revision_id
      AND status = 'completed';
    IF finished_round IS NULL
       OR dripsign.round_missing_signatures(NEW.tenant_id, finished_round)
       OR (SELECT count(*) FROM dripsign.artifact
           WHERE tenant_id = NEW.tenant_id AND round_id = finished_round) <> 2 THEN
      RAISE EXCEPTION 'Every required signature and both archived artifacts are required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agreement_completion_gate
  BEFORE UPDATE ON dripsign.agreement
  FOR EACH ROW EXECUTE FUNCTION dripsign.require_completed_evidence();

-- Audit timeline -----------------------------------------------------------------------------

-- visibility 'staff' rows are hidden from recipients, except recipient rows whose subject_email
-- is the viewer's own address.
CREATE VIEW dripsign.agreement_timeline AS
SELECT
  a.tenant_id,
  a.id AS agreement_id,
  a.created_at AS at,
  'agreement_created'::text AS kind,
  'staff'::text AS actor_capacity,
  a.created_by::text AS actor_email,
  NULL::uuid AS subject_id,
  NULL::text AS subject_email,
  jsonb_build_object('title', a.title) AS detail,
  'staff'::text AS visibility
FROM dripsign.agreement a
UNION ALL
SELECT r.tenant_id, r.agreement_id, r.added_at, 'recipient_added', 'staff', NULL, r.id,
  r.email, jsonb_build_object('name', r.name, 'isSigner', r.is_signer), 'staff'
FROM dripsign.recipient r
UNION ALL
SELECT r.tenant_id, r.agreement_id, r.revoked_at, 'recipient_removed', 'staff', NULL, r.id,
  r.email, jsonb_build_object('name', r.name), 'staff'
FROM dripsign.recipient r
WHERE r.revoked_at IS NOT NULL
UNION ALL
SELECT v.tenant_id, v.agreement_id, v.published_at, 'revision_published', 'staff',
  v.published_by, v.id, NULL,
  jsonb_build_object('number', v.number, 'sha256', v.document_sha256), 'shared'
FROM dripsign.revision v
UNION ALL
SELECT p.tenant_id, p.agreement_id, p.created_at, 'proposal_created', p.author_capacity,
  p.author_email, p.id, NULL,
  jsonb_build_object('baseRevisionId', p.base_revision_id, 'supersedesId', p.supersedes_id),
  'shared'
FROM dripsign.proposal p
UNION ALL
SELECT p.tenant_id, p.agreement_id, p.decided_at, 'proposal_' || p.status,
  CASE p.author_capacity WHEN 'staff' THEN 'recipient' ELSE 'staff' END,
  p.decided_by, p.id, NULL, '{}'::jsonb, 'shared'
FROM dripsign.proposal p
WHERE p.status IN ('accepted', 'rejected')
UNION ALL
SELECT g.tenant_id, g.agreement_id, g.created_at, 'signing_requested', 'staff',
  g.requested_by, g.id, NULL,
  jsonb_build_object(
    'revisionId', g.revision_id,
    'documentSha256', g.document_sha256,
    'signers', (
      SELECT coalesce(
        jsonb_agg(rs.name ORDER BY array_position(v.signer_ids, rs.recipient_id)), '[]'::jsonb)
      FROM dripsign.round_signer rs
      JOIN dripsign.revision v ON v.tenant_id = g.tenant_id AND v.id = g.revision_id
      WHERE rs.tenant_id = g.tenant_id AND rs.round_id = g.id
    )
  ),
  'shared'
FROM dripsign.signing_round g
UNION ALL
SELECT s.tenant_id, s.agreement_id, s.signed_at, 'signature_recorded', 'recipient',
  rs.email, s.round_id, rs.email,
  jsonb_build_object('recipientId', s.recipient_id, 'name', rs.name, 'typedName', s.typed_name),
  'shared'
FROM dripsign.signature s
JOIN dripsign.round_signer rs
  ON rs.tenant_id = s.tenant_id AND rs.round_id = s.round_id AND rs.recipient_id = s.recipient_id
UNION ALL
SELECT g.tenant_id, g.agreement_id, g.ended_at, 'signing_ended', NULL, NULL, g.id, NULL,
  jsonb_build_object('reason', g.end_reason), 'shared'
FROM dripsign.signing_round g
WHERE g.status = 'void'
UNION ALL
SELECT g.tenant_id, g.agreement_id, g.ended_at, 'signing_completed', NULL, NULL, g.id, NULL,
  (
    SELECT jsonb_object_agg(f.kind, f.sha256)
    FROM dripsign.artifact f
    WHERE f.tenant_id = g.tenant_id AND f.round_id = g.id
  ),
  'shared'
FROM dripsign.signing_round g
WHERE g.status = 'completed'
UNION ALL
SELECT a.tenant_id, a.id, a.voided_at, 'agreement_voided', 'staff', a.voided_by, NULL, NULL,
  jsonb_build_object('reason', a.void_reason), 'shared'
FROM dripsign.agreement a
WHERE a.voided_at IS NOT NULL
UNION ALL
SELECT i.tenant_id, i.agreement_id, i.created_at, 'ai_requested', 'staff', i.requested_by,
  i.id, NULL, jsonb_build_object('status', i.status), 'staff'
FROM dripsign.ai_suggestion i;
