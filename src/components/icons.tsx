/** Small stroke icons (24px grid), used by the shell and dashboard. They take their colour from the text. */
type P = { className?: string };

const base = {
  width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
};

export const HomeIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M4 11.2 12 4l8 7.2" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></svg>
);
export const DocIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12h5M10 16h5" /></svg>
);
export const UserIcon = ({ className }: P) => (
  <svg {...base} className={className}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.6-3.6 3.3-5.5 7-5.5s6.4 1.9 7 5.5" /></svg>
);
export const PlusIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
export const SearchIcon = ({ className }: P) => (
  <svg {...base} className={className}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
);
export const LogoutIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></svg>
);
export const SendIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M21 3 10 14" /><path d="M21 3l-7 18-4-7-7-4z" /></svg>
);
export const PencilIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" /><path d="M14.5 6.5l3 3" /></svg>
);
export const ChatIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M4 5h16v11H9l-5 4z" /></svg>
);
export const ClockIcon = ({ className }: P) => (
  <svg {...base} className={className}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const CalendarIcon = ({ className }: P) => (
  <svg {...base} className={className}><rect x="4" y="5.5" width="16" height="14" rx="3" /><path d="M8 3.5v4M16 3.5v4M4 10h16" /></svg>
);
export const SparkIcon = ({ className }: P) => (
  <svg {...base} className={className}><path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9z" /></svg>
);

/** The app mark: a small black glyph next to the wordmark, as in the reference. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" className="text-fg">
      <circle cx="7" cy="7" r="4" fill="currentColor" />
      <circle cx="17" cy="7" r="4" fill="currentColor" />
      <circle cx="7" cy="17" r="4" fill="currentColor" />
      <rect x="13" y="13" width="8" height="8" rx="2.5" fill="currentColor" />
    </svg>
  );
}
