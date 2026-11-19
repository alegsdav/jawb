/**
 * The tab stops dialog's helpers: the inches the dialog shows and the points the document keeps, and the checks on the
 * rows the user types. Kept apart from the component so they test without a DOM.
 */
import { MAX_TAB_STOPS, TAB_STOP_MAX_PT, type TabStop, type TabStopAlign } from "@/lib/doc/types";
import { cleanTabStops } from "@/lib/doc/model";

const PT_PER_IN = 72;
/** The furthest a stop may sit from the text's left edge, in inches (TAB_STOP_MAX_PT). */
export const TAB_STOP_MAX_IN = TAB_STOP_MAX_PT / PT_PER_IN;
/** The step of the position input, in inches. */
export const TAB_STOP_STEP_IN = 0.05;

/** One row of the dialog: the position as the user typed it (inches) and the alignment. */
export type StopRow = { inches: string; align: TabStopAlign };

/** Points to inches, rounded to hundredths, for showing a stop. */
export function ptToInches(pt: number): number {
  return Math.round((pt / PT_PER_IN) * 100) / 100;
}

/** Inches to points, rounded to hundredths of a point, for storing a stop. */
export function inchesToPt(inches: number): number {
  return Math.round(inches * PT_PER_IN * 100) / 100;
}

/** The dialog's rows for a paragraph's stops, in the order the paragraph keeps them. No stops gives no rows. */
export function rowsFromStops(stops: TabStop[] | null): StopRow[] {
  return (stops ?? []).map((s) => ({ inches: ptToInches(s.pos).toFixed(2), align: s.align }));
}

export type StopsResult = { ok: true; stops: TabStop[] } | { ok: false; error: string };

/**
 * The stops the rows describe, sorted by position, with a repeated position dropped (the row listed first wins), as
 * the document keeps them. Every row must read as a position above 0 and at most TAB_STOP_MAX_IN; an empty list of
 * rows is valid and means no stops.
 */
export function stopsFromRows(rows: StopRow[]): StopsResult {
  if (rows.length > MAX_TAB_STOPS) return { ok: false, error: `A paragraph can have at most ${MAX_TAB_STOPS} tab stops.` };
  const raw: TabStop[] = [];
  for (let i = 0; i < rows.length; i++) {
    const text = rows[i].inches.trim();
    const inches = text === "" ? NaN : Number(text);
    if (!(inches > 0 && inches <= TAB_STOP_MAX_IN)) {
      return { ok: false, error: `Stop ${i + 1}: the position must be more than 0 and at most ${TAB_STOP_MAX_IN} in.` };
    }
    raw.push({ pos: inchesToPt(inches), align: rows[i].align });
  }
  return { ok: true, stops: cleanTabStops(raw) ?? [] };
}

/**
 * A new row for "Add stop": left-aligned, half an inch past the furthest stop (or at half an inch with none), kept
 * within the allowed range.
 */
export function nextStopRow(rows: StopRow[]): StopRow {
  const furthest = rows.reduce((max, r) => Math.max(max, Number(r.inches) || 0), 0);
  const inches = Math.min(TAB_STOP_MAX_IN, furthest > 0 ? furthest + 0.5 : 0.5);
  return { inches: inches.toFixed(2), align: "left" };
}
