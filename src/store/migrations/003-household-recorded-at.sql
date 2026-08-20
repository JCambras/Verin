-- 003-household-recorded-at: the instant a household record entered the store, carried NULLABLE with
-- no default - a default cannot answer for rows that already exist, and a NULL renders as an honest
-- "recorded date not on file" absent state rather than a minted timestamp. Writers (the seed, and
-- every later real path) set it explicitly at their insert.
ALTER TABLE household ADD COLUMN recorded_at timestamptz;
