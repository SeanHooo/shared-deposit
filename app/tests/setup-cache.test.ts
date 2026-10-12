import { afterEach, describe, expect, it, vi } from "vitest";
import { readSetupCache, writeSetupCache } from "../src/setup-cache";

// The mint addresses are the only irreplaceable value in the operator setup: the mint
// keypair is generated in the browser and discarded, so the address cannot be derived
// again. These tests cover the cases where reading storage does not simply work.
const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("operator setup cache", () => {
  it("returns empty strings and does not throw when storage is missing", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readSetupCache()).toEqual({ usdcMint: "", usdtMint: "" });
    expect(() => writeSetupCache({ usdcMint: "a", usdtMint: "b" })).not.toThrow();
  });

  it("round-trips both mint addresses", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    writeSetupCache({ usdcMint: "MintA", usdtMint: "MintB" });
    expect(readSetupCache()).toEqual({ usdcMint: "MintA", usdtMint: "MintB" });
  });

  it("survives storage that throws on write, as private mode does", () => {
    vi.stubGlobal("localStorage", {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(() => writeSetupCache({ usdcMint: "a", usdtMint: "b" })).not.toThrow();
  });

  it("falls back to empty on malformed or unexpected stored values", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    writeSetupCache({ usdcMint: "MintA", usdtMint: "MintB" });
    const key = [...Array(storage.length).keys()]
      .map((index) => storage.key(index)!)
      .find((name) => name.startsWith("passport:setup:"))!;
    expect(key).toBeDefined();

    storage.setItem(key, "{not json");
    expect(readSetupCache()).toEqual({ usdcMint: "", usdtMint: "" });

    // A wrong shape must not surface `undefined` in an input value.
    storage.setItem(key, JSON.stringify({ usdcMint: 42 }));
    expect(readSetupCache()).toEqual({ usdcMint: "42", usdtMint: "" });
  });
});
