-- Runs once, when the PostgreSQL data volume is first created (docker-entrypoint-initdb.d).
-- `b17_dev` is created by POSTGRES_DB. The test database is separate so that the automated tests,
-- which reset their schema, can never touch development data. Its name MUST end in `_test`:
-- the test harness refuses to run against any other database name.
CREATE DATABASE b17_test;
