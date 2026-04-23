export function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("rate_limit:");
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-2xl text-[var(--accent-red)]">⚠</div>
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      {message && (
        <p className="max-w-xs text-xs text-[var(--text-muted)]">{message}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 text-xs text-[var(--accent-cyan)] hover:underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}

interface RateLimitErrorProps {
  onRetry?: () => void;
}

export function RateLimitError({ onRetry }: RateLimitErrorProps) {
  return (
    <ErrorState
      title="Rate limit reached"
      message="Instagram API usage is at capacity. Try again shortly."
      onRetry={onRetry}
    />
  );
}

interface EmptyStateProps {
  title?: string;
  message?: string;
}

export function EmptyState({
  title = "No data",
  message,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-[var(--text-muted)]">{title}</p>
      {message && (
        <p className="max-w-xs text-xs text-[var(--text-muted)]/60">{message}</p>
      )}
    </div>
  );
}
