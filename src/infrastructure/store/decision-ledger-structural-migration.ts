export const DECISION_LEDGER_STRUCTURAL_LOOKUP_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS decision_ledger_approval_escalations
  ON decision_ledger(
    org_id,
    decision_id,
    ((payload_json::jsonb #>> '{stageId}')),
    sequence
  )
  WHERE event_type = 'ApprovalStageEscalated';
CREATE INDEX IF NOT EXISTS decision_ledger_execution_handles
  ON decision_ledger(
    org_id,
    ((payload_json::jsonb #>> '{executionHandleRef,id}')),
    sequence
  )
  WHERE event_type IN (
    'ExecutionSucceeded', 'ExecutionPartiallySucceeded',
    'StatusObserved', 'VerificationStuck'
  );
`;
