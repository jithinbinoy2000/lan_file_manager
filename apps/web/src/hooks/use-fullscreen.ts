import { useEffect, useState, useCallback } from "react";
import screenfull from "screenfull";

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(
    () => screenfull.isEnabled && screenfull.isFullscreen,
  );
  useEffect(() => {
    if (!screenfull.isEnabled) return;
    const onChange = () => {
      const active = screenfull.isFullscreen;
      setIsFullscreen(active);
    };
    screenfull.on("change", onChange);
    return () => {
      screenfull.off("change", onChange);
    };
  }, []);
  const toggle = useCallback(() => {
    if (!screenfull.isEnabled) return;
    if (screenfull.isFullscreen) void screenfull.exit();
    else void screenfull.request(document.documentElement).catch(() => {});
  }, []);
  return { isFullscreen, toggle, isSupported: screenfull.isEnabled };
}
