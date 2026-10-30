import { describe, expect, it } from "vitest";
import {
  MAX_PASSPORT_DEPOSIT_V2,
  MAX_RENTAL_DEPOSIT_V2,
  RENTAL_STATUS_V2,
  USDC_UNIT_V2,
  assertPassportCapacityV2,
  assertRentalAmountV2,
  formatUsdc,
  isFinalRentalStatus,
  parseUsdc,
  rentalStatusLabel,
} from "../src/program-v2";

describe("Shared Deposit v2 client domain", () => {
  it("parses and formats six-decimal USDC exactly", () => {
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(parseUsdc("50")).toBe(50n * USDC_UNIT_V2);
    expect(formatUsdc(12_340_000n)).toBe("12.34");
    expect(() => parseUsdc("0")).toThrow();
    expect(() => parseUsdc("1.0000001")).toThrow();
    expect(() => parseUsdc("-1")).toThrow();
  });

  it("mirrors the on-chain amount caps before transaction construction", () => {
    expect(() => assertRentalAmountV2(MAX_RENTAL_DEPOSIT_V2)).not.toThrow();
    expect(() =>
      assertRentalAmountV2(MAX_RENTAL_DEPOSIT_V2 + 1n),
    ).toThrow();
    expect(() =>
      assertPassportCapacityV2(0n, 0n, MAX_PASSPORT_DEPOSIT_V2),
    ).not.toThrow();
    expect(() =>
      assertPassportCapacityV2(99n * USDC_UNIT_V2, 0n, 2n * USDC_UNIT_V2),
    ).toThrow();
  });

  it("exposes every terminal rental state", () => {
    expect(rentalStatusLabel(RENTAL_STATUS_V2.ACTIVE)).toBe("ACTIVE");
    expect(rentalStatusLabel(RENTAL_STATUS_V2.DISPUTED)).toBe("DISPUTED");
    expect(rentalStatusLabel(RENTAL_STATUS_V2.PAID_TO_MERCHANT)).toBe(
      "PAID_TO_MERCHANT",
    );
    expect(isFinalRentalStatus(RENTAL_STATUS_V2.ACTIVE)).toBe(false);
    expect(isFinalRentalStatus(RENTAL_STATUS_V2.DISPUTED)).toBe(false);
    expect(isFinalRentalStatus(RENTAL_STATUS_V2.RETURNED)).toBe(true);
    expect(isFinalRentalStatus(RENTAL_STATUS_V2.TIMED_OUT)).toBe(true);
  });
});
