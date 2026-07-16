import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Check, X, ShieldCheck, Clock, Users, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface AdminProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  approved: boolean;
  approved_at: string | null;
  created_at: string;
}

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
    const { data: role } = await supabase
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) throw redirect({ to: "/board" });
  },
  component: AdminPage,
});

function AdminPage() {
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url, approved, approved_at, created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setProfiles((data ?? []) as AdminProfile[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setApproved = async (id: string, approved: boolean) => {
    setBusyId(id);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").update({
      approved,
      approved_at: approved ? new Date().toISOString() : null,
      approved_by: approved ? user?.id ?? null : null,
    }).eq("id", id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(approved ? "Kullanıcı onaylandı" : "Onay geri alındı");
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, approved, approved_at: approved ? new Date().toISOString() : null } : p));
  };

  const pending = profiles.filter((p) => !p.approved);
  const approved = profiles.filter((p) => p.approved);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <header className="flex items-start sm:items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> Kullanıcı Onayları
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Ekibe kimlerin katılacağını sen belirle.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
        </Button>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-amber-400 flex items-center gap-2">
          <Clock className="h-4 w-4" /> Onay bekleyenler
          <span className="text-xs text-muted-foreground">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 p-6 text-sm text-muted-foreground text-center">
            Onay bekleyen kimse yok.
          </div>
        ) : (
          <ul className="space-y-2">
            {pending.map((p) => (
              <UserRow key={p.id} p={p} busy={busyId === p.id} onApprove={() => setApproved(p.id, true)} onReject={() => setApproved(p.id, false)} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-emerald-400 flex items-center gap-2">
          <Users className="h-4 w-4" /> Onaylı üyeler
          <span className="text-xs text-muted-foreground">({approved.length})</span>
        </h2>
        <ul className="space-y-2">
          {approved.map((p) => (
            <UserRow key={p.id} p={p} busy={busyId === p.id} onApprove={() => setApproved(p.id, true)} onReject={() => setApproved(p.id, false)} approvedList />
          ))}
        </ul>
      </section>
    </div>
  );
}

function UserRow({ p, busy, onApprove, onReject, approvedList }: {
  p: AdminProfile; busy: boolean; onApprove: () => void; onReject: () => void; approvedList?: boolean;
}) {
  const name = p.full_name || p.email?.split("@")[0] || "İsimsiz";
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/40 p-3">
      {p.avatar_url ? (
        <img src={p.avatar_url} alt={name} className="h-10 w-10 rounded-full shrink-0" />
      ) : (
        <div className="h-10 w-10 rounded-full bg-primary/20 grid place-items-center text-sm font-medium text-primary shrink-0">
          {initials}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{name}</div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
          <Mail className="h-3 w-3" /> {p.email ?? "—"}
        </div>
      </div>
      {approvedList ? (
        <Button size="sm" variant="outline" onClick={onReject} disabled={busy} className="text-red-400 border-red-500/30 hover:bg-red-500/10">
          <X className="h-3.5 w-3.5 mr-1" /> Onayı kaldır
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onReject} disabled={busy} className="text-muted-foreground">
            <X className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={onApprove} disabled={busy} className="bg-emerald-500 hover:bg-emerald-600 text-white">
            <Check className="h-3.5 w-3.5 mr-1" /> Onayla
          </Button>
        </div>
      )}
    </li>
  );
}
