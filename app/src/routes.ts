/**
 * Role routing: each console gets its own URL.
 *
 * The role panels are not separate applications — they are four views over one
 * program state machine, one wallet identity and one snapshot loader. What they
 * do need is a *distribution* boundary: a console must be linkable, bookmarkable
 * and showable in a video description on its own, and it must be possible to
 * move one console to its own origin later without touching its callers.
 *
 * A URL is exactly that boundary, and it is the cheapest one to add.
 *
 * Hash routing is deliberate. It never reaches the server, so the same build
 * works on any static host with no SPA rewrite rules, no server config and no
 * way to 404 a deep link. A path-based router would trade that away for
 * prettier URLs that nobody reads.
 */
export const ROLES = ["guest", "merchant", "operator", "keeper"] as const;

export type Role = (typeof ROLES)[number];

/** Visiting the bare origin shows the end user's own view. */
export const DEFAULT_ROLE: Role = "guest";

export const roleHash = (role: Role) => `#/${role}`;

export const roleLabel = (role: Role) =>
  `${role[0].toUpperCase()}${role.slice(1)}`;

export function roleFromHash(hash: string): Role | null {
  const key = hash.replace(/^#\/?/, "").toLowerCase();
  return (ROLES as readonly string[]).includes(key) ? (key as Role) : null;
}
