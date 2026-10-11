"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

/**
 * A table row that acts as a link to the run. The prompt cell keeps a real
 * <a> for accessibility and middle-click; the row handler is the enhancement
 * that makes status, model, cost and date clickable too. Clicks on inner links,
 * buttons and text selections are left alone.
 */
export function RunRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const go = (e: MouseEvent<HTMLTableRowElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("a, button, summary, input, [data-no-row-link]")) return;
    if (window.getSelection()?.toString()) return;
    if (e.metaKey || e.ctrlKey || e.button === 1) window.open(href, "_blank", "noopener");
    else router.push(href);
  };
  const key = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      router.push(href);
    }
  };
  return (
    <tr className="clickable" tabIndex={0} onClick={go} onKeyDown={key}>
      {children}
    </tr>
  );
}
