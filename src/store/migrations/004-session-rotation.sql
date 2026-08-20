-- 004-session-rotation (prompt 2 PR-2c): the shipped session policy pinned every write to the
-- presented-token GUC, which a rotation by construction violates - and PostgreSQL also requires the
-- post-update row to satisfy USING, proven in this PR's probe transcript. The policy is REPLACED
-- (the shipped 001 file is never edited) with one carrying the rotation arm in both clauses: the
-- second GUC, verin.session_token_next, is set only by the session-rotation transaction class, and
-- current_setting(..., true) is NULL everywhere else, so nothing widens for any other operation.
DROP POLICY session_token_scoped ON session;
CREATE POLICY session_token_scoped ON session FOR ALL
  USING (token_hash = current_setting('verin.session_token_hash', true)
      OR token_hash = current_setting('verin.session_token_next', true))
  WITH CHECK (token_hash = current_setting('verin.session_token_hash', true)
      OR token_hash = current_setting('verin.session_token_next', true));
