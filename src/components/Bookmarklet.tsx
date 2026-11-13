"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Bookmarklet source: grabs the page (or the selection) and opens the tracker with it in the URL hash
 * (`#add=` + JSON {url,title,text}). Written as \x23 so no bookmark manager mistakes it for a fragment.
 */
export function bookmarkletCode(origin: string) {
  const js = `(function(){var s=String(window.getSelection()||'').trim();var t=s||((document.querySelector('main')||document.body).innerText||'');t=t.replace(/\\n{3,}/g,'\\n\\n').trim().slice(0,15000);var u='${origin}/\\x23add='+encodeURIComponent(JSON.stringify({url:location.href,title:document.title,text:t}));if(!window.open(u,'_blank'))location.href=u;})();`;
  return `javascript:${js}`;
}

/** Collapsible "save from any job site" helper with a draggable bookmarklet and a Copy code button. */
export function Bookmarklet() {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const [hint, setHint] = useState(false);

  useEffect(() => {
    setCode(bookmarkletCode(window.location.origin));
  }, []);

  // React 19 refuses javascript: URLs in JSX props, so set the href directly on the element.
  useEffect(() => {
    if (code) linkRef.current?.setAttribute("href", code);
  }, [code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("ok");
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("fail");
    }
  }

  return (
    <details className="group text-sm">
      <summary className="cursor-pointer select-none text-muted hover:text-fg">
        Save jobs from LinkedIn, Handshake &amp; more
      </summary>
      <div className="mt-2 space-y-2 rounded-lg border border-border p-3">
        <p className="text-muted">
          Sites that need a login can&apos;t be read by a link. This button copies the posting you&apos;re looking at
          into the form here — you review it, then click Add job. Tip: select just the description first for a cleaner
          capture.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            ref={linkRef}
            draggable
            onClick={(e) => {
              e.preventDefault();
              setHint(true);
            }}
            className="btn btn-sm border-dashed border-accent text-accent cursor-grab"
            title="Drag me to your bookmarks bar"
          >
            ＋ Save to Job Pipeline
          </a>
          <button className="btn btn-sm" onClick={copy} disabled={!code}>
            {copied === "ok" ? "Copied" : "Copy code"}
          </button>
        </div>
        {hint && <p className="text-ok">Drag that button to your bookmarks bar, then click it on a job posting.</p>}
        <p className="text-xs text-muted">
          Computer: drag the button to your bookmarks bar. iPhone: tap Copy code, bookmark any page (Share → Add
          Bookmark), then edit that bookmark and replace its address with the copied code.
        </p>
        {copied === "fail" && (
          <textarea
            readOnly
            className="input w-full h-20 font-mono text-xs"
            value={code}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Bookmarklet code"
          />
        )}
      </div>
    </details>
  );
}
