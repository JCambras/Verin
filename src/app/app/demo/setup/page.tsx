import { buildMoneyMovementSetup } from "@app/demo/build-setup";
import { MoneyMovementSetupSurface } from "@app/demo/surfaces/setup";

export const runtime = "nodejs";

export default function MoneyMovementSetupPage() {
  return <MoneyMovementSetupSurface vm={buildMoneyMovementSetup()} />;
}
