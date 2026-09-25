// Which stock is being paid right now: the keeper's schedule, in the browser.
//
// A copy of rotation/src/schedule.ts's windowAt, and test/schedule.test.mjs holds
// the two together. The keeper decides what is actually bought. This only has to
// name the same stock, from the same two numbers: T0 and the clock.

export const PERIOD_SECS = 300;

export function windowAt(nowSecs, t0Secs, n, periodSecs = PERIOD_SECS) {
  const elapsed = Math.max(0, nowSecs - t0Secs);
  const round = Math.floor(elapsed / periodSecs);
  const startsAt = t0Secs + round * periodSecs;
  return { slot: round % n, round, startsAt, endsAt: startsAt + periodSecs };
}
