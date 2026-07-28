import { buildMoneyMovementSetup } from "@app/demo/build-setup";
import { MoneyMovementSetupSurface } from "@app/demo/surfaces/setup";
import { activateSetup } from "./actions";

export const runtime = "nodejs";

export default function MoneyMovementSetupPage() {
  return (
    <MoneyMovementSetupSurface
      vm={buildMoneyMovementSetup()}
      activate={activateSetup}
    />
  );
}
