import { computed, onScopeDispose, ref, type Reactive } from 'vue';

/**
 * Mission-clock playback.
 *
 * The run already happened, deterministically, on the server. This walks its
 * timeline at wall-clock speed so the twin moves as the machine moved, and it
 * can be paused and scrubbed because the point of a lab is to look twice.
 */
export function usePlayback() {
  const t = ref(0);
  const duration = ref(0);
  const playing = ref(false);
  const speed = ref(1);
  const loop = ref(false);

  let handle = 0;
  let lastWallMs = 0;

  const progress = computed(() => (duration.value > 0 ? Math.min(1, t.value / duration.value) : 0));
  const atEnd = computed(() => duration.value > 0 && t.value >= duration.value - 1);

  function stopLoop(): void {
    if (handle !== 0) {
      cancelAnimationFrame(handle);
      handle = 0;
    }
  }

  function tick(wallMs: number): void {
    if (!playing.value) return;
    const delta = (wallMs - lastWallMs) * speed.value;
    lastWallMs = wallMs;
    const next = t.value + delta;
    if (next >= duration.value) {
      t.value = duration.value;
      if (loop.value) {
        t.value = 0;
      } else {
        playing.value = false;
        stopLoop();
        return;
      }
    } else {
      t.value = next;
    }
    handle = requestAnimationFrame(tick);
  }

  function play(): void {
    if (typeof window === 'undefined' || duration.value <= 0) return;
    if (atEnd.value) t.value = 0;
    playing.value = true;
    lastWallMs = performance.now();
    stopLoop();
    handle = requestAnimationFrame(tick);
  }

  function pause(): void {
    playing.value = false;
    stopLoop();
  }

  function toggle(): void {
    if (playing.value) pause();
    else play();
  }

  function seek(ms: number): void {
    t.value = Math.max(0, Math.min(duration.value, ms));
  }

  function nudge(ms: number): void {
    seek(t.value + ms);
  }

  /** Loads a new run: the timeline restarts from zero. */
  function reset(durationMs: number, autoplay = true): void {
    pause();
    duration.value = Math.max(0, durationMs);
    t.value = 0;
    if (autoplay) play();
  }

  function setSpeed(value: number): void {
    speed.value = value;
  }

  onScopeDispose(stopLoop);

  return { t, duration, playing, speed, loop, progress, atEnd, play, pause, toggle, seek, nudge, reset, setSpeed };
}

export type PlaybackState = ReturnType<typeof usePlayback>;

/** Playback as components see it: `reactive(usePlayback())`, refs unwrapped. */
export type Playback = Reactive<PlaybackState>;
