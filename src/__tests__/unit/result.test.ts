import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, unwrap, map } from "@contracts/result";
import { appError, normalizeAppError, toResponse, statusFor, type AppError } from "@contracts/errors";

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
    expect(normalizeAppError(appError("FORBIDDEN", "no"))).not.toBeNull();
    expect(normalizeAppError({ code: "NOPE", message: "x" })).toBeNull();
    expect(statusFor("NOT_FOUND")).toBe(404);
    expect(toResponse(appError("VALIDATION", "bad")).status).toBe(400);
  });

  it("snapshots accessor-backed errors before downstream response handling", () => {
    let codeReads = 0;
    let messageReads = 0;
    const accessorError = {
      get code() {
        codeReads += 1;
        return codeReads === 1 ? "VALIDATION" : "secret@example.test";
      },
      get message() {
        messageReads += 1;
        return messageReads === 1 ? "Request rejected." : "secret@example.test";
      },
    };
    const normalized = normalizeAppError(accessorError);
    expect(normalized).toEqual({
      code: "VALIDATION",
      message: "The request could not be completed.",
    });
    expect(codeReads).toBe(1);
    expect(messageReads).toBe(0);
    expect(toResponse(normalized!)).toEqual({
      status: 400,
      body: {
        error: {
          code: "VALIDATION",
          message: "The request could not be completed.",
        },
      },
    });
    expect(codeReads).toBe(1);
    expect(messageReads).toBe(0);
  });

  it("degrades invalid or throwing error accessors without leaking or throwing", () => {
    const throwingMessage = {
      code: "VALIDATION",
      get message(): string {
        throw new Error("secret@example.test");
      },
    };
    expect(normalizeAppError(throwingMessage)).toEqual({
      code: "VALIDATION",
      message: "The request could not be completed.",
    });
    expect(toResponse(throwingMessage as AppError)).toEqual({
      status: 400,
      body: {
        error: {
          code: "VALIDATION",
          message: "The request could not be completed.",
        },
      },
    });
  });

  it("does not trust messages on AppError-shaped dependency failures", () => {
    expect(toResponse({
      code: "INTERNAL",
      message: "alice@example.test",
      context: { accountNumber: "1234-5678-9012" },
    })).toEqual({
      status: 500,
      body: {
        error: {
          code: "INTERNAL",
          message: "The request could not be completed.",
        },
      },
    });
  });
});
