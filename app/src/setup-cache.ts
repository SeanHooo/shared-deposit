// The two test mints are the only irreplaceable identifiers in the operator setup.
// The mint keypair is generated in the browser and deliberately discarded, so its
// address cannot be recovered from a seed; the platform account only carries the
// addresses after `Initialize platform` succeeds. Between creating a mint and
// initializing the platform, React state is the only copy — and a reload erases it,
// which would strand an existing mint account nobody can name again.
//
// Keyed by RPC like the pending-transaction record, because a localnet mint address
// is meaningless on devnet.
import { RPC_URL } from "./transactions";

const storageKey = `passport:setup:${RPC_URL}`;

export type SetupCache = { usdcMint: string; usdtMint: string };

export function readSetupCache(): SetupCache {
  // Reading storage can throw outright: blocked cookies, Safari private mode, or a
  // non-browser test runner where `localStorage` is not defined at all.
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<SetupCache>;
    return { usdcMint: String(parsed?.usdcMint ?? ""), usdtMint: String(parsed?.usdtMint ?? "") };
  } catch {
    return { usdcMint: "", usdtMint: "" };
  }
}

export function writeSetupCache(value: SetupCache): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Storage may be unavailable or full. Losing the cache is not worth failing the
    // operator's transaction over.
  }
}
