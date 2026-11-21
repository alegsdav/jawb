/**
 * Joins class names, skipping empty ones (shadcn's `cn`). This app has no tailwind-merge, so later classes don't
 * override conflicting earlier ones: pass a className that adds, rather than fights, the component's own classes.
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
