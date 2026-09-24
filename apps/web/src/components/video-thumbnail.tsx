import { useEffect, useRef, useState } from "react";
const memoryCache = new Map<string, string>();
function readCache(key: string): string | undefined {
  const hit = memoryCache.get(key);
  if (hit) return hit;
  try {
    const stored = sessionStorage.getItem(`studio-vthumb:${key}`);
    if (stored) {
      memoryCache.set(key, stored);
      return stored;
    }
  } catch {}
  return undefined;
}
function writeCache(key: string, dataUrl: string) {
  memoryCache.set(key, dataUrl);
  try {
    sessionStorage.setItem(`studio-vthumb:${key}`, dataUrl);
  } catch {}
}
export function VideoThumbnail({
  src,
  cacheKey,
  onFail,
}: {
  src: string;
  cacheKey: string;
  onFail: () => void;
}) {
  const [thumb, setThumb] = useState(() => readCache(cacheKey));
  const containerRef = useRef<HTMLDivElement>(null);
  const captured = useRef(false);
  useEffect(() => {
    setThumb(readCache(cacheKey));
    captured.current = false;
  }, [cacheKey]);
  useEffect(() => {
    if (thumb || !containerRef.current) return;
    const el = containerRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) capture();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
    function capture() {
      if (captured.current) return;
      captured.current = true;
      observer.disconnect();
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.crossOrigin = "anonymous";
      video.src = src;
      const cleanup = () => {
        video.removeAttribute("src");
        video.load();
      };
      video.onerror = () => {
        cleanup();
        onFail();
      };
      video.onloadedmetadata = () => {
        if (!Number.isFinite(video.duration) || video.duration <= 0) {
          video.currentTime = 0;
          return;
        }
        video.currentTime = Math.min(1, video.duration * 0.1);
      };
      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 480;
          canvas.height = video.videoHeight || 320;
          const ctx = canvas.getContext("2d");
          if (!ctx || !canvas.width || !canvas.height) throw new Error("capture failed");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/webp", 0.75);
          writeCache(cacheKey, dataUrl);
          setThumb(dataUrl);
        } catch {
          onFail();
        } finally {
          cleanup();
        }
      };
    }
  }, [thumb, src, cacheKey, onFail]);
  return (
    <div ref={containerRef} className="video-thumb-zone">
      {thumb && <img className="video-thumb" src={thumb} alt="" />}
    </div>
  );
}
