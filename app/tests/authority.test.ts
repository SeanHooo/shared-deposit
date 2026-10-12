import { getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { mintAuthority, upgradeAuthority } from "../src/chain";

const OPERATOR = "CMNgjVqaaopNCZTsKBzD2zVxxQHMrFejNiaQW9iVXrxF";

/**
 * The USDC test mint account as devnet actually stores it, base64, 82 bytes. Its mint
 * authority is not the platform operator, which is exactly the situation the send-test-
 * tokens button has to detect, and using real bytes means the offsets cannot be validated
 * against a buffer that already agrees with the bug being guarded against.
 */
const REAL_MINT =
  "AQAAAEX2a+OvRNnaUr6/ZUCnuMQEUfyIr5mOi+GdN+8L2H6kAAAAAAAAAAAGAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
const REAL_MINT_AUTHORITY = "5i74v8jzv5Yjb2mTcKJYnr3oRcypVNTs1xrTPkJkKDPR";

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

describe("mintAuthority", () => {
  it("reads the authority out of a real devnet mint account", () => {
    expect(mintAuthority(Buffer.from(REAL_MINT, "base64"))).toBe(
      REAL_MINT_AUTHORITY,
    );
  });

  it("agrees with spl-token display about the rest of the account", () => {
    // The CLI reports decimals 6, a mint authority and no freeze authority for this
    // account. Checking the neighbours of offset 4 matters because the COption tag is
    // four bytes wide here and one byte wide in ProgramData: reading it as one byte
    // would return an address shifted by three and still look like a valid address.
    const bytes = Buffer.from(REAL_MINT, "base64");
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    expect(bytes.length).toBe(82);
    expect(view.getUint32(0, true)).toBe(1);
    expect(view.getBigUint64(36, true)).toBe(0n);
    expect(bytes[44]).toBe(6);
    expect(bytes[45]).toBe(1);
    expect(view.getUint32(46, true)).toBe(0);
  });

  it("returns null when the mint records no authority", () => {
    const bytes = Buffer.from(REAL_MINT, "base64");
    new DataView(bytes.buffer, bytes.byteOffset).setUint32(0, 0, true);
    expect(mintAuthority(bytes)).toBeNull();
  });

  it("returns null rather than reading past a short account", () => {
    expect(mintAuthority(Buffer.from(REAL_MINT, "base64").subarray(0, 81))).toBeNull();
  });

  it("does not confuse the mint authority with the upgrade authority", () => {
    // Different programs, different layouts, adjacent names. This asserts the two
    // readers are not accidentally sharing an implementation.
    const mint = Buffer.from(REAL_MINT, "base64");
    expect(mintAuthority(mint)).toBe(REAL_MINT_AUTHORITY);
    expect(upgradeAuthority(mint)).toBeNull();
  });
});
