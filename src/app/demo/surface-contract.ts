import type { DemoStation } from "./model";

export interface DemoSurfaceDefinition {
  readonly number: number;
  readonly contractName: string;
  readonly station: DemoStation;
  readonly componentPath: string;
  readonly screenshotName: string;
}

export const DEMO_SURFACES = [
  {
    number: 1,
    contractName: "Household workspace",
    station: "workspace",
    componentPath: "src/app/demo/surfaces/workspace.tsx",
    screenshotName: "workspace",
  },
  {
    number: 2,
    contractName: "Contextual intent panel",
    station: "intent",
    componentPath: "src/app/demo/surfaces/intent.tsx",
    screenshotName: "intent",
  },
  {
    number: 3,
    contractName: "Evidence and conflict view",
    station: "evidence",
    componentPath: "src/app/demo/surfaces/evidence.tsx",
    screenshotName: "evidence",
  },
  {
    number: 4,
    contractName: "Recommendation and alternatives",
    station: "decision",
    componentPath: "src/app/demo/surfaces/recommendation.tsx",
    screenshotName: "decision",
  },
  {
    number: 5,
    contractName: "Policy and precedence trace",
    station: "policy-trace",
    componentPath: "src/app/demo/surfaces/policy-trace.tsx",
    screenshotName: "policy-trace",
  },
  {
    number: 6,
    contractName: "Approval stages and actor status",
    station: "authority",
    componentPath: "src/app/demo/surfaces/authority.tsx",
    screenshotName: "authority",
  },
  {
    number: 7,
    contractName: "Pre-execution safety check",
    station: "safety",
    componentPath: "src/app/demo/surfaces/safety.tsx",
    screenshotName: "safety",
  },
  {
    number: 8,
    contractName: "Execution timeline",
    station: "execution",
    componentPath: "src/app/demo/surfaces/execution.tsx",
    screenshotName: "execution",
  },
  {
    number: 9,
    contractName: "Verification state",
    station: "verification",
    componentPath: "src/app/demo/surfaces/verification.tsx",
    screenshotName: "verification",
  },
  {
    number: 10,
    contractName: "Firm A / Firm B comparison",
    station: "comparison",
    componentPath: "src/app/demo/surfaces/comparison.tsx",
    screenshotName: "comparison",
  },
  {
    number: 11,
    contractName: "Policy draft and simulation impact",
    station: "policy-authoring",
    componentPath: "src/app/demo/surfaces/policy-authoring.tsx",
    screenshotName: "policy-authoring",
  },
  {
    number: 12,
    contractName: "Printable examiner-grade decision artifact",
    station: "record",
    componentPath: "src/app/demo/surfaces/record.tsx",
    screenshotName: "record",
  },
] as const satisfies readonly DemoSurfaceDefinition[];
