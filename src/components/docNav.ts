import type React from "react";

type DocField = HTMLInputElement | HTMLTextAreaElement;

/** Fields in DOM order, skipping disabled and hidden ones. */
function fieldsIn(root: HTMLElement): DocField[] {
  return Array.from(root.querySelectorAll<DocField>("input.doc-field, textarea.doc-field")).filter(
    (el) => !el.disabled && el.offsetParent !== null,
  );
}

/** Single-line fields: inputs, and textareas marked data-singleline (the name and contact lines). */
function isSingleLine(el: DocField): boolean {
  return el instanceof HTMLInputElement || el.hasAttribute("data-singleline");
}

/** Focus a field and put the caret at its start or end, scrolling it into view if needed. */
export function focusField(el: DocField, pos: "start" | "end"): void {
  el.focus({ preventScroll: false });
  const at = pos === "start" ? 0 : el.value.length;
  try {
    el.setSelectionRange(at, at);
  } catch {
    // Some input types do not support selection; focusing alone is enough there.
  }
  el.scrollIntoView({ block: "nearest" });
}

// Hidden mirror of a textarea, laid out with the same box, font and wrapping. Used to tell which
// visual line the caret is on (a soft-wrapped paragraph is several visual lines).
let mirror: HTMLDivElement | null = null;

function getMirror(el: HTMLTextAreaElement): HTMLDivElement {
  if (!mirror) {
    mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    mirror.style.position = "absolute";
    mirror.style.left = "-99999px";
    mirror.style.top = "0";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.overflowWrap = "break-word";
    document.body.appendChild(mirror);
  }
  const cs = window.getComputedStyle(el);
  const m = mirror;
  m.style.width = `${el.clientWidth}px`;
  m.style.boxSizing = "border-box";
  m.style.padding = cs.padding;
  m.style.borderWidth = cs.borderWidth;
  m.style.borderStyle = "solid";
  m.style.fontFamily = cs.fontFamily;
  m.style.fontSize = cs.fontSize;
  m.style.fontWeight = cs.fontWeight;
  m.style.fontStyle = cs.fontStyle;
  m.style.letterSpacing = cs.letterSpacing;
  m.style.lineHeight = cs.lineHeight;
  return m;
}

/** Vertical position of the visual line that contains `pos`, in the textarea's own layout. */
function caretLineTop(el: HTMLTextAreaElement, pos: number): number {
  const m = getMirror(el);
  m.textContent = el.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = "​";
  m.appendChild(marker);
  return marker.offsetTop;
}

/**
 * Like a continuous document: arrow keys and Enter move between the doc's fields.
 * Call from the keydown handler of the element that contains the fields (the canvas).
 */
export function handleDocArrowKeys(e: React.KeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  if (!root || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (e.nativeEvent.isComposing) return;

  const target = e.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  if (!target.classList.contains("doc-field") || !root.contains(target)) return;
  if (target instanceof HTMLInputElement && target.type !== "text" && target.type !== "") return;

  const fields = fieldsIn(root);
  const idx = fields.indexOf(target);
  if (idx < 0) return;
  const prev = fields[idx - 1];
  const next = fields[idx + 1];

  const pos = target.selectionStart ?? 0;
  const collapsed = target.selectionStart === target.selectionEnd;
  const len = target.value.length;

  const moveTo = (el: DocField | undefined, where: "start" | "end") => {
    if (!el) return;
    e.preventDefault();
    focusField(el, where);
  };

  switch (e.key) {
    case "ArrowLeft":
      if (collapsed && pos === 0) moveTo(prev, "end");
      return;
    case "ArrowRight":
      if (collapsed && pos === len) moveTo(next, "start");
      return;
    case "ArrowUp":
      if (!collapsed) return;
      if (isSingleLine(target) || !(target instanceof HTMLTextAreaElement)) {
        moveTo(prev, "end");
        return;
      }
      // Textarea: only leave the field when the caret is already on its first visual line.
      if (pos === 0 || caretLineTop(target, pos) <= caretLineTop(target, 0)) moveTo(prev, "end");
      return;
    case "ArrowDown":
      if (!collapsed) return;
      if (isSingleLine(target) || !(target instanceof HTMLTextAreaElement)) {
        moveTo(next, "start");
        return;
      }
      // Textarea: only leave the field when the caret is already on its last visual line.
      if (pos === len || caretLineTop(target, pos) >= caretLineTop(target, len)) moveTo(next, "start");
      return;
    case "Enter":
      // Single-line fields: Enter goes to the next field and never adds a line. Other textareas keep their newline.
      if (isSingleLine(target)) {
        e.preventDefault();
        if (next) focusField(next, "start");
      }
      return;
    default:
      return;
  }
}
