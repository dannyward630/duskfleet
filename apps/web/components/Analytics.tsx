"use client";

import { useEffect } from "react";
import { onConsentChange, readConsent } from "@/lib/consent";

/**
 * GA4 loader. Loads nothing without a measurement id (`NEXT_PUBLIC_GA_MEASUREMENT_ID`, unset by
 * default) and nothing before the visitor accepts analytics cookies in the banner: with no
 * choice yet, or Reject, no script is requested and no cookie is set.
 */
export function Analytics() {
  const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  useEffect(() => {
    if (!id) return;
    if (readConsent() === "accepted") {
      loadGtag(id);
      return;
    }
    return onConsentChange((consent) => {
      if (consent === "accepted") loadGtag(id);
    });
  }, [id]);

  return null;
}

function loadGtag(id: string) {
  if (document.getElementById("ga4")) return;
  const w = window as unknown as { dataLayer: unknown[] };
  w.dataLayer = w.dataLayer ?? [];
  // gtag.js reads the arguments object, not an array.
  function gtag(..._args: unknown[]) {
    // biome-ignore lint/complexity/noArguments: the gtag snippet pushes `arguments` by contract
    w.dataLayer.push(arguments);
  }
  gtag("js", new Date());
  gtag("config", id);
  const script = document.createElement("script");
  script.id = "ga4";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}
