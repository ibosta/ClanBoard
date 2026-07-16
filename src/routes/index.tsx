import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Kanban, Users, Zap, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import hyperushLogo from "@/assets/hyperush-logo.jpg";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/board", replace: true });
      else setChecking(false);
    });
  }, [navigate]);

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">Yükleniyor…</div>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/50 backdrop-blur-sm sticky top-0 z-10 bg-background/60">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={hyperushLogo} alt="Hyperush" className="h-9 w-9 rounded-lg object-cover ring-1 ring-border/60" />
            <span className="font-semibold tracking-tight">Hyperush</span>
          </div>
          <Link to="/auth">
            <Button variant="ghost" size="sm">Giriş yap</Button>
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-24 pb-32">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs text-muted-foreground mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Hyperush yazılım birimi için
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05]">
            Ekip görevlerinizi<br />
            <span className="bg-gradient-to-r from-primary via-primary/80 to-primary/50 bg-clip-text text-transparent">
              tek panelden yönetin
            </span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-xl leading-relaxed">
            Notion sadeliğiyle Kanban hızını birleştirdik. Yazılım işlerinizi ekipçe paylaşın, gerçek zamanlı olarak takip edin.
          </p>
          <div className="mt-8 flex gap-3">
            <Link to="/auth">
              <Button size="lg" className="gap-2">
                Panele giriş <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>

        <div className="mt-20 relative">
          <div className="absolute inset-0 bg-gradient-to-t from-primary/20 via-primary/5 to-transparent blur-3xl -z-10" />
          <div className="relative rounded-3xl border border-border/60 bg-card/30 backdrop-blur-sm p-6 md:p-10 overflow-hidden">
            <div className="absolute -bottom-10 -right-10 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-primary/80 mb-3">AXAR Projesi</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">Yenilikçi teknoloji, hızlı ekip.</h2>
              <p className="text-muted-foreground leading-relaxed max-w-2xl">
                Hyperush yazılım birimi, sahada iş yapan donanım ve yazılım projelerini aynı panelden takip eder. AXAR ve ortak paydaşlarımız için üretim hızıyla senkron çalışıyoruz.
              </p>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mt-24">
          {[
            { icon: Kanban, title: "Kanban board", desc: "Sürükle-bırak ile görevleri hareket ettirin." },
            { icon: Users, title: "Ekip senkron", desc: "Değişiklikler herkese anında yansır." },
            { icon: Zap, title: "Hızlı", desc: "Klavye ile hızlıca görev ekleyin." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-6 hover:border-primary/40 transition-colors">
              <f.icon className="h-5 w-5 text-primary mb-4" />
              <h3 className="font-semibold mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border/50 py-6 text-center text-xs text-muted-foreground">
        <Lock className="h-3 w-3 inline mr-1" /> Sadece ekip üyeleri erişebilir.
      </footer>
    </div>
  );
}
