// Release switches. Flip these per build instead of editing feature code.

export const CONFIG = {
  version: "2.12.0",
  // Premium is hidden until in-app purchases (App Store / Google Play billing) are wired up.
  // Stores reject external payment methods and "coming soon" features.
  showPremium: false,
  // Launch prices (the stores' introductory offers) end on this day; lifetime Pro is sold only until then.
  launchOfferEnds: "2027-03-31",
  // "Coming to Pro" on the payment screen: off for store builds (only list what Pro does today).
  showComingSoon: false,
  // Optional crash reporting: paste a Sentry DSN to send errors (see README → Crash reporting).
  sentryDsn: "",
  // Public pages linked from Settings.
  // The website: GitHub Pages, account "merkhet-support", repository "waqti".
  privacyUrl: "https://merkhet-support.github.io/waqti/privacy-policy.html",
  termsUrl: "https://merkhet-support.github.io/waqti/terms.html",
  // Where request and list links point: the hosted web app, so people without Waqti can open them.
  shareBase: "https://merkhet-support.github.io/waqti/app/",
  supportEmail: "merkhet.support@gmail.com",
  // Who checked the fasting and prayer calendars — shown under the fasting calendar once filled in,
  // e.g. [{ name: "Fr. …", role: "Coptic Orthodox priest, Cairo", covers: "Coptic fasts" }]. Real people only.
  faithReviewers: []
};
