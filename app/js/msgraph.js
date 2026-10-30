// Microsoft 365 (Outlook / Teams) calendar via Microsoft Graph, using the
// OAuth 2.0 authorization-code flow with PKCE — no server needed.
//
// One-time setup (you or your IT admin), see README "Microsoft 365 / Teams":
//   Azure portal → App registrations → New → platform "Single-page application",
//   redirect URI = this app's address; API permission: Calendars.Read (delegated).
// Paste the Application (client) ID into Waqti.

import { state, save } from "./store.js";
import { meetingLink } from "./ics.js";
import { addDays } from "./dates.js";

const SCOPES = "openid offline_access User.Read Calendars.Read";
const redirectUri = () => location.origin + location.pathname;
const authBase = () => "https://login.microsoftonline.com/" + encodeURIComponent(state.calendars.msgraph.tenant || "organizations") + "/oauth2/v2.0/";

function b64url(bytes) {
  let s = ""; bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function startSignIn() {
  const g = state.calendars.msgraph;
  if (!g.clientId) throw new Error("Add your Application (client) ID first.");
  if (!window.crypto || !crypto.subtle) throw new Error("Sign-in needs a secure (https) address.");
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const st = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem("rafeeq_ms_pkce", JSON.stringify({ verifier, st }));
  const q = new URLSearchParams({
    client_id: g.clientId, response_type: "code", redirect_uri: redirectUri(), response_mode: "query",
    scope: SCOPES, code_challenge: challenge, code_challenge_method: "S256", state: st, prompt: "select_account"
  });
  location.assign(authBase() + "authorize?" + q);
}

async function tokenRequest(body) {
  const g = state.calendars.msgraph;
  const res = await fetch(authBase() + "token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(Object.assign({ client_id: g.clientId, scope: SCOPES }, body))
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error_description ? j.error_description.split("\r\n")[0] : "Microsoft sign-in failed.");
  g.token = j.access_token;
  if (j.refresh_token) g.refresh = j.refresh_token;
  g.expires = Date.now() + (j.expires_in - 120) * 1000;
}

// Call on startup: finishes sign-in when Microsoft redirects back with ?code=
export async function completeSignInIfReturning() {
  const q = new URLSearchParams(location.search);
  if (!q.get("code") && !q.get("error")) return null;
  const saved = JSON.parse(sessionStorage.getItem("rafeeq_ms_pkce") || "null");
  history.replaceState(null, "", location.pathname);
  if (q.get("error")) return { ok: false, message: q.get("error_description") || "Sign-in was cancelled." };
  if (!saved || saved.st !== q.get("state")) return null;
  sessionStorage.removeItem("rafeeq_ms_pkce");
  try {
    await tokenRequest({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri(), code_verifier: saved.verifier });
    const me = await graph("/me?$select=displayName,mail,userPrincipalName");
    state.calendars.msgraph.account = me.mail || me.userPrincipalName || me.displayName || "";
    let s = state.calendars.sources.find(x => x.kind === "msgraph");
    if (!s) {
      const { addSource } = await import("./calendars.js");
      s = addSource("msgraph", { name: "Microsoft 365 · " + state.calendars.msgraph.account });
    }
    await syncGraph(s);
    s.lastSync = Date.now(); s.error = "";
    save();
    return { ok: true, message: "Connected " + state.calendars.msgraph.account };
  } catch (e) {
    save();
    return { ok: false, message: e.message };
  }
}

async function ensureToken() {
  const g = state.calendars.msgraph;
  if (g.token && Date.now() < g.expires) return;
  if (!g.refresh) throw new Error("Sign in to Microsoft again.");
  await tokenRequest({ grant_type: "refresh_token", refresh_token: g.refresh });
}

async function graph(path) {
  await ensureToken();
  const url = path.startsWith("http") ? path : "https://graph.microsoft.com/v1.0" + path;
  const res = await fetch(url, { headers: { Authorization: "Bearer " + state.calendars.msgraph.token, Prefer: 'outlook.timezone="UTC"' } });
  if (res.status === 401) { state.calendars.msgraph.token = null; throw new Error("Microsoft session expired — sign in again."); }
  if (!res.ok) throw new Error("Microsoft 365 returned an error (" + res.status + ").");
  return res.json();
}

export async function syncGraph(s) {
  const from = addDays(new Date(), -30).toISOString(), to = addDays(new Date(), 120).toISOString();
  let url = "/me/calendarView?startDateTime=" + from + "&endDateTime=" + to + "&$top=200&$select=id,subject,start,end,isAllDay,location,onlineMeeting,onlineMeetingUrl,bodyPreview,isCancelled,showAs";
  const out = [];
  for (let page = 0; url && page < 10; page++) {
    const j = await graph(url);
    (j.value || []).forEach(e => {
      if (e.isCancelled) return;
      const st = Date.parse(e.start.dateTime + "Z"), en = Date.parse(e.end.dateTime + "Z");
      const join = (e.onlineMeeting && e.onlineMeeting.joinUrl) || e.onlineMeetingUrl || "";
      const link = join ? Object.assign(meetingLink(join), { join }) : meetingLink((e.location && e.location.displayName) + " " + e.bodyPreview);
      if (join && !link.provider) link.provider = "teams";
      out.push(Object.assign({ id: e.id, title: e.subject || "(No title)", start: st, end: en, allDay: !!e.isAllDay, location: (e.location && e.location.displayName) || "", notes: (e.bodyPreview || "").slice(0, 300) }, link));
    });
    url = j["@odata.nextLink"] || null;
  }
  state.calendars.events[s.id] = out;
}

export function signOut() {
  Object.assign(state.calendars.msgraph, { token: null, refresh: null, expires: 0, account: "" });
}
