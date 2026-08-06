/**
 * "Active now" / "Active 20m ago", from a last-seen timestamp.
 *
 * The backend stamps `last_seen` on any admin API request and hands over the
 * raw time — how fresh counts as "now" is a display decision, and it lives here
 * so the staff table and anything else that grows one can never disagree.
 *
 * The window is deliberately wider than the server's write throttle (45s): a
 * person sitting at their desk must not flicker offline between two stamps.
 */

export type PresenceState = "online" | "idle" | "away" | "never";

export interface Presence {
  state: PresenceState;
  label: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Under this, the person is treated as here right now. */
export const ONLINE_MS = 2 * MINUTE;
/** Under this, they were here a moment ago — a tab left open, or a short break. */
export const IDLE_MS = 15 * MINUTE;

export function describePresence(lastSeen: string | null, now: number = Date.now()): Presence {
  if (!lastSeen) return { state: "never", label: "Never signed in" };
  const seen = new Date(lastSeen).getTime();
  if (isNaN(seen)) return { state: "never", label: "Never signed in" };

  // A clock skew between server and browser must not read as the future.
  const ago = Math.max(0, now - seen);
  if (ago < ONLINE_MS) return { state: "online", label: "Active now" };

  const state: PresenceState = ago < IDLE_MS ? "idle" : "away";
  if (ago < HOUR) return { state, label: `Active ${Math.floor(ago / MINUTE)}m ago` };
  if (ago < DAY) return { state, label: `Active ${Math.floor(ago / HOUR)}h ago` };
  if (ago < 7 * DAY) return { state, label: `Active ${Math.floor(ago / DAY)}d ago` };

  return {
    state: "away",
    label: `Active ${new Date(seen).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Dhaka",
    })}`,
  };
}
