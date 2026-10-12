import { getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { upgradeAuthority } from "../src/chain";

const OPERATOR = "CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF";

/**
 * Build a ProgramData account body: a 4-byte state discriminant, an 8-byte slot, then an
 * Option<Pubkey>. This mirrors what the loader writes and what the end-to-end harness
 * patches, so it is the shape the reading code has to agree with.
 */
function programData(authority: string | null) {
  const bytes = new Uint8Array(45);
  new DataView(bytes.buffer).setUint32(0, 3, true); // ProgramData
  new DataView(bytes.buffer).setBigUint64(4, 123_456_789n, true);
  if (authority !== null) {
    bytes[12] = 1;
    bytes.set(getAddressEncoder().encode(authority as never), 13);
  }
  return bytes;
}

describe("upgradeAuthority", () => {
  it("reads the address the loader wrote at offset 13", () => {
    expect(upgradeAuthority(programData(OPERATOR))).toBe(OPERATOR);
  });

  it("returns null when the Option tag says there is no authority", () => {
    // Byte 12 is the tag, so a 2 there is a malformed account rather than a Some.
    const bytes = programData(OPERATOR);
    bytes[12] = 2;
    expect(upgradeAuthority(bytes)).toBeNull();
  });

  it("returns null for a zeroed tag, which is what makes a program immutable", () => {
    expect(upgradeAuthority(programData(null))).toBeNull();
  });

  it("refuses a buffer too short to hold an authority instead of reading past it", () => {
    expect(upgradeAuthority(programData(OPERATOR).subarray(0, 44))).toBeNull();
    expect(upgradeAuthority(new Uint8Array(0))).toBeNull();
  });

  it("ignores the program body that follows, which is the real account shape", () => {
    // A deployed ProgramData account is 45 bytes of header plus the whole program. This
    // uses the actual length of the deployed artifact, because reading the authority
    // from a fixed-length buffer would work in a unit test and fail on devnet.
    const bytes = new Uint8Array(45 + 506_501);
    bytes.set(programData(OPERATOR));
    expect(bytes.length).toBe(506_546);
    expect(upgradeAuthority(bytes)).toBe(OPERATOR);
  });
});
