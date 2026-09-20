/**
 * Counts actions in a sliding time window and scales them to one minute.
 * Time is supplied by the caller: game time from the recording, or wall clock time.
 */
export class EapmCounter {
  private times: number[] = [];
  private startMs: number | null = null;
  private _total = 0;

  constructor(
    readonly windowMs = 60_000,
    /** Below this span the value is not scaled up, otherwise it jumps around too much. */
    readonly minElapsedMs = 10_000,
  ) {}

  reset(): void {
    this.times = [];
    this.startMs = null;
    this._total = 0;
  }

  /** Records when the game started, so the first minute is scaled correctly. */
  markStart(timeMs: number): void {
    if (this.startMs === null) this.startMs = timeMs;
  }

  add(timeMs: number): void {
    this.markStart(timeMs);
    this.times.push(timeMs);
    this._total++;
  }

  /** Every action counted since the last reset, regardless of the window. */
  get total(): number {
    return this._total;
  }

  /**
   * eAPM at `nowMs`. Counts the actions in the window (now - window, now].
   * While the game is shorter than the window, the count is scaled to the elapsed
   * time so far, but never to less than `minElapsedMs`.
   */
  value(nowMs: number): number {
    this.markStart(nowMs);
    const from = nowMs - this.windowMs;
    // Drop old entries at the front. The list is sorted by time.
    let drop = 0;
    while (drop < this.times.length && this.times[drop] <= from) drop++;
    if (drop > 0) this.times.splice(0, drop);

    let count = 0;
    for (const t of this.times) if (t <= nowMs) count++;

    const elapsed = Math.min(this.windowMs, Math.max(nowMs - (this.startMs ?? nowMs), this.minElapsedMs));
    return Math.round((count * 60_000) / elapsed);
  }
}
