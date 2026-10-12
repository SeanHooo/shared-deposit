// A failure that reaches the screen is almost never the error object that explains it.
//
// When a transaction fails during the simulation @solana/kit runs to size it, the value
// thrown is a wrapper whose message says only that the simulation failed and invites you
// to inspect `cause`. The two fields that explain anything are `context.logs`, which is
// the program's own log output, and `cause`, which decodes to something like
// "custom program error: 0x1781". Neither survives `String(error)`, which is how this
// application used to render failures — so a rejected constraint and a genuinely broken
// program looked identical, and the operator had no way to tell which wallet or which
// account was wrong.
//
// The program numbers its own errors from 6000 in the order of its ErrorCode enum, so a
// hex code resolves back to a name. A test asserts this table against
// programs/shared-deposit-passport/src/lib.rs so the numbers cannot drift silently.
const PROGRAM_ERRORS: Record<number, string> = {
  6000: "InvalidAsset — Invalid or unregistered asset. The mint is not one of the two the platform registered, or its decimals are not 6.",
  6001: "InvalidAmount — Amount must be positive.",
  6002: "Overflow — Arithmetic overflow.",
  6003: "InsufficientAvailable — Insufficient available balance for this withdrawal.",
  6004: "AccountUnavailable — This asset is locked or frozen, so it cannot move right now.",
  6005: "MerchantInactive — Merchant is inactive.",
  6006: "AuthorizationUnavailable — Authorization revoked or already consumed.",
  6007: "AuthorizationExpired — Authorization or rental due time expired.",
  6008: "ConcurrentLock — Another rental is active on this passport.",
  6009: "MinimumBalance — Minimum reserve would be violated.",
  6010: "InvalidNonce — Stale or duplicate nonce; this signature was already used.",
  6011: "InvalidLockState — Rental is not in the required state for this action.",
  6012: "InvalidReturnStatus — Invalid return status.",
  6013: "TooEarly — 180 days have not elapsed, so keeper release is not available yet.",
  6014: "InvalidInput — Invalid input length or due time. The item id must be 1 to 64 bytes and the due time must be in the future.",
  6015: "InvalidPhoto — Photo URL must be HTTPS and at most 256 bytes.",
  6016: "InvalidRules — Unsupported rules version.",
  6017: "InvalidAuthority — Only deployment authority may initialize platform. The connected wallet is not the program's upgrade authority.",
};

const CUSTOM_ERROR = /custom program error: 0x([0-9a-f]+)/i;

export function programErrorName(code: number): string | undefined {
  return PROGRAM_ERRORS[code];
}

/** The error's `context.logs`, which is where the program's own output lives. */
function collectLogs(candidates: unknown[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const logs = (candidate as { context?: { logs?: unknown } }).context?.logs;
    if (!Array.isArray(logs)) continue;
    for (const line of logs) {
      if (typeof line !== "string" || seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}

export function describeError(error: unknown): string {
  const cause =
    typeof error === "object" && error !== null
      ? (error as { cause?: unknown }).cause
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const causeText =
    cause instanceof Error ? cause.message : cause === undefined ? "" : String(cause);
  const match = causeText.match(CUSTOM_ERROR) ?? message.match(CUSTOM_ERROR);
  const code = match ? parseInt(match[1], 16) : undefined;
  const named = code === undefined ? undefined : PROGRAM_ERRORS[code];

  const parts = [
    named === undefined ? message : `${named}\n(program error ${code})`,
  ];
  // Only repeat the cause when it is not already what we just reported.
  if (named === undefined && causeText && causeText !== message) {
    parts.push(`Cause: ${causeText}`);
  }
  const logs = collectLogs([error, cause]);
  if (logs.length) parts.push(`Program logs:\n${logs.join("\n")}`);
  return parts.join("\n");
}
