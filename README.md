# Waqti website (GitHub Pages)

Everything in this folder is the public website: the landing page, the privacy policy, the
fasting-calendar pages, and the web app itself under `app/`. People who get a request or a
shared-list link from someone open it here, see who sent it, and can set up Waqti to answer.

## Publish (about 10 minutes, free)

1. Run `build-site.ps1` from the project folder. It copies the web app into `site/app/` and the
   privacy policy into `site/`.
2. Create a free GitHub account **just for Waqti** (for example `merkhet`), then a **public** repository
   named, for example, `waqti`. Why a separate account: every GitHub Pages site under one account
   shares the same web address (`<account>.github.io`), so any other page you ever publish there
   could read the web app's saved data. A custom domain (for example `waqti.app`) also solves this.
   Turn on two-factor sign-in for the account: whoever controls it controls the site.
3. Upload the **contents** of this `site` folder to the repository (Add file → Upload files).
4. Repository → Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
5. After a minute your site is live at `https://merkhet-support.github.io/waqti/`.

## Then tell the app where it lives

In `www/js/config.js` set (replace `merkhet-support`):

```js
privacyUrl: "https://merkhet-support.github.io/waqti/privacy-policy.html",
termsUrl: "https://merkhet-support.github.io/waqti/terms.html",
shareBase: "https://merkhet-support.github.io/waqti/app/",
```

Run `build-site.ps1` again and re-upload `app/`, so the hosted app has the same settings.
The same privacy link goes into App Store Connect and Google Play Console.

## Keep the fasting pages current

The dates on the pages under `fasting/` were generated from the app's own calendars
(seasons, Hijri and Hebrew calendars). Before each new church or Islamic year, ask for them to be
regenerated rather than editing dates by hand.
