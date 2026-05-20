const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

interface RetryOpts {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

export async function withAnthropicRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 6;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const label = opts.label ?? "anthropic";

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      const retryable = typeof status === "number" && RETRYABLE_STATUSES.has(status);
      if (!retryable || attempt >= maxAttempts) throw e;
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * (exp / 2));
      const delay = exp + jitter;
      console.warn(
        `[${label}] ${status} (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
