CREATE SCHEMA IF NOT EXISTS dripsign;
CREATE TABLE dripsign.tenant (id uuid PRIMARY KEY, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200), last_outbox_claim_at timestamptz);
CREATE TABLE dripsign.staff_membership (
 tenant_id uuid NOT NULL REFERENCES dripsign.tenant(id), user_id text NOT NULL CHECK(length(user_id) BETWEEN 1 AND 200),
 email text NOT NULL CHECK(email=lower(email) AND length(email) BETWEEN 3 AND 254), revoked_at timestamptz,
 PRIMARY KEY(tenant_id,user_id), UNIQUE(tenant_id,email)
);
CREATE TABLE dripsign.agreement (
 tenant_id uuid NOT NULL REFERENCES dripsign.tenant(id), id uuid NOT NULL, title text NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','negotiating','signing','signed','void')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), current_revision_id uuid, draft_dirty boolean NOT NULL DEFAULT true, create_provenance jsonb,
 draft jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE INDEX agreement_page ON dripsign.agreement(tenant_id,id DESC);
CREATE TABLE dripsign.recipient_grant (
 tenant_id uuid NOT NULL, agreement_id uuid NOT NULL, id uuid NOT NULL, email text NOT NULL CHECK(email=lower(email) AND length(email) BETWEEN 3 AND 254),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200), required_signer boolean NOT NULL, revoked_at timestamptz,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,agreement_id,id), UNIQUE(tenant_id,agreement_id,email),
 FOREIGN KEY(tenant_id,agreement_id) REFERENCES dripsign.agreement(tenant_id,id)
);
CREATE INDEX recipient_email_lookup ON dripsign.recipient_grant(tenant_id,email,agreement_id) WHERE revoked_at IS NULL;
CREATE TABLE dripsign.revision (
 tenant_id uuid NOT NULL, agreement_id uuid NOT NULL, id uuid NOT NULL, number integer NOT NULL CHECK(number>0),
 document jsonb NOT NULL, source jsonb CHECK(octet_length(source::text)<=500000), signing_fields jsonb NOT NULL, required_grant_ids uuid[] NOT NULL CHECK(cardinality(required_grant_ids) BETWEEN 1 AND 10), published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,agreement_id,id), UNIQUE(tenant_id,agreement_id,number),
 FOREIGN KEY(tenant_id,agreement_id) REFERENCES dripsign.agreement(tenant_id,id)
);
ALTER TABLE dripsign.agreement ADD FOREIGN KEY(tenant_id,id,current_revision_id) REFERENCES dripsign.revision(tenant_id,agreement_id,id);
CREATE TABLE dripsign.proposal (
 tenant_id uuid NOT NULL, agreement_id uuid NOT NULL, id uuid NOT NULL, base_revision_id uuid NOT NULL,
 author_kind text NOT NULL CHECK(author_kind IN ('staff','recipient')), author_id text NOT NULL,
 text text NOT NULL CHECK(length(text) BETWEEN 1 AND 20000), replacement_source jsonb CHECK(octet_length(replacement_source::text)<=500000), original_source jsonb,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','superseded')),
 supersedes_id uuid, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,agreement_id,id), FOREIGN KEY(tenant_id,agreement_id) REFERENCES dripsign.agreement(tenant_id,id),
 FOREIGN KEY(tenant_id,agreement_id,base_revision_id) REFERENCES dripsign.revision(tenant_id,agreement_id,id),
 FOREIGN KEY(tenant_id,agreement_id,supersedes_id) REFERENCES dripsign.proposal(tenant_id,agreement_id,id)
);
CREATE UNIQUE INDEX one_pending_proposal ON dripsign.proposal(tenant_id,agreement_id) WHERE status='pending';
CREATE INDEX proposal_thread ON dripsign.proposal(tenant_id,agreement_id,created_at,id);
CREATE TABLE dripsign.shared_message (
 tenant_id uuid NOT NULL, agreement_id uuid NOT NULL, id uuid NOT NULL, author_kind text NOT NULL CHECK(author_kind IN ('staff','recipient')),
 author_id text NOT NULL, body text NOT NULL CHECK(length(body) BETWEEN 1 AND 20000), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,agreement_id) REFERENCES dripsign.agreement(tenant_id,id)
);
CREATE INDEX shared_message_thread ON dripsign.shared_message(tenant_id,agreement_id,created_at,id);
CREATE TABLE dripsign.private_ai_message (
 tenant_id uuid NOT NULL, agreement_id uuid NOT NULL, id uuid NOT NULL, user_id text NOT NULL,
 role text NOT NULL CHECK(role IN ('user','assistant')), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 500000), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,agreement_id) REFERENCES dripsign.agreement(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES dripsign.staff_membership(tenant_id,user_id)
);
CREATE INDEX private_ai_thread ON dripsign.private_ai_message(tenant_id,agreement_id,user_id,created_at,id);
CREATE TABLE dripsign.signing_round (
 tenant_id uuid NOT NULL, agreement_id uuid NOT NULL, id uuid NOT NULL, revision_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('active','finalizing','completed','void')), document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[a-f0-9]{64}$'),
 consent_version text NOT NULL CHECK(length(consent_version) BETWEEN 1 AND 100), consent_text text NOT NULL CHECK(length(consent_text) BETWEEN 1 AND 2000),
 consent_hash text NOT NULL CHECK(consent_hash=encode(sha256(convert_to(consent_text,'UTF8')),'hex')), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,agreement_id,id),
 FOREIGN KEY(tenant_id,agreement_id,revision_id) REFERENCES dripsign.revision(tenant_id,agreement_id,id)
);
CREATE UNIQUE INDEX one_live_round ON dripsign.signing_round(tenant_id,agreement_id) WHERE status IN ('active','finalizing');
CREATE INDEX signing_round_agreement ON dripsign.signing_round(tenant_id,agreement_id,created_at DESC);
CREATE TABLE dripsign.required_signer (
 tenant_id uuid NOT NULL, agreement_id uuid NOT NULL, round_id uuid NOT NULL, grant_id uuid NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 email text NOT NULL CHECK(email=lower(email) AND length(email) BETWEEN 3 AND 254),
 PRIMARY KEY(tenant_id,round_id,grant_id),
 FOREIGN KEY(tenant_id,agreement_id,round_id) REFERENCES dripsign.signing_round(tenant_id,agreement_id,id),
 FOREIGN KEY(tenant_id,agreement_id,grant_id) REFERENCES dripsign.recipient_grant(tenant_id,agreement_id,id)
);
CREATE TABLE dripsign.signature (
 tenant_id uuid NOT NULL, round_id uuid NOT NULL, grant_id uuid NOT NULL,
 typed_name text NOT NULL CHECK(length(typed_name) BETWEEN 1 AND 200 AND typed_name=btrim(typed_name) AND typed_name !~ '[[:cntrl:]]'),
 consent_version text NOT NULL CHECK(length(consent_version) BETWEEN 1 AND 100), consent_text text NOT NULL CHECK(length(consent_text) BETWEEN 1 AND 2000),
 consent_hash text NOT NULL CHECK(consent_hash=encode(sha256(convert_to(consent_text,'UTF8')),'hex')),
 document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[a-f0-9]{64}$'), signed_at timestamptz NOT NULL DEFAULT now(),
 auth_session_id uuid NOT NULL, verified_at timestamptz NOT NULL, request_evidence jsonb NOT NULL CHECK(octet_length(request_evidence::text)<=2000),
 PRIMARY KEY(tenant_id,round_id,grant_id),
 FOREIGN KEY(tenant_id,round_id,grant_id) REFERENCES dripsign.required_signer(tenant_id,round_id,grant_id)
);
CREATE TABLE dripsign.archived_artifact (
 tenant_id uuid NOT NULL, round_id uuid NOT NULL, id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('signed_document','audit_record')),
 document jsonb NOT NULL, archived_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,round_id,kind),
 FOREIGN KEY(tenant_id,round_id) REFERENCES dripsign.signing_round(tenant_id,id)
);
CREATE TABLE dripsign.idempotency (
 tenant_id uuid NOT NULL REFERENCES dripsign.tenant(id), actor_key text NOT NULL, operation text NOT NULL, key text NOT NULL CHECK(length(key) BETWEEN 8 AND 200),
 request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,actor_key,operation,key)
);
CREATE TABLE dripsign.outbox (
 tenant_id uuid NOT NULL REFERENCES dripsign.tenant(id), id uuid NOT NULL, agreement_id uuid, kind text NOT NULL CHECK(kind IN ('invitation','otp','revision_published','agreement_executed','archive','ai_suggestion','proposal_ai_suggestion','pdf_prepare')),
 dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 300), payload jsonb NOT NULL CHECK(octet_length(payload::text)<=1000000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivering','delivered','uncertain','failed')),
 lease_token uuid, lease_until timestamptz, effect_started_at timestamptz, claimed_at timestamptz, available_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0, receipt text,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,dedupe_key),
 FOREIGN KEY(tenant_id,agreement_id) REFERENCES dripsign.agreement(tenant_id,id)
);
CREATE UNIQUE INDEX one_agreement_dispatch ON dripsign.outbox(tenant_id,agreement_id) WHERE status='delivering' AND agreement_id IS NOT NULL;
CREATE INDEX outbox_pending ON dripsign.outbox(tenant_id,created_at,id) WHERE status='pending';
CREATE INDEX outbox_expired ON dripsign.outbox(tenant_id,lease_until) WHERE status='delivering';
CREATE TABLE dripsign.otp_challenge (
 tenant_id uuid REFERENCES dripsign.tenant(id), id uuid PRIMARY KEY, scope jsonb NOT NULL, email text NOT NULL,
 code_hash text NOT NULL, challenge_token_hash text NOT NULL CHECK(challenge_token_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_pacing ON dripsign.otp_challenge(tenant_id,email,created_at DESC);
CREATE TABLE dripsign.auth_session (
 tenant_id uuid REFERENCES dripsign.tenant(id), id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE,
 actor jsonb NOT NULL, expires_at timestamptz NOT NULL, verified_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
ALTER TABLE dripsign.signature ADD FOREIGN KEY(auth_session_id) REFERENCES dripsign.auth_session(id);
CREATE TABLE dripsign.bridge_nonce (
 tenant_id uuid NOT NULL REFERENCES dripsign.tenant(id), nonce text NOT NULL CHECK(length(nonce) BETWEEN 16 AND 200),
 assertion jsonb NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(tenant_id,nonce)
);
CREATE FUNCTION dripsign.reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable evidence cannot be changed'; END;
$$;
CREATE TRIGGER immutable_revision BEFORE UPDATE OR DELETE ON dripsign.revision FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_mutation();
CREATE TRIGGER immutable_signature BEFORE UPDATE OR DELETE ON dripsign.signature FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_mutation();
CREATE TRIGGER immutable_artifact BEFORE UPDATE OR DELETE ON dripsign.archived_artifact FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_mutation();
CREATE TRIGGER immutable_signer_set BEFORE UPDATE OR DELETE ON dripsign.required_signer FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_mutation();
CREATE TRIGGER immutable_shared_message BEFORE UPDATE OR DELETE ON dripsign.shared_message FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_mutation();
CREATE TABLE dripsign.ai_reservation (
 tenant_id uuid NOT NULL, agreement_id uuid NOT NULL, job_id uuid NOT NULL, day date NOT NULL DEFAULT CURRENT_DATE,
 reserved_micros bigint NOT NULL CHECK(reserved_micros>0), actual_micros bigint CHECK(actual_micros>=0 AND actual_micros<=reserved_micros),
 PRIMARY KEY(tenant_id,job_id), FOREIGN KEY(tenant_id,agreement_id) REFERENCES dripsign.agreement(tenant_id,id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES dripsign.outbox(tenant_id,id)
);
CREATE INDEX ai_daily_admission ON dripsign.ai_reservation(tenant_id,day);

CREATE INDEX outbox_claim_global ON dripsign.outbox(claimed_at);
CREATE INDEX outbox_claim_tenant ON dripsign.outbox(tenant_id,claimed_at);
CREATE INDEX outbox_live_global ON dripsign.outbox(status,lease_until);
CREATE INDEX outbox_tenant_fairness ON dripsign.tenant(last_outbox_claim_at NULLS FIRST,id);
CREATE INDEX recipient_mailbox_lookup ON dripsign.recipient_grant(email,agreement_id,tenant_id) WHERE revoked_at IS NULL;
CREATE TABLE dripsign.otp_request(id uuid PRIMARY KEY,email text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX otp_request_pacing ON dripsign.otp_request(email,created_at DESC);
CREATE TABLE dripsign.outbox_claim (
 tenant_id uuid NOT NULL REFERENCES dripsign.tenant(id), id uuid PRIMARY KEY, job_id uuid NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,job_id) REFERENCES dripsign.outbox(tenant_id,id)
);
CREATE INDEX outbox_claim_rate_global ON dripsign.outbox_claim(claimed_at);
CREATE INDEX outbox_claim_rate_tenant ON dripsign.outbox_claim(tenant_id,claimed_at);
ALTER TABLE dripsign.agreement ADD UNIQUE(id);
CREATE FUNCTION dripsign.require_completed_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE finished_round uuid;
BEGIN
 IF NEW.status='signed' AND OLD.status IS DISTINCT FROM NEW.status THEN
  SELECT id INTO finished_round FROM dripsign.signing_round WHERE tenant_id=NEW.tenant_id AND agreement_id=NEW.id AND revision_id=NEW.current_revision_id AND status='completed';
  IF finished_round IS NULL OR NOT EXISTS(SELECT 1 FROM dripsign.required_signer WHERE tenant_id=NEW.tenant_id AND round_id=finished_round)
    OR EXISTS(SELECT 1 FROM dripsign.required_signer r LEFT JOIN dripsign.signature s ON s.tenant_id=r.tenant_id AND s.round_id=r.round_id AND s.grant_id=r.grant_id WHERE r.tenant_id=NEW.tenant_id AND r.round_id=finished_round AND s.grant_id IS NULL)
    OR (SELECT count(*) FROM dripsign.archived_artifact WHERE tenant_id=NEW.tenant_id AND round_id=finished_round)<>2
  THEN RAISE EXCEPTION 'Every required signature and both archived artifacts are required'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER agreement_completion_gate BEFORE UPDATE ON dripsign.agreement FOR EACH ROW EXECUTE FUNCTION dripsign.require_completed_evidence();

CREATE INDEX agreement_create_provenance ON dripsign.agreement(tenant_id,(create_provenance->>'subject'),(create_provenance->>'idempotencyKey')) WHERE create_provenance IS NOT NULL;

CREATE TABLE dripsign.proposal_ai_candidate (
 tenant_id uuid NOT NULL, agreement_id uuid NOT NULL, id uuid NOT NULL, proposal_id uuid NOT NULL, revision_id uuid NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'), job_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','ready','failed','uncertain','adopted')),
 suggestion jsonb CHECK(octet_length(suggestion::text)<=500000), created_at timestamptz NOT NULL DEFAULT now(), adopted_at timestamptz,
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,proposal_id), UNIQUE(tenant_id,job_id),
 FOREIGN KEY(tenant_id,agreement_id,proposal_id) REFERENCES dripsign.proposal(tenant_id,agreement_id,id),
 FOREIGN KEY(tenant_id,agreement_id,revision_id) REFERENCES dripsign.revision(tenant_id,agreement_id,id),
 FOREIGN KEY(tenant_id,job_id) REFERENCES dripsign.outbox(tenant_id,id),
 CHECK((status IN ('ready','adopted'))=(suggestion IS NOT NULL)), CHECK((status='adopted')=(adopted_at IS NOT NULL))
);
CREATE INDEX proposal_ai_private ON dripsign.proposal_ai_candidate(tenant_id,agreement_id,created_at DESC,id DESC);
CREATE FUNCTION dripsign.guard_signing_round() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.tenant_id,NEW.agreement_id,NEW.id,NEW.revision_id,NEW.document_sha256,NEW.consent_version,NEW.consent_text,NEW.consent_hash,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.tenant_id,OLD.agreement_id,OLD.id,OLD.revision_id,OLD.document_sha256,OLD.consent_version,OLD.consent_text,OLD.consent_hash,OLD.created_at)
 THEN RAISE EXCEPTION 'Frozen signing evidence cannot be changed'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF NOT ((OLD.status='active' AND NEW.status IN ('finalizing','void')) OR (OLD.status='finalizing' AND NEW.status='completed'))
  THEN RAISE EXCEPTION 'Signing round transition is invalid'; END IF;
  IF NEW.status IN ('finalizing','completed') AND (
   NOT EXISTS(SELECT 1 FROM dripsign.required_signer WHERE tenant_id=NEW.tenant_id AND round_id=NEW.id)
   OR EXISTS(SELECT 1 FROM dripsign.required_signer r LEFT JOIN dripsign.signature s ON s.tenant_id=r.tenant_id AND s.round_id=r.round_id AND s.grant_id=r.grant_id WHERE r.tenant_id=NEW.tenant_id AND r.round_id=NEW.id AND s.grant_id IS NULL))
  THEN RAISE EXCEPTION 'Every required signature is required'; END IF;
  IF NEW.status='completed' AND (SELECT count(*) FROM dripsign.archived_artifact WHERE tenant_id=NEW.tenant_id AND round_id=NEW.id)<>2
  THEN RAISE EXCEPTION 'Both archived artifacts are required'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER signing_round_evidence_gate BEFORE UPDATE ON dripsign.signing_round FOR EACH ROW EXECUTE FUNCTION dripsign.guard_signing_round();
CREATE TRIGGER immutable_signing_round_delete BEFORE DELETE ON dripsign.signing_round FOR EACH ROW EXECUTE FUNCTION dripsign.reject_evidence_mutation();
