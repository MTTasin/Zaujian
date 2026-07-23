"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { login } from "@/lib/adminApi";
import { Card, AdminButton, Field, TextInput } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

export default function AdminLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      await login(String(fd.get("username")), String(fd.get("password")));
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-sm p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col items-center gap-2 pb-2 text-center">
            <span className="text-gold"><Icon name="logo" size={28} fill /></span>
            <div className="text-xl font-bold text-slate-900">
              Zaujain <span className="font-medium text-slate-400">Admin</span>
            </div>
          </div>

          <Field label="Username">
            <TextInput name="username" required autoFocus />
          </Field>
          <Field label="Password">
            <TextInput name="password" type="password" required />
          </Field>

          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-600">{error}</p>}

          <AdminButton type="submit" disabled={busy} className="w-full">
            {busy ? "…" : "Log in"}
          </AdminButton>
        </form>
      </Card>
    </div>
  );
}
