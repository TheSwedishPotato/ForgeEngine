"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, formatQuality, reportPlay, type Track } from "@/core/api";
import { useAuth } from "@/core/auth";

type Player = {
  current: Track | null;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  buffered: Array<[number, number]>;
  error: string | null;
  analyser: AnalyserNode | null;
  /** Sample rate the browser mixes at; the master is resampled to this for the output device. */
  outputRate: number | null;
  play(track: Track, queue?: Track[]): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(seconds: number): void;
};

const PlayerContext = createContext<Player | null>(null);

/**
 * Owns the single <audio> element. The browser streams the signed URL with
 * HTTP Range requests (only the bytes about to play are fetched, and seeking
 * jumps straight to the right offset); Web Audio taps the decoded signal for
 * the spectrum display.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef(-1);
  const currentRef = useRef<Track | null>(null);
  const loadedIdRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  const retriedRef = useRef(false);
  const listenedMs = useRef(0);
  const lastTime = useRef(0);

  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(NaN);
  const [buffered, setBuffered] = useState<Array<[number, number]>>([]);
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const flush = useCallback(() => {
    const t = currentRef.current;
    if (t && listenedMs.current >= 1000) reportPlay(t.id, listenedMs.current);
    listenedMs.current = 0;
  }, []);

  // Browsers only let an AudioContext start from a user gesture, so the graph
  // is built on the first play.
  const ensureGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (ctxRef.current) {
      ctxRef.current.resume();
      return;
    }
    const ctx = new AudioContext({ latencyHint: "playback" });
    const node = ctx.createAnalyser();
    node.fftSize = 4096;
    node.smoothingTimeConstant = 0.8;
    ctx.createMediaElementSource(audio).connect(node).connect(ctx.destination);
    ctxRef.current = ctx;
    setAnalyser(node);
  }, []);

  const load = useCallback(
    async (track: Track, resumeAt = 0) => {
      const audio = audioRef.current;
      if (!audio) return;
      const req = ++requestRef.current;
      flush();
      audio.pause();
      loadedIdRef.current = null;
      currentRef.current = track;
      lastTime.current = resumeAt;
      setCurrent(track);
      setError(null);
      setLoading(true);
      setPosition(resumeAt);
      setBuffered([]);
      setMediaDuration(NaN);
      try {
        const { url } = await api<{ url: string }>(`/api/tracks/${track.id}/play`, { method: "POST" });
        if (req !== requestRef.current) return;
        audio.src = url;
        loadedIdRef.current = track.id;
        if (resumeAt > 0) audio.currentTime = resumeAt;
        await audio.play();
      } catch (e) {
        if (req !== requestRef.current) return;
        setLoading(false);
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof ApiError) setError(e.status === 401 ? "Sign in to listen." : e.message);
        else if (e instanceof DOMException && e.name === "NotAllowedError") setError(null);
        else setError("Playback failed. Check your connection and try again.");
      }
    },
    [flush],
  );

  const step = useCallback(
    (delta: number) => {
      const i = indexRef.current + delta;
      if (i < 0 || i >= queueRef.current.length) return false;
      indexRef.current = i;
      retriedRef.current = false;
      load(queueRef.current[i]);
      return true;
    },
    [load],
  );

  const stop = useCallback(() => {
    const audio = audioRef.current;
    flush();
    requestRef.current++;
    currentRef.current = null;
    loadedIdRef.current = null;
    queueRef.current = [];
    indexRef.current = -1;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setCurrent(null);
    setPlaying(false);
    setLoading(false);
  }, [flush]);

  useEffect(() => {
    const audio = new Audio();
    // Without CORS the Web Audio graph would receive silence from a cross-origin stream.
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    audioRef.current = audio;

    const onTime = () => {
      const t = audio.currentTime;
      const d = t - lastTime.current;
      if (!audio.paused && d > 0 && d < 1.5) listenedMs.current += d * 1000; // larger jumps are seeks
      lastTime.current = t;
      setPosition(t);
    };
    const onProgress = () => {
      const out: Array<[number, number]> = [];
      for (let i = 0; i < audio.buffered.length; i++) out.push([audio.buffered.start(i), audio.buffered.end(i)]);
      setBuffered(out);
    };
    const onPlaying = () => {
      setPlaying(true);
      setLoading(false);
      retriedRef.current = false;
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setLoading(true);
    const onDuration = () => setMediaDuration(audio.duration);
    const onSeeked = () => (lastTime.current = audio.currentTime);
    const onEnded = () => {
      flush();
      setPlaying(false);
      if (!step(1)) audio.currentTime = 0;
    };
    const onError = () => {
      const t = currentRef.current;
      if (!t || !loadedIdRef.current) return;
      // Stream links expire after a few hours: fetch a fresh one once and resume in place.
      if (!retriedRef.current) {
        retriedRef.current = true;
        load(t, audio.currentTime);
        return;
      }
      setPlaying(false);
      setLoading(false);
      setError("Playback failed. Check your connection and try again.");
    };
    const events: Array<[string, () => void]> = [
      ["timeupdate", onTime],
      ["progress", onProgress],
      ["playing", onPlaying],
      ["pause", onPause],
      ["waiting", onWaiting],
      ["durationchange", onDuration],
      ["seeked", onSeeked],
      ["ended", onEnded],
      ["error", onError],
    ];
    for (const [name, fn] of events) audio.addEventListener(name, fn);
    window.addEventListener("pagehide", flush);

    return () => {
      for (const [name, fn] of events) audio.removeEventListener(name, fn);
      window.removeEventListener("pagehide", flush);
      flush();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      ctxRef.current?.close();
      ctxRef.current = null;
      audioRef.current = null;
      setAnalyser(null);
    };
  }, [flush, load, step]);

  // Signing out stops playback.
  useEffect(() => {
    if (!me) stop();
  }, [me, stop]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = current
      ? new MediaMetadata({ title: current.title, artist: current.artistName, album: formatQuality(current) })
      : null;
  }, [current]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => void audioRef.current?.play());
    ms.setActionHandler("pause", () => audioRef.current?.pause());
    ms.setActionHandler("nexttrack", () => step(1));
    ms.setActionHandler("previoustrack", () => step(-1));
    return () => {
      for (const action of ["play", "pause", "nexttrack", "previoustrack"] as const) ms.setActionHandler(action, null);
    };
  }, [step]);

  const value = useMemo<Player>(() => {
    const audio = () => audioRef.current;
    return {
      current,
      playing,
      loading,
      position,
      duration: Number.isFinite(mediaDuration) ? mediaDuration : (current?.durationMs ?? 0) / 1000,
      buffered,
      error,
      analyser,
      outputRate: analyser?.context.sampleRate ?? null,
      play(track, queue) {
        ensureGraph();
        if (queue) queueRef.current = queue;
        if (!queueRef.current.some((t) => t.id === track.id)) queueRef.current = [track];
        indexRef.current = queueRef.current.findIndex((t) => t.id === track.id);
        const a = audio();
        if (a && loadedIdRef.current === track.id) {
          if (a.paused) void a.play();
          else a.pause();
          return;
        }
        retriedRef.current = false;
        load(track);
      },
      toggle() {
        const a = audio();
        const t = currentRef.current;
        if (!a || !t) return;
        ensureGraph();
        if (!loadedIdRef.current) load(t);
        else if (a.paused) void a.play();
        else a.pause();
      },
      next() {
        ensureGraph();
        step(1);
      },
      prev() {
        const a = audio();
        if (a && a.currentTime > 3) {
          a.currentTime = 0;
          return;
        }
        ensureGraph();
        if (!step(-1) && a) a.currentTime = 0;
      },
      seek(seconds) {
        const a = audio();
        if (!a || !loadedIdRef.current) return;
        a.currentTime = seconds;
        lastTime.current = seconds;
        setPosition(seconds);
      },
    };
  }, [current, playing, loading, position, mediaDuration, buffered, error, analyser, ensureGraph, load, step]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}
