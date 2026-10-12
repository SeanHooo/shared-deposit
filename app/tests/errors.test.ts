import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeError, programErrorName } from "../src/errors";

/** The shape @solana/kit throws when a transaction fails while being sized. */
function simulationFailure(logs: string[], causeMessage: string) {
  return Object.assign(
    new Error(
      "Transaction failed when it was simulated in order to estimate its resource limits. " +
        "The resource limit estimates provided are for a transaction that failed when " +
        "simulated and may not be representative of the resources this transaction would " +
        "consume if successful. Inspect the `cause` property of this error to learn more",
    ),
    { context: { __code: 5663037, logs }, cause: new Error(causeMessage) },
  );
}

const AUTHORITY_LOGS = [
  "Program Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o invoke [1]",
  "Program log: Instruction: InitializePlatform",
  "Program log: AnchorError caused by account: program_data. Error Code: InvalidAuthority. Error Number: 6017. Error Message: Only deployment authority may initialize platform.",
  "Program Bw5pP788g5eK117b7oA1dzSMg4N5ZG5vjcHpEKTzzN2o failed: custom program error: 0x1781",
];

describe("describeError", () => {
  it("names the failing constraint instead of leaving the operator to decode a hex code", () => {
    const text = describeError(
      simulationFailure(AUTHORITY_LOGS, "custom program error: 0x1781"),
    );
    expect(text).toContain("InvalidAuthority");
    expect(text).toContain("deployment authority");
    expect(text).toContain("upgrade authority");
    expect(text).toContain("program error 6017");
  });

  it("keeps the program logs, which name the account that rejected the constraint", () => {
    const text = describeError(
      simulationFailure(AUTHORITY_LOGS, "custom program error: 0x1781"),
    );
    expect(text).toContain("Program logs:");
    expect(text).toContain("AnchorError caused by account: program_data");
  });

  it("is strictly more informative than the message alone, which is the point", () => {
    const error = simulationFailure(AUTHORITY_LOGS, "custom program error: 0x1781");
    // This is what the application rendered before, and it says nothing useful.
    expect(String(error)).not.toContain("6017");
    expect(describeError(error)).toContain("6017");
  });

  it("falls back to the raw cause when the code is not one this program defines", () => {
    const text = describeError(simulationFailure([], "custom program error: 0x1799"));
    expect(text).toContain("0x1799");
    expect(text).toContain("Cause:");
  });

  it("reports a plain error without inventing logs", () => {
    expect(describeError(new Error("Platform is not initialized."))).toBe(
      "Platform is not initialized.",
    );
  });

  it("survives a thrown non-Error, and a cause that repeats the message", () => {
    expect(describeError("connect failed")).toBe("connect failed");
    const error = Object.assign(new Error("same"), { cause: new Error("same") });
    expect(describeError(error)).toBe("same");
  });

  it("does not print a log line twice when both the wrapper and its cause carry logs", () => {
    const cause = Object.assign(new Error("custom program error: 0x1781"), {
      context: { logs: AUTHORITY_LOGS },
    });
    const text = describeError(Object.assign(new Error("wrapped"), {
      context: { logs: AUTHORITY_LOGS },
      cause,
    }));
    expect(text.match(/Instruction: InitializePlatform/g)).toHaveLength(1);
  });

  it("matches the program's own ErrorCode enum, so the numbers cannot drift", () => {
    const source = readFileSync(
      new URL("../../programs/shared-deposit-passport/src/lib.rs", import.meta.url),
      "utf8",
    );
    const enumBody = source.slice(source.indexOf("pub enum ErrorCode"));
    const variants = [...enumBody.matchAll(/#\[msg\("([^"]+)"\)\]\s*([A-Za-z]+),/g)].map(
      (match) => ({ message: match[1], name: match[2] }),
    );
    expect(variants.length).toBeGreaterThan(10);
    variants.forEach(({ name, message }, index) => {
      const entry = programErrorName(6000 + index);
      expect(entry, `missing entry for ${name}`).toBeDefined();
      expect(entry).toContain(name);
      expect(entry).toContain(message);
    });
    // Nothing beyond the enum.
    expect(programErrorName(6000 + variants.length)).toBeUndefined();
  });
});
