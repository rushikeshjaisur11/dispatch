const http = require("http");
const crypto = require("crypto");
const { shell } = require("electron");
const secretStore = require("./secretStore.cjs");

const SECRET_NAME = "google_refresh_token";
const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email openid";

function randomUrlsafe(len) {
  return crypto.randomBytes(len).toString("base64url");
}

async function exchangeCodeForTokens(clientId, clientSecret, code, verifier, redirectUri) {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!resp.ok) throw new Error(`token exchange failed: ${await resp.text()}`);
  return resp.json();
}

async function fetchEmail(accessToken) {
  const resp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const user = await resp.json();
  return user.email;
}

/** Blocks on one loopback HTTP request to catch the OAuth redirect — same PKCE desktop-app
 * flow as google.rs's run_pkce_flow, ported from std::net::TcpListener to Node's http. */
function runPkceFlow(clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const verifier = randomUrlsafe(48);
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = randomUrlsafe(16);
    let redirectUri;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>Signed in — you can close this tab.</body></html>");
      server.close();
      if (returnedState !== state) return reject(new Error("state mismatch"));
      if (!code) return reject(new Error("no code in redirect"));
      resolve({ code, verifier, redirectUri });
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", SCOPES);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", state);
      shell.openExternal(authUrl.toString());
    });
  }).then(async ({ code, verifier, redirectUri }) => {
    const tokens = await exchangeCodeForTokens(clientId, clientSecret, code, verifier, redirectUri);
    if (!tokens.refresh_token) {
      throw new Error("Google did not return a refresh token (already authorized without access_type=offline/prompt=consent?)");
    }
    secretStore.setSecret(SECRET_NAME, tokens.refresh_token);
    return fetchEmail(tokens.access_token);
  });
}

function googleAuthStart(win, { clientId, clientSecret }) {
  runPkceFlow(clientId, clientSecret)
    .then((email) => win.webContents.send("google-auth-result", { payload: { success: true, email } }))
    .catch((err) => {
      console.error("[google-auth-start]", err);
      win.webContents.send("google-auth-result", { payload: { success: false, error: String(err.message ?? err) } });
    });
}

function googleAuthStatus() {
  return secretStore.getSecret(SECRET_NAME) !== null;
}

function googleAuthSignOut() {
  secretStore.deleteSecret(SECRET_NAME);
}

async function getAccessToken(clientId, clientSecret) {
  const refreshToken = secretStore.getSecret(SECRET_NAME);
  if (!refreshToken) throw new Error("not signed in to Google");
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error(`token refresh failed: ${await resp.text()}`);
  const data = await resp.json();
  return data.access_token;
}

/** Finds (or creates) the dedicated "Dispatch" calendar, returning its calendar id.
 * Also matches the app's old "AgentPad" name so accounts that already synced under
 * that name keep using the same calendar instead of getting a duplicate. */
async function googleCalendarEnsure({ clientId, clientSecret }) {
  const token = await getAccessToken(clientId, clientSecret);
  const listResp = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { authorization: `Bearer ${token}` },
  });
  const list = await listResp.json();
  const existing = (list.items ?? []).find((item) => item.summary === "Dispatch" || item.summary === "AgentPad");
  if (existing) return existing.id;
  const createResp = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ summary: "Dispatch" }),
  });
  const created = await createResp.json();
  if (!created.id) throw new Error("calendar creation did not return an id");
  return created.id;
}

/** Creates the event if `eventId` is null, otherwise patches the existing one. Returns the event id. */
async function googleCalendarUpsertEvent({ clientId, clientSecret, calendarId, eventId, summary, dueAtIso }) {
  const token = await getAccessToken(clientId, clientSecret);
  const url = eventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`
    : `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  const resp = await fetch(url, {
    method: eventId ? "PATCH" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ summary, start: { dateTime: dueAtIso }, end: { dateTime: dueAtIso } }),
  });
  const body = await resp.json();
  if (!body.id) throw new Error(`upsert did not return an event id: ${JSON.stringify(body)}`);
  return body.id;
}

async function googleCalendarDeleteEvent({ clientId, clientSecret, calendarId, eventId }) {
  const token = await getAccessToken(clientId, clientSecret);
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Incremental pull via Calendar's syncToken; pass null the first time. Returns raw events.list JSON. */
async function googleCalendarListEvents({ clientId, clientSecret, calendarId, syncToken }) {
  const token = await getAccessToken(clientId, clientSecret);
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`);
  if (syncToken) url.searchParams.set("syncToken", syncToken);
  else url.searchParams.set("singleEvents", "true");
  const resp = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return resp.json();
}

module.exports = {
  googleAuthStart,
  googleAuthStatus,
  googleAuthSignOut,
  googleCalendarEnsure,
  googleCalendarUpsertEvent,
  googleCalendarDeleteEvent,
  googleCalendarListEvents,
};
