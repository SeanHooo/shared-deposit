import { describe, expect, it } from "vitest";
import { getAddressEncoder } from "@solana/kit";
import * as p from "../src/program";
import {
  assertNetwork,
  decodeChecked,
  DEVNET_GENESIS,
  type PassportRpc,
} from "../src/chain";

describe("precision and RPC trust boundaries", () => {
  it("preserves integer precision beyond Number.MAX_SAFE_INTEGER and rejects coercion", () => {
    expect(p.parseAmount("18446744073.709551615", "SOL")).toBe(
      18446744073709551615n,
    );
    expect(p.formatAmount(18446744073709551615n, "SOL")).toBe(
      "18446744073.709551615",
    );
    expect(p.parseAmount("0.000000001", "SOL")).toBe(1n);
    expect(p.parseAmount("0.000001", "USDC")).toBe(1n);
    for (const input of [
      "0",
      "-1",
      "1e6",
      "Infinity",
      "NaN",
      "1.0000001",
      " 1",
      "",
      "18446744073710",
    ])
      expect(() => p.parseAmount(input, "USDC")).toThrow();
  });
  it("rejects wrong owner, discriminator and allocated size before decoding", () => {
    const bytes = new Uint8Array(105);
    bytes.set(p.PLATFORM_DISCRIMINATOR);
    for (const offset of [8, 40, 72])
      bytes.set(getAddressEncoder().encode(p.ZERO), offset);
    expect(
      decodeChecked(
        bytes,
        p.PROGRAM_ADDRESS,
        p.PLATFORM_DISCRIMINATOR,
        p.getPlatformDecoder(),
      ).operator,
    ).toBe(p.ZERO);
    expect(() =>
      decodeChecked(
        bytes,
        p.ZERO,
        p.PLATFORM_DISCRIMINATOR,
        p.getPlatformDecoder(),
      ),
    ).toThrow();
    expect(() =>
      decodeChecked(
        bytes.slice(0, 104),
        p.PROGRAM_ADDRESS,
        p.PLATFORM_DISCRIMINATOR,
        p.getPlatformDecoder(),
      ),
    ).toThrow();
    bytes[0] = 0;
    expect(() =>
      decodeChecked(
        bytes,
        p.PROGRAM_ADDRESS,
        p.PLATFORM_DISCRIMINATOR,
        p.getPlatformDecoder(),
      ),
    ).toThrow();
  });
  it("only accepts the full devnet genesis hash for a remote RPC", async () => {
    const rpc = (hash: string) =>
      ({
        getGenesisHash: () => ({ send: async () => hash }),
      }) as unknown as PassportRpc;
    await expect(
      assertNetwork(rpc(DEVNET_GENESIS), false),
    ).resolves.toBeUndefined();
    await expect(
      assertNetwork(rpc(DEVNET_GENESIS.slice(0, 30)), false),
    ).rejects.toThrow();
    await expect(
      assertNetwork(rpc("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), false),
    ).rejects.toThrow();
  });
});
