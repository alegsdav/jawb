/**
 * Placeholder cards for features that aren't built yet: a "Coming soon" badge, one line on what it
 * will do, and a faded skeleton of the layout. Static, with no data (no made-up companies or roles).
 */

function Badge() {
  return <span className="chip border-accent/40 bg-accent/5 text-accent text-[11px] font-medium">Coming soon</span>;
}

const Bar = ({ w }: { w: string }) => <span className={`block h-2.5 rounded-full bg-border ${w}`} />;

export function RecommendedCard() {
  return (
    <section className="card p-4 space-y-3" aria-labelledby="recs-heading">
      <div className="flex items-center gap-2">
        <h2 id="recs-heading" className="font-semibold">Recommended internships</h2>
        <Badge />
      </div>
      <p className="text-sm text-muted">Postings that match your resume and facts, ready to tailor in one click.</p>
      <ul aria-hidden className="space-y-3 opacity-60 select-none">
        {["w-3/4", "w-2/3", "w-4/5"].map((w, i) => (
          <li key={i} className="flex items-center gap-3 rounded-lg border border-border p-3">
            <span className="h-8 w-8 shrink-0 rounded-md bg-border" />
            <span className="min-w-0 flex-1 space-y-2">
              <Bar w={w} />
              <Bar w="w-1/3" />
              <span className="flex gap-1">
                <span className="h-4 w-12 rounded-full bg-border" />
                <span className="h-4 w-16 rounded-full bg-border" />
              </span>
            </span>
            <button type="button" disabled className="btn btn-sm" tabIndex={-1}>Tailor</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function InboxCard() {
  return (
    <section className="card p-4 space-y-3" aria-labelledby="inbox-heading">
      <div className="flex items-center gap-2">
        <h2 id="inbox-heading" className="font-semibold">Inbox updates</h2>
        <Badge />
      </div>
      <p className="text-sm text-muted">Interview invites and replies from your email, matched to the right application automatically.</p>
      <ul aria-hidden className="grid gap-2 sm:grid-cols-3 opacity-60 select-none">
        {["w-2/3", "w-3/4", "w-1/2"].map((w, i) => (
          <li key={i} className="rounded-lg border border-border p-3 space-y-2">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-border" />
              <Bar w={w} />
            </span>
            <Bar w="w-full" />
            <Bar w="w-5/6" />
            <span className="block h-4 w-20 rounded-full bg-border" />
          </li>
        ))}
      </ul>
    </section>
  );
}
