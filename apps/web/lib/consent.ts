/**
 * Analytics consent, stored client-side. The cookie banner writes it; anything that would set an
 * analytics cookie (the GA4 loader) reads it and loads nothing unless it is "accepted".
 * Browser-only: call from client components, after mount.
 */
export type Consent = "accepted" | "rejected";

const KEY = "duskfleet.consent";
const EVENT = "duskfleet:consent";

/** The stored choice, or null when the visitor has not picked one yet (or storage is blocked). */
export function readConsent(): Consent | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    return null;
  }
}

/** Stores the choice and tells the listeners in this tab. */
export function writeConsent(consent: Consent): void {
  try {
    window.localStorage.setItem(KEY, consent);
  } catch {
    // Storage blocked: the choice holds for this page only, the banner comes back next visit.
  }
  window.dispatchEvent(new CustomEvent<Consent>(EVENT, { detail: consent }));
}

/** Calls back on every choice made in this tab; returns the unsubscribe. */
export function onConsentChange(listener: (consent: Consent) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<Consent>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
