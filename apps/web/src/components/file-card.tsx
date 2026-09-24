import { useEffect, useRef, useState } from "react";
import {
  Folder,
  File,
  FileImage,
  FileText,
  FileArchive,
  FileChartColumn,
  Film,
  Music,
  Play,
  MoreVertical,
  Star,
  Clock,
  Copy,
  Scissors,
  Pencil,
  Download,
  Trash2,
  Info,
  ExternalLink,
  Link,
} from "lucide-react";
import type { Entry, Location } from "../../../../packages/shared/types";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "./ui/context-menu";
import { bytes, date, url } from "@/lib/api";
import { VideoThumbnail } from "./video-thumbnail";
export type Action = "open" | "copy" | "cut" | "rename" | "download" | "trash" | "delete" | "info" | "star";
export function fileType(e: Entry) {
  if (e.kind === "directory") return { icon: Folder, label: "Folder" };
  if (e.kind === "symlink") return { icon: Link, label: "Symbolic link" };
  if (e.mime.startsWith("image/")) return { icon: FileImage, label: "Image" };
  if (e.mime.startsWith("video/")) return { icon: Film, label: "Video" };
  if (e.mime.startsWith("audio/")) return { icon: Music, label: "Audio" };
  if (/zip|archive|compressed/.test(e.mime)) return { icon: FileArchive, label: "Archive" };
  if (/sheet|csv|excel/.test(e.mime)) return { icon: FileChartColumn, label: "Spreadsheet" };
  if (e.mime === "application/pdf") return { icon: File, label: "PDF" };
  if (/text|document|json/.test(e.mime)) return { icon: FileText, label: "Document" };
  return { icon: File, label: "File" };
}
const HOVER_DELAY = 350;
function VideoPreview({ src, onFail }: { src: string; onFail: () => void }) {
  const [active, setActive] = useState(false),
    [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setActive(true), HOVER_DELAY);
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setActive(false);
    setReady(false);
  };
  useEffect(() => () => stop(), []);
  return (
    <div
      className="video-preview-zone"
      onMouseEnter={start}
      onMouseLeave={stop}
      onTouchStart={start}
      onTouchEnd={stop}
      onTouchCancel={stop}
    >
      {active && (
        <video
          className={`video-preview ${ready ? "ready" : ""}`}
          src={src}
          muted
          playsInline
          loop
          autoPlay
          preload="metadata"
          onLoadedData={() => setReady(true)}
          onError={onFail}
        />
      )}
    </div>
  );
}
const actions: [Action, string, typeof File][] = [
  ["open", "Open", ExternalLink],
  ["download", "Download", Download],
  ["copy", "Copy", Copy],
  ["cut", "Cut", Scissors],
  ["rename", "Rename", Pencil],
  ["info", "Details", Info],
  ["trash", "Move to trash", Trash2],
  ["delete", "Delete permanently", Trash2],
];
export function FileCard({
  entry,
  loc,
  selected,
  starred,
  view,
  isMobile,
  onSelect,
  onLongPressSelect,
  onAction,
}: {
  entry: Entry;
  loc: Location;
  selected: boolean;
  starred: boolean;
  view: "grid" | "list";
  isMobile: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onLongPressSelect: () => void;
  onAction: (action: Action, entry: Entry) => void;
}) {
  const [thumbError, setThumbError] = useState(false),
    [videoThumbFailed, setVideoThumbFailed] = useState(false),
    [videoFailed, setVideoFailed] = useState(false);
  const folder = entry.kind === "directory";
  const { icon: Icon, label } = fileType(entry);
  const isVideo = entry.mime.startsWith("video/");
  const opensPreview =
    entry.kind === "file" &&
    (entry.mime.startsWith("image/") || entry.mime.startsWith("video/") || entry.mime.startsWith("audio/"));
  const doAction = (action: Action) => onAction(action, entry);
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open && isMobile) onLongPressSelect();
      }}
    >
      <ContextMenuTrigger
        render={<article />}
        data-entry={entry.path}
        tabIndex={0}
        aria-label={`${entry.name}, ${label}${selected ? ", selected" : ""}`}
        className={`file-card ${view === "list" ? "list-card" : folder ? "folder-card" : ""} ${selected ? "selected" : ""}`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, [role=menuitem]")) return;
          if (isMobile || opensPreview) doAction("open");
          else onSelect(event);
        }}
        onDoubleClick={(event) => {
          if (!isMobile && !(event.target as HTMLElement).closest("button")) doAction("open");
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter") {
            e.preventDefault();
            doAction("open");
          }
          if (e.key === " ") {
            e.preventDefault();
            onSelect(e as unknown as React.MouseEvent);
          }
        }}
      >
        {view === "list" ? (
          <>
            <div className="list-name-cell">
              <Icon className="list-icon" />
              <span className="file-name" title={entry.name}>
                {entry.name}
              </span>
            </div>
            <span className="list-kind">{label}</span>
            <span className="list-date">{date(entry.modified)}</span>
            <span className="list-size">{folder ? "—" : bytes(entry.size)}</span>
          </>
        ) : folder ? (
          <>
            <div className="folder-top">
              <div className="folder-icon">
                <Folder size={18} />
              </div>
              <div className="min-w-0">
                <h3 title={entry.name}>{entry.name}</h3>
                <p>Folder</p>
              </div>
            </div>
            <div className="folder-bottom">
              <span>
                <Clock size={14} />
                Updated {date(entry.modified)}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="file-art">
              {entry.mime.startsWith("image/") && !entry.mime.includes("svg") && !thumbError ? (
                <img
                  loading="lazy"
                  decoding="async"
                  src={`${url({ root: loc.root, path: entry.path }, "thumbnail")}&v=${entry.modified}`}
                  alt=""
                  onError={() => setThumbError(true)}
                />
              ) : isVideo && !videoThumbFailed ? (
                <VideoThumbnail
                  src={url({ root: loc.root, path: entry.path })}
                  cacheKey={`${loc.root}:${entry.path}:${entry.modified}`}
                  onFail={() => setVideoThumbFailed(true)}
                />
              ) : (
                <Icon className="file-type-icon" />
              )}
              {isVideo && !videoThumbFailed && (
                <span className="video-play-badge" aria-hidden="true">
                  <Play size={16} fill="currentColor" />
                </span>
              )}
              {isVideo && !videoFailed && (
                <VideoPreview
                  src={url({ root: loc.root, path: entry.path })}
                  onFail={() => setVideoFailed(true)}
                />
              )}
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label={`${starred ? "Unstar" : "Star"} ${entry.name}`}
                className={`star-button ${starred ? "starred" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  doAction("star");
                }}
              >
                <Star className={starred ? "fill-current" : ""} />
              </Button>
            </div>
            <div className="file-description">
              <h3 title={entry.name}>{entry.name}</h3>
              <div className="file-meta">
                <p>Modified {date(entry.modified)}</p>
                <p>{bytes(entry.size)}</p>
              </div>
            </div>
          </>
        )}
        <div className="file-actions">
          {view === "list" && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="list-star"
              aria-label={`${starred ? "Unstar" : "Star"} ${entry.name}`}
              onClick={(event) => {
                event.stopPropagation();
                doAction("star");
              }}
            >
              <Star className={starred ? "fill-current" : ""} />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
              className="file-menu"
              aria-label={`Actions for ${entry.name}`}
            >
              <MoreVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {actions.map(([action, text, ActionIcon], i) => (
                <div key={action}>
                  {i === 6 && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    variant={i >= 6 ? "destructive" : "default"}
                    onClick={() => doAction(action)}
                  >
                    <ActionIcon />
                    {text}
                  </DropdownMenuItem>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {selected && (
          <span className="selection-dot" aria-hidden="true">
            ✓
          </span>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map(([action, text, ActionIcon], i) => (
          <div key={action}>
            {i === 6 && <ContextMenuSeparator />}
            <ContextMenuItem onClick={() => doAction(action)}>
              <ActionIcon />
              {text}
            </ContextMenuItem>
          </div>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
