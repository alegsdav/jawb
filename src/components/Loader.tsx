import UniqueLoading from "@/components/ui/morph-loading";

/**
 * The app's loading mark: four near-black squares that morph around the centre (components/ui/morph-loading.tsx).
 * Plain markup with no hooks, so it works in server and client components alike.
 * Motion is swapped for a gentle pulse under prefers-reduced-motion (see globals.css).
 */
export function Loader({
  size = "md",
  label = "Loading…",
  center = false,
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
  center?: boolean;
  className?: string;
}) {
  const mark = (
    <div role="status" aria-live="polite" className={`inline-flex ${className}`}>
      <span aria-hidden="true">
        <UniqueLoading variant="morph" size={size} />
      </span>
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
