\set ON_ERROR_STOP on

-- Run once on a dedicated PostgreSQL instance as its administrator. It fails if the roles or the
-- database already exist. Passwords are set privately afterwards. The administrator must be able
-- to create roles and databases and to make dripsign_migrator the database owner.
--   dripsign_migrator owns the database: `cli migrate` connects as it and creates the schema.
--   dripsign_app is the runtime login of web and worker: data access only, no DDL.
CREATE ROLE dripsign_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE dripsign_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE dripsign OWNER dripsign_migrator;
REVOKE ALL ON DATABASE dripsign FROM PUBLIC;
GRANT CONNECT ON DATABASE dripsign TO dripsign_app;

\connect dripsign
BEGIN;
-- The schema does not exist yet, so the runtime's access is a default privilege on whatever
-- dripsign_migrator creates. Tables get no TRUNCATE; functions are callable by the runtime only.
ALTER DEFAULT PRIVILEGES FOR ROLE dripsign_migrator GRANT USAGE ON SCHEMAS TO dripsign_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dripsign_migrator
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dripsign_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dripsign_migrator
  GRANT USAGE, SELECT ON SEQUENCES TO dripsign_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dripsign_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE dripsign_migrator GRANT EXECUTE ON FUNCTIONS TO dripsign_app;
ALTER ROLE dripsign_app IN DATABASE dripsign SET statement_timeout = '30s';
ALTER ROLE dripsign_app IN DATABASE dripsign SET idle_in_transaction_session_timeout = '30s';
COMMIT;
