"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionEventLike = Event & { results: SpeechRecognitionResultList; resultIndex: number };
type SpeechRecognitionErrorLike = Event & { error: string };
type Recognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
};

type RecognitionConstructor = new () => Recognition;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  }
}

export function useLiveAnswerTranscript() {
  const recognitionRef = useRef<Recognition | null>(null);
  const shouldRunRef = useRef(false);
  const finalRef = useRef("");
  const [transcript, setTranscript] = useState("");
  const [supported, setSupported] = useState(
    () => typeof window !== "undefined" && Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition)
  );

  useEffect(() => {
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) return;
    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-GB";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const value = result[0]?.transcript ?? "";
        if (result.isFinal) finalRef.current = `${finalRef.current} ${value}`.trim();
        else interim += value;
      }
      setTranscript(`${finalRef.current} ${interim}`.trim());
    };
    recognition.onerror = (event) => {
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
        shouldRunRef.current = false;
        setSupported(false);
      }
    };
    recognition.onend = () => {
      if (shouldRunRef.current) {
        try { recognition.start(); } catch { /* browser is already restarting */ }
      }
    };
    recognitionRef.current = recognition;
    return () => {
      shouldRunRef.current = false;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  const begin = useCallback(() => {
    finalRef.current = "";
    setTranscript("");
    shouldRunRef.current = true;
    try { recognitionRef.current?.start(); } catch { /* already active */ }
  }, []);
  const pause = useCallback(() => {
    shouldRunRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
  }, []);
  const resume = useCallback(() => {
    shouldRunRef.current = true;
    try { recognitionRef.current?.start(); } catch { /* already active */ }
  }, []);
  const finish = useCallback(() => {
    shouldRunRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    return finalRef.current.trim() || transcript.trim();
  }, [transcript]);

  return { transcript, supported, begin, pause, resume, finish };
}
