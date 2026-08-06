"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { adminGet, getToken } from "@/lib/adminApi";
import { can, isReadOnly, type AdminMe } from "@/lib/adminAuth";

interface AuthValue {
  me: AdminMe | null;
  loading: boolean;
  /** Can the current user read (default) or write this section? */
  can: (section: string, mode?: "read" | "write") => boolean;
  /** Readable but not writable — pages show a "View only" pill. */
  readOnly: (section: string) => boolean;
}

const Ctx = createContext<AuthValue>({
  me: null,
  loading: true,
  can: () => false,
  readOnly: () => false,
});

/**
 * Fetches who is logged in once per panel mount and hands the access map down.
 * Purely for rendering decisions — the backend re-checks every request, so a
 * user who edits this in devtools just gets 403s from a prettier page.
 */
export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);

  // Re-checked on navigation, not just on mount: logging in is a client-side
  // route change, so the provider never remounts and would otherwise stay
  // stuck on the anonymous "no sections" answer.
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    // No token = the login page. Asking who we are would 401, and a 401 sends
    // the browser to /admin/login — which is where we already are.
    if (!getToken()) { setMe(null); setLoading(false); return; }
    if (me) return;  // already know this session
    setLoading(true);
    adminGet<AdminMe>("me/")
      .then((data) => alive && setMe(data))
      .catch(() => alive && setMe(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [pathname, me]);

  return (
    <Ctx.Provider
      value={{
        me,
        loading,
        can: (section, mode = "read") => can(me, section, mode),
        readOnly: (section) => isReadOnly(me, section),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAdminAuth = () => useContext(Ctx);

/**
 * `const canWrite = useCanWrite("orders")` — the one line most pages need to
 * disable their write controls.
 */
export function useCanWrite(section: string): boolean {
  return useAdminAuth().can(section, "write");
}
