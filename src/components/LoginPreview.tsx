import { RevertIcon } from "@/components/icons";

/*
 * The decorative right column of the sign-in page (lg and up): a mock resume in the editor's grey, with a tailoring
 * card overlapping its corner. It is purely visual and has no state, so it is a server component. The whole column is
 * aria-hidden: the form carries everything a screen reader needs.
 */

const CHEVRON = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const GREEN = "bg-[#e3f4ea]";
const RED = "bg-[#fbe5e5]";
const AMBER = "bg-[#fbefe0]";

function Pill({ children, tone }: { children: string; tone: "green" | "red" }) {
  const bg = tone === "green" ? "bg-[rgb(76_195_138/0.18)]" : "bg-[rgb(229_72_77/0.2)]";
  return <span className={`rounded px-2 py-0.5 text-[12px] text-[#e9e9ea] ${bg}`}>{children}</span>;
}

export function LoginPreview() {
  return (
    <div
      aria-hidden="true"
      className="hidden min-w-0 overflow-hidden border-l border-border bg-[#f1f3f4] lg:flex lg:flex-col lg:items-center lg:justify-center lg:gap-7 lg:p-8 xl:p-12"
    >
      <div className="relative w-full max-w-[440px]">
        <div
          className="w-full bg-white px-10 pt-9 pb-10 text-[11px] leading-[1.45] text-[#111] shadow-[0_1px_2px_rgb(0_0_0/0.06),0_8px_24px_-12px_rgb(0_0_0/0.18)]"
          style={{ fontFamily: "Calibri, Carlito, 'Segoe UI', sans-serif" }}
        >
          <div className="text-center text-[17px] font-bold">Your Name</div>
          <div className="text-center text-[#555]">City, ST · you@school.edu · linkedin.com/in/you</div>

          <div className="mt-4 border-b border-[#111] pb-0.5 text-[12px] font-bold">Experience</div>

          <div className="mt-1.5 flex justify-between font-bold">
            <span>Company A</span>
            <span>June – Present</span>
          </div>
          <div className="italic text-[#333]">Software Engineering Intern</div>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            <li className="relative">
              <span className={GREEN}>
                Cut report generation time by [X%] by rebuilding the data pipeline in Python and SQL.
              </span>
            </li>
            <li className="relative">
              <span className={`${RED} outline-3 outline-offset-2 outline-solid outline-[#1e1e7a]`}>
                Worked with engineers and designers on internal tools.
              </span>
              <span className="absolute top-[-4px] left-[calc(100%+36px)] grid size-6 place-items-center rounded-full bg-fg/[0.06] text-[#111]">
                <RevertIcon className="size-[11px]" />
              </span>
            </li>
            <li className="relative">
              <span className={AMBER}>Improved onboarding docs for new team members.</span>
            </li>
          </ul>

          <div className="mt-2.5 flex justify-between font-bold">
            <span>University Lab</span>
            <span>2024 – 2025</span>
          </div>
          <div className="italic text-[#333]">Undergraduate Researcher</div>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            <li>
              <span className={GREEN}>Reduced manual cleanup time by 50% by automating alignment and denoising.</span>
            </li>
          </ul>
        </div>

        <div
          className="absolute -right-8 -bottom-10 flex w-[300px] flex-col gap-2.5 rounded-xl border border-[rgb(255_255_255/0.08)] px-4 py-3.5 text-[#f4f4f5] shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.15)]"
          style={{
            background: "rgb(44 44 46 / 0.94)",
            ["--fg" as string]: "#f4f4f5",
            ["--muted" as string]: "#a1a1a6",
          }}
        >
          <div className="loading-state inline-flex items-center gap-2.5">
            <span className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]">
              {CHEVRON.map((d, i) => (
                <span
                  key={i}
                  className="loading-cell size-[4px] rounded-[1px] bg-fg"
                  style={{ opacity: 0.15, animation: `pixel-on 650ms ease-in-out ${d}ms infinite` }}
                />
              ))}
            </span>
            <span
              className="loading-label bg-clip-text text-[13px] font-medium text-transparent"
              style={{
                backgroundImage: "linear-gradient(90deg, #a1a1a6 35%, #f4f4f5 50%, #a1a1a6 65%)",
                backgroundSize: "200% 100%",
                animation: "shimmer-text 1.4s linear infinite",
              }}
            >
              Tailoring to the posting
            </span>
            <span className="font-mono text-[12px] text-[#a1a1a6] tabular-nums">2.4s</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="green">Python</Pill>
            <Pill tone="green">SQL</Pill>
            <Pill tone="red">Data pipelines</Pill>
            <Pill tone="red">Airflow</Pill>
          </div>
        </div>
      </div>

      <div className="mt-6 max-w-[440px] text-center">
        <p className="text-[17px] font-semibold">One master resume. A tailored copy for every job.</p>
        <p className="mt-1.5 text-[14px] text-muted">
          See which bullets land, fill in the real numbers, and track every application to an offer.
        </p>
      </div>
    </div>
  );
}

export default LoginPreview;
