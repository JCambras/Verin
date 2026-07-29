import gc01 from "../../../fixtures/golden/GC-01-firm-a-happy-path.json";
import gc02 from "../../../fixtures/golden/GC-02-firm-b-happy-path.json";
import gc03 from "../../../fixtures/golden/GC-03-recent-bank-change-firm-a.json";
import gc04 from "../../../fixtures/golden/GC-04-recent-bank-change-firm-b.json";
import gc05 from "../../../fixtures/golden/GC-05-insufficient-liquidity.json";
import gc06 from "../../../fixtures/golden/GC-06-household-restriction.json";
import gc07 from "../../../fixtures/golden/GC-07-regulatory-prohibition.json";
import gc08 from "../../../fixtures/golden/GC-08-ambiguous-household.json";
import gc09 from "../../../fixtures/golden/GC-09-stale-evidence.json";
import gc10 from "../../../fixtures/golden/GC-10-simultaneous-distributions-first.json";
import gc11 from "../../../fixtures/golden/GC-11-simultaneous-distributions-second.json";
import gc12 from "../../../fixtures/golden/GC-12-duplicate-retry.json";
import gc13 from "../../../fixtures/golden/GC-13-partial-salesforce-success.json";
import gc14 from "../../../fixtures/golden/GC-14-delayed-nigo.json";
import gc15 from "../../../fixtures/golden/GC-15-approval-invalidation.json";
import gc16 from "../../../fixtures/golden/GC-16-specialist-review-expiration.json";

export const RAW_SIGNED_CASES = [
  gc01,
  gc02,
  gc03,
  gc04,
  gc05,
  gc06,
  gc07,
  gc08,
  gc09,
  gc10,
  gc11,
  gc12,
  gc13,
  gc14,
  gc15,
  gc16,
] as const;
