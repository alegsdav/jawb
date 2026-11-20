"use client";

import { Fragment, useEffect, useState } from "react";
import { getApi, GENERIC_MESSAGE, postApi } from "@/lib/api";

type Weight = "heavy" | "light";
type Bucket = { limit: number; isDefault: boolean; used: number; remaining: number };
type AdminUser = { userId: string; email: string; heavy: Bucket; light: Bucket };
type Quotas = { users: AdminUser[]; defaults: Record<Weight, number> };

/** What the admin has typed for one weight: Total ("" = the env default) and Remaining, as text. */
type Draft = { total: string; remaining: string };

const WEIGHTS: Weight[] = ["heavy", "light"];
const LABEL: Record<Weight, string> = { heavy: "Analyses", light: "Quick actions" };

const draftOf = (b: Bucket): Draft => ({ total: b.isDefault ? "" : String(b.limit), remaining: String(b.remaining) });

/** A whole number from 0 up, or NaN. */
const count = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

/** Total must be empty (default) or a whole number; Remaining must be a whole number. */
const valid = (d: Draft) => (d.total.trim() === "" || Number.isFinite(count(d.total))) && Number.isFinite(count(d.remaining));

/** Total or Remaining differs from what the row shows. */
const changed = (d: Draft, b: Bucket) => {
  const saved = draftOf(b);
  return d.total.trim() !== saved.total || d.remaining.trim() !== saved.remaining;
};

/** One user's row. Save posts only the weights that changed, one request each. */
function Row({ initial, defaults }: { initial: AdminUser; defaults: Record<Weight, number> }) {
  const [user, setUser] = useState(initial);
  const [drafts, setDrafts] = useState<Record<Weight, Draft>>({ heavy: draftOf(initial.heavy), light: draftOf(initial.light) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty = WEIGHTS.filter((w) => changed(drafts[w], user[w]));
  const invalid = dirty.some((w) => !valid(drafts[w]));

  const edit = (w: Weight, patch: Partial<Draft>) => {
    setDrafts((ds) => ({ ...ds, [w]: { ...ds[w], ...patch } }));
    setError("");
  };

  async function save() {
    setSaving(true);
    setError("");
    for (const w of dirty) {
      const d = drafts[w];
      const { data, error: apiError } = await postApi<{ user: AdminUser }>("/api/admin/quotas", {
        userId: user.userId,
        weight: w,
        limit: d.total.trim() === "" ? null : count(d.total),
        remaining: d.remaining.trim() === draftOf(user[w]).remaining ? null : count(d.remaining),
      });
      if (!data) {
        setError(apiError ?? GENERIC_MESSAGE);
        setSaving(false);
        return;
      }
      // Show what the server stored (it clamps Remaining to the limit), so the next Save compares fresh values.
      const fresh = data.user[w];
      setUser((u) => ({ ...u, heavy: w === "heavy" ? fresh : u.heavy, light: w === "light" ? fresh : u.light }));
      setDrafts((ds) => ({ ...ds, [w]: draftOf(fresh) }));
    }
    setSaving(false);
  }

  return (
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-3 break-all">{user.email}</td>
      {WEIGHTS.map((w) => (
        <Fragment key={w}>
          <td className="py-2 pr-2">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              aria-label={`${user.email} ${LABEL[w]} total`}
              placeholder={String(defaults[w])}
              value={drafts[w].total}
              onChange={(e) => edit(w, { total: e.target.value })}
              className="input w-20 py-1.5 tabular-nums"
            />
          </td>
          <td className="py-2 pr-4">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              aria-label={`${user.email} ${LABEL[w]} remaining`}
              value={drafts[w].remaining}
              onChange={(e) => edit(w, { remaining: e.target.value })}
              className="input w-20 py-1.5 tabular-nums"
            />
          </td>
        </Fragment>
      ))}
      <td className="py-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || dirty.length === 0 || invalid}
          className="btn btn-sm"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {(error || (dirty.length > 0 && invalid)) && (
          <p className="text-xs text-bad mt-1">{error || "Use whole numbers, 0 or more."}</p>
        )}
      </td>
    </tr>
  );
}

/** The admin's table of every user's AI limits (GET /api/admin/quotas). */
export function AdminQuotas() {
  const [quotas, setQuotas] = useState<Quotas | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let alive = true;
    getApi<Quotas>("/api/admin/quotas").then(({ data, error }) => {
      if (!alive) return;
      if (data) setQuotas(data);
      else setLoadError(error ?? GENERIC_MESSAGE);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (loadError) return <p className="text-sm text-bad">{loadError}</p>;
  if (!quotas) return <p className="text-sm text-muted">Loading…</p>;
  const { users, defaults } = quotas;
  if (!users.length) return <p className="text-sm text-muted">No users yet.</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Empty total = default ({defaults.heavy} analyses, {defaults.light} quick actions). Remaining resets the
        user&apos;s current window.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th rowSpan={2} className="font-medium pb-2 pr-3 align-bottom">Email</th>
              <th colSpan={2} className="font-medium pb-1">Analyses / day</th>
              <th colSpan={2} className="font-medium pb-1">Quick actions / hr</th>
              <th rowSpan={2} className="pb-2" />
            </tr>
            <tr>
              <th className="font-medium pb-2 pr-2">Total</th>
              <th className="font-medium pb-2 pr-4">Remaining</th>
              <th className="font-medium pb-2 pr-2">Total</th>
              <th className="font-medium pb-2 pr-4">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Row key={u.userId} initial={u} defaults={defaults} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
