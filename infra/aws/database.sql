\set ON_ERROR_STOP on

-- Run on a dedicated PostgreSQL instance as its administrator. Passwords are set privately.
CREATE ROLE dripsign_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE dripsign_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE dripsign_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT dripsign_owner TO dripsign_migrator;
CREATE DATABASE dripsign OWNER dripsign_owner;
REVOKE ALL ON DATABASE dripsign FROM PUBLIC;
GRANT CONNECT ON DATABASE dripsign TO dripsign_migrator, dripsign_app;

\connect dripsign
BEGIN;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SET ROLE dripsign_owner;
CREATE SCHEMA dripsign AUTHORIZATION dripsign_owner;
GRANT USAGE ON SCHEMA dripsign TO dripsign_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA dripsign
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dripsign_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA dripsign
  GRANT USAGE, SELECT ON SEQUENCES TO dripsign_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA dripsign REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
RESET ROLE;
ALTER ROLE dripsign_app IN DATABASE dripsign SET search_path = dripsign, pg_catalog;
ALTER ROLE dripsign_app IN DATABASE dripsign SET statement_timeout = '30s';
ALTER ROLE dripsign_app IN DATABASE dripsign SET idle_in_transaction_session_timeout = '30s';
COMMIT;
