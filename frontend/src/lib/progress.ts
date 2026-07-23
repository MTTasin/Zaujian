// Session-scoped "did this visitor do something meaningful" flag. Used to gate the
// help nudge popup — once real progress is made, we stop pestering the visitor.

const KEY = "hn_progress";

export function markProgress(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // sessionStorage unavailable (private mode / SSR) — ignore.
  }
}

export function hasProgress(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
