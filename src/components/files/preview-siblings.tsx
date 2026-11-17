"use client";

import { createContext, useContext } from "react";
import type { DocKind, TurnDoc } from "@/lib/drive-links";

// The deliverables of the conversation on screen (the chat bar's « Livrables » list): a file opened from
// the chat shows them at the top of its preview, to go from one to the next without closing it (Leslie,
// 02/11, option A). Empty anywhere else: the preview then shows its one file.
export const PreviewSiblings = createContext<TurnDoc[]>([]);
export const usePreviewSiblings = () => useContext(PreviewSiblings);

export const DOC_TONE: Record<DocKind, string> = {
  pdf: "bg-[#B4321F]",
  excel: "bg-[#137A4B]",
  word: "bg-[#2E4EC4]",
  powerpoint: "bg-[#B85A12]",
  image: "bg-brand",
  video: "bg-[#5538EE]",
  audio: "bg-[#1976D2]",
  other: "bg-ink-3",
};
