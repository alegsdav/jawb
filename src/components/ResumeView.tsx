import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { DocLine } from "@/lib/docLineTypes";
import { resumeToLines } from "@/lib/docLines";
import { DEFAULT_SIZE, toRuns, type Run } from "@/lib/richText";
import type { Resume } from "@/lib/types";

/** Inline runs of one text part: bold / italic / underline / size, like the editor's marks. */
function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, i) => {
        let node: ReactNode = run.text;
        if (run.underline) node = <u>{node}</u>;
        if (run.italic) node = <em>{node}</em>;
        if (run.bold) node = <strong>{node}</strong>;
        if (run.size !== DEFAULT_SIZE) {
          node = <span style={{ fontSize: `${run.size / DEFAULT_SIZE}em` }}>{node}</span>;
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

/** One line, with the same classes and inline styles the editor's line node renders. */
function ViewLine({ line }: { line: DocLine }) {
  const para = line.para;
  const classes = ["doc-line", `doc-line-${line.kind}`];
  if (para?.align) classes.push(`doc-align-${para.align}`);
  if (para?.rule) classes.push("doc-rule");
  if (para?.caps) classes.push("doc-caps");
  const style: CSSProperties | undefined = para?.spaceBefore
    ? { marginTop: `${para.spaceBefore / DEFAULT_SIZE}em` }
    : undefined;

  const left = toRuns(line.text, line.marks);
  const hasTab = line.kind === "entry" || line.kind === "role";
  const right = hasTab ? toRuns(line.right ?? "", line.rightMarks) : [];
  const empty = left.length === 0 && right.length === 0;

  return (
    <div className={classes.join(" ")} style={style}>
      {empty ? (
        <br />
      ) : (
        <>
          <Runs runs={left} />
          {hasTab && <span className="doc-tab" />}
          <Runs runs={right} />
        </>
      )}
    </div>
  );
}

/** The resume as a read-only page: the same lines the editor shows, with no look applied by kind. */
export function ResumeView({ value }: { value: Resume }) {
  const lines = resumeToLines(value);
  return (
    <div className="doc-canvas">
      <div className="doc-page doc-readonly">
        <div className="doc-content">
          {lines.map((line, i) => (
            <ViewLine key={i} line={line} />
          ))}
        </div>
      </div>
    </div>
  );
}
