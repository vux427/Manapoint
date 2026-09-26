// Usage readings (CONTRACT.md §1.2). `resetsAt` travels as an RFC 3339 string.

export const ROLLING = "Rolling"; // short rolling window; five hours on most plans
export const WEEKLY = "Weekly";
export const MONTHLY = "Monthly";

export const usageWindow = (kind, percent, resetsAt = null) => ({ kind, percent, resetsAt });

/**
 * One provider's windows at a point in time. `note` explains why there is nothing to
 * draw — an account with no quota cap, say. That is not a failure, which is why it
 * is separate from a card's error.
 */
export const usage = (provider, windows, collectedAt, note = null) => ({
  provider,
  windows,
  collectedAt: new Date(collectedAt).toISOString(),
  note,
});
