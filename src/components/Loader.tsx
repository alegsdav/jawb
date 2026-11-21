/**
 * The app's loading mark: a flipping blue square (the owner's loader, in the app's colours).
 * Plain markup with no hooks, so it works in server and client components alike.
 * Motion is swapped for a gentle pulse under prefers-reduced-motion (see globals.css).
 */
export function Loader({
  size = 40,
  label = "Loading…",
  center = false,
  className = "",
}: {
  size?: number;
  label?: string;
  center?: boolean;
  className?: string;
}) {
  const mark = (
    <div role="status" aria-live="polite" className={`inline-flex ${className}`}>
      <span
        aria-hidden="true"
        className="flipping-square-loader"
        style={{ width: size, height: size, borderRadius: Math.max(2, Math.round(size * 0.1)) }}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
  if (!center) return mark;
  return <div className="flex h-full min-h-[60vh] w-full items-center justify-center">{mark}</div>;
}

/** A whole-page loading state, centred in the content area (both ways). Used by route-level loading UI. */
export function PageLoader() {
  return <Loader center />;
}
