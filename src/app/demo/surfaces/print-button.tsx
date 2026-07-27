"use client";

/**
 * The record surface's one primary action. Buttons are hidden in print posture
 * (globals.css §9 print rules), so this control never appears on paper.
 */
import { Button } from "@app/presentation/ui";

export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      Print this record
    </Button>
  );
}
