"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SpeakingAvatar3DHandle {
  speak(text: string): Promise<boolean>;
  stop(): void;
}

interface Props {
  enabled: boolean;
  onSpeakingChange?: (speaking: boolean) => void;
}

interface Head {
  showAvatar(options: Record<string, unknown>, onprogress?: (event: ProgressEvent) => void): Promise<void>;
  speakAudio(audio: Record<string, unknown>): void;
  speakMarker(callback: () => void): Promise<void> | void;
  stopSpeaking(): void;
  start(): void;
  stop(): void;
}

interface TTS {
  connect(): Promise<void>;
  setup(options: Record<string, unknown>): void;
  synthesize(options: { input: string }): Promise<Array<{ type: string; data: Record<string, unknown> }>>;
}

type TalkingHeadConstructor = new (node: HTMLElement, options?: Record<string, unknown>) => Head;
type HeadTTSConstructor = new (options?: Record<string, unknown>, onerror?: (error: unknown) => void) => TTS;

async function loadBrowserModule<T>(url: string): Promise<T> {
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as Promise<T>;
}

export const SpeakingAvatar3D = forwardRef<SpeakingAvatar3DHandle, Props>(function SpeakingAvatar3D(
  { enabled, onSpeakingChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<Head | null>(null);
  const ttsRef = useRef<TTS | null>(null);
  const ttsReadyRef = useRef(false);
  const cancelledRef = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback" | "disabled">(enabled ? "loading" : "disabled");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!enabled || !containerRef.current) {
      setStatus("disabled");
      return;
    }
    cancelledRef.current = false;
    let head: Head | null = null;

    void (async () => {
      try {
        const { TalkingHead } = await loadBrowserModule<{ TalkingHead: TalkingHeadConstructor }>(
          "/vendor/talkinghead/talkinghead.bundle.mjs"
        );
        if (cancelledRef.current || !containerRef.current) return;
        head = new TalkingHead(containerRef.current, {
          // HeadTTS supplies timed visemes, so TalkingHead's dynamic language
          // modules are intentionally disabled in the pre-bundled browser build.
          lipsyncModules: [],
          lipsyncLang: "en",
          cameraView: "upper",
          cameraRotateEnable: false,
          cameraPanEnable: false,
          cameraZoomEnable: false,
          modelPixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
          modelFPS: 30,
          lightAmbientIntensity: 3,
          lightDirectIntensity: 24,
        });
        await head.showAvatar(
          {
            url: "/avatars/axi-examiner-mpfb.glb",
            body: "F",
            avatarMood: "happy",
            lipsyncLang: "en",
            baseline: {},
            modelDynamicBones: [
              { bone: "Ponytail1", type: "mix2", stiffness: 100, damping: 4, limits: [null, null, [null, 0.02], null], pivot: true },
              { bone: "Ponytail2", type: "mix2", stiffness: 150, damping: 4, limits: [null, null, [null, 0.01], null] },
              { bone: "Ponytail3", type: "mix2", stiffness: 200, damping: 4 },
            ],
          },
          (event) => {
            if (event.lengthComputable) setProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
          }
        );
        if (cancelledRef.current) return;
        headRef.current = head;
        setStatus("ready");
      } catch {
        if (!cancelledRef.current) setStatus("fallback");
      }
    })();

    const visibility = () => {
      const current = headRef.current;
      if (!current) return;
      if (document.visibilityState === "visible") current.start();
      else current.stop();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelledRef.current = true;
      document.removeEventListener("visibilitychange", visibility);
      window.speechSynthesis?.cancel();
      try { head?.stopSpeaking(); head?.stop(); } catch { /* already disposed */ }
      headRef.current = null;
      ttsRef.current = null;
    };
  }, [enabled]);

  async function ensureTts(): Promise<TTS> {
    if (!ttsRef.current) {
      const { HeadTTS } = await loadBrowserModule<{ HeadTTS: HeadTTSConstructor }>(
        "/vendor/headtts/headtts.bundle.mjs"
      );
      ttsRef.current = new HeadTTS({
        endpoints: ["webgpu", "wasm"],
        languages: ["en-us"],
        voices: ["af_bella"],
        defaultVoice: "af_bella",
        defaultLanguage: "en-us",
        defaultSpeed: 0.96,
        transformersModule: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0/dist/transformers.min.js",
        model: "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped",
        workerModule: `${window.location.origin}/vendor/headtts/worker-tts.mjs`,
        dictionaryURL: `${window.location.origin}/vendor/headtts/dictionaries`,
        voiceURL: `${window.location.origin}/vendor/headtts/voices`,
      });
    }
    if (!ttsReadyRef.current) {
      await ttsRef.current.connect();
      ttsRef.current.setup({ voice: "af_bella", language: "en-us", speed: 0.96, audioEncoding: "wav" });
      ttsReadyRef.current = true;
    }
    return ttsRef.current;
  }

  async function browserSpeak(text: string): Promise<boolean> {
    if (!("speechSynthesis" in window)) return false;
    return new Promise((resolve) => {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-GB";
      utterance.rate = 0.92;
      utterance.pitch = 1;
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    });
  }

  useImperativeHandle(ref, () => ({
    async speak(text: string) {
      const clean = text.trim();
      if (!enabled || !clean) return false;
      onSpeakingChange?.(true);
      try {
        const head = headRef.current;
        if (!head) return await browserSpeak(clean);
        try {
          const tts = await ensureTts();
          const messages = await tts.synthesize({ input: clean });
          for (const message of messages) if (message.type === "audio") head.speakAudio(message.data);
          await new Promise<void>((resolve) => {
            const timeout = window.setTimeout(resolve, Math.max(5000, clean.length * 110));
            head.speakMarker(() => { window.clearTimeout(timeout); resolve(); });
          });
          return true;
        } catch {
          return await browserSpeak(clean);
        }
      } finally {
        onSpeakingChange?.(false);
      }
    },
    stop() {
      window.speechSynthesis?.cancel();
      utteranceRef.current = null;
      try { headRef.current?.stopSpeaking(); } catch { /* nothing queued */ }
      onSpeakingChange?.(false);
    },
  }), [enabled, onSpeakingChange]);

  return (
    <div className="relative min-h-[300px] overflow-hidden rounded-2xl bg-gradient-to-b from-slate-100 via-sky-50 to-brand-50" data-testid="speaking-avatar-3d">
      {enabled && <div ref={containerRef} className="absolute inset-0" aria-label="3D IELTS examiner" />}
      {(status === "loading" || status === "fallback" || status === "disabled") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-brand-100 text-5xl" aria-hidden="true">👩‍🏫</div>
          <p className="mt-4 text-sm font-semibold text-gray-800">
            {status === "loading" ? `3D examiner loading${progress ? ` · ${progress}%` : "…"}` : "IELTS examiner"}
          </p>
          {status === "fallback" && <p className="mt-1 text-xs text-gray-500">3D unavailable — voice mode remains active.</p>}
        </div>
      )}
      <div className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm">AXI Examiner · English (UK)</div>
    </div>
  );
});
