"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Command as CommandIcon, Loader2, Mic, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BorderBeam } from "../ui/border-beam";
import { useSavy } from "./SavyContext";
import { COMMANDS } from "./prompts";

/**
 * The part of the browser speech API this composer uses. It is not in the
 * standard TypeScript library, and Chrome still ships it under a prefix.
 */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface SavyComposerProps {
  /** Take focus when the composer appears. */
  autoFocus?: boolean;
  followUps: string[];
}

/**
 * Where a question is typed. A light travels round the border and quickens
 * while the box has focus or Savy is working. Typing a slash opens the list
 * of commands; each command is a question, so nothing here bypasses Savy.
 */
export function SavyComposer({ autoFocus = false, followUps }: SavyComposerProps) {
  const { ask, busy, speak, setSpeak, canSpeak } = useSavy();
  const [draft, setDraft] = useState("");
  const [canListen, setCanListen] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  // Decided after mount, so the server and the first client render agree.
  useEffect(() => {
    setCanListen(speechRecognition() !== null);
    return () => recognition.current?.abort();
  }, []);
  const [focused, setFocused] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const slash = draft.startsWith("/");
  const showPalette = paletteOpen || slash;
  const matches = useMemo(() => {
    const needle = slash ? draft.slice(1).toLowerCase() : "";
    // A match on the command's own name ranks above a match in its description.
    const byName = COMMANDS.filter((c) => c.command.slice(1).includes(needle));
    const byDescription = COMMANDS.filter((c) => !byName.includes(c) && c.description.toLowerCase().includes(needle));
    return [...byName, ...byDescription];
  }, [draft, slash]);
  const active = Math.min(highlight, Math.max(0, matches.length - 1));

  const send = (question: string) => {
    if (!question.trim() || busy) return;
    ask(question);
    setDraft("");
    setPaletteOpen(false);
    setHighlight(0);
  };

  /** Push to talk: speak a question, and it is sent when the sentence ends. */
  const toggleListening = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Recognition = speechRecognition();
    if (!Recognition || busy) return;
    const r = new Recognition();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (event) => {
      const results = Array.from(event.results);
      const transcript = results.map((res) => res[0].transcript).join(" ").trim();
      setDraft(transcript);
      if (results.length > 0 && results[results.length - 1]?.isFinal) send(transcript);
    };
    r.onerror = (event) => {
      setVoiceNote(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "The microphone is blocked for this page."
          : event.error === "no-speech"
            ? "I didn't hear anything."
            : "Voice input stopped.",
      );
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    setVoiceNote(null);
    setListening(true);
    r.start();
  };

  const run = (index: number) => {
    const command = matches[index];
    if (command) send(command.question);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showPalette && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((active + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((active - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        run(active);
        return;
      }
    }
    if (e.key === "Escape" && showPalette) {
      // Close the list first; a second Escape reaches the panel.
      e.stopPropagation();
      setPaletteOpen(false);
      if (slash) setDraft("");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  return (
    <div className="relative">
      {followUps.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {followUps.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => send(s)}
              className="rounded-full border border-line bg-ground-2/60 px-3 py-1.5 text-xs text-ink-mid transition-colors hover:border-brass/60 hover:text-ink-hi disabled:cursor-not-allowed disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showPalette && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="glass absolute inset-x-0 bottom-full z-10 mb-2 max-h-72 overflow-y-auto rounded-2xl border border-line p-1.5 shadow-[0_-18px_50px_-24px_rgba(0,0,0,0.9)]"
          >
            <ul role="listbox" aria-label="Commands">
              {matches.map((c, i) => (
                <li key={c.command} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => run(i)}
                    className={clsx(
                      "flex w-full items-baseline gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                      i === active ? "bg-ground-3" : "hover:bg-ground-3/60",
                    )}
                  >
                    <span className="shrink-0 font-mono text-xs text-brass-ink">{c.command}</span>
                    <span className="truncate text-sm text-ink-mid">{c.description}</span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="px-3 py-2 text-sm text-ink-lo">No command matches. Press Enter to ask it as a question.</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      <BorderBeam active={focused || busy || listening} radius={22} size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="rounded-[22px] bg-ground-2 p-2.5 shadow-[inset_0_0_0_1px_rgba(47,41,35,0.9),inset_0_0_40px_0_rgba(255,255,255,0.015)]"
        >
          <label htmlFor="savy-question" className="sr-only">
            Ask Savy a question
          </label>
          <textarea
            id="savy-question"
            ref={inputRef}
            rows={2}
            value={draft}
            maxLength={1200}
            placeholder={listening ? "Listening" : "Ask about tonight, or type / for commands"}
            onChange={(e) => {
              setDraft(e.target.value);
              setHighlight(0);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            className="block max-h-36 min-h-12 w-full resize-none bg-transparent px-2 py-1.5 text-[0.9375rem] text-ink-hi outline-none placeholder:text-ink-lo"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              aria-expanded={showPalette}
              onClick={() => {
                setPaletteOpen(!showPalette);
                inputRef.current?.focus();
              }}
              className={clsx(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                showPalette ? "border-brass/60 text-brass-ink" : "border-line text-ink-mid hover:border-ink-lo hover:text-ink-hi",
              )}
            >
              <CommandIcon aria-hidden className="size-3" />
              Commands
            </button>
            {canSpeak && (
              <button
                type="button"
                aria-pressed={speak}
                title={speak ? "Stop reading answers aloud" : "Read answers aloud"}
                onClick={() => setSpeak(!speak)}
                className={clsx(
                  "inline-flex size-7 items-center justify-center rounded-full border transition-colors",
                  speak ? "border-brass/60 text-brass-ink" : "border-line text-ink-mid hover:border-ink-lo hover:text-ink-hi",
                )}
              >
                {speak ? <Volume2 aria-hidden className="size-3.5" /> : <VolumeX aria-hidden className="size-3.5" />}
                <span className="sr-only">{speak ? "Answers are read aloud" : "Answers are not read aloud"}</span>
              </button>
            )}
            {/* A question typed while Savy is answering stays in the box, and the box says why. */}
            <span aria-live="polite" className={clsx("min-w-0 truncate text-[0.6875rem]", busy && draft.trim() ? "inline text-brass-ink" : "hidden text-ink-lo sm:inline")}>
              {busy && draft.trim() ? "Savy is still answering. Send this when it finishes." : (voiceNote ?? "Enter to send · Shift Enter for a new line")}
            </span>
            {canListen && (
              <button
                type="button"
                aria-pressed={listening}
                disabled={busy}
                title={listening ? "Stop listening" : "Push to talk"}
                onClick={toggleListening}
                className={clsx(
                  "ml-auto flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  listening ? "animate-pulse border-conflict bg-conflict/15 text-conflict" : "border-line text-ink-mid hover:border-ink-lo hover:text-ink-hi",
                )}
              >
                <Mic aria-hidden className="size-4" />
                <span className="sr-only">{listening ? "Stop listening" : "Ask by voice"}</span>
              </button>
            )}
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Send"
              className={clsx(
                "flex size-8 shrink-0 items-center justify-center rounded-full bg-brass text-ground-0 transition-colors hover:bg-brass-ink disabled:cursor-not-allowed disabled:bg-ground-3 disabled:text-ink-lo",
                !canListen && "ml-auto",
              )}
            >
              {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <ArrowUp aria-hidden className="size-4" strokeWidth={2.5} />}
            </button>
          </div>
        </form>
      </BorderBeam>
    </div>
  );
}
