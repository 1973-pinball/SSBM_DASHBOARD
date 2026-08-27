import { useRef, useState } from "react";
import { toBlob, toPng } from "html-to-image";

export type CopyState = "idle" | "ok" | "fail";

/**
 * PNG export for a shareable card.
 *
 * Rendering happens entirely client-side through html-to-image: sharing is the
 * user's choice and nothing is uploaded, which is the same promise the rest of
 * the app makes about replay data. Shared by the player card and the records
 * card so the two can't drift on file naming or clipboard behaviour.
 */
export function useCardExport(fileName: string) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<CopyState>("idle");

  const download = async () => {
    if (!cardRef.current) return;
    const url = await toPng(cardRef.current, { pixelRatio: 2 });
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  };

  const copy = async () => {
    if (!cardRef.current) return;
    try {
      const blob = await toBlob(cardRef.current, { pixelRatio: 2 });
      if (!blob) throw new Error("render failed");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 2000);
  };

  return { cardRef, copied, download, copy };
}
