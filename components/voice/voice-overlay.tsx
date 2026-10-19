"use client";

import { Check, Microphone, MicrophoneSlash, SpeakerSlash, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { approveProposalAction, dismissProposalAction } from "@/app/actions/proposals";
import { Markdown } from "@/components/chat/markdown";
import { useChat, type UiProposal } from "@/components/chat/use-chat";
import { useShell } from "@/components/layout/shell-context";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/tabs";
import { fetcher } from "@/lib/fetcher";
import { parseConfirmation, spokenSummary } from "@/lib/voice/speech-text";
import { AgentOrb, type OrbState } from "./agent-orb";

type VoiceConfig = { voice: string; speechRate: number; language: string; agentName: string; serverStt: boolean; serverTts: boolean };

// Minimal typing for the Web Speech API (not in lib.dom for all browsers).
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const MAX_RECORD_MS = 45_000;

/**
 * Voice mode: push-to-talk or hands-free. Browser SpeechRecognition when
 * available, otherwise records audio and sends it to the Whisper endpoint.
 * Speaks short answers; any action is confirmed by voice AND on screen first.
 */
export function VoiceOverlay() {
  const { closeVoice, user } = useShell();
  const { data: cfg } = useSWR<VoiceConfig>("/api/voice/config", fetcher);
  const chat = useChat({});
  const [mode, setMode] = React.useState<"ptt" | "handsfree">("ptt");
  const [orb, setOrb] = React.useState<OrbState>("idle");
  const [interim, setInterim] = React.useState("");
  const [micOn, setMicOn] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<UiProposal | null>(null);
  const [level, setLevel] = React.useState(0);

  const recRef = React.useRef<Recognition | null>(null);
  const mediaRef = React.useRef<{ recorder: MediaRecorder; stream: MediaStream; timer: ReturnType<typeof setTimeout>; raf: number } | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const modeRef = React.useRef(mode);
  const confirmingRef = React.useRef<UiProposal | null>(null);
  const handledRef = React.useRef<string | null>(null);
  modeRef.current = mode;
  confirmingRef.current = confirming;

  const Ctor = getRecognitionCtor();
  const supported = Boolean(Ctor) || Boolean(cfg?.serverStt && typeof window !== "undefined" && "MediaRecorder" in window);

  // ---------- speech out ----------
  const stopSpeaking = React.useCallback(() => {
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const speak = React.useCallback(
    async (text: string, then?: () => void) => {
      stopSpeaking();
      if (!text) return then?.();
      setOrb("speaking");
      const done = () => {
        setOrb("idle");
        then?.();
      };
      if (cfg?.serverTts && cfg.voice.startsWith("server:")) {
        try {
          const res = await fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: cfg.voice.slice(7), speed: cfg.speechRate }) });
          if (!res.ok) throw new Error();
          const audio = new Audio(URL.createObjectURL(await res.blob()));
          audioRef.current = audio;
          audio.onended = done;
          await audio.play();
          return;
        } catch {
          // fall back to the browser voice
        }
      }
      if (!("speechSynthesis" in window)) return done();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = cfg?.speechRate ?? 1;
      u.lang = cfg?.language && cfg.language !== "en" ? cfg.language : "en-US";
      const voice = window.speechSynthesis.getVoices().find((v) => v.name === cfg?.voice);
      if (voice) u.voice = voice;
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.speak(u);
    },
    [cfg, stopSpeaking],
  );

  // ---------- speech in ----------
  const stopListening = React.useCallback(() => {
    recRef.current?.stop();
    const m = mediaRef.current;
    if (m && m.recorder.state !== "inactive") m.recorder.stop();
  }, []);

  const handleUtterance = React.useCallback(
    async (text: string) => {
      const t = text.trim();
      setInterim("");
      if (!t) {
        setOrb("idle");
        // Hands-free keeps listening after a silent turn instead of ending the conversation.
        if (modeRef.current === "handsfree") setTimeout(() => void startListeningRef.current?.(), 400);
        return;
      }
      const pending = confirmingRef.current;
      if (pending) {
        const reply = parseConfirmation(t);
        if (reply === "yes") return void confirm(pending, true);
        if (reply === "no") return void confirm(pending, false);
      }
      setOrb("thinking");
      await chat.send(t, { trigger: "voice" });
    },
    [chat], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const startListeningRef = React.useRef<(() => Promise<void>) | null>(null);
  const startListening = React.useCallback(async () => {
    setError(null);
    stopSpeaking(); // interrupt-to-stop
    if (Ctor) {
      const rec = new Ctor();
      rec.lang = cfg?.language && cfg.language !== "en" ? cfg.language : "en-US";
      rec.continuous = false;
      rec.interimResults = true;
      let finalText = "";
      rec.onresult = (e) => {
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]!;
          if (r.isFinal) finalText += r[0].transcript;
          else interimText += r[0].transcript;
        }
        setInterim(finalText + interimText);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Microphone access was blocked. Allow it in your browser's site settings.");
        else if (e.error !== "no-speech" && e.error !== "aborted") setError("I couldn't hear that. Try again.");
      };
      rec.onend = () => {
        setMicOn(false);
        recRef.current = null;
        void handleUtterance(finalText);
      };
      recRef.current = rec;
      try {
        rec.start();
        setMicOn(true);
        setOrb("listening");
      } catch {
        setError("Couldn't start the microphone.");
      }
      return;
    }
    if (!cfg?.serverStt) return setError("Voice input isn't supported in this browser.");
    // Fallback: record a short clip and transcribe on the server (Whisper).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(peak / 128);
        if (mediaRef.current) mediaRef.current.raf = requestAnimationFrame(tick);
      };
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        const m = mediaRef.current;
        if (m) {
          clearTimeout(m.timer);
          cancelAnimationFrame(m.raf);
          m.stream.getTracks().forEach((tr) => tr.stop());
        }
        void ctx.close();
        mediaRef.current = null;
        setMicOn(false);
        setLevel(0);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 1000) return setOrb("idle");
        setOrb("thinking");
        const fd = new FormData();
        fd.set("audio", blob, "speech.webm");
        const res = await fetch("/api/voice/transcribe", { method: "POST", body: fd });
        const data = (await res.json()) as { text?: string; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Transcription failed.");
          return setOrb("idle");
        }
        setInterim(data.text ?? "");
        void handleUtterance(data.text ?? "");
      };
      mediaRef.current = { recorder, stream, timer: setTimeout(() => recorder.stop(), MAX_RECORD_MS), raf: 0 };
      recorder.start();
      mediaRef.current.raf = requestAnimationFrame(tick);
      setMicOn(true);
      setOrb("listening");
    } catch {
      setError("Microphone access was blocked. Allow it in your browser's site settings.");
    }
  }, [Ctor, cfg, handleUtterance, stopSpeaking]);
  startListeningRef.current = startListening;

  // ---------- react to finished answers ----------
  React.useEffect(() => {
    const last = [...chat.messages].reverse().find((m) => m.role === "assistant");
    if (!last || last.pending || handledRef.current === last.id) return;
    handledRef.current = last.id;
    const proposal = last.proposals?.find((p) => p.status === "pending");
    const { text } = spokenSummary(last.content);
    const continueListening = () => {
      if (modeRef.current === "handsfree" || proposal) void startListening();
    };
    if (proposal) {
      setConfirming(proposal);
      void speak(`${text} I can ${proposal.label.toLowerCase()}: ${proposal.summary}. Shall I go ahead?`, continueListening);
    } else {
      void speak(text, continueListening);
    }
  }, [chat.messages, speak, startListening]);

  const confirm = async (p: UiProposal, yes: boolean) => {
    setConfirming(null);
    if (!yes) {
      await dismissProposalAction({ id: p.id });
      chat.setProposalStatus(p.id, "dismissed");
      return void speak("Okay, I won't.");
    }
    const res = await approveProposalAction({ id: p.id });
    if (!res.ok) {
      toast.error(res.error);
      return void speak("That didn't work.");
    }
    chat.setProposalStatus(p.id, "executed");
    toast.success(res.data.message);
    void speak(res.data.message);
  };

  // Cleanup and Esc-to-close.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeVoice();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      recRef.current?.abort();
      const m = mediaRef.current;
      if (m) {
        if (m.recorder.state !== "inactive") m.recorder.stop();
        m.stream.getTracks().forEach((t) => t.stop());
      }
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
    };
  }, [closeVoice]);

  const last = [...chat.messages].reverse().find((m) => m.role === "assistant");
  const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`Talk to ${user.agentName}`}
      className="fixed inset-0 z-[70] flex flex-col bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <Segmented
          id="voice-mode"
          label="Voice mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "ptt", label: "Push to talk" },
            { value: "handsfree", label: "Hands-free" },
          ]}
        />
        <div className="flex items-center gap-2">
          <AnimatePresence>
            {micOn ? (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex h-8 items-center gap-2 rounded-full border border-border px-3 text-[12px]" role="status">
                <span className="size-2 rounded-full bg-danger motion-safe:animate-pulse" aria-hidden /> Mic on
              </motion.span>
            ) : null}
          </AnimatePresence>
          <Button variant="quiet" size="icon" onClick={closeVoice} aria-label="Close voice mode">
            <X />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-4 pb-8" data-lenis-prevent>
        <button
          type="button"
          onClick={() => (orb === "speaking" ? (stopSpeaking(), setOrb("idle")) : undefined)}
          aria-label={orb === "speaking" ? "Stop speaking" : `${user.agentName} is ${orb}`}
          className="rounded-full"
        >
          <AgentOrb state={orb} size={176} level={level} />
        </button>

        <div className="min-h-[3.5rem] max-w-xl text-center" aria-live="polite">
          {interim ? <p className="font-serif text-[22px] leading-snug">{interim}</p> : lastUser && !last?.pending ? <p className="text-[13px] text-muted">You said: “{lastUser.content}”</p> : <p className="text-[15px] text-muted">{supported ? (mode === "ptt" ? "Hold the button and speak." : "Tap start, then just talk.") : "Voice input isn't available in this browser."}</p>}
        </div>

        {last && !last.pending ? (
          <div className="w-full max-w-xl rounded-[16px] border border-border p-5" aria-live="polite">
            <Markdown text={last.content} citations={last.citations} />
            {confirming ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <p className="w-full text-[13px] text-muted">
                  {confirming.label}: <span className="text-foreground">{confirming.summary}</span>. Say “yes” or tap Approve.
                </p>
                <Button variant="primary" size="sm" onClick={() => void confirm(confirming, true)}>
                  <Check /> Approve
                </Button>
                <Button size="sm" onClick={() => void confirm(confirming, false)}>
                  Dismiss
                </Button>
              </div>
            ) : null}
            {chat.conversationId ? (
              <Link href={`/chat/${chat.conversationId}`} onClick={closeVoice} className="mt-3 inline-block text-[12px] text-muted underline underline-offset-4">
                Open in chat
              </Link>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="max-w-md text-center text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        {orb === "speaking" ? (
          <Button size="lg" onClick={() => (stopSpeaking(), setOrb("idle"))}>
            <SpeakerSlash /> Stop speaking
          </Button>
        ) : null}
        {mode === "ptt" ? (
          <Button
            variant="primary"
            size="lg"
            className="min-w-[200px] touch-none select-none"
            disabled={!supported || orb === "thinking"}
            onPointerDown={(e) => {
              e.preventDefault();
              void startListening();
            }}
            onPointerUp={stopListening}
            onPointerLeave={() => micOn && stopListening()}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat && !micOn) {
                e.preventDefault();
                void startListening();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") stopListening();
            }}
            aria-pressed={micOn}
          >
            <Microphone weight={micOn ? "fill" : "regular"} /> {micOn ? "Listening… release to send" : "Hold to talk"}
          </Button>
        ) : (
          <Button variant="primary" size="lg" className="min-w-[200px]" disabled={!supported || orb === "thinking"} onClick={() => (micOn ? stopListening() : void startListening())} aria-pressed={micOn}>
            {micOn ? <MicrophoneSlash /> : <Microphone />} {micOn ? "Stop listening" : "Start"}
          </Button>
        )}
      </div>
    </motion.div>
  );
}
