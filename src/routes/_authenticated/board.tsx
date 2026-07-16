import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Calendar as CalendarIcon, GripVertical, Circle, Play, Eye, CheckCircle2, MessageCircle, HelpCircle, AlertTriangle, Activity, StickyNote, Send, CornerDownRight, Reply, X, Sparkles, Bug, Wrench, Palette, FileText, Hammer, Flame, ArrowDown, ArrowRight, ArrowUp, Zap, User as UserIcon, Flag, RotateCcw, Trash, Github, GitCommit, ExternalLink, Search, RefreshCw, GitBranch, Check } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { useServerFn } from "@/lib/use-server-fn";
import { listMyRepos, listRepoCommits, attachCommit, syncRepoCommits, listRepoBranches } from "@/lib/github.functions";

export const Route = createFileRoute("/_authenticated/board")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      ...search,
      taskId: (search.taskId as string) || undefined,
    };
  },
  component: Board,
});

type Status = "todo" | "in_progress" | "review" | "done";
type Priority = "low" | "medium" | "high" | "urgent";
type Category = "feature" | "bug" | "improvement" | "chore" | "design" | "docs";

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  category: Category;
  assignee_id: string | null;
  created_by: string;
  position: number;
  due_date: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  repo_full_name: string | null;
  issue_number: number | null;
  branch: string | null;
}

interface TaskCommit {
  id: string;
  task_id: string;
  sha: string;
  short_sha: string;
  message: string;
  html_url: string;
  repo_full_name: string;
  author_name: string | null;
  author_login: string | null;
  author_avatar_url: string | null;
  committed_at: string | null;
  added_by: string;
  created_at: string;
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

const COLUMNS: { id: Status; label: string; icon: typeof Circle; accent: string }[] = [
  { id: "todo", label: "Yapılacak", icon: Circle, accent: "var(--status-todo)" },
  { id: "in_progress", label: "Devam ediyor", icon: Play, accent: "var(--status-progress)" },
  { id: "review", label: "İnceleme", icon: Eye, accent: "var(--status-review)" },
  { id: "done", label: "Tamamlandı", icon: CheckCircle2, accent: "var(--status-done)" },
];

const PRIORITIES: { id: Priority; label: string; icon: typeof ArrowDown; var: string }[] = [
  { id: "low",    label: "Düşük",  icon: ArrowDown,  var: "var(--priority-low)" },
  { id: "medium", label: "Orta",   icon: ArrowRight, var: "var(--priority-medium)" },
  { id: "high",   label: "Yüksek", icon: ArrowUp,    var: "var(--priority-high)" },
  { id: "urgent", label: "Acil",   icon: Zap,        var: "var(--priority-urgent)" },
];
const PRIORITY_MAP = Object.fromEntries(PRIORITIES.map((p) => [p.id, p])) as Record<Priority, typeof PRIORITIES[number]>;

const CATEGORIES: { id: Category; label: string; icon: typeof Sparkles; var: string }[] = [
  { id: "feature",     label: "Özellik",    icon: Sparkles, var: "var(--category-feature)" },
  { id: "bug",         label: "Hata",       icon: Bug,      var: "var(--category-bug)" },
  { id: "improvement", label: "İyileştirme",icon: Wrench,   var: "var(--category-improvement)" },
  { id: "chore",       label: "İş",         icon: Hammer,   var: "var(--category-chore)" },
  { id: "design",      label: "Tasarım",    icon: Palette,  var: "var(--category-design)" },
  { id: "docs",        label: "Doküman",    icon: FileText, var: "var(--category-docs)" },
];
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<Category, typeof CATEGORIES[number]>;

type CommentType = "note" | "question" | "update" | "blocker";

interface Comment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  type: CommentType;
  created_at: string;
  updated_at: string;
  parent_id: string | null;
}

const COMMENT_TYPES: { id: CommentType; label: string; icon: typeof StickyNote; color: string; bg: string; border: string }[] = [
  { id: "note",     label: "Not",         icon: StickyNote,    color: "text-slate-300",   bg: "bg-slate-500/10",   border: "border-slate-500/30" },
  { id: "question", label: "Soru",        icon: HelpCircle,    color: "text-amber-300",   bg: "bg-amber-500/10",   border: "border-amber-500/40" },
  { id: "update",   label: "Güncelleme",  icon: Activity,      color: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/40" },
  { id: "blocker",  label: "Engel",       icon: AlertTriangle, color: "text-rose-300",    bg: "bg-rose-500/10",    border: "border-rose-500/40" },
];

const COMMENT_TYPE_MAP = Object.fromEntries(COMMENT_TYPES.map((c) => [c.id, c])) as Record<CommentType, typeof COMMENT_TYPES[number]>;

function Board() {
  const { user } = Route.useRouteContext();
  const search = Route.useSearch() as { taskId?: string };
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [trash, setTrash] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState<Status | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  const editing = useMemo(() => {
    if (!search.taskId || tasks.length === 0) return null;
    return tasks.find((t) => t.id === search.taskId) || null;
  }, [search.taskId, tasks]);

  useEffect(() => {
    if (search.taskId && tasks.length > 0) {
      const exists = tasks.some((t) => t.id === search.taskId);
      if (!exists) {
        navigate({ search: (prev) => ({ ...prev, taskId: undefined }), replace: true });
      }
    }
  }, [search.taskId, tasks, navigate]);

  const profilesById = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  useEffect(() => {
    const load = async () => {
      const [t, td, p] = await Promise.all([
        supabase.from("tasks").select("*").is("deleted_at", null).order("position").order("created_at"),
        supabase.from("tasks").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name, email, avatar_url"),
      ]);
      if (t.data) setTasks(t.data as Task[]);
      if (td.data) setTrash(td.data as Task[]);
      if (p.data) setProfiles(p.data as Profile[]);
      setLoading(false);
    };
    load();

    const channel = supabase
      .channel("tasks-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const n = payload.new as Task;
          if (n.deleted_at) {
            setTrash((prev) => (prev.some((t) => t.id === n.id) ? prev : [n, ...prev]));
          } else {
            setTasks((prev) => (prev.some((t) => t.id === n.id) ? prev : [...prev, n]));
          }
        } else if (payload.eventType === "UPDATE") {
          const n = payload.new as Task;
          if (n.deleted_at) {
            setTasks((prev) => prev.filter((t) => t.id !== n.id));
            setTrash((prev) => {
              const others = prev.filter((t) => t.id !== n.id);
              return [n, ...others];
            });
          } else {
            setTrash((prev) => prev.filter((t) => t.id !== n.id));
            setTasks((prev) => {
              const others = prev.filter((t) => t.id !== n.id);
              return [...others, n];
            });
          }
        } else if (payload.eventType === "DELETE") {
          const id = (payload.old as Task).id;
          setTasks((prev) => prev.filter((t) => t.id !== id));
          setTrash((prev) => prev.filter((t) => t.id !== id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const byColumn = useMemo(() => {
    const m: Record<Status, Task[]> = { todo: [], in_progress: [], review: [], done: [] };
    tasks.forEach((t) => m[t.status].push(t));
    return m;
  }, [tasks]);

  const handleDrop = async (status: Status) => {
    if (!dragId) return;
    const t = tasks.find((x) => x.id === dragId);
    setDragId(null);
    if (!t || t.status === status) return;
    setTasks((prev) => prev.map((x) => (x.id === dragId ? { ...x, status } : x)));
    const { error } = await supabase.from("tasks").update({ status }).eq("id", dragId);
    if (error) toast.error("Güncellenemedi");
  };

  const restoreTask = async (id: string) => {
    const { error } = await supabase.from("tasks").update({ deleted_at: null }).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Görev geri alındı");
  };

  const softDeleteTask = async (id: string, title?: string) => {
    const { error } = await supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(title ? `"${title}" çöp kutusuna taşındı` : "Görev çöp kutusuna taşındı", {
      duration: 8000,
      action: {
        label: "Geri al",
        onClick: () => restoreTask(id),
      },
    });
  };

  const purgeTask = async (id: string) => {
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Kalıcı olarak silindi");
  };


  return (
    <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-4 sm:py-6">
      <div className="mb-4 sm:mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Görev Panosu</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 truncate">
            {loading ? "Yükleniyor..." : `${tasks.length} görev · ${profiles.length} ekip üyesi`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setTrashOpen(true)}
            className="gap-1.5 relative"
            aria-label="Çöp kutusu"
          >
            <Trash className="h-4 w-4" />
            <span className="hidden sm:inline">Çöp</span>
            {trash.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold bg-destructive/20 text-destructive">
                {trash.length}
              </span>
            )}
          </Button>
          <Button size="sm" onClick={() => setOpenDialog("todo")} className="gap-1.5">
            <Plus className="h-4 w-4" /> <span className="hidden xs:inline sm:inline">Yeni görev</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">

        {COLUMNS.map((col) => (
          <div
            key={col.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(col.id)}
            className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm flex flex-col min-h-[60vh]"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <div className="flex items-center gap-2">
                <col.icon className="h-4 w-4" style={{ color: col.accent }} />
                <span className="font-medium text-sm">{col.label}</span>
                <span className="text-xs text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5">
                  {byColumn[col.id].length}
                </span>
              </div>
              <button
                onClick={() => setOpenDialog(col.id)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Bu sütuna görev ekle"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
              {byColumn[col.id].map((task) => {
                const assignee = task.assignee_id ? profilesById.get(task.assignee_id) : null;
                const isMine = task.assignee_id === user.id;
                const pr = PRIORITY_MAP[task.priority];
                const cat = CATEGORY_MAP[task.category];
                const CatIcon = cat.icon;
                const PrIcon = pr.icon;
                return (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => navigate({ search: (prev) => ({ ...prev, taskId: task.id }) })}
                    className={`group relative rounded-lg p-3 cursor-pointer transition-all ${
                      isMine
                        ? "mine-card"
                        : "border border-border/60 bg-popover hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
                    }`}
                    style={!isMine ? { borderLeft: `3px solid ${pr.var}` } : undefined}
                  >
                    {isMine && <span className="mine-rain" aria-hidden />}
                    <div className="relative flex items-start gap-2">
                      <GripVertical className="h-3.5 w-3.5 mt-0.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ color: cat.var, backgroundColor: `color-mix(in oklab, ${cat.var} 15%, transparent)` }}
                          >
                            <CatIcon className="h-2.5 w-2.5" />
                            {cat.label}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ color: pr.var, backgroundColor: `color-mix(in oklab, ${pr.var} 15%, transparent)` }}
                          >
                            <PrIcon className="h-2.5 w-2.5" />
                            {pr.label}
                          </span>
                          {isMine && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded text-orange-200 bg-orange-500/15 ml-auto">
                              <Flame className="h-2.5 w-2.5" /> Sen
                            </span>
                          )}
                        </div>
                        <p className="font-medium text-sm leading-snug">{task.title}</p>
                        {task.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {task.description}
                          </p>
                        )}
                        {task.tags && task.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {task.tags.map((tag) => (
                              <span key={tag} className="text-[10px] rounded bg-accent/40 px-1.5 py-0.5 text-accent-foreground/80">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                          <div className="flex items-center gap-2">
                            {assignee ? (
                              assignee.avatar_url ? (
                                <img src={assignee.avatar_url} alt="" className="h-5 w-5 rounded-full" />
                              ) : (
                                <div className="h-5 w-5 rounded-full bg-primary/20 grid place-items-center text-[9px] font-semibold text-primary">
                                  {(assignee.full_name || assignee.email || "?").slice(0, 2).toUpperCase()}
                                </div>
                              )
                            ) : (
                              <div className="h-5 w-5 rounded-full border border-dashed border-border" />
                            )}
                            {task.due_date && (
                              <span className="flex items-center gap-1">
                                <CalendarIcon className="h-3 w-3" />
                                {format(new Date(task.due_date), "d MMM", { locale: tr })}
                              </span>
                            )}
                          </div>
                          {(task.created_by === user.id || task.assignee_id === user.id) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); softDeleteTask(task.id, task.title); }}
                              className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
                              aria-label="Sil"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {byColumn[col.id].length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-8">
                  Görev yok
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <TaskDialog
        open={openDialog !== null}
        onOpenChange={(v) => !v && setOpenDialog(null)}
        defaultStatus={openDialog || "todo"}
        profiles={profiles}
        currentUserId={user.id}
      />

      <TaskDialog
        open={editing !== null}
        onOpenChange={(v) => !v && navigate({ search: (prev) => ({ ...prev, taskId: undefined }) })}
        task={editing || undefined}
        profiles={profiles}
        currentUserId={user.id}
        onDelete={editing ? async () => {
          const t = editing;
          await softDeleteTask(t.id, t.title);
          navigate({ search: (prev) => ({ ...prev, taskId: undefined }) });
        } : undefined}
      />

      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        trash={trash}
        profilesById={profilesById}
        onRestore={restoreTask}
        onPurge={purgeTask}
      />
    </div>
  );
}

function TaskDialog({
  open, onOpenChange, task, defaultStatus, profiles, currentUserId, onDelete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task?: Task;
  defaultStatus?: Status;
  profiles: Profile[];
  currentUserId: string;
  onDelete?: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("todo");
  const [priority, setPriority] = useState<Priority>("medium");
  const [category, setCategory] = useState<Category>("feature");
  const [assigneeId, setAssigneeId] = useState<string>("none");
  const [dueDate, setDueDate] = useState("");
  const [tags, setTags] = useState("");
  const [repoFullName, setRepoFullName] = useState<string>("");
  const [issueNumber, setIssueNumber] = useState<string>("");
  const [branch, setBranch] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || "");
      setStatus(task.status);
      setPriority(task.priority);
      setCategory(task.category || "feature");
      setAssigneeId(task.assignee_id || "none");
      setDueDate(task.due_date ? task.due_date.slice(0, 10) : "");
      setTags((task.tags || []).join(", "));
      setRepoFullName(task.repo_full_name || "");
      setIssueNumber(task.issue_number != null ? String(task.issue_number) : "");
      setBranch(task.branch || "");
    } else {
      setTitle("");
      setDescription("");
      setStatus(defaultStatus || "todo");
      setPriority("medium");
      setCategory("feature");
      setAssigneeId("none");
      setDueDate("");
      setTags("");
      setRepoFullName("");
      setIssueNumber("");
      setBranch("");
    }
  }, [task, defaultStatus, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      category,
      assignee_id: assigneeId === "none" ? null : assigneeId,
      due_date: dueDate || null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      repo_full_name: repoFullName.trim() || null,
      issue_number: issueNumber.trim() ? parseInt(issueNumber, 10) : null,
      branch: branch.trim() || null,
    };
    let error;
    if (task) {
      ({ error } = await supabase.from("tasks").update(payload).eq("id", task.id));
    } else {
      ({ error } = await supabase.from("tasks").insert({ ...payload, created_by: currentUserId }));
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(task ? "Güncellendi" : "Görev eklendi");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? "Görevi düzenle" : "Yeni görev"}</DialogTitle>
          <DialogDescription>Hızlıca seç, sadece başlık yaz — gerisi tıklamayla.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="title" className="text-xs uppercase tracking-wide text-muted-foreground">Başlık</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kısa ve net bir başlık..." required autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Kategori</Label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => {
                const active = category === c.id;
                const Icon = c.icon;
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-all"
                    style={
                      active
                        ? { color: c.var, backgroundColor: `color-mix(in oklab, ${c.var} 15%, transparent)`, borderColor: `color-mix(in oklab, ${c.var} 45%, transparent)` }
                        : undefined
                    }
                  >
                    <Icon className="h-3.5 w-3.5" style={active ? { color: c.var } : undefined} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              <Flag className="inline h-3 w-3 mr-1 -mt-0.5" />Öncelik
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {PRIORITIES.map((p) => {
                const active = priority === p.id;
                const Icon = p.icon;
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setPriority(p.id)}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-all"
                    style={
                      active
                        ? { color: p.var, backgroundColor: `color-mix(in oklab, ${p.var} 15%, transparent)`, borderColor: `color-mix(in oklab, ${p.var} 45%, transparent)` }
                        : undefined
                    }
                  >
                    <Icon className="h-3.5 w-3.5" style={active ? { color: p.var } : undefined} />
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Durum</Label>
            <div className="flex flex-wrap gap-1.5">
              {COLUMNS.map((c) => {
                const active = status === c.id;
                const Icon = c.icon;
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setStatus(c.id)}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-all"
                    style={
                      active
                        ? { color: c.accent, backgroundColor: `color-mix(in oklab, ${c.accent} 15%, transparent)`, borderColor: `color-mix(in oklab, ${c.accent} 45%, transparent)` }
                        : undefined
                    }
                  >
                    <Icon className="h-3.5 w-3.5" style={active ? { color: c.accent } : undefined} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Atanan</Label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setAssigneeId("none")}
                className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-all ${
                  assigneeId === "none" ? "border-primary/50 bg-primary/10 text-foreground" : "border-border/60 text-muted-foreground"
                }`}
              >
                <UserIcon className="h-3.5 w-3.5" />
                Kimse
              </button>
              {profiles.map((p) => {
                const active = assigneeId === p.id;
                const name = p.full_name || p.email || "Kullanıcı";
                const isSelf = p.id === currentUserId;
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setAssigneeId(p.id)}
                    className={`inline-flex items-center gap-1.5 text-xs pl-1 pr-2.5 py-1 rounded-full border transition-all ${
                      active ? "border-primary/60 bg-primary/10 text-foreground" : "border-border/60 text-muted-foreground hover:border-border"
                    }`}
                  >
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt="" className="h-5 w-5 rounded-full" />
                    ) : (
                      <div className="h-5 w-5 rounded-full bg-primary/20 grid place-items-center text-[9px] font-semibold text-primary">
                        {name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    {name.split(" ")[0]}{isSelf && " (ben)"}
                  </button>
                );
              })}
              {profiles.length === 0 && (
                <span className="text-xs text-muted-foreground">Henüz üye yok</span>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Teslim</Label>
            <DuePicker value={dueDate} onChange={setDueDate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tags" className="text-xs uppercase tracking-wide text-muted-foreground">Etiketler</Label>
            <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="frontend, api" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-end">
            <div className="space-y-1.5 min-w-0">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                <Github className="inline h-3 w-3 mr-1 -mt-0.5" /> Repo
              </Label>
              <RepoPicker value={repoFullName} onChange={(v) => { setRepoFullName(v); setBranch(""); }} />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Dal</Label>
              <BranchPicker repoFullName={repoFullName} value={branch} onChange={setBranch} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issue" className="text-xs uppercase tracking-wide text-muted-foreground">Issue #</Label>
              <Input
                id="issue"
                value={issueNumber}
                onChange={(e) => setIssueNumber(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="42"
                className="w-24"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc" className="text-xs uppercase tracking-wide text-muted-foreground">Açıklama (opsiyonel)</Label>
            <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Kısa bir detay ekle..." />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {task && onDelete ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => onDelete()}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                Sil
              </Button>
            ) : <span />}
            <Button type="submit" disabled={saving}>{saving ? "..." : task ? "Kaydet" : "Oluştur"}</Button>
          </DialogFooter>
        </form>

        {task && task.repo_full_name && (
          <CommitsPanel taskId={task.id} repoFullName={task.repo_full_name} branch={task.branch} issueNumber={task.issue_number} currentUserId={currentUserId} />
        )}

        {task && (
          <CommentsPanel taskId={task.id} profiles={profiles} currentUserId={currentUserId} repoFullName={task.repo_full_name} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RepoPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<Array<{ full_name: string; private: boolean; description: string | null; pushed_at: string }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const doList = useServerFn(listMyRepos);

  const load = async () => {
    if (repos || loading) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await doList({});
      setRepos(rows as Array<{ full_name: string; private: boolean; description: string | null; pushed_at: string }>);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Yüklenemedi");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = query.toLowerCase().trim();
    return q ? repos.filter((r) => r.full_name.toLowerCase().includes(q)) : repos;
  }, [repos, query]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal min-w-0" title={value || undefined}>
          <span className={cn("truncate block min-w-0 flex-1 text-left", !value && "text-muted-foreground")}>
            {value || "Repo seç..."}
          </span>
          <Search className="h-3.5 w-3.5 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="p-2 border-b border-border/50">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ara..."
            className="h-8"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {loading && <div className="px-3 py-4 text-xs text-muted-foreground">Yükleniyor...</div>}
          {error && (
            <div className="px-3 py-3 text-xs text-destructive">
              {error}
              <div className="text-muted-foreground mt-1">Header'dan GitHub'a bağlan.</div>
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground">Repo bulunamadı</div>
          )}
          {filtered.map((r) => {
            const [owner, name] = r.full_name.split("/");
            return (
              <button
                key={r.full_name}
                type="button"
                onClick={() => { onChange(r.full_name); setOpen(false); }}
                title={r.full_name}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 flex items-center justify-between gap-2",
                  value === r.full_name && "bg-accent/40"
                )}
              >
                <div className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{name || r.full_name}</span>
                  {owner && name && <span className="text-muted-foreground"> · {owner}</span>}
                </div>
                {r.private && <span className="text-[9px] uppercase text-muted-foreground shrink-0">özel</span>}
              </button>
            );
          })}
        </div>
        {value && (
          <div className="border-t border-border/50 p-1">
            <Button type="button" variant="ghost" size="sm" className="w-full h-7 text-xs text-muted-foreground" onClick={() => { onChange(""); setOpen(false); }}>
              Temizle
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function BranchPicker({ repoFullName, value, onChange }: { repoFullName: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const fetchBranches = useServerFn(listRepoBranches);

  const load = async () => {
    if (!repoFullName) return;
    setLoading(true); setError(null);
    try {
      const rows = await fetchBranches({ data: { repo_full_name: repoFullName } });
      setBranches(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Yüklenemedi");
    } finally { setLoading(false); }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={!repoFullName} className="w-full justify-between font-normal">
          <span className="truncate inline-flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            {value || (repoFullName ? "Dal seç" : "Önce repo seç")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-2 w-64" align="start">
        <Input
          placeholder="Dal ara..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 mb-2"
        />
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {loading && <div className="py-4 text-center text-xs text-muted-foreground">Yükleniyor...</div>}
          {error && <div className="py-4 text-center text-xs text-destructive">{error}</div>}
          {!loading && !error && (
            <>
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted text-left"
              >
                <Check className={`h-3.5 w-3.5 ${!value ? "opacity-100" : "opacity-0"}`} />
                <span className="text-muted-foreground">Tüm dallar</span>
              </button>
              {branches.filter((b) => b.toLowerCase().includes(query.toLowerCase())).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => { onChange(b); setOpen(false); }}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded hover:bg-muted text-left"
                >
                  <Check className={`h-3.5 w-3.5 ${value === b ? "opacity-100" : "opacity-0"}`} />
                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{b}</span>
                </button>
              ))}
              {branches.length === 0 && <div className="py-4 text-center text-xs text-muted-foreground">Dal bulunamadı</div>}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}


function renderCommentContent(content: string, commits: TaskCommit[], repoFullName: string | null): React.ReactNode {
  // Tokens: [[commit:<sha>]] or bare short sha (7-40 hex) matching a linked commit
  const bySha = new Map<string, TaskCommit>();
  commits.forEach((c) => { bySha.set(c.sha, c); bySha.set(c.short_sha, c); });
  const parts: React.ReactNode[] = [];
  const regex = /\[\[commit:([a-f0-9]{7,40})\]\]|\b([a-f0-9]{7,40})\b/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  let idx = 0;

  const parseMentions = (text: string, baseIdx: number): React.ReactNode[] => {
    const mentionRegex = /@([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+)/g;
    const subParts: React.ReactNode[] = [];
    let subLast = 0;
    let sm: RegExpExecArray | null;
    let sIdx = 0;
    while ((sm = mentionRegex.exec(text)) !== null) {
      if (sm.index > subLast) {
        subParts.push(text.slice(subLast, sm.index));
      }
      const username = sm[1];
      subParts.push(
        <span
          key={`m-${baseIdx}-${sIdx++}`}
          className="inline-flex items-center rounded bg-blue-500/10 text-blue-500 font-medium px-1.5 py-0.5 text-xs mx-0.5 select-all border border-blue-500/20 cursor-default"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          @{username}
        </span>
      );
      subLast = sm.index + sm[0].length;
    }
    if (subLast < text.length) {
      subParts.push(text.slice(subLast));
    }
    return subParts;
  };

  while ((m = regex.exec(content)) !== null) {
    const sha = (m[1] || m[2]).toLowerCase();
    const match = bySha.get(sha) || [...bySha.values()].find((c) => c.sha.startsWith(sha));
    if (m.index > last) {
      parts.push(...parseMentions(content.slice(last, m.index), idx++));
    }
    if (match) {
      parts.push(
        <a
          key={`c${idx++}`}
          href={match.html_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 px-1.5 py-0.5 text-xs font-mono transition-colors"
          title={match.message.split("\n")[0]}
        >
          <GitCommit className="h-3 w-3" />
          {match.short_sha}
        </a>
      );
    } else if (repoFullName) {
      parts.push(
        <a key={`c${idx++}`} href={`https://github.com/${repoFullName}/commit/${sha}`} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono text-xs">
          {sha.slice(0, 7)}
        </a>
      );
    } else {
      parts.push(...parseMentions(m[0], idx++));
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    parts.push(...parseMentions(content.slice(last), idx++));
  }
  return parts;
}




function SingleCommentItem({
  c,
  depth,
  t,
  author,
  name,
  isReplying,
  setReplyTo,
  setContent,
  remove,
  currentUserId,
  taskCommits,
  repoFullName,
  targetCommentId,
  replies,
  Icon,
}: {
  c: Comment;
  depth: number;
  t: any;
  author: Profile | undefined;
  name: string;
  isReplying: boolean;
  setReplyTo: (v: string | null) => void;
  setContent: (v: string) => void;
  remove: (id: string) => void;
  currentUserId: string;
  taskCommits: TaskCommit[];
  repoFullName: string | null;
  targetCommentId: string | undefined;
  replies: Comment[];
  Icon: any;
}) {
  const navigate = useNavigate();
  const elementRef = useRef<HTMLDivElement>(null);
  const isHighlighted = c.id === targetCommentId;
  const [activeHighlight, setActiveHighlight] = useState(false);

  useEffect(() => {
    if (isHighlighted) {
      setActiveHighlight(true);
      const timer = setTimeout(() => {
        setActiveHighlight(false);
        navigate({ search: (prev) => {
          const next = { ...prev };
          delete (next as any).commentId;
          return next;
        }, replace: true });
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isHighlighted, navigate]);

  const clearHighlight = () => {
    if (activeHighlight) {
      setActiveHighlight(false);
      navigate({ search: (prev) => {
        const next = { ...prev };
        delete (next as any).commentId;
        return next;
      }, replace: true });
    }
  };

  useEffect(() => {
    if (isHighlighted && elementRef.current) {
      setTimeout(() => {
        elementRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 400);
    }
  }, [isHighlighted]);

  return (
    <div
      ref={elementRef}
      onClick={clearHighlight}
      className={cn(
        "transition-all duration-500",
        depth > 0 
          ? "rounded-md border border-border/40 p-2.5 bg-card/25 shadow-sm" 
          : "rounded-lg border p-3",
        activeHighlight
          ? "border-primary/80 bg-primary/10 shadow-[0_0_15px_rgba(59,130,246,0.25)] scale-[1.01] animate-pulse"
          : depth > 0 ? "" : `${t.border} ${t.bg}`
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {depth > 0 && <CornerDownRight className="h-3 w-3 text-muted-foreground shrink-0" />}
          {author?.avatar_url ? (
            <img src={author.avatar_url} alt="" className="h-5 w-5 rounded-full shrink-0" />
          ) : (
            <div className="h-5 w-5 rounded-full bg-primary/20 grid place-items-center text-[9px] font-semibold text-primary shrink-0">
              {name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <span className="text-xs font-medium truncate">{name}</span>
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${t.color} ${t.bg} border ${t.border}`}>
            <Icon className="h-3 w-3" />
            {t.label}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(c.created_at), { locale: tr, addSuffix: true })}
          </span>
          {c.author_id === currentUserId && (
            <button
              onClick={() => remove(c.id)}
              className="text-muted-foreground hover:text-destructive transition-colors"
              aria-label="Yorumu sil"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <div className="text-sm whitespace-pre-wrap leading-relaxed">
        {renderCommentContent(c.content, taskCommits, repoFullName)}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            clearHighlight();
            setReplyTo(isReplying ? null : c.id);
            setContent("");
          }}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {isReplying ? <><X className="h-3 w-3" /> İptal</> : <><Reply className="h-3 w-3" /> Yanıtla</>}
        </button>
        {replies.length > 0 && (
          <span className="text-[11px] text-muted-foreground">{replies.length} yanıt</span>
        )}
      </div>
    </div>
  );
}

function CommentsPanel({ taskId, profiles, currentUserId, repoFullName }: { taskId: string; profiles: Profile[]; currentUserId: string; repoFullName: string | null }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [content, setContent] = useState("");
  const [type, setType] = useState<CommentType>("note");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [taskCommits, setTaskCommits] = useState<TaskCommit[]>([]);
  const search = Route.useSearch();
  const targetCommentId = search.commentId as string | undefined;
  const [visibleRepliesCount, setVisibleRepliesCount] = useState<Record<string, number>>({});

  useEffect(() => {
    supabase.from("task_commits").select("*").eq("task_id", taskId).order("committed_at", { ascending: false }).then(({ data }) => {
      if (data) setTaskCommits(data as TaskCommit[]);
    });
    const ch = supabase
      .channel(`commits-mentions-${taskId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_commits", filter: `task_id=eq.${taskId}` }, () => {
        supabase.from("task_commits").select("*").eq("task_id", taskId).order("committed_at", { ascending: false }).then(({ data }) => {
          if (data) setTaskCommits(data as TaskCommit[]);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [taskId]);


  const profilesById = useMemo(() => {
    const m = new Map<string, Profile>();
    profiles.forEach((p) => m.set(p.id, p));
    return m;
  }, [profiles]);

  useEffect(() => {
    supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at").then(({ data }) => {
      if (data) setComments(data as Comment[]);
    });

    const ch = supabase
      .channel(`comments-${taskId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments", filter: `task_id=eq.${taskId}` }, (payload) => {
        setComments((prev) => {
          if (payload.eventType === "INSERT") {
            const n = payload.new as Comment;
            if (prev.some((c) => c.id === n.id)) return prev;
            return [...prev, n];
          }
          if (payload.eventType === "UPDATE") {
            const n = payload.new as Comment;
            return prev.map((c) => (c.id === n.id ? n : c));
          }
          if (payload.eventType === "DELETE") {
            return prev.filter((c) => c.id !== (payload.old as Comment).id);
          }
          return prev;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [taskId]);

  const submit = async (e: React.FormEvent, parentId: string | null = null) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    const { error } = await supabase.from("task_comments").insert({
      task_id: taskId,
      author_id: currentUserId,
      content: content.trim(),
      type,
      parent_id: parentId,
    });
    setSending(false);
    if (error) return toast.error(error.message);
    setContent("");
    setType("note");
    setReplyTo(null);
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("task_comments").delete().eq("id", id);
    if (error) toast.error(error.message);
  };

  const { roots, childrenByParent } = useMemo(() => {
    const roots: Comment[] = [];
    const childrenByParent = new Map<string, Comment[]>();
    for (const c of comments) {
      if (c.parent_id) {
        const list = childrenByParent.get(c.parent_id) || [];
        list.push(c);
        childrenByParent.set(c.parent_id, list);
      } else {
        roots.push(c);
      }
    }
    return { roots, childrenByParent };
  }, [comments]);

  const renderComment = (c: Comment, depth: number): React.ReactNode => {
    const t = COMMENT_TYPE_MAP[c.type];
    const author = profilesById.get(c.author_id);
    const name = author?.full_name || author?.email || "Kullanıcı";
    const Icon = t.icon;
    const allReplies = childrenByParent.get(c.id) || [];
    const totalReplies = allReplies.length;
    const currentLimit = visibleRepliesCount[c.id] !== undefined ? visibleRepliesCount[c.id] : totalReplies;
    const displayedReplies = totalReplies > 1 ? allReplies.slice(-currentLimit) : allReplies;
    const isReplying = replyTo === c.id;

    return (
      <div key={c.id} className="space-y-2">
        <SingleCommentItem
          c={c}
          depth={depth}
          t={t}
          author={author}
          name={name}
          isReplying={isReplying}
          setReplyTo={setReplyTo}
          setContent={setContent}
          remove={remove}
          currentUserId={currentUserId}
          taskCommits={taskCommits}
          repoFullName={repoFullName}
          targetCommentId={targetCommentId}
          replies={allReplies}
          Icon={Icon}
        />

        {isReplying && (
          <div className="ml-6">
            <CommentForm commits={taskCommits}
              content={content} setContent={setContent}
              type={type} setType={setType}
              sending={sending}
              onSubmit={(e) => submit(e, c.id)}
              isReply
              profiles={profiles}
              currentUserId={currentUserId}
            />
          </div>
        )}

        {totalReplies > 1 && (
          <div className="ml-6 flex items-center gap-3 py-1">
            {currentLimit < totalReplies && (
              <button
                type="button"
                onClick={() => setVisibleRepliesCount(prev => ({ ...prev, [c.id]: Math.min(totalReplies, (prev[c.id] || 1) + 5) }))}
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="h-3 w-3" />
                Diğer {totalReplies - currentLimit} yanıtı göster
              </button>
            )}
            {currentLimit > 1 && (
              <button
                type="button"
                onClick={() => setVisibleRepliesCount(prev => ({ ...prev, [c.id]: 1 }))}
                className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors hover:underline"
              >
                Yanıtları kapat
              </button>
            )}
          </div>
        )}

        {displayedReplies.length > 0 && (
          <div className="ml-6 space-y-2 border-l-2 border-border/40 pl-3">
            {displayedReplies.map((r) => renderComment(r, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-2 pt-4 border-t border-border/60">
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Yorumlar</h3>
        <span className="text-xs text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5">{comments.length}</span>
      </div>

      <div className="space-y-3 mb-6">
        {roots.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">Henüz yorum yok — ilk soruyu/güncellemeyi sen yaz.</div>
        )}
        {roots.map((c) => renderComment(c, 0))}
      </div>

      {replyTo === null && (
        <CommentForm commits={taskCommits}
          content={content} setContent={setContent}
          type={type} setType={setType}
          sending={sending}
          onSubmit={(e) => submit(e, null)}
          profiles={profiles}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
}

function CommentForm({
  content, setContent, type, setType, sending, onSubmit, isReply, commits, profiles, currentUserId,
}: {
  content: string;
  setContent: (v: string) => void;
  type: CommentType;
  setType: (v: CommentType) => void;
  sending: boolean;
  onSubmit: (e: React.FormEvent) => void;
  isReply?: boolean;
  commits: TaskCommit[];
  profiles: Profile[];
  currentUserId: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isReply && textareaRef.current) {
      textareaRef.current.focus({ preventScroll: true });
    }
  }, [isReply]);

  // Mention Autocomplete States
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);

  const filteredUsers = useMemo(() => {
    if (!mentionOpen) return [];
    return profiles.filter((p) => {
      if (p.id === currentUserId) return false;
      const queryStr = mentionQuery.toLowerCase();
      const name = (p.full_name || "").toLowerCase();
      const email = (p.email || "").toLowerCase();
      return name.includes(queryStr) || email.includes(queryStr);
    });
  }, [mentionOpen, mentionQuery, profiles, currentUserId]);

  const selectMentionUser = (user: Profile) => {
    const nameSlug = user.full_name ? user.full_name.replace(/\s+/g, "") : user.email ? user.email.split("@")[0] : "";
    const mentionText = `@${nameSlug} `;
    
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    const selectionStart = textarea.selectionStart;
    const textBeforeCursor = content.slice(0, selectionStart);
    const lastAtPos = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtPos !== -1) {
      const before = content.slice(0, lastAtPos);
      const after = content.slice(selectionStart);
      const newText = before + mentionText + after;
      setContent(newText);
      setMentionOpen(false);
      
      setTimeout(() => {
        textarea.focus();
        const cursorPosition = lastAtPos + mentionText.length;
        textarea.setSelectionRange(cursorPosition, cursorPosition);
      }, 0);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    
    const selectionStart = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, selectionStart);
    const lastAtPos = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtPos !== -1) {
      const charBeforeAt = lastAtPos > 0 ? textBeforeCursor[lastAtPos - 1] : "";
      const isStartOfMention = lastAtPos === 0 || /\s/.test(charBeforeAt);
      const textAfterAt = textBeforeCursor.slice(lastAtPos + 1);
      const hasSpaceAfterAt = /\s/.test(textAfterAt);
      
      if (isStartOfMention && !hasSpaceAfterAt) {
        setMentionOpen(true);
        setMentionQuery(textAfterAt);
        setMentionIndex(0);
        return;
      }
    }
    setMentionOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionOpen || filteredUsers.length === 0) return;
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((prev) => (prev + 1) % filteredUsers.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectMentionUser(filteredUsers[mentionIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMentionOpen(false);
    }
  };

  const insertCommit = (c: TaskCommit) => {
    const token = `[[commit:${c.short_sha}]] `;
    setContent((content ? content + (content.endsWith(" ") || content.endsWith("\n") ? "" : " ") : "") + token);
    setPickerOpen(false);
    setQ("");
  };
  const filtered = commits.filter((c) => {
    const t = q.toLowerCase();
    return !t || c.short_sha.includes(t) || c.message.toLowerCase().includes(t);
  });
  return (
    <form onSubmit={onSubmit} className="space-y-2 relative">
      <div className="flex flex-wrap gap-1.5">
        {COMMENT_TYPES.map((t) => {
          const active = type === t.id;
          const Icon = t.icon;
          return (
            <button
              type="button"
              key={t.id}
              onClick={() => setType(t.id)}
              className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all ${
                active ? `${t.color} ${t.bg} ${t.border}` : "text-muted-foreground border-border/60 hover:border-border"
              }`}
            >
              <Icon className="h-3 w-3" />
              {t.label}
            </button>
          );
        })}
        {commits.length > 0 && (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-border/60 text-muted-foreground hover:border-border hover:text-foreground transition-all"
              >
                <GitCommit className="h-3 w-3" /> Commit iliştir
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-2 w-80" align="start">
              <Input placeholder="Commit ara..." value={q} onChange={(e) => setQ(e.target.value)} className="h-8 mb-2" />
              <div className="max-h-64 overflow-y-auto space-y-1">
                {filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => insertCommit(c)}
                    className="w-full text-left rounded-md hover:bg-muted p-2"
                  >
                    <div className="flex items-center gap-2">
                      <code className="text-[11px] font-mono bg-primary/10 text-primary rounded px-1.5 py-0.5">{c.short_sha}</code>
                      <span className="text-xs truncate flex-1">{c.message.split("\n")[0]}</span>
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && <div className="py-4 text-center text-xs text-muted-foreground">Commit bulunamadı</div>}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      
      {mentionOpen && filteredUsers.length > 0 && (
        <div className="absolute bottom-[calc(100%-35px)] left-0 z-50 w-64 bg-popover text-popover-foreground rounded-md border border-border shadow-md max-h-48 overflow-y-auto p-1">
          {filteredUsers.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onClick={() => selectMentionUser(u)}
              className={cn(
                "w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-sm hover:bg-accent hover:text-accent-foreground",
                i === mentionIndex && "bg-accent text-accent-foreground"
              )}
            >
              {u.avatar_url ? (
                <img src={u.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
              ) : (
                <div className="h-5 w-5 rounded-full bg-primary/20 grid place-items-center text-[9px] font-semibold text-primary">
                  {(u.full_name || u.email || "?").slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col min-w-0">
                <span className="font-medium truncate">{u.full_name || "Kullanıcı"}</span>
                <span className="text-[10px] text-muted-foreground truncate">{u.email}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleContentChange}
          onKeyDown={handleKeyDown}
          placeholder={
            isReply ? "Yanıtını yaz..."
            : type === "question" ? "Sorunu yaz..."
            : type === "blocker" ? "Neyi engelliyor?"
            : type === "update" ? "İşin son durumunu paylaş..."
            : "Bir not ekle... (@ ile bahset)"
          }
          rows={2}
          className="flex-1 resize-none"
        />
        <Button type="submit" size="sm" disabled={sending || !content.trim()} className="self-end gap-1">
          <Send className="h-3.5 w-3.5" />
          {isReply ? "Yanıtla" : "Gönder"}
        </Button>
      </div>
    </form>
  );
}

function DuePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);

  const toIso = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const addDays = (days: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    onChange(toIso(d));
  };

  const presets: { label: string; days: number }[] = [
    { label: "Bugün", days: 0 },
    { label: "Yarın", days: 1 },
    { label: "3 gün", days: 3 },
    { label: "1 hafta", days: 7 },
    { label: "10 gün", days: 10 },
    { label: "2 hafta", days: 14 },
    { label: "1 ay", days: 30 },
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selectedDate = value ? new Date(value) : undefined;
  const activeDays = selectedDate
    ? Math.round((selectedDate.getTime() - today.getTime()) / 86400000)
    : null;

  const label = value
    ? format(new Date(value), "d MMMM yyyy, EEEE", { locale: tr })
    : "Teslim yok";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const active = activeDays === p.days;
          return (
            <button
              type="button"
              key={p.label}
              onClick={() => addDays(p.days)}
              className={`inline-flex items-center text-xs px-2.5 py-1.5 rounded-full border transition-all ${
                active
                  ? "border-primary/60 bg-primary/15 text-foreground"
                  : "border-border/60 text-muted-foreground hover:border-border"
              }`}
            >
              {p.label}
            </button>
          );
        })}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-all ${
                value && activeDays !== null && !presets.some((p) => p.days === activeDays)
                  ? "border-primary/60 bg-primary/15 text-foreground"
                  : "border-border/60 text-muted-foreground hover:border-border"
              }`}
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              Gün seç
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => {
                if (d) onChange(toIso(d));
                setOpen(false);
              }}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border border-border/60 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" /> Temizle
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        <CalendarIcon className="inline h-3 w-3 mr-1 -mt-0.5" />
        {label}
      </p>
    </div>
  );
}

function TrashDialog({
  open, onOpenChange, trash, profilesById, onRestore, onPurge,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trash: Task[];
  profilesById: Map<string, Profile>;
  onRestore: (id: string) => void | Promise<void>;
  onPurge: (id: string) => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash className="h-5 w-5 text-muted-foreground" />
            Çöp Kutusu
          </DialogTitle>
          <DialogDescription>
            Silinen görevler burada tutulur. İstediğin zaman geri alabilirsin — hiçbir görev otomatik silinmez.
          </DialogDescription>
        </DialogHeader>

        {trash.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Çöp kutusu boş.
          </div>
        ) : (
          <div className="space-y-2">
            {trash.map((task) => {
              const assignee = task.assignee_id ? profilesById.get(task.assignee_id) : null;
              const pr = PRIORITY_MAP[task.priority];
              const cat = CATEGORY_MAP[task.category];
              const CatIcon = cat.icon;
              return (
                <div
                  key={task.id}
                  className="rounded-lg border border-border/60 bg-card/40 p-3 flex items-start gap-3"
                  style={{ borderLeft: `3px solid ${pr.var}` }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ color: cat.var, backgroundColor: `color-mix(in oklab, ${cat.var} 15%, transparent)` }}
                      >
                        <CatIcon className="h-2.5 w-2.5" />
                        {cat.label}
                      </span>
                      {task.deleted_at && (
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(task.deleted_at), { locale: tr, addSuffix: true })} silindi
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-sm leading-snug truncate">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>
                    )}
                    {assignee && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Atanan: {assignee.full_name || assignee.email}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => onRestore(task.id)}
                      className="gap-1.5"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Geri al
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Bu görev kalıcı olarak silinsin mi? Bu işlem geri alınamaz.")) {
                          onPurge(task.id);
                        }
                      }}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Kalıcı sil
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CommitsPanel({
  taskId, repoFullName, branch, issueNumber, currentUserId,
}: {
  taskId: string;
  repoFullName: string;
  branch: string | null;
  issueNumber: number | null;
  currentUserId: string;
}) {
  const [commits, setCommits] = useState<TaskCommit[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCommits, setPickerCommits] = useState<Awaited<ReturnType<typeof listRepoCommits>>>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [attaching, setAttaching] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(1);

  const fetchRepoCommits = useServerFn(listRepoCommits);
  const doAttach = useServerFn(attachCommit);
  const doSync = useServerFn(syncRepoCommits);

  useEffect(() => {
    supabase.from("task_commits").select("*").eq("task_id", taskId).order("committed_at", { ascending: false }).then(({ data }) => {
      if (data) setCommits(data as TaskCommit[]);
    });

    const ch = supabase
      .channel(`commits-${taskId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_commits", filter: `task_id=eq.${taskId}` }, (payload) => {
        setCommits((prev) => {
          if (payload.eventType === "INSERT") {
            const n = payload.new as TaskCommit;
            if (prev.some((c) => c.id === n.id)) return prev;
            return [n, ...prev];
          }
          if (payload.eventType === "DELETE") {
            return prev.filter((c) => c.id !== (payload.old as TaskCommit).id);
          }
          return prev;
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [taskId]);

  const runSync = async () => {
    if (!repoFullName) return;
    setSyncing(true);
    try {
      await doSync({ data: { task_id: taskId, repo_full_name: repoFullName, branch: branch || null } });
      setLastSync(new Date());
    } catch (e) {
      // sessiz
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!repoFullName) return;
    runSync();
    const iv = setInterval(runSync, 30000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, repoFullName, branch]);

  const openPicker = async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    setPickerError(null);
    try {
      const rows = await fetchRepoCommits({ data: { repo_full_name: repoFullName } });
      setPickerCommits(rows);
    } catch (e) {
      setPickerError(e instanceof Error ? e.message : "Yüklenemedi");
    } finally {
      setPickerLoading(false);
    }
  };

  const attach = async (sha: string) => {
    setAttaching(sha);
    try {
      await doAttach({ data: { task_id: taskId, repo_full_name: repoFullName, sha } });
      toast.success("Commit eklendi");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eklenemedi");
    } finally {
      setAttaching(null);
    }
  };

  const removeCommit = async (id: string) => {
    const { error } = await supabase.from("task_commits").delete().eq("id", id);
    if (error) toast.error(error.message);
  };

  const filteredPicker = useMemo(() => {
    const q = pickerQuery.toLowerCase().trim();
    if (!q) return pickerCommits;
    return pickerCommits.filter((c) => c.message.toLowerCase().includes(q) || c.short_sha.includes(q));
  }, [pickerCommits, pickerQuery]);

  const visibleCommits = commits.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, commits.length - visibleCommits.length);
  const canCollapse = visibleLimit > 1 && commits.length > 1;

  return (
    <div className="mt-2 pt-4 border-t border-border/60">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <GitCommit className="h-4 w-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-semibold shrink-0">Commit'ler</h3>
          <span className="text-xs text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5 shrink-0">{commits.length}</span>
          <a
            href={`https://github.com/${repoFullName}${issueNumber ? `/issues/${issueNumber}` : ""}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 min-w-0"
            title={`${repoFullName}${branch ? ` · ${branch}` : ""}${issueNumber ? ` #${issueNumber}` : ""}`}
          >
            <Github className="h-3 w-3 shrink-0" />
            <span className="truncate">{repoFullName}{branch ? ` · ${branch}` : ""}{issueNumber ? ` #${issueNumber}` : ""}</span>
          </a>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button type="button" size="sm" variant="ghost" onClick={runSync} disabled={syncing} className="gap-1.5 text-xs h-7 px-2">
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> <span className="hidden sm:inline">{syncing ? "Sync..." : "Yenile"}</span>
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={openPicker} className="gap-1.5 h-7 px-2">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Ekle</span>
          </Button>
        </div>
      </div>


      <div className="space-y-2">
        {commits.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            Henüz commit iliştirilmedi. "Commit ekle" ile bu görev için yapılan commit'i seç.
          </div>
        )}
        {visibleCommits.map((c, idx) => {
          const firstLine = c.message.split("\n")[0];
          const isLatest = idx === 0;
          return (
            <div key={c.id} className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                {c.author_avatar_url ? (
                  <img src={c.author_avatar_url} alt="" className="h-6 w-6 rounded-full shrink-0 mt-0.5" />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-primary/20 grid place-items-center text-[9px] font-semibold text-primary shrink-0 mt-0.5">
                    {(c.author_login || c.author_name || "?").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isLatest && commits.length > 1 && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 shrink-0">Son</span>
                    )}
                    <p className="text-sm font-medium leading-snug truncate min-w-0">{firstLine}</p>
                  </div>
                  <div className="flex items-center gap-x-2 mt-1 text-[11px] text-muted-foreground min-w-0">
                    <code className="font-mono px-1.5 py-0.5 rounded bg-muted/50 text-foreground/80 shrink-0">{c.short_sha}</code>
                    <span className="truncate min-w-0">{c.author_login || c.author_name || "?"}</span>
                    {c.committed_at && (
                      <span className="shrink-0 whitespace-nowrap">· {formatDistanceToNow(new Date(c.committed_at), { locale: tr, addSuffix: true })}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <a href={c.html_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground p-1" aria-label="GitHub'da aç">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  {c.added_by === currentUserId && (
                    <button
                      type="button"
                      onClick={() => removeCommit(c.id)}
                      className="text-muted-foreground hover:text-destructive p-1"
                      aria-label="Bağlantıyı kaldır"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {commits.length > 1 && (
          <div className="flex items-center gap-2">
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setVisibleLimit((v) => (v < 5 ? Math.min(5, commits.length) : Math.min(v + 5, commits.length)))}
                className="flex-1 text-xs text-muted-foreground hover:text-foreground py-1.5 rounded-md hover:bg-accent/30 transition-colors"
              >
                {visibleLimit < 5 ? `Daha fazla göster (${Math.min(4, hiddenCount)})` : `Daha fazla göster (${Math.min(5, hiddenCount)})`}
              </button>
            )}
            {canCollapse && (
              <button
                type="button"
                onClick={() => setVisibleLimit(1)}
                className="text-xs text-muted-foreground hover:text-foreground py-1.5 px-3 rounded-md hover:bg-accent/30 transition-colors shrink-0"
              >
                Daralt
              </button>
            )}
          </div>
        )}
      </div>



      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github className="h-4 w-4" /> {repoFullName}
            </DialogTitle>
            <DialogDescription>Son commit'ler — bu görevle ilgili olanı seç.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Commit mesajı veya SHA ara..."
              className="pl-8"
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 -mx-1 px-1">
            {pickerLoading && <div className="text-xs text-muted-foreground text-center py-6">Yükleniyor...</div>}
            {pickerError && <div className="text-xs text-destructive text-center py-6">{pickerError}</div>}
            {!pickerLoading && !pickerError && filteredPicker.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-6">Commit bulunamadı</div>
            )}
            {filteredPicker.map((c) => {
              const already = commits.some((x) => x.sha === c.sha);
              const firstLine = c.message.split("\n")[0];
              return (
                <button
                  key={c.sha}
                  type="button"
                  disabled={already || attaching === c.sha}
                  onClick={() => attach(c.sha)}
                  className="w-full text-left rounded-lg border border-border/60 hover:border-primary/50 bg-card/40 p-2.5 disabled:opacity-50 disabled:hover:border-border/60 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {c.author_avatar_url ? (
                      <img src={c.author_avatar_url} alt="" className="h-6 w-6 rounded-full shrink-0" />
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-primary/20 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{firstLine}</p>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                        <code className="font-mono">{c.short_sha}</code>
                        <span>{c.author_login || c.author_name}</span>
                      </div>
                    </div>
                    {already ? (
                      <span className="text-[10px] text-muted-foreground">Eklendi</span>
                    ) : (
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


