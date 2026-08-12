// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { appError } from "@contracts/errors";
import { demoVocabulary, slotLabel } from "@app/demo/vocabulary";
import { DemoUnavailable } from "@app/demo/surfaces/unavailable";

/**
 * THE DEMO STATION PAGE FAILS AS A VALUE, NOT AS A STACK TRACE (D-267).
 *
 * `/app/demo/[station]` renders on the SERVER and reads its labels from a
 * published domain configuration at request time. Removing that document must
 * break the journey - inventing labels would be the dead-configuration failure
 * prompt 10 exists to prevent - but the break has to be a rendered state carrying
 * the refusal's own quotable reference, which is the only thing the person looking
 * at the screen can hand to operations.
 *
 * The ABSENT-DOCUMENT path is proven where it can be proven without mutating a
 * content-hash-pinned artifact under a parallel suite: the resolution returns a
 * typed refusal here, and the domain-configuration fence proves the page renders
 * that refusal rather than driving a journey without it.
 */
const DEPLOYMENT_INTERNAL = /[\w-]+\.(?:ya?ml|json|tsx?)\b|\b[0-9a-f]{32,}\b|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

describe("the demo's configured vocabulary refuses as a value", () => {
  it("is not asserting on a broken baseline: the shipped document DOES resolve", () => {
    const resolved = demoVocabulary("firm-a");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(slotLabel(resolved.value, "household").length).toBeGreaterThan(0);
  });

  it("answers a branch this demo does not record without throwing", () => {
    const resolved = demoVocabulary("firm-zzz");
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    // NOT a configuration refusal: the published document is fine, so there is no
    // operator diagnosis and therefore no reference to quote.
    expect(resolved.error.code).toBe("NOT_FOUND");
    expect(resolved.error.context?.["correlationId"]).toBeUndefined();
    expect(resolved.error.message).not.toMatch(DEPLOYMENT_INTERNAL);
  });

  it("renders the refusal's reference, and no deployment internal", () => {
    const reference = "b1b7e0f2-4f2e-4a5f-9a5f-2f1c9d0e7a31";
    render(
      <DemoUnavailable
        error={appError(
          "INTERNAL",
          `This deployment's published configuration could not be resolved. Quote reference ${reference}.`,
          { stage: "unpublished", correlationId: reference },
        )}
      />,
    );
    expect(screen.getByText(new RegExp(reference))).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(DEPLOYMENT_INTERNAL);
  });

  it("renders an honest state for a refusal that minted no reference", () => {
    render(<DemoUnavailable error={appError("NOT_FOUND", "This demo does not record that firm.")} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("This journey cannot be shown");
    expect(text).not.toContain("quote reference");
  });
});
