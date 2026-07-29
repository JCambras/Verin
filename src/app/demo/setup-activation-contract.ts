import type {
  SetupAttestationChallengeVM,
  SetupSelections,
} from "./setup-model";

export interface SetupActivationDraft {
  readonly generation: number;
  readonly selections: SetupSelections;
}

export type SetupAttestationResult =
  | { readonly ok: true; readonly challenge: SetupAttestationChallengeVM }
  | { readonly ok: false; readonly error: string };

export interface SetupActivationCommand {
  readonly draftGeneration: number;
  readonly selections: SetupSelections;
  readonly attestationToken: string;
  readonly statementVersion: SetupAttestationChallengeVM["statementVersion"];
}
