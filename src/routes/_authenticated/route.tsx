import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, Github, Check, ShieldCheck, Clock, Mail, Bell, BellRing, Megaphone, MessageSquare, CheckSquare, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-server-fn";
import { toast } from "sonner";
import { getGithubStatus, disconnectGithub } from "@/lib/github.functions";
import hyperushLogo from "@/assets/hyperush-logo.jpg";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

interface Notification {
  id: string;
  user_id: string;
  title: string;
  content: string;
  type: string; // 'comment' | 'task' | 'announcement'
  task_id: string | null;
  comment_id: string | null;
  read: boolean;
  created_at: string;
}

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const [profile, setProfile] = useState<{ full_name: string | null; avatar_url: string | null; approved: boolean } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [gh, setGh] = useState<{ connected: boolean; github_login?: string | null; github_avatar_url?: string | null } | null>(null);
  const [ghBusy, setGhBusy] = useState(false);

  // Notifications State
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  // Announcement Dialog State
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [announceTitle, setAnnounceTitle] = useState("");
  const [announceContent, setAnnounceContent] = useState("");
  const [announcing, setAnnouncing] = useState(false);

  const sendTestNotification = () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        const notif = new Notification("Hyperush Test Bildirimi", {
          body: "PC bildirimleriniz başarıyla aktif edildi! Sistem bildirimleri bu şekilde görünecektir.",
          icon: "/favicon.ico",
        });
        notif.onclick = () => {
          window.focus();
          toast.success("Test bildirimine tıkladınız!");
        };
      } else {
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") {
            const notif = new Notification("Hyperush Test Bildirimi", {
              body: "PC bildirimleriniz başarıyla aktif edildi!",
              icon: "/favicon.ico",
            });
            notif.onclick = () => {
              window.focus();
            };
          } else {
            toast.error("Bildirim izni reddedildi. Lütfen tarayıcı ayarlarından bildirimlere izin verin.");
          }
        });
      }
    } else {
      toast.error("Tarayıcınız sistem bildirimlerini desteklemiyor.");
    }
  };

  const doStatus = useServerFn(getGithubStatus);
  const doDisconnect = useServerFn(disconnectGithub);

  useEffect(() => {
    const meta = (user.user_metadata || {}) as { full_name?: string; name?: string; avatar_url?: string };
    (async () => {
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email ?? null,
        full_name: meta.full_name || meta.name || user.email?.split("@")[0] || null,
        avatar_url: meta.avatar_url || null,
      }, { onConflict: "id", ignoreDuplicates: true });
      const { data: p } = await supabase.from("profiles").select("full_name, avatar_url, approved").eq("id", user.id).maybeSingle();
      setProfile(p as typeof profile);
      const { data: r } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      setIsAdmin(!!r);
      setProfileLoading(false);
    })();
  }, [user.id, user.email, user.user_metadata]);

  // Load and Subscribe to Notifications
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(console.error);
    }

    supabase.from("notifications").select("*").then(({ data }) => {
      if (data) setNotifications(data as Notification[]);
    });

    const ch = supabase.channel(`notifications-changes-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => {
        setNotifications((prev) => {
          if (payload.eventType === "INSERT") {
            const n = payload.new as Notification;
            if (prev.some((x) => x.id === n.id)) return prev;
            toast(n.title, {
              description: n.content,
              action: n.task_id ? {
                label: "Git",
                onClick: () => navigate({ to: "/board", search: { taskId: n.task_id, commentId: n.comment_id || undefined } }),
              } : undefined,
            });

            if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
              try {
                const nativeNotif = new Notification(n.title, {
                  body: n.content,
                  tag: n.id,
                });
                nativeNotif.onclick = () => {
                  window.focus();
                  if (n.task_id) {
                    navigate({ to: "/board", search: { taskId: n.task_id, commentId: n.comment_id || undefined } });
                  }
                };
              } catch (e) {
                console.error("Failed to show native notification:", e);
              }
            }

            return [n, ...prev];
          }
          if (payload.eventType === "UPDATE") {
            const n = payload.new as Notification;
            return prev.map((x) => (x.id === n.id ? n : x));
          }
          if (payload.eventType === "DELETE") {
            return prev.filter((x) => x.id !== (payload.old as Notification).id);
          }
          return prev;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [user.id, navigate]);

  useEffect(() => {
    doStatus({}).then((s) => setGh(s as typeof gh)).catch(() => setGh({ connected: false }));
  }, [doStatus]);

  // Handle post-callback banner
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("github");
    if (!flag) return;
    if (flag === "connected") toast.success("GitHub bağlandı");
    else if (flag === "error") toast.error(params.get("reason") || "GitHub bağlantısı başarısız");
    params.delete("github");
    params.delete("reason");
    const q = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (q ? `?${q}` : ""));
    doStatus({}).then((s) => setGh(s as typeof gh)).catch(() => {});
  }, [doStatus]);

  const connectGithub = () => {
    setGhBusy(true);
    window.location.href = "/api/auth/github/start";
  };

  const disconnect = async () => {
    setGhBusy(true);
    try { await doDisconnect({}); setGh({ connected: false }); toast.success("GitHub bağlantısı kaldırıldı"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Kaldırılamadı"); }
    finally { setGhBusy(false); }
  };

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const handleNotificationClick = async (notif: Notification) => {
    if (!notif.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", notif.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
      );
    }
    setDropdownOpen(false);
    if (notif.task_id) {
      navigate({ to: "/board", search: { taskId: notif.task_id, commentId: notif.comment_id || undefined } });
    }
  };

  const handleOpenChange = (open: boolean) => {
    setDropdownOpen(open);
    // Mark announcements as read automatically when dropdown is toggled
    const unreadAnnouncements = notifications.some((n) => n.type === "announcement" && !n.read);
    if (unreadAnnouncements) {
      fetch("/api/notifications/read-announcements", { method: "POST" })
        .then((res) => {
          if (res.ok) {
            setNotifications((prev) =>
              prev.map((n) => (n.type === "announcement" ? { ...n, read: true } : n))
            );
          }
        })
        .catch(console.error);
    }
  };

  const handleSendAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!announceTitle.trim() || !announceContent.trim()) {
      toast.error("Başlık ve içerik gereklidir.");
      return;
    }
    setAnnouncing(true);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: announceTitle, content: announceContent }),
      });
      if (res.ok) {
        toast.success("Duyuru başarıyla tüm kullanıcılara gönderildi.");
        setAnnounceTitle("");
        setAnnounceContent("");
        setAnnouncementOpen(false);
      } else {
        toast.error("Duyuru gönderilemedi.");
      }
    } catch (err) {
      toast.error("Duyuru gönderilirken bir hata oluştu.");
    } finally {
      setAnnouncing(false);
    }
  };

  const name = profile?.full_name || user.email?.split("@")[0] || "Kullanıcı";
  const initials = name.slice(0, 2).toUpperCase();

  // Derived: unread count for badge
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Derived: unread notifications + latest 3 read notifications (rendered as faded)
  const displayedNotifications = useMemo(() => {
    const unread = notifications.filter((n) => !n.read);
    const read = notifications.filter((n) => n.read).slice(0, 3);
    return [...unread, ...read];
  }, [notifications]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/50 backdrop-blur-sm sticky top-0 z-20 bg-background/70">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-3 flex items-center gap-2 sm:gap-3">
          <Link to="/board" className="flex items-center gap-2 min-w-0 shrink">
            <img src={hyperushLogo} alt="Hyperush" className="h-9 w-9 rounded-lg object-cover ring-1 ring-border/60 shrink-0" />
            <div className="hidden sm:flex flex-col leading-tight min-w-0">
              <span className="font-semibold tracking-tight text-sm truncate">Hyperush</span>
              <span className="text-[10px] text-muted-foreground truncate">Yazılım Ekibi</span>
            </div>
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto">
            <div className="hidden sm:flex items-center gap-2 text-sm">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={name} className="h-7 w-7 rounded-full" />
              ) : (
                <div className="h-7 w-7 rounded-full bg-primary/20 grid place-items-center text-xs font-medium text-primary">
                  {initials}
                </div>
              )}
              <span className="hidden md:inline text-muted-foreground truncate max-w-[10rem]">{name}</span>
            </div>
            
            {/* Real-time Notifications Popover */}
            <Popover open={dropdownOpen} onOpenChange={handleOpenChange}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-8 w-8 rounded-full border border-border/40 hover:bg-muted/50 cursor-pointer">
                  {unreadCount > 0 ? (
                    <>
                      <BellRing className="h-4 w-4 text-primary animate-pulse" />
                      <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
                        {unreadCount}
                      </span>
                    </>
                  ) : (
                    <Bell className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 shadow-lg border border-border/60 backdrop-blur-md bg-background/90" align="end">
                <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">Bildirimler</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={sendTestNotification}
                      className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Test Bildirimi Gönder"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {isAdmin && (
                    <Dialog open={announcementOpen} onOpenChange={setAnnouncementOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs cursor-pointer">
                          <Megaphone className="h-3 w-3" />
                          Duyuru Yap
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[425px]">
                        <form onSubmit={handleSendAnnouncement} className="space-y-4">
                          <DialogHeader>
                            <DialogTitle>Duyuru Gönder</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <Label htmlFor="announce-title" className="text-xs">Duyuru Başlığı</Label>
                              <Input id="announce-title" value={announceTitle} onChange={(e) => setAnnounceTitle(e.target.value)} placeholder="Örn: Yeni sunucu taşınması" required />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="announce-content" className="text-xs">Duyuru İçeriği</Label>
                              <Textarea id="announce-content" value={announceContent} onChange={(e) => setAnnounceContent(e.target.value)} placeholder="İçeriği girin..." rows={4} required />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button type="submit" size="sm" disabled={announcing} className="cursor-pointer">
                              {announcing ? "Gönderiliyor..." : "Duyuruyu Yayınla"}
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {displayedNotifications.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">Bildirim yok</div>
                  ) : (
                    displayedNotifications.map((notif) => {
                      const Icon = notif.type === "task" ? CheckSquare : notif.type === "comment" ? MessageSquare : Megaphone;
                      const iconColor = notif.type === "task" ? "text-blue-500" : notif.type === "comment" ? "text-emerald-500" : "text-amber-500";
                      
                      return (
                        <div
                          key={notif.id}
                          onClick={() => handleNotificationClick(notif)}
                          className={cn(
                            "flex gap-3 px-4 py-3 border-b border-border/30 cursor-pointer transition-colors hover:bg-muted/30 relative",
                            notif.read ? "opacity-55" : "bg-primary/5 hover:bg-primary/10"
                          )}
                        >
                          <div className="mt-0.5 shrink-0">
                            <Icon className={cn("h-4 w-4", iconColor)} />
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className={cn("text-xs font-semibold truncate", !notif.read && "text-foreground font-bold")}>{notif.title}</p>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: tr }).replace("yaklaşık", "").trim()}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{notif.content}</p>
                          </div>
                          {!notif.read && (
                            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {gh?.connected ? (
              <Button variant="outline" size="sm" onClick={disconnect} disabled={ghBusy} className="gap-1.5 border-emerald-500/40 text-emerald-500 hover:text-emerald-400 px-2 sm:px-3" title={`Bağlı: ${gh.github_login ?? ""}`}>
                <Github className="h-3.5 w-3.5" />
                <Check className="h-3 w-3" />
                <span className="hidden lg:inline truncate max-w-[8rem]">{gh.github_login}</span>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={connectGithub} disabled={ghBusy} className="gap-1.5 px-2 sm:px-3">
                <Github className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">GitHub'a bağlan</span>
              </Button>
            )}
            {isAdmin && (
              <Button asChild variant="outline" size="sm" className="gap-1.5 px-2 sm:px-3">
                <Link to="/admin">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">Onaylar</span>
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-1.5 px-2 sm:px-3">
              <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Çıkış</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        {profileLoading ? (
          <div className="min-h-[60vh] grid place-items-center text-muted-foreground text-sm">Yükleniyor…</div>
        ) : profile && !profile.approved ? (
          <PendingApprovalScreen name={name} />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

function PendingApprovalScreen({ name }: { name: string }) {
  return (
    <div className="min-h-[calc(100vh-64px)] grid place-items-center px-4 py-16">
      <div className="max-w-lg w-full text-center space-y-6">
        <div className="relative mx-auto h-20 w-20 rounded-full bg-amber-500/10 ring-1 ring-amber-500/30 grid place-items-center">
          <Clock className="h-9 w-9 text-amber-400 animate-pulse" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Onay bekleniyor</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Merhaba <span className="text-foreground font-medium">{name}</span> 👋
            <br />
            Hesabın oluşturuldu, ancak bir yönetici onayına ihtiyacın var. Onaylandıktan sonra
            Hyperush Yazılım paneline erişebileceksin.
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 text-sm space-y-2">
          <p className="text-muted-foreground">Ekibin bir parçası değilsen ve erişim istiyorsan:</p>
          <a
            href="mailto:info@podhyperush.com"
            className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium"
          >
            <Mail className="h-4 w-4" />
            info@podhyperush.com
          </a>
          <p className="text-xs text-muted-foreground">
            Ekipten biriyle iletişime geçerek Hyperush yazılım birimine katılabilirsin.
          </p>
        </div>
      </div>
    </div>
  );
}
