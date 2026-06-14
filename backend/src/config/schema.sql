-- ============================================================
-- Shared Expense Manager — Database Schema
-- PostgreSQL 15+
-- ============================================================
-- Tables (in dependency order):
--   1. users
--   2. groups
--   3. group_members
--   4. expenses
--   5. expense_splits
--   6. settlements
--   7. import_sessions
--   8. import_anomalies
-- ============================================================

-- Drop in reverse dependency order (safe re-run)
DROP TABLE IF EXISTS import_anomalies   CASCADE;
DROP TABLE IF EXISTS import_sessions    CASCADE;
DROP TABLE IF EXISTS settlements        CASCADE;
DROP TABLE IF EXISTS expense_splits     CASCADE;
DROP TABLE IF EXISTS expenses           CASCADE;
DROP TABLE IF EXISTS group_members      CASCADE;
DROP TABLE IF EXISTS groups             CASCADE;
DROP TABLE IF EXISTS users              CASCADE;

-- ============================================================
-- 1. USERS
-- Stores registered accounts. Passwords are bcrypt hashed.
-- role: 'USER' (default) or 'ADMIN'
-- ============================================================
CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    email       VARCHAR(100)  NOT NULL UNIQUE,
    password    VARCHAR(255)  NOT NULL,
    role        VARCHAR(20)   NOT NULL DEFAULT 'USER',
    created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_users_role CHECK (role IN ('USER', 'ADMIN'))
);

CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- 2. GROUPS
-- A named collection of users who share expenses.
-- ============================================================
CREATE TABLE groups (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    creator_id  INTEGER       NOT NULL REFERENCES users(id),
    created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 3. GROUP_MEMBERS
-- Tracks temporal membership of a user inside a group.
-- joined_at: when the user became a member.
-- left_at:   NULL means still active; a date means they left.
--
-- BUSINESS RULE: A user may only appear in an expense if
-- expense_date is within [joined_at, left_at] (inclusive).
-- ============================================================
CREATE TABLE group_members (
    id          SERIAL PRIMARY KEY,
    group_id    INTEGER       NOT NULL REFERENCES groups(id)  ON DELETE CASCADE,
    user_id     INTEGER       NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    joined_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at     TIMESTAMP,

    CONSTRAINT uq_group_member UNIQUE (group_id, user_id, joined_at),
    CONSTRAINT chk_leave_after_join CHECK (left_at IS NULL OR left_at > joined_at)
);

-- Used by temporal queries: "who was active on date X?"
CREATE INDEX idx_group_members_timeline ON group_members(group_id, joined_at, left_at);

-- ============================================================
-- 4. EXPENSES
-- A single shared cost paid by one user for the group.
-- split_type determines how the amount is divided.
-- Currency fields support multi-currency with audit trail:
--   amount           = original value in original currency
--   currency         = 'INR' or 'USD'
--   exchange_rate    = rate at time of recording
--   converted_amount = amount × exchange_rate → always INR
-- ============================================================
CREATE TABLE expenses (
    id                 SERIAL PRIMARY KEY,
    group_id           INTEGER         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    payer_id           INTEGER         NOT NULL REFERENCES users(id),
    description        VARCHAR(255)    NOT NULL,
    amount             NUMERIC(12, 2)  NOT NULL,
    currency           VARCHAR(3)      NOT NULL,
    expense_date       TIMESTAMP       NOT NULL,
    split_type         VARCHAR(20)     NOT NULL,
    exchange_rate      NUMERIC(10, 4)  NOT NULL DEFAULT 1.0000,
    converted_amount   NUMERIC(12, 2)  NOT NULL,
    converted_currency VARCHAR(3)      NOT NULL DEFAULT 'INR',
    status             VARCHAR(20)     NOT NULL DEFAULT 'ACTIVE',
    created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_expenses_status     CHECK (status             IN ('DRAFT', 'ACTIVE', 'SETTLED', 'ARCHIVED')),
    CONSTRAINT chk_expenses_currency   CHECK (currency           IN ('INR', 'USD')),
    CONSTRAINT chk_expenses_conv_curr  CHECK (converted_currency IN ('INR', 'USD')),
    CONSTRAINT chk_expenses_split_type CHECK (split_type         IN ('EQUAL', 'PERCENTAGE', 'EXACT')),
    CONSTRAINT chk_expenses_amount     CHECK (amount > 0),
    CONSTRAINT chk_expenses_rate       CHECK (exchange_rate > 0)
);

CREATE INDEX idx_expenses_group_date ON expenses(group_id, expense_date);

-- ============================================================
-- 5. EXPENSE_SPLITS
-- One row per participant in an expense.
-- share_value meaning depends on the parent expense split_type:
--   EQUAL:      share_value = computed INR amount owed
--   PERCENTAGE: share_value = percent (e.g. 40.00 = 40%)
--   EXACT:      share_value = exact INR amount owed
-- ============================================================
CREATE TABLE expense_splits (
    id          SERIAL PRIMARY KEY,
    expense_id  INTEGER         NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id     INTEGER         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    share_value NUMERIC(12, 2)  NOT NULL,

    CONSTRAINT uq_split_per_expense_user UNIQUE (expense_id, user_id)
);

CREATE INDEX idx_expense_splits_expense ON expense_splits(expense_id);

-- ============================================================
-- 6. SETTLEMENTS
-- A direct payment between two users to clear a debt.
-- MUST remain separate from expenses — different semantics.
-- ============================================================
CREATE TABLE settlements (
    id               SERIAL PRIMARY KEY,
    group_id         INTEGER         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    from_user_id     INTEGER         NOT NULL REFERENCES users(id),
    to_user_id       INTEGER         NOT NULL REFERENCES users(id),
    amount           NUMERIC(12, 2)  NOT NULL,
    currency         VARCHAR(3)      NOT NULL,
    settlement_date  TIMESTAMP       NOT NULL,
    created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_settlements_currency CHECK (currency IN ('INR', 'USD')),
    CONSTRAINT chk_settlements_amount   CHECK (amount > 0),
    CONSTRAINT chk_settlements_no_self  CHECK (from_user_id <> to_user_id)
);

CREATE INDEX idx_settlements_group ON settlements(group_id, settlement_date);

-- ============================================================
-- 7. IMPORT_SESSIONS
-- One session per CSV upload. Stores staged CSV rows as JSONB
-- so we can replay them after user review without re-uploading.
-- status: PENDING → COMMITTED or REJECTED
-- ============================================================
CREATE TABLE import_sessions (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER       NOT NULL REFERENCES users(id),
    group_id        INTEGER       NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    file_name       VARCHAR(255)  NOT NULL,
    status          VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
    rows_processed  INTEGER       NOT NULL DEFAULT 0,
    rows_imported   INTEGER       NOT NULL DEFAULT 0,
    rows_skipped    INTEGER       NOT NULL DEFAULT 0,
    csv_data        JSONB         NOT NULL DEFAULT '[]',
    imported_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_session_status CHECK (status IN ('PENDING', 'COMMITTED', 'REJECTED'))
);

CREATE INDEX idx_import_sessions_group ON import_sessions(group_id, imported_at DESC);

-- ============================================================
-- 8. IMPORT_ANOMALIES
-- One row per anomaly detected in a CSV row.
-- severity:    INFO | WARNING | CRITICAL
-- action_taken: what the user decided (IMPORTED_AS_IS, RESOLVED_WITH_FIX, SKIPPED_BY_USER, etc.)
-- approved:    true once user has resolved this anomaly
-- ============================================================
CREATE TABLE import_anomalies (
    id                 SERIAL PRIMARY KEY,
    import_session_id  INTEGER       NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
    row_number         INTEGER       NOT NULL,
    anomaly_type       VARCHAR(60)   NOT NULL,
    severity           VARCHAR(20)   NOT NULL,
    description        VARCHAR(500)  NOT NULL,
    action_taken       VARCHAR(100),
    approved           BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_anomaly_severity CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL'))
);

CREATE INDEX idx_import_anomalies_session ON import_anomalies(import_session_id, row_number);
