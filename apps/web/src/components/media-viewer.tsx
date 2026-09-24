import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import { useDrag } from "@use-gesture/react";
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  RotateCw,
  MoreVertical,
  Download,
  Info,
  File,
  Music,
  AlertCircle,
} from "lucide-react";
import type { Entry, Location } from "../../../../packages/shared/types";
import { Button } from "./ui/button";
import { Slider, SliderControl, SliderTrack, SliderIndicator, SliderThumb } from "./ui/slider";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./ui/dropdown-menu";
import { bytes, date, url } from "@/lib/api";
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const isMedia = (e: Entry) =>
  e.kind === "file" &&
  (e.mime.startsWith("image/") || e.mime.startsWith("video/") || e.mime.startsWith("audio/"));
function formatTime(s: number) {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60),
    sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
function useObjectFit() {
  const [orientation, setOrientation] = useState<"landscape" | "portrait">(
    window.innerWidth >= window.innerHeight ? "landscape" : "portrait",
  );
  useEffect(() => {
    const onResize = () => setOrientation(window.innerWidth >= window.innerHeight ? "landscape" : "portrait");
    window.addEventListener("resize", onResize);
    window.screen.orientation?.addEventListener?.("change", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.screen.orientation?.removeEventListener?.("change", onResize);
    };
  }, []);
  return orientation;
}
function ImageStage({
  src,
  alt,
  onFail,
  onSwipe,
}: {
  src: string;
  alt: string;
  onFail: () => void;
  onSwipe: (dir: 1 | -1) => void;
}) {
  const wrapperRef = useRef<ReactZoomPanPinchRef>(null);
  const [scale, setScale] = useState(1);
  const bind = useDrag(
    ({ last, movement: [mx], velocity: [vx], direction: [dx], cancel }) => {
      if (scale > 1.01) return;
      if (Math.abs(mx) > 80 && last) {
        cancel();
        onSwipe(dx > 0 ? -1 : 1);
      } else if (last && Math.abs(mx) > 40 && vx > 0.5) {
        cancel();
        onSwipe(dx > 0 ? -1 : 1);
      }
    },
    { axis: "x", filterTaps: true, pointer: { touch: true } },
  );
  return (
    <div className="media-image-stage" {...bind()}>
      <TransformWrapper
        ref={wrapperRef}
        initialScale={1}
        minScale={1}
        maxScale={6}
        doubleClick={{ mode: "toggle", step: 2 }}
        panning={{ disabled: scale <= 1 }}
        onTransform={(_, state) => setScale(state.scale)}
        wheel={{ step: 0.2 }}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <TransformComponent wrapperClass="media-transform-wrapper" contentClass="media-transform-content">
              <img src={src} alt={alt} draggable={false} onError={onFail} />
            </TransformComponent>
            <div className="media-zoom-controls">
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Zoom out"
                onClick={() => zoomOut()}
                disabled={scale <= 1.01}
              >
                <ZoomOut />
              </Button>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Reset zoom"
                onClick={() => resetTransform()}
                disabled={scale <= 1.01}
              >
                {Math.round(scale * 100)}%
              </Button>
              <Button variant="secondary" size="icon-sm" aria-label="Zoom in" onClick={() => zoomIn()}>
                <ZoomIn />
              </Button>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
function MediaPlayer({
  kind,
  src,
  poster,
  onFail,
  autoplay,
}: {
  kind: "video" | "audio";
  src: string;
  poster?: string;
  onFail: () => void;
  autoplay: boolean;
}) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false),
    [current, setCurrent] = useState(0),
    [duration, setDuration] = useState(0),
    [buffered, setBuffered] = useState(0),
    [muted, setMuted] = useState(false),
    [volume, setVolume] = useState(1),
    [speed, setSpeed] = useState(1),
    [seeking, setSeeking] = useState(false),
    [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    if (autoplay) mediaRef.current?.play().catch(() => {});
    const el = mediaRef.current;
    if (el && el.readyState >= 1 && Number.isFinite(el.duration)) setDuration(el.duration);
  }, [autoplay, src]);
  const wake = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (kind === "video" && playing) hideTimer.current = setTimeout(() => setControlsVisible(false), 2600);
  }, [kind, playing]);
  useEffect(() => {
    wake();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [wake]);
  const togglePlay = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };
  const seekTo = (t: number) => {
    const el = mediaRef.current;
    if (el) el.currentTime = t;
    setCurrent(t);
  };
  const skip = (delta: number) => seekTo(Math.min(Math.max(0, current + delta), duration || 0));
  const Element = kind === "video" ? "video" : "audio";
  return (
    <div className={`media-player media-player-${kind}`} onPointerMove={wake} onClick={wake}>
      <Element
        ref={mediaRef as never}
        key={src}
        src={src}
        poster={kind === "video" ? poster : undefined}
        playsInline
        preload="metadata"
        autoPlay={autoplay}
        onError={onFail}
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLMediaElement).duration || 0)}
        onDurationChange={(e) => {
          const d = (e.target as HTMLMediaElement).duration;
          if (Number.isFinite(d)) setDuration(d);
        }}
        onTimeUpdate={(e) => {
          const el = e.target as HTMLMediaElement;
          if (!seeking) setCurrent(el.currentTime);
          if (Number.isFinite(el.duration)) setDuration((d) => (d !== el.duration ? el.duration : d));
        }}
        onProgress={(e) => {
          const el = e.target as HTMLMediaElement;
          setBuffered(el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0);
        }}
        onVolumeChange={(e) => {
          const el = e.target as HTMLMediaElement;
          setMuted(el.muted);
          setVolume(el.volume);
        }}
      />
      {kind === "audio" && (
        <div className="audio-art">
          <Music size={72} />
        </div>
      )}
      <div
        className={`media-controls ${controlsVisible ? "visible" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="media-seek">
          <span className="media-time">{formatTime(current)}</span>
          <Slider
            min={0}
            max={duration || 0.001}
            step={0.01}
            value={current}
            onValueChange={(v) => {
              setSeeking(true);
              setCurrent(v as number);
            }}
            onValueCommitted={(v) => {
              seekTo(v as number);
              setSeeking(false);
            }}
          >
            <SliderControl>
              <SliderTrack>
                <div
                  className="media-buffered"
                  style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }}
                />
                <SliderIndicator />
              </SliderTrack>
              <SliderThumb />
            </SliderControl>
          </Slider>
          <span className="media-time">{formatTime(duration)}</span>
        </div>
        <div className="media-buttons">
          <Button variant="ghost" size="icon-sm" aria-label="Back 10 seconds" onClick={() => skip(-10)}>
            <RotateCw className="scale-x-[-1]" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label={playing ? "Pause" : "Play"}
            onClick={togglePlay}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Forward 10 seconds" onClick={() => skip(10)}>
            <RotateCw />
          </Button>
          <div className="media-volume">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => {
                const el = mediaRef.current;
                if (el) el.muted = !el.muted;
              }}
            >
              {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
            </Button>
            <Slider
              className="media-volume-slider"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onValueChange={(v) => {
                const el = mediaRef.current;
                if (el) {
                  el.volume = v as number;
                  el.muted = false;
                }
              }}
            >
              <SliderControl>
                <SliderTrack>
                  <SliderIndicator />
                </SliderTrack>
                <SliderThumb />
              </SliderControl>
            </Slider>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label="Playback speed" />}>
              {speed}×
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SPEEDS.map((s) => (
                <DropdownMenuItem key={s} onClick={() => setSpeed(s)}>
                  {s}× {s === 1 ? "(Normal)" : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
export function MediaViewer({
  entry,
  loc,
  entries,
  onClose,
  onChange,
}: {
  entry: Entry;
  loc: Location;
  entries: Entry[];
  onClose: () => void;
  onChange: (e: Entry) => void;
}) {
  const [failed, setFailed] = useState(false);
  const media = entries.filter(isMedia);
  const index = media.findIndex((e) => e.path === entry.path);
  const orientation = useObjectFit();
  useEffect(() => setFailed(false), [entry.path]);
  const go = useCallback(
    (d: 1 | -1) => {
      if (media.length < 2) return;
      onChange(media[(index + d + media.length) % media.length]);
    },
    [media, index, onChange],
  );
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go]);
  useEffect(() => {
    const adjacent = [media[index + 1], media[index - 1]].filter(Boolean) as Entry[];
    const preloaded: HTMLImageElement[] = [];
    for (const e of adjacent) {
      if (e.mime.startsWith("image/") && !e.mime.includes("svg")) {
        const img = new Image();
        img.src = url({ root: loc.root, path: e.path });
        preloaded.push(img);
      }
    }
  }, [index, media, loc.root]);
  const fileUrl = url({ root: loc.root, path: entry.path });
  const isImage = entry.mime.startsWith("image/") && !entry.mime.includes("svg");
  const isVideo = entry.mime.startsWith("video/");
  const isAudio = entry.mime.startsWith("audio/");
  const swipeBind = useDrag(
    ({ last, movement: [mx], direction: [dx], distance: [dist] }) => {
      if (isImage) return;
      if (last && dist > 60 && Math.abs(mx) > 60) go(dx > 0 ? -1 : 1);
    },
    { axis: "x", filterTaps: true, pointer: { touch: true } },
  );
  return (
    <div
      className="media-viewer"
      data-orientation={orientation}
      style={{ "--vh": `${window.innerHeight}px` } as CSSProperties}
      {...(isImage ? {} : swipeBind())}
    >
      <div className="media-viewer-header">
        <div className="media-viewer-title">
          <span className="file-name" title={entry.name}>
            {entry.name}
          </span>
          <span className="media-viewer-meta">
            {bytes(entry.size)} · {date(entry.modified)}
          </span>
        </div>
        <div className="media-viewer-header-actions">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More options" />}>
              <MoreVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                render={<a href={url({ root: loc.root, path: entry.path }, "file", true)} download />}
              >
                <Download />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void navigator.clipboard?.writeText(window.location.href);
                }}
              >
                <Info />
                Copy link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>
      <div className="media-viewer-stage">
        {media.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            className="media-nav media-nav-prev"
            aria-label="Previous"
            onClick={() => go(-1)}
          >
            <ChevronLeft />
          </Button>
        )}
        {failed ? (
          <div className="preview-fallback">
            <AlertCircle />
            <h3>This format cannot be played by your browser.</h3>
            <p>Use the options menu to download it instead.</p>
          </div>
        ) : isImage ? (
          <ImageStage src={fileUrl} alt={entry.name} onFail={() => setFailed(true)} onSwipe={go} />
        ) : isVideo ? (
          <MediaPlayer kind="video" src={fileUrl} onFail={() => setFailed(true)} autoplay />
        ) : isAudio ? (
          <MediaPlayer kind="audio" src={fileUrl} onFail={() => setFailed(true)} autoplay />
        ) : (
          <div className="preview-fallback">
            <File size={56} />
            <h3>No preview available for this file</h3>
            <p>{entry.mime}</p>
            <p>Use the options menu to download the original file.</p>
          </div>
        )}
        {media.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            className="media-nav media-nav-next"
            aria-label="Next"
            onClick={() => go(1)}
          >
            <ChevronRight />
          </Button>
        )}
      </div>
    </div>
  );
}
