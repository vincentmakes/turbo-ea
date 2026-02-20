import { useRef, useState, useCallback } from "react";
import { toPng } from "html-to-image";

/**
 * Hook for capturing a DOM element as a thumbnail preview image.
 * Returns a ref to attach to the chart container, the captured thumbnail,
 * and a function that captures the screenshot and opens the save dialog.
 */
export function useThumbnailCapture(openDialog: () => void) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [thumbnail, setThumbnail] = useState<string | undefined>();

  const captureAndSave = useCallback(async () => {
    if (chartRef.current) {
      try {
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
