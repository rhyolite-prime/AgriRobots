/**
 * Time is injected, never read (grammar rule S10). A mission running against a
 * virtual clock is reproducible bit for bit; the same interpreter runs against a
 * wall clock on the edge without a line of task logic changing.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch, in the clock's own frame. */
  now(): number;
  /** ISO 8601 UTC timestamp of `now()`, for journal records. */
  timestamp(): string;
}

/**
 * Deterministic clock driven by the interpreter and the simulated world.
 *
 * Concurrent branches of a `parallel` statement each run in their own time lane:
 * a branch's action advances its lane, and the join commits the slowest lane to
 * the mission clock. Eight hands picking at once therefore cost the longest pick,
 * not the sum of all eight, while every event still carries a real timestamp.
 */
export class VirtualClock implements Clock {
  private base = 0;
  private readonly lanes: number[] = [];

  private readonly epochMs: number;
  private readonly onAdvance: ((deltaMs: number) => void) | undefined;

  constructor(epochMs: number, onAdvance?: (deltaMs: number) => void) {
    this.epochMs = epochMs;
    this.onAdvance = onAdvance;
  }

  now(): number {
    return this.epochMs + this.base + this.lanes.reduce((total, lane) => total + lane, 0);
  }

  timestamp(): string {
    return new Date(this.now()).toISOString();
  }

  /** Milliseconds since the mission started, lanes included. */
  elapsedMs(): number {
    return this.now() - this.epochMs;
  }

  /** Mission time with concurrent lanes excluded: the committed timeline. */
  committedMs(): number {
    return this.base;
  }

  /**
   * Moves time forward. Time never goes backwards: a negative delta is refused,
   * because a mission that could un-happen an action could not be audited.
   */
  advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new RangeError(
        `clock advance must be a finite non-negative number, got ${String(deltaMs)}`,
      );
    }
    if (this.lanes.length > 0) {
      this.lanes[this.lanes.length - 1] = (this.lanes[this.lanes.length - 1] ?? 0) + deltaMs;
    } else {
      this.base += deltaMs;
    }
    this.onAdvance?.(deltaMs);
  }

  /** Starts a new concurrency lane (one per nesting level of `parallel`). */
  pushLane(): void {
    this.lanes.push(0);
  }

  /** Reads the current lane's elapsed time. */
  laneElapsed(): number {
    return this.lanes.length > 0 ? (this.lanes[this.lanes.length - 1] ?? 0) : this.base;
  }

  /** Sets the current lane's elapsed time, used when switching between branches. */
  setLaneElapsed(deltaMs: number): void {
    if (this.lanes.length === 0) {
      this.base = deltaMs;
      return;
    }
    this.lanes[this.lanes.length - 1] = deltaMs;
  }

  /** Ends the current lane and commits the slowest work to the mission clock. */
  popLane(): number {
    const lane = this.lanes.pop() ?? 0;
    if (this.lanes.length > 0) {
      this.lanes[this.lanes.length - 1] = (this.lanes[this.lanes.length - 1] ?? 0) + lane;
    } else {
      this.base += lane;
    }
    return lane;
  }

  /** Restores a checkpointed mission time. */
  setElapsed(ms: number): void {
    this.lanes.length = 0;
    this.base = Math.max(0, ms);
  }
}

/** Wall clock, for hardware-in-the-loop and shadow-mode runs. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  timestamp(): string {
    return new Date().toISOString();
  }
}

/** Default mission epoch used by the Virtual Lab: 2026-10-09T17:00:00Z. */
export const DEFAULT_MISSION_EPOCH_MS = Date.parse('2026-10-09T17:00:00.000Z');
