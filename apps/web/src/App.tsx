import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Command,
  PlusCircle,
  FolderOpen,
  Home,
  HardDrive,
  Download,
  Image,
  Music,
  Video,
  FileText,
  Star,
  Trash2,
  Settings,
  Moon,
  Sun,
  Search,
  FolderPlus,
  Upload,
  SlidersHorizontal,
  Grid2X2,
  List,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RefreshCw,
  Copy,
  Scissors,
  ClipboardPaste,
  X,
  ShieldCheck,
  Keyboard,
  CircleHelp,
  Check,
  MoreHorizontal,
  LoaderCircle,
  Info,
  Maximize,
  Minimize,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import type {
  Entry,
  Volume,
  Location,
  Listing,
  Job,
  TrashItem,
  Shortcut,
  VolumeResponse,
} from "../../../packages/shared/types";
import { api, session, login, LoginRequiredError, query, url, bytes, ApiError, upload } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { FileCard, type Action, fileType } from "@/components/file-card";
import { useFullscreen } from "@/hooks/use-fullscreen";
const MediaViewer = lazy(() =>
  import("@/components/media-viewer").then((module) => ({ default: module.MediaViewer })),
);
const getLocation = (): Location => {
  const params = new URLSearchParams(window.location.search);
  return { root: params.get("root") || "", path: params.get("path") || "" };
};
const getPreviewPath = (): string | null => new URLSearchParams(window.location.search).get("preview");
const savedStars = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem("studio-stars") || "[]");
  } catch {
    return [];
  }
};
function Workspace() {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]),
    [ready, setReady] = useState(false),
    [volumes, setVolumes] = useState<Volume[]>([]),
    [loc, setLoc] = useState<Location>(getLocation),
    [listing, setListing] = useState<Listing | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [loginRequired, setLoginRequired] = useState(false),
    [loginError, setLoginError] = useState(""),
    [loginBusy, setLoginBusy] = useState(false);
  const [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [hidden, setHidden] = useState(false),
    [sort, setSort] = useState("name"),
    [direction, setDirection] = useState("asc"),
    [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<"grid" | "list">(() =>
      localStorage.getItem("studio-view") === "list" ? "list" : "grid",
    ),
    [selected, setSelected] = useState<string[]>([]),
    [stars, setStars] = useState(savedStars),
    [starFilter, setStarFilter] = useState(false);
  const [clipboard, setClipboard] = useState<{ items: Location[]; mode: "copy" | "move" } | null>(null),
    [preview, setPreview] = useState<Entry | null>(null),
    [dialog, setDialog] = useState<
      null | "new" | "rename" | "delete" | "settings" | "trash" | "details" | "help"
    >(null),
    [target, setTarget] = useState<Entry | null>(null),
    [name, setName] = useState(""),
    [permanent, setPermanent] = useState(false),
    [busy, setBusy] = useState(false),
    [allVolumes, setAllVolumes] = useState(true),
    [trash, setTrash] = useState<TrashItem[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [dark, setDark] = useState(() => localStorage.getItem("studio-theme") === "dark");
  const [conflict, setConflict] = useState<string | null>(null),
    [uploadProgress, setUploadProgress] = useState<{
      name: string;
      percent: number;
      index: number;
      total: number;
    } | null>(null),
    [folderSize, setFolderSize] = useState<number | null>(null);
  const conflictResolve = useRef<((yes: boolean) => void) | null>(null),
    uploadController = useRef<AbortController | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    completed = useRef(new Set<string>()),
    detailsJob = useRef(""),
    lastRefresh = useRef(0),
    entriesRef = useRef<Entry[]>([]);
  const { setOpenMobile, isMobile } = useSidebar();
  const fullscreen = useFullscreen();
  const navigate = useCallback(
    (next: Location, replace = false) => {
      window.history[replace ? "replaceState" : "pushState"]({}, "", `?${query(next)}`);
      setLoc(next);
      setSearch("");
      setOffset(0);
      setSelected([]);
      setStarFilter(false);
      setOpenMobile(false);
    },
    [setOpenMobile],
  );
  const reload = () => {
    setRefresh((n) => n + 1);
    setSelected([]);
  };
  const report = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong.");
  const bootstrap = async () => {
    setAllVolumes((await session()).allVolumes);
    const result = await api<VolumeResponse>("/volumes");
    setShortcuts(result.shortcuts);
    setVolumes(result.volumes);
    if (!result.volumes.some((v) => v.id === loc.root) && result.volumes.length) {
      if (loc.root) toast.info("Your previous volume is unavailable. Showing your current workspace.");
      navigate({ root: result.volumes[0].id, path: "" }, true);
    }
    if (!result.volumes.length) {
      setLoading(false);
      setError("No accessible volumes are enabled. Check Settings or reconnect your drive.");
    }
    setReady(true);
  };
  useEffect(() => {
    void bootstrap().catch((e) => {
      if (e instanceof LoginRequiredError) return setLoginRequired(true);
      setError(e.message);
      setLoading(false);
    });
  }, []);
  const submitLogin = async (password: string) => {
    setLoginBusy(true);
    setLoginError("");
    try {
      await login(password);
      setLoginRequired(false);
      await bootstrap();
    } catch (e) {
      setLoginError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setLoginBusy(false);
    }
  };
  useEffect(() => {
    const onPop = () => {
      const next = getLocation();
      setLoc((prev) => {
        if (prev.root === next.root && prev.path === next.path) return prev;
        setSearch("");
        setOffset(0);
        setSelected([]);
        return next;
      });
      const path = getPreviewPath();
      setPreview((prev) => (path ? (entriesRef.current.find((e) => e.path === path) ?? prev) : null));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setOffset(0);
    }, 220);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (!ready || !loc.root) return;
    const controller = new AbortController();
    const forceRefresh = lastRefresh.current !== refresh;
    lastRefresh.current = refresh;
    setLoading(true);
    setError("");
    void api<Listing>(
      `/list?${query(loc)}&q=${encodeURIComponent(debounced)}&hidden=${hidden}&sort=${sort}&direction=${direction}&offset=${offset}&refresh=${forceRefresh}`,
      undefined,
      controller.signal,
    )
      .then((v) => {
        setListing(v);
        setSelected([]);
        const path = getPreviewPath();
        if (path && !preview) {
          const found = v.entries.find((e) => e.path === path);
          if (found) setPreview(found);
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ready, loc, debounced, hidden, sort, direction, offset, refresh]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("studio-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    localStorage.setItem("studio-stars", JSON.stringify(stars));
  }, [stars]);
  useEffect(() => {
    localStorage.setItem("studio-view", view);
  }, [view]);
  useEffect(() => {
    if (!ready) return;
    let stopped = false,
      nextPoll = 0,
      inFlight = false;
    const tick = async () => {
      if (inFlight || Date.now() < nextPoll) return;
      inFlight = true;
      try {
        const list = await api<Job[]>("/jobs");
        if (stopped) return;
        setJobs(list);
        nextPoll = Date.now() + (list.some((j) => j.status === "running") ? 1000 : 30000);
        for (const j of list) {
          if (j.status !== "running" && !completed.current.has(j.id)) {
            completed.current.add(j.id);
            if (j.status === "done") {
              toast.success(`${j.type} complete`);
              if (j.id === detailsJob.current) setFolderSize((j.result as { size: number }).size);
            } else if (j.status === "error") toast.error(j.error);
            else toast.info(j.message);
            reload();
            if (dialog === "trash") void loadTrash();
          }
        }
      } catch {
        nextPoll = Date.now() + 30000;
      } finally {
        inFlight = false;
      }
    };
    const wake = () => {
      nextPoll = 0;
      void tick();
    };
    window.addEventListener("studio-operation", wake);
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("studio-operation", wake);
    };
  }, [ready, dialog]);
  const entryLoc = (e: Entry): Location => ({ root: loc.root, path: e.path });
  const key = (e: Entry) => `${loc.root}:${e.path}`;
  const confirmReplace = (message: string) =>
    new Promise<boolean>((resolve) => {
      conflictResolve.current = resolve;
      setConflict(message);
    });
  const answerConflict = (answer: boolean) => {
    conflictResolve.current?.(answer);
    conflictResolve.current = null;
    setConflict(null);
  };
  async function loadTrash() {
    try {
      setTrash(await api<TrashItem[]>("/trash"));
    } catch (e) {
      report(e);
    }
  }
  function openPreview(e: Entry) {
    const params = new URLSearchParams(window.location.search);
    params.set("preview", e.path);
    window.history.pushState({}, "", `?${params.toString()}`);
    setPreview(e);
  }
  function changePreview(e: Entry) {
    const params = new URLSearchParams(window.location.search);
    params.set("preview", e.path);
    window.history.replaceState({}, "", `?${params.toString()}`);
    setPreview(e);
  }
  function closePreview() {
    if (getPreviewPath()) window.history.back();
    else setPreview(null);
  }
  async function openEntry(e: Entry) {
    if (e.kind === "directory") navigate(entryLoc(e));
    else if (e.kind === "symlink") {
      try {
        const stat = await api<{ kind: string }>(`/stat?${query(entryLoc(e))}`);
        if (stat.kind === "directory") navigate(entryLoc(e));
        else openPreview(e);
      } catch (err) {
        report(err);
      }
    } else if (e.kind === "file") openPreview(e);
    else toast.info("Special devices and sockets cannot be opened.");
  }
  function action(a: Action, e: Entry) {
    setTarget(e);
    switch (a) {
      case "open":
        void openEntry(e);
        break;
      case "copy":
      case "cut": {
        const items = selected.includes(e.path)
          ? selected.map((p) => ({ root: loc.root, path: p }))
          : [entryLoc(e)];
        setClipboard({ items, mode: a === "copy" ? "copy" : "move" });
        toast.success(
          `${items.length} item${items.length === 1 ? "" : "s"} ready to ${a === "copy" ? "copy" : "move"}`,
        );
        break;
      }
      case "rename":
        setName(e.name);
        setDialog("rename");
        break;
      case "download":
        window.location.href = url(entryLoc(e), e.kind === "directory" ? "archive" : "file", true);
        break;
      case "trash":
      case "delete":
        if (!selected.includes(e.path)) setSelected([e.path]);
        setPermanent(a === "delete");
        setDialog("delete");
        break;
      case "star":
        setStars((s) => (s.includes(key(e)) ? s.filter((k) => k !== key(e)) : [...s, key(e)]));
        break;
      case "info":
        setFolderSize(null);
        setDialog("details");
        break;
    }
  }
  async function paste() {
    if (!clipboard) return;
    try {
      await api("/transfer", { ...clipboard, destination: loc, overwrite: false });
      if (clipboard.mode === "move") setClipboard(null);
      toast.info("Transfer started");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.message.includes("names already")) {
        if (await confirmReplace(e.message)) {
          try {
            await api("/transfer", { ...clipboard, destination: loc, overwrite: true });
            if (clipboard.mode === "move") setClipboard(null);
          } catch (err) {
            report(err);
          }
        }
      } else report(e);
    }
  }
  async function submit() {
    setBusy(true);
    try {
      if (dialog === "new") await api("/mkdir", { ...loc, name });
      if (dialog === "rename" && target) await api("/rename", { ...entryLoc(target), name });
      if (dialog === "delete")
        await api("/delete", { items: selected.map((p) => ({ root: loc.root, path: p })), permanent });
      setDialog(null);
      reload();
      if (dialog !== "delete") toast.success(dialog === "new" ? "Folder created" : "Item renamed");
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function uploadFiles(files: File[]) {
    if (uploadController.current) {
      toast.info("An upload is already in progress.");
      return;
    }
    const controller = new AbortController();
    uploadController.current = controller;
    const created = new Set<string>();
    try {
      for (let i = 0; i < files.length; i++) {
        controller.signal.throwIfAborted();
        const file = files[i],
          relative = file.webkitRelativePath || file.name,
          segments = relative.split("/");
        let parent = loc.path;
        for (const segment of segments.slice(0, -1)) {
          const p = [parent, segment].filter(Boolean).join("/");
          if (!created.has(p)) {
            try {
              await api("/mkdir", { root: loc.root, path: parent, name: segment });
            } catch (e) {
              if (!(e instanceof ApiError && e.status === 409)) throw e;
            }
            created.add(p);
          }
          parent = p;
        }
        const destination = { root: loc.root, path: parent };
        const progress = (percent: number) =>
          setUploadProgress({ name: relative, percent, index: i + 1, total: files.length });
        progress(0);
        try {
          await upload(file, destination, progress, controller.signal, false, segments.at(-1));
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && e.message.includes("name already")) {
            if (
              await confirmReplace(
                `${relative} already exists. Replace it? The original will move to Harbor trash.`,
              )
            )
              await upload(file, destination, progress, controller.signal, true, segments.at(-1));
          } else throw e;
        }
      }
      toast.success("Upload finished");
    } catch (e) {
      if ((e as Error).name === "AbortError") toast.info("Upload cancelled; completed files were kept.");
      else report(e);
    } finally {
      uploadController.current = null;
      setUploadProgress(null);
      reload();
    }
  }
  const entries = (listing?.entries || []).filter((e) => !starFilter || stars.includes(key(e))),
    folders = entries.filter((e) => e.kind === "directory"),
    files = entries.filter((e) => e.kind !== "directory");
  entriesRef.current = entries;
  function select(e: Entry, event: React.MouseEvent) {
    if (event.shiftKey && selected.length) {
      const from = entries.findIndex((x) => x.path === selected[0]),
        to = entries.findIndex((x) => x.path === e.path);
      setSelected(entries.slice(Math.min(from, to), Math.max(from, to) + 1).map((x) => x.path));
    } else if (event.metaKey || event.ctrlKey || isMobile)
      setSelected((s) => (s.includes(e.path) ? s.filter((p) => p !== e.path) : [...s, e.path]));
    else setSelected([e.path]);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = e.target as HTMLElement;
      if (
        input.closest("input,textarea,[contenteditable=true],[role=dialog],[role=alertdialog],[role=menu]") ||
        preview
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInput.current?.focus();
        return;
      }
      if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        if (loc.path) navigate({ ...loc, path: loc.path.split("/").slice(0, -1).join("/") });
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(entries.map((x) => x.path));
      }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        void paste();
      }
      if (selected.length) {
        const first = entries.find((x) => x.path === selected[0]);
        if (first && mod && ["c", "x"].includes(e.key.toLowerCase())) {
          e.preventDefault();
          action(e.key.toLowerCase() === "c" ? "copy" : "cut", first);
        }
        if (e.key === "F2" && first) {
          e.preventDefault();
          action("rename", first);
        }
        if (e.key === "Delete" || (e.metaKey && e.key === "Backspace")) {
          e.preventDefault();
          setPermanent(e.shiftKey);
          setDialog("delete");
        }
      }
      if (e.key === "Escape") setSelected([]);
      if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        const cards = [...document.querySelectorAll<HTMLElement>("[data-entry]")];
        const i = cards.indexOf(document.activeElement as HTMLElement);
        if (i >= 0) {
          e.preventDefault();
          cards[Math.max(0, Math.min(cards.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const currentVolume = volumes.find((v) => v.id === loc.root),
    home = volumes.find((v) => v.kind === "home") || volumes[0],
    parts = loc.path.split("/").filter(Boolean);
  const card = (e: Entry) => (
    <FileCard
      key={e.path}
      entry={e}
      loc={loc}
      selected={selected.includes(e.path)}
      starred={stars.includes(key(e))}
      view={e.kind === "directory" ? "grid" : view}
      isMobile={isMobile}
      onSelect={(ev) => select(e, ev)}
      onLongPressSelect={() => setSelected((s) => (s.includes(e.path) ? s : [...s, e.path]))}
      onAction={action}
    />
  );
  return loginRequired ? (
    <div className="empty-state" style={{ minHeight: "100vh" }}>
      <ShieldCheck />
      <h2>PIN required</h2>
      <p>
        This Studio Files instance is shared over the network. Enter the PIN shown in the server terminal.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const password = new FormData(e.currentTarget).get("password");
          if (typeof password === "string" && password) void submitLogin(password);
        }}
        style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}
      >
        <Input
          name="password"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="PIN"
          disabled={loginBusy}
        />
        <Button type="submit" disabled={loginBusy}>
          {loginBusy ? <LoaderCircle className="animate-spin" /> : "Unlock"}
        </Button>
      </form>
      {loginError ? <p style={{ color: "var(--destructive)" }}>{loginError}</p> : null}
    </div>
  ) : (
    <>
      <Sidebar className="studio-sidebar">
        <SidebarHeader className="p-0">
          <button className="brand" onClick={() => home && navigate({ root: home.id, path: "" })}>
            <Command size={18} />
            <span>Studio Files</span>
          </button>
          <div className="quick-create">
            <Button
              className="min-w-0 flex-1 justify-start"
              onClick={() => {
                setName("");
                setDialog("new");
              }}
              disabled={!loc.root}
            >
              <PlusCircle />
              Quick Create
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Keyboard shortcuts"
              onClick={() => setDialog("help")}
            >
              <Keyboard />
            </Button>
          </div>
        </SidebarHeader>
        <SidebarContent className="sidebar-scroll">
          <div className="nav-group">
            <h2>Workspace</h2>
            {!shortcuts.some((s) => s.id === "home") && home && (
              <button
                className={`nav-item ${home.id === loc.root && !loc.path ? "active" : ""}`}
                onClick={() => navigate({ root: home.id, path: "" })}
              >
                <Home size={16} />
                My files
              </button>
            )}
            {shortcuts.map((shortcut) => {
              const Icon = {
                home: Home,
                downloads: Download,
                documents: FileText,
                pictures: Image,
                videos: Video,
                music: Music,
              }[shortcut.id];
              return (
                <button
                  key={shortcut.id}
                  className={`nav-item ${!starFilter && shortcut.root === loc.root && shortcut.path === loc.path ? "active" : ""}`}
                  onClick={() => navigate({ root: shortcut.root, path: shortcut.path })}
                >
                  <Icon size={16} />
                  {shortcut.name}
                </button>
              );
            })}
            <button
              className={`nav-item ${starFilter ? "active" : ""}`}
              onClick={() => setStarFilter((v) => !v)}
            >
              <Star size={16} />
              Starred in this folder
            </button>
            <button
              className="nav-item"
              onClick={() => {
                setDialog("trash");
                void loadTrash();
              }}
            >
              <Trash2 size={16} />
              Trash
            </button>
          </div>
          <div className="nav-group">
            <div className="group-heading">
              <h2>Volumes</h2>
              <button
                aria-label="Refresh volumes"
                onClick={() =>
                  void api<VolumeResponse>("/volumes")
                    .then((r) => {
                      setVolumes(r.volumes);
                      setShortcuts(r.shortcuts);
                      toast.success("Volumes refreshed");
                    })
                    .catch(report)
                }
              >
                <RefreshCw size={13} />
              </button>
            </div>
            {volumes.map((v) => (
              <button
                key={v.id}
                className={`nav-item ${v.id === loc.root && !loc.path ? "active" : ""}`}
                onClick={() => navigate({ root: v.id, path: "" })}
                title={v.path}
              >
                <HardDrive size={16} />
                <span className="truncate">{v.name}</span>
                {v.id === loc.root && <span className="volume-dot" />}
              </button>
            ))}
          </div>
          <div className="nav-group">
            <h2>Preferences</h2>
            <button className="nav-item" onClick={() => setDialog("settings")}>
              <Settings size={16} />
              Settings
            </button>
            <button className="nav-item" onClick={() => setDialog("help")}>
              <CircleHelp size={16} />
              Help & shortcuts
            </button>
          </div>
        </SidebarContent>
        <SidebarFooter className="p-2">
          <div className="storage-card">
            <div className="flex items-center justify-between">
              <span className="font-medium">{currentVolume?.name || "Storage"}</span>
              <HardDrive size={15} />
            </div>
            {currentVolume?.total ? (
              <>
                <p>
                  {bytes(currentVolume.total - (currentVolume.free || 0))} of {bytes(currentVolume.total)}{" "}
                  used
                </p>
                <Progress
                  aria-label="Storage used"
                  value={((currentVolume.total - (currentVolume.free || 0)) / currentVolume.total) * 100}
                />
                <p>{bytes(currentVolume.free || 0)} available</p>
              </>
            ) : (
              <p>Storage information unavailable</p>
            )}
          </div>
          <button className="owner" onClick={() => setDialog("settings")}>
            <div className="avatar">
              <Command size={18} />
            </div>
            <span>
              <strong>Local workspace</strong>
              <small>This device · No login</small>
            </span>
            <MoreHorizontal size={17} />
          </button>
        </SidebarFooter>
      </Sidebar>
      <div className="workspace">
        <header className="topbar">
          <SidebarTrigger />
          <span className="top-divider" />
          <button className="global-search" onClick={() => searchInput.current?.focus()}>
            <Search size={16} />
            Search <kbd>⌘ F</kbd>
          </button>
          <div className="topbar-actions">
            {fullscreen.isSupported && (
              <Button
                size="icon-sm"
                aria-label={fullscreen.isFullscreen ? "Exit full screen" : "Enter full screen"}
                onClick={fullscreen.toggle}
              >
                {fullscreen.isFullscreen ? <Minimize /> : <Maximize />}
              </Button>
            )}
            <Button size="icon-sm" aria-label="Settings" onClick={() => setDialog("settings")}>
              <Settings />
            </Button>
            <Button
              size="icon-sm"
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setDark((v) => !v)}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Help" onClick={() => setDialog("help")}>
              <CircleHelp />
            </Button>
            <span className="avatar small">
              <Command size={16} />
            </span>
          </div>
        </header>
        <main
          className="main-content"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void uploadFiles([...e.dataTransfer.files]);
          }}
        >
          <div className="page-heading">
            <div>
              <h1>{starFilter ? "Starred files" : loc.path ? parts.at(-1) : "My files"}</h1>
              <p>Organize, browse, and find your local files.</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!ready}
                onClick={() => {
                  setName("");
                  setDialog("new");
                }}
              >
                <FolderPlus />
                New folder
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button />} disabled={!ready}>
                  <Upload />
                  Upload
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => fileInput.current?.click()}>
                    <Upload />
                    Upload files
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => folderInput.current?.click()}>
                    <FolderPlus />
                    Upload folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="file-toolbar">
            <div className="search-field">
              <Search size={16} />
              <Input
                ref={searchInput}
                aria-label="Search files and folders"
                placeholder="Search files and folders..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button aria-label="Clear search" onClick={() => setSearch("")}>
                  <X size={14} />
                </button>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                <SlidersHorizontal />
                Filter & sort
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {[
                  ["name", "Name"],
                  ["modified", "Last modified"],
                  ["size", "File size"],
                ].map(([value, label]) => (
                  <DropdownMenuItem key={value} onClick={() => setSort(value)}>
                    {sort === value ? <Check /> : <span className="w-4" />}
                    {label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={direction === "desc"}
                  onCheckedChange={(v) => setDirection(v ? "desc" : "asc")}
                >
                  Descending order
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={hidden} onCheckedChange={setHidden}>
                  Show hidden files
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={starFilter} onCheckedChange={setStarFilter}>
                  Starred in this folder
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="navigation-bar" title={`${currentVolume?.path || ""}/${loc.path}`}>
            <div className="nav-arrows">
              <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => window.history.back()}>
                <ArrowLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Forward"
                onClick={() => window.history.forward()}
              >
                <ArrowRight />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Up one folder"
                disabled={!loc.path}
                onClick={() => navigate({ ...loc, path: parts.slice(0, -1).join("/") })}
              >
                <ArrowUp />
              </Button>
            </div>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  {!parts.length ? (
                    <BreadcrumbPage>{currentVolume?.name || "Volumes"}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={<button />} onClick={() => navigate({ ...loc, path: "" })}>
                      {currentVolume?.name}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {parts.length > 3 && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <DropdownMenu>
                        <DropdownMenuTrigger aria-label="Show parent folders">
                          <MoreHorizontal size={16} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {parts.slice(0, -2).map((p, i) => (
                            <DropdownMenuItem
                              key={i}
                              onClick={() => navigate({ ...loc, path: parts.slice(0, i + 1).join("/") })}
                            >
                              {p}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </BreadcrumbItem>
                  </>
                )}
                {parts.map((p, i) =>
                  parts.length > 3 && i < parts.length - 2 ? null : (
                    <Fragment key={i}>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        {i === parts.length - 1 ? (
                          <BreadcrumbPage>{p}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink
                            render={<button />}
                            onClick={() => navigate({ ...loc, path: parts.slice(0, i + 1).join("/") })}
                          >
                            {p}
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </Fragment>
                  ),
                )}
              </BreadcrumbList>
            </Breadcrumb>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label="Refresh folder"
              onClick={reload}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
            </Button>
          </div>
          {selected.length > 0 && (
            <div className="selection-bar">
              <span>{selected.length} selected</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setClipboard({ items: selected.map((p) => ({ root: loc.root, path: p })), mode: "copy" });
                  toast.success("Copied to clipboard");
                }}
              >
                <Copy />
                Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setClipboard({ items: selected.map((p) => ({ root: loc.root, path: p })), mode: "move" });
                  toast.success("Ready to move");
                }}
              >
                <Scissors />
                Cut
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPermanent(false);
                  setDialog("delete");
                }}
              >
                <Trash2 />
                Trash
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                aria-label="Clear selection"
                onClick={() => setSelected([])}
              >
                <X />
              </Button>
            </div>
          )}
          {clipboard && (
            <div className="clipboard-bar">
              <ClipboardPaste size={15} />
              <span>
                {clipboard.items.length} item(s) ready to {clipboard.mode}
              </span>
              <Button variant="outline" size="sm" onClick={() => void paste()}>
                Paste here
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear clipboard"
                onClick={() => setClipboard(null)}
              >
                <X />
              </Button>
            </div>
          )}
          {error ? (
            <div className="empty-state">
              <Info />
              <h2>We couldn’t open this folder</h2>
              <p>{error}</p>
              <Button variant="outline" onClick={reload}>
                <RefreshCw />
                Try again
              </Button>
            </div>
          ) : loading ? (
            <div className="skeleton-grid" aria-label="Loading files">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="skeleton-card animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {folders.length > 0 && (
                <section>
                  <div className="section-heading">
                    <h2>Folders</h2>
                    <span>
                      {folders.length} {folders.length === 1 ? "folder" : "folders"}
                      {listing?.next !== null ? " on this page" : ""}
                    </span>
                  </div>
                  <div className="folder-grid">{folders.map(card)}</div>
                </section>
              )}
              <section>
                <div className="section-heading">
                  <h2>{starFilter ? "Starred files" : "All files"}</h2>
                  <div className="view-switch">
                    <Button
                      variant="outline"
                      size="sm"
                      className={view === "grid" ? "active" : ""}
                      aria-pressed={view === "grid"}
                      onClick={() => setView("grid")}
                    >
                      <Grid2X2 />
                      Grid View
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={view === "list" ? "active" : ""}
                      aria-pressed={view === "list"}
                      onClick={() => setView("list")}
                    >
                      <List />
                      List View
                    </Button>
                  </div>
                </div>
                {files.length ? (
                  <div className={view === "grid" ? "file-grid" : "file-list"}>
                    {view === "list" && (
                      <div className="list-head">
                        <span>Name</span>
                        <span className="list-kind">Type</span>
                        <span className="list-date">Modified</span>
                        <span className="list-size">Size</span>
                        <span className="sr-only">Actions</span>
                      </div>
                    )}
                    {files.map(card)}
                  </div>
                ) : (
                  <div className="empty-state compact">
                    <FolderOpen />
                    <h2>
                      {search
                        ? "No matching files"
                        : starFilter
                          ? "No starred files in this folder"
                          : "No files here yet"}
                    </h2>
                    <p>
                      {search
                        ? "Try another name or change your filters."
                        : "Drop files here or use Upload to add them."}
                    </p>
                    {!search && (
                      <Button variant="outline" onClick={() => fileInput.current?.click()}>
                        <Upload />
                        Upload files
                      </Button>
                    )}
                  </div>
                )}
              </section>
              <footer className="file-footer">
                <span>
                  {listing?.total.toLocaleString()} items · {currentVolume?.name}{" "}
                  {hidden ? "· Hidden files visible" : ""}
                </span>
                <div className="flex items-center gap-2">
                  {listing && (listing.total > 200 || offset > 0) && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={offset === 0}
                        onClick={() => setOffset((n) => Math.max(0, n - 200))}
                      >
                        Previous
                      </Button>
                      <span>
                        {offset + 1}–{Math.min(offset + 200, listing.total)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={listing.next === null}
                        onClick={() => setOffset(listing.next!)}
                      >
                        Next
                      </Button>
                    </>
                  )}
                  <span className="local-badge">
                    <ShieldCheck size={13} />
                    Local connection
                  </span>
                </div>
              </footer>
            </>
          )}
        </main>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void uploadFiles([...(e.target.files || [])]);
          e.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        {...{ webkitdirectory: "" }}
        onChange={(e) => {
          void uploadFiles([...(e.target.files || [])]);
          e.target.value = "";
        }}
      />
      {(uploadProgress || jobs.some((j) => j.status === "running")) && (
        <div className="transfer-panel" aria-live="polite">
          {uploadProgress && (
            <div>
              <div className="flex items-center justify-between">
                <strong>
                  Uploading {uploadProgress.index} of {uploadProgress.total}
                </strong>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Cancel upload"
                  onClick={() => uploadController.current?.abort()}
                >
                  <X />
                </Button>
              </div>
              <p className="truncate">{uploadProgress.name}</p>
              <Progress value={uploadProgress.percent} />
              <small>{Math.round(uploadProgress.percent)}%</small>
            </div>
          )}
          {jobs
            .filter((j) => j.status === "running")
            .map((j) => (
              <div key={j.id}>
                <div className="flex items-center justify-between">
                  <strong>{j.type}</strong>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Cancel operation"
                    onClick={() => void api(`/jobs/${j.id}/cancel`, {}).catch(report)}
                  >
                    <X />
                  </Button>
                </div>
                <p className="truncate">{j.message}</p>
                <Progress value={j.total ? (j.completed / j.total) * 100 : 0} />
                <small>
                  {j.completed} / {j.total} · {bytes(j.bytes)} processed
                </small>
              </div>
            ))}
        </div>
      )}
      <Dialog
        open={dialog !== null && dialog !== "delete"}
        onOpenChange={(open) => !open && !busy && setDialog(null)}
      >
        <DialogContent
          className={dialog === "settings" || dialog === "help" || dialog === "trash" ? "sm:max-w-lg" : ""}
        >
          <DialogHeader>
            <DialogTitle>
              {dialog === "new"
                ? "Create a new folder"
                : dialog === "rename"
                  ? "Rename item"
                  : dialog === "delete"
                    ? permanent
                      ? "Permanently delete?"
                      : "Move to trash?"
                    : dialog === "settings"
                      ? "Workspace settings"
                      : dialog === "trash"
                        ? "Trash"
                        : dialog === "details"
                          ? target?.name
                          : "Help & keyboard shortcuts"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "new"
                ? "Give your folder a name."
                : dialog === "rename"
                  ? "Choose a new name for this item."
                  : dialog === "delete"
                    ? permanent
                      ? `${selected.length} item(s) will be permanently removed. This cannot be undone.`
                      : `${selected.length} item(s) will move to Harbor trash and can be restored from the sidebar.`
                    : dialog === "settings"
                      ? "Storage and appearance for this device."
                      : dialog === "trash"
                        ? "Deleted items are kept in Harbor trash until restored."
                        : dialog === "details"
                          ? "File information from your device."
                          : "Browse with double-click or Enter. Right-click any item for actions."}
            </DialogDescription>
          </DialogHeader>
          {(dialog === "new" || dialog === "rename") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              id="name-form"
            >
              <label htmlFor="item-name" className="field-label">
                Name
              </label>
              <Input
                id="item-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </form>
          )}
          {dialog === "delete" && (
            <div className={`delete-note ${permanent ? "danger" : ""}`}>
              <Trash2 size={19} />
              <span>
                {permanent
                  ? "Permanent deletion bypasses trash. Check your selection before continuing."
                  : "Trash is stored by this application, separately from your operating system’s trash."}
              </span>
            </div>
          )}
          {dialog === "settings" && (
            <div className="settings-body">
              <label className="setting-row">
                <div>
                  <strong>All volumes</strong>
                  <p>Access every discovered volume your OS allows.</p>
                </div>
                <input
                  type="checkbox"
                  role="switch"
                  checked={allVolumes}
                  onChange={(e) => {
                    const value = e.target.checked;
                    void api<VolumeResponse>("/settings", { allVolumes: value })
                      .then((r) => {
                        setAllVolumes(r.allVolumes);
                        setVolumes(r.volumes);
                        setShortcuts(r.shortcuts);
                        if (!r.volumes.some((v) => v.id === loc.root) && r.volumes[0])
                          navigate({ root: r.volumes[0].id, path: "" });
                        toast.success("Volume access updated");
                      })
                      .catch(report);
                  }}
                />
              </label>
              <label className="setting-row">
                <div>
                  <strong>Dark appearance</strong>
                  <p>Use the dark theme on this browser.</p>
                </div>
                <input
                  type="checkbox"
                  role="switch"
                  checked={dark}
                  onChange={(e) => setDark(e.target.checked)}
                />
              </label>
              <label className="setting-row">
                <div>
                  <strong>Show hidden files</strong>
                  <p>Include dotfiles in folder listings.</p>
                </div>
                <input
                  type="checkbox"
                  role="switch"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                />
              </label>
              <div className="setting-note">
                <ShieldCheck size={18} />
                <div>
                  <strong>Localhost · No login</strong>
                  <p>
                    Network binding is disabled until remote authentication is agreed. This browser controls
                    its own download location. OS permissions always apply.
                  </p>
                </div>
              </div>
            </div>
          )}
          {dialog === "trash" && (
            <div className="trash-list">
              {trash.length ? (
                trash.map((t) => (
                  <div key={t.id}>
                    <Trash2 size={18} />
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate">{t.name}</strong>
                      <small>{new Date(t.deletedAt).toLocaleString()}</small>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void api("/restore", { id: t.id })
                          .then(() => toast.info("Restoring…"))
                          .catch(report)
                      }
                    >
                      Restore
                    </Button>
                  </div>
                ))
              ) : (
                <p className="py-8 text-center text-muted-foreground">Your trash is empty.</p>
              )}
            </div>
          )}
          {dialog === "details" && target && (
            <div className="details">
              {target.kind === "file" && target.mime.startsWith("image/") && !target.mime.includes("svg") && (
                <img
                  className="details-preview"
                  loading="lazy"
                  src={`${url(entryLoc(target), "thumbnail")}&v=${target.modified}`}
                  alt=""
                />
              )}
              {target.kind === "file" && target.mime.startsWith("video/") && (
                <video
                  className="details-preview"
                  src={url(entryLoc(target))}
                  muted
                  playsInline
                  controls
                  preload="metadata"
                />
              )}
              {target.kind === "file" && target.mime.startsWith("audio/") && (
                <audio
                  className="details-preview-audio"
                  src={url(entryLoc(target))}
                  controls
                  preload="metadata"
                />
              )}
              <div>
                <span>Type</span>
                <strong>{fileType(target).label}</strong>
              </div>
              <div>
                <span>Size</span>
                <strong>
                  {target.kind === "directory"
                    ? folderSize === null
                      ? "Not calculated"
                      : bytes(folderSize)
                    : bytes(target.size)}
                </strong>
              </div>
              <div>
                <span>Modified</span>
                <strong>{new Date(target.modified).toLocaleString()}</strong>
              </div>
              <div>
                <span>Path</span>
                <code>
                  {currentVolume?.path}/{target.path}
                </code>
              </div>
              {target.kind === "directory" && (
                <Button
                  variant="outline"
                  onClick={() =>
                    void api<Job>("/size", entryLoc(target))
                      .then((j) => {
                        detailsJob.current = j.id;
                        toast.info("Calculating folder size…");
                      })
                      .catch(report)
                  }
                >
                  Calculate folder size
                </Button>
              )}
            </div>
          )}
          {dialog === "help" && (
            <>
              <div className="shortcuts">
                {[
                  ["Open item", "Double-click / Enter"],
                  ["Select multiple", "Ctrl / ⌘ + click"],
                  ["Select range", "Shift + click"],
                  ["Select this page", "Ctrl / ⌘ + A"],
                  ["Copy / Cut / Paste", "Ctrl / ⌘ + C / X / V"],
                  ["Rename", "F2"],
                  ["Move to trash", "Delete / ⌘ + Backspace"],
                  ["Permanently delete", "Shift + Delete"],
                  ["Go up", "Alt + ↑"],
                  ["Search folder", "Ctrl / ⌘ + F"],
                  ["Toggle sidebar", "Ctrl / ⌘ + B"],
                ].map(([label, k]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <kbd>{k}</kbd>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Search and starred filters apply to the current folder. Touch: tap to select, double-tap to
                open. Media plays using your browser’s supported codecs; unsupported formats remain
                downloadable.
              </p>
            </>
          )}
          {["new", "rename", "delete"].includes(dialog || "") && (
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                variant={dialog === "delete" && permanent ? "destructive" : "default"}
                disabled={busy || (["new", "rename"].includes(dialog || "") && !name.trim())}
                onClick={() => void submit()}
              >
                {busy && <LoaderCircle className="animate-spin" />}
                {dialog === "new"
                  ? "Create folder"
                  : dialog === "rename"
                    ? "Save name"
                    : permanent
                      ? "Delete permanently"
                      : "Move to trash"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={dialog === "delete"} onOpenChange={(open) => !open && !busy && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{permanent ? "Permanently delete?" : "Move to trash?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {selected.length} item(s){" "}
              {permanent
                ? "will be permanently removed. This cannot be undone."
                : "will move to Harbor trash. You can restore them from the sidebar."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className={`delete-note ${permanent ? "danger" : ""}`}>
            <Trash2 size={19} />
            <span>
              {permanent
                ? "Permanent deletion bypasses trash. Check your selection before continuing."
                : "Harbor trash is separate from your operating system’s trash."}
            </span>
          </div>
          <AlertDialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={permanent ? "destructive" : "default"}
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy && <LoaderCircle className="animate-spin" />}
              {permanent ? "Delete permanently" : "Move to trash"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={!!conflict} onOpenChange={(open) => !open && answerConflict(false)}>
        <DialogContent>
          <DialogTitle>Replace existing item?</DialogTitle>
          <DialogDescription>{conflict}</DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => answerConflict(false)}>
              Cancel
            </Button>
            <Button onClick={() => answerConflict(true)}>Replace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Suspense fallback={null}>
        {preview && (
          <MediaViewer
            entry={preview}
            entries={entries}
            loc={loc}
            onClose={closePreview}
            onChange={changePreview}
          />
        )}
      </Suspense>
      <Toaster richColors position="bottom-right" theme={dark ? "dark" : "light"} />
    </>
  );
}
export default function App() {
  return (
    <TooltipProvider>
      <SidebarProvider style={{ "--sidebar-width": "270px" } as CSSProperties}>
        <Workspace />
      </SidebarProvider>
    </TooltipProvider>
  );
}
