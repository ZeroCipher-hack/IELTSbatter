"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

interface AudioPlayerProps {
  src: string;
  /** Shown before the first play; simply a hint, the browser reports the rest. */
  durationSeconds?: number | null;
  title?: string | null;
}

/**
 * Listening audio player. The audio is always served from a URL (never stored
 * as binary in the database) so it can later move to object storage unchanged.
 */
export function AudioPlayer({ src, durationSeconds, title }: AudioPlayerProps) {
  const t = useTranslations("testing");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(durationSeconds ?? 0);
  const [plays, setPlays] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setTotal(durationSeconds ?? 0);
    setError(false);
  }, [src, durationSeconds]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().then(() => setPlays((n) => n + 1)).catch(() => setError(true));
    } else {
      audio.pause();
    }
  }

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrent(seconds);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setTotal(event.currentTarget.duration || durationSeconds || 0)}
        onError={() => setError(true)}
        data-testid="audio-element"
      >
        <track kind="captions" />
      </audio>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={error}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:bg-gray-300"
          aria-label={playing ? t("audio.pause") : t("audio.play")}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="min-w-0 flex-1">
          {title && <p className="truncate text-xs font-medium text-gray-600">{title}</p>}
          <input
            type="range"
            min={0}
            max={Math.max(total, 1)}
            step={0.5}
            value={Math.min(current, total || 1)}
            onChange={(event) => seek(Number(event.target.value))}
            className="mt-1 w-full accent-brand-600"
            aria-label={t("audio.seek")}
            disabled={error}
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{formatTime(current)} / {formatTime(total)}</span>
            <span>{t("audio.plays", { count: plays })}</span>
          </div>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{t("audio.error")}</p>}
      <p className="mt-2 text-xs text-gray-500">{t("audio.hint")}</p>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
