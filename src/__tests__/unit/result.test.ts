import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, unwrap, map } from "@contracts/result";
import { appError, isAppError, toResponse, statusFor } from "@contracts/errors";

describe("Result", () => {
  it("wraps success and failure", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err(appError("VALIDATION", "bad")))).toBe(true);
  });

  it("unwrap returns value on ok and throws on err", () => {
    expect(unwrap(ok(42))).toBe(42);
    expect(() => unwrap(err(appError("NOT_FOUND", "missing")))).toThrow();
  });

  it("map transforms ok and passes err through", () => {
    expect(unwrap(map(ok(2), (n) => n * 3))).toBe(6);
    const e = err<ReturnType<typeof appError>>(appError("INTERNAL", "x"));
    expect(map(e, (n: number) => n)).toBe(e);
  });
});

describe("AppError", () => {
  it("recognizes typed errors and maps codes to status", () => {
    expect(isAppError(appError("FORBIDDEN", "no"))).toBe(true);
    expect(isAppError({ code: "NOPE", message: "x" })).toBe(false);
    expect(statusFor("NOT_FOUND")).toBe(404);
    expect(toResponse(appError("VALIDATION", "bad")).status).toBe(400);
  });
});
