"use client";

import { useEffect, useRef, useState } from "react";
import {
  SpeakingAvatar3D,
  type SpeakingAvatar3DHandle,
} from "@/components/speaking/SpeakingAvatar3D";

interface Props {
  question: string;
  repeatLabel: string;
  loadingLabel: string;
}

export function LandingExaminerPreview({ question, repeatLabel, loadingLabel }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const avatarRef = useRef<SpeakingAvatar3DHandle | null>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) {
      const timeout = globalThis.setTimeout(() => setVisible(true), 0);
      return () => globalThis.clearTimeout(timeout);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="mt-3">
      <SpeakingAvatar3D
        ref={avatarRef}
        enabled={visible}
        onReadyChange={setReady}
        onSpeakingChange={setSpeaking}
      />
      <div className="mt-3 flex items-center gap-3 text-[#c93926]">
        <span aria-hidden="true">●</span>
        <div className="flex h-10 flex-1 items-center justify-center gap-1 overflow-hidden" aria-hidden="true">
          {Array.from({ length: 24 }, (_, index) => (
            <i
              key={index}
              className={`w-[3px] rounded-full bg-[#ef503b] ${speaking ? "animate-pulse" : ""}`}
              style={{ height: `${9 + ((index * 13) % 30)}px` }}
            />
          ))}
        </div>
        <button
          type="button"
          className="min-h-11 rounded-full border border-[#ef503b] bg-[#fff0e6] px-4 text-xs font-bold disabled:cursor-wait disabled:opacity-60"
          disabled={!ready || speaking}
          onClick={() => void avatarRef.current?.speak(question)}
        >
          {!ready ? loadingLabel : speaking ? "…" : repeatLabel}
        </button>
      </div>
      <p className="border-t border-[#e7ded1] pt-3 text-sm">
        <b className="mb-1 block text-[11px] text-[#b63321]">NOVA</b>
        {question}
      </p>
    </div>
  );
}
