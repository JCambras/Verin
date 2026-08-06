import { loadMoneyMovementSetup } from "@app/demo/build-setup";
import { MoneyMovementSetupSurface } from "@app/demo/surfaces/setup";
import { SurfaceShell } from "@app/demo/surfaces/shared";
import { activateSetup, attestSetupDraft } from "./actions";

export const runtime = "nodejs";

export default function MoneyMovementSetupPage() {
  const setup = loadMoneyMovementSetup();
  if (!setup.ok) {
    return (
      <SurfaceShell
        title="Demonstration setup unavailable"
        description="The setup failed closed before any projection without a signed case behind it could be shown."
      >
        <p
          role="alert"
          className="break-words rounded-lg border border-destructive bg-white p-4 text-sm text-destructive"
        >
          {setup.error}
        </p>
      </SurfaceShell>
    );
  }
  return (
    <MoneyMovementSetupSurface
      vm={setup.vm}
      attest={attestSetupDraft}
      activate={activateSetup}
    />
  );
}
