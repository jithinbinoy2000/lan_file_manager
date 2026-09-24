import { useEffect, useState, useCallback } from "react";
import screenfull from "screenfull";

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() => screenfull.isEnabled && screenfull.isFullscreen);
  useEffect(() => {
    if (!screenfull.isEnabled) return;
    const onChange = () => setIsFullscreen(screenfull.isFullscreen);
    screenfull.on("change", onChange);
    return () => screenfull.off("change", onChange);
  }, []);
  const toggle = useCallback(() => {
    if (screenfull.isEnabled) void screenfull.toggle();
  }, []);
  return { isFullscreen, toggle, isSupported: screenfull.isEnabled };
}
