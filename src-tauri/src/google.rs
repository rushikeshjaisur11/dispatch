use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;

const KEYRING_SERVICE: &str = "agentpad";
const KEYRING_ACCOUNT: &str = "google_refresh_token";
const SCOPES: &str = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email openid";

fn random_urlsafe(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct UserInfo {
    email: String,
}

fn exchange_code_for_tokens(
    client_id: &str,
    client_secret: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("token exchange failed: {}", resp.text().unwrap_or_default()));
    }
    resp.json::<TokenResponse>().map_err(|e| e.to_string())
}

fn fetch_email(access_token: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(access_token)
        .send()
        .map_err(|e| e.to_string())?;
    resp.json::<UserInfo>().map_err(|e| e.to_string()).map(|u| u.email)
}

/// Blocks on one loopback HTTP request to catch the OAuth redirect, per the PKCE
/// desktop-app flow (no client secret confidentiality assumed, verified via code_verifier).
fn run_pkce_flow(app: &tauri::AppHandle, client_id: String, client_secret: String) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let verifier = random_urlsafe(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_urlsafe(16);

    let mut auth_url = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &state);

    app.opener()
        .open_url(auth_url.to_string(), None::<String>)
        .map_err(|e| e.to_string())?;

    let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let request_line = String::from_utf8_lossy(&buf[..n]);
    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    let callback_url = url::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
    let params: std::collections::HashMap<_, _> = callback_url.query_pairs().collect();

    let body = "<html><body>Signed in — you can close this tab.</body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());

    let code = params.get("code").ok_or("no code in redirect")?.to_string();
    if params.get("state").map(|s| s.as_ref()) != Some(state.as_str()) {
        return Err("state mismatch".into());
    }

    let tokens = exchange_code_for_tokens(&client_id, &client_secret, &code, &verifier, &redirect_uri)?;
    let refresh_token = tokens.refresh_token.ok_or("Google did not return a refresh token (already authorized without access_type=offline/prompt=consent?)")?;
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .and_then(|e| e.set_password(&refresh_token))
        .map_err(|e| e.to_string())?;

    fetch_email(&tokens.access_token)
}

#[tauri::command]
pub fn google_auth_start(app: tauri::AppHandle, client_id: String, client_secret: String) {
    std::thread::spawn(move || {
        let result = run_pkce_flow(&app, client_id, client_secret);
        let payload = match result {
            Ok(email) => serde_json::json!({ "success": true, "email": email }),
            Err(e) => serde_json::json!({ "success": false, "error": e }),
        };
        let _ = app.emit("google-auth-result", payload);
    });
}

#[tauri::command]
pub fn google_auth_status() -> bool {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .and_then(|e| e.get_password())
        .is_ok()
}

#[tauri::command]
pub fn google_auth_sign_out() -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

fn get_access_token(client_id: &str, client_secret: &str) -> Result<String, String> {
    let refresh_token = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .and_then(|e| e.get_password())
        .map_err(|_| "not signed in to Google".to_string())?;
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("token refresh failed: {}", resp.text().unwrap_or_default()));
    }
    resp.json::<TokenResponse>().map_err(|e| e.to_string()).map(|t| t.access_token)
}

/// Finds (or creates) the dedicated "AgentPad" calendar, returning its calendar id.
#[tauri::command]
pub fn google_calendar_ensure(client_id: String, client_secret: String) -> Result<String, String> {
    let token = get_access_token(&client_id, &client_secret)?;
    let client = reqwest::blocking::Client::new();
    let list: serde_json::Value = client
        .get("https://www.googleapis.com/calendar/v3/users/me/calendarList")
        .bearer_auth(&token)
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    if let Some(items) = list.get("items").and_then(|v| v.as_array()) {
        for item in items {
            if item.get("summary").and_then(|s| s.as_str()) == Some("AgentPad") {
                if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                    return Ok(id.to_string());
                }
            }
        }
    }
    let created: serde_json::Value = client
        .post("https://www.googleapis.com/calendar/v3/calendars")
        .bearer_auth(&token)
        .json(&serde_json::json!({ "summary": "AgentPad" }))
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    created
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "calendar creation did not return an id".to_string())
}

/// Creates the event if `event_id` is None, otherwise patches the existing one. Returns the event id.
#[tauri::command]
pub fn google_calendar_upsert_event(
    client_id: String,
    client_secret: String,
    calendar_id: String,
    event_id: Option<String>,
    summary: String,
    due_at_iso: String,
) -> Result<String, String> {
    let token = get_access_token(&client_id, &client_secret)?;
    let client = reqwest::blocking::Client::new();
    let body = serde_json::json!({
        "summary": summary,
        "start": { "dateTime": due_at_iso },
        "end": { "dateTime": due_at_iso },
    });
    let url = match &event_id {
        Some(id) => format!("https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events/{id}"),
        None => format!("https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"),
    };
    let req = if event_id.is_some() {
        client.patch(&url)
    } else {
        client.post(&url)
    };
    let resp: serde_json::Value = req
        .bearer_auth(&token)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    resp.get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("upsert did not return an event id: {resp}"))
}

#[tauri::command]
pub fn google_calendar_delete_event(client_id: String, client_secret: String, calendar_id: String, event_id: String) -> Result<(), String> {
    let token = get_access_token(&client_id, &client_secret)?;
    let client = reqwest::blocking::Client::new();
    let url = format!("https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events/{event_id}");
    client.delete(&url).bearer_auth(&token).send().map_err(|e| e.to_string())?;
    Ok(())
}

/// Incremental pull via Calendar's syncToken; pass None the first time. Returns raw events.list JSON.
#[tauri::command]
pub fn google_calendar_list_events(
    client_id: String,
    client_secret: String,
    calendar_id: String,
    sync_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let token = get_access_token(&client_id, &client_secret)?;
    let client = reqwest::blocking::Client::new();
    let mut url = url::Url::parse(&format!("https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events")).unwrap();
    match &sync_token {
        Some(t) => {
            url.query_pairs_mut().append_pair("syncToken", t);
        }
        None => {
            url.query_pairs_mut().append_pair("singleEvents", "true");
        }
    }
    client
        .get(url)
        .bearer_auth(&token)
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())
}
