"use client";

import { useEffect, useState } from "react";
import { type Consent, readConsent, writeConsent } from "@/lib/consent";

/**
 * Analytics consent bar, fixed to the bottom of the viewport (a card on narrow screens).
 * Shown until the visitor picks Accept or Reject; both are the same button, so neither is
 * the easier choice. Not rendered on the server: the stored choice is only known after mount,
 * and a returning visitor must not see it flash.
 */
export function CookieBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(readConsent() === null);
  }, []);

  if (!open) return null;

  const choose = (consent: Consent) => {
    writeConsent(consent);
    setOpen(false);
  };

  return (
    <section className="cookie-banner" aria-label="Cookie consent">
      <p className="cb-copy">
        <span>We use analytics cookies to understand how DuskFleet is used.</span>
        {/* Future route: the Privacy page does not exist yet (404 until it does). */}
        <a href="/privacy" className="cb-link">
          Privacy
        </a>
      </p>
      <div className="cb-actions">
        <button type="button" className="cb-btn" onClick={() => choose("accepted")}>
          Accept
        </button>
        <button type="button" className="cb-btn" onClick={() => choose("rejected")}>
          Reject
        </button>
      </div>
    </section>
  );
}
