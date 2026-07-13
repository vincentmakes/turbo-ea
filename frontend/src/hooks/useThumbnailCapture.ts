import { useRef, useState, useCallback } from "react";

/**
 * Hook for capturing a DOM element as a thumbnail preview image.
 * Returns a ref to attach to the chart container, the captured thumbnail,
 * and a function that captures the screenshot and opens the save dialog.
 *
 * html-to-image loads lazily on first capture: the hook is on the extension
 * SDK (UI SDK 1.11), and a static import here would drag the library into
 * the eager main bundle via extensionHost.
 */
export function useThumbnailCapture(openDialog: () => void) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [thumbnail, setThumbnail] = useState<string | undefined>();

  const captureAndSave = useCallback(async () => {
    if (chartRef.current) {
      try {
        const { toPng } = await import("html-to-image");
        const dataUrl = await toPng(chartRef.current, {
          cacheBust: true,
          pixelRatio: 1,
          quality: 0.8,
          backgroundColor: "#ffffff",
        });
        setThumbnail(dataUrl);
      } catch {
        setThumbnail(undefined);
      }
    }
    openDialog();
  }, [openDialog]);

  return { chartRef, thumbnail, captureAndSave };
}
