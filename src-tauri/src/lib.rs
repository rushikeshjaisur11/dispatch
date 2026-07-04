use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

mod google;

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create note_groups and tasks",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/0001_init.sql"),
        },
        Migration {
            version: 2,
            description: "create agent_runs",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/0002_agent_runs.sql"),
        },
        Migration {
            version: 3,
            description: "create settings",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/0003_settings.sql"),
        },
        Migration {
            version: 4,
            description: "add note_groups.updated_at",
            kind: MigrationKind::Up,
            sql: include_str!("../migrations/0004_note_group_updated_at.sql"),
        },
    ]
}

/// Tracks child processes for running agent tasks, keyed by task_id, so a task can be paused.
struct Supervisor(Mutex<HashMap<String, Child>>);

#[tauri::command]
fn run_agent(
    app: tauri::AppHandle,
    sup: tauri::State<Supervisor>,
    task_id: String,
    agent: String,
    project_dir: String,
    prompt: String,
    resume_session_id: Option<String>,
) -> Result<(), String> {
    let mut cmd = if agent == "codex" {
        let mut c = Command::new("codex");
        c.arg("exec");
        if let Some(id) = &resume_session_id {
            c.arg("resume").arg(id);
        }
        c.arg("--json").arg("--sandbox").arg("workspace-write").arg(&prompt);
        c
    } else {
        let mut c = Command::new("claude");
        if let Some(id) = &resume_session_id {
            c.arg("--resume").arg(id);
        }
        c.arg("-p")
            .arg(&prompt)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--permission-mode")
            .arg("bypassPermissions");
        c
    };
    cmd.current_dir(&project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("failed to capture stdout")?;
    sup.0.lock().unwrap().insert(task_id.clone(), child);

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app.emit("agent-event", serde_json::json!({ "task_id": task_id, "line": line }));
        }
        if let Some(state) = app.try_state::<Supervisor>() {
            state.0.lock().unwrap().remove(&task_id);
        }
        let _ = app.emit("agent-exit", serde_json::json!({ "task_id": task_id }));
    });

    Ok(())
}

#[tauri::command]
fn pause_agent(sup: tauri::State<Supervisor>, task_id: String) -> Result<(), String> {
    if let Some(mut child) = sup.0.lock().unwrap().remove(&task_id) {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Fixed (not ephemeral) so it can be added once to Supabase's redirect-URL allow-list —
/// Supabase's wildcard matching for localhost ports is unreliable (supabase#34912), so a
/// changing port per run would mean re-configuring the allow-list every time.
const LOCAL_REDIRECT_PORT: u16 = 53682;

/// Binds a fixed loopback port and, on the first request, captures the `code` query
/// param (PKCE auth code) and emits it as `email-auth-redirect`. Generic on purpose: any
/// "click a link in your email/browser, land back in the app" flow can reuse this instead
/// of a full deep-link plugin.
#[tauri::command]
fn start_local_redirect_listener(app: tauri::AppHandle) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", LOCAL_REDIRECT_PORT)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 4096];
            if let Ok(n) = std::io::Read::read(&mut stream, &mut buf) {
                let request_line = String::from_utf8_lossy(&buf[..n]);
                let path = request_line.split_whitespace().nth(1).unwrap_or("");
                if let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{path}")) {
                    let code = url.query_pairs().find(|(k, _)| k == "code").map(|(_, v)| v.to_string());
                    let body = "<html><body>Signed in — you can close this tab.</body></html>";
                    let response =
                        format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
                    let _ = std::io::Write::write_all(&mut stream, response.as_bytes());
                    let _ = app.emit("email-auth-redirect", serde_json::json!({ "code": code }));
                }
            }
        }
    });
    Ok(port)
}

#[tauri::command]
fn detect_obsidian_vault(vault_path: String) -> bool {
    std::path::Path::new(&vault_path).join(".obsidian").is_dir()
}

#[tauri::command]
fn write_vault_note(vault_path: String, folder: String, filename: String, content: String) -> Result<(), String> {
    let dir = std::path::Path::new(&vault_path).join(&folder);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(&filename), content).map_err(|e| e.to_string())
}

fn open_sticky_window(app: &tauri::AppHandle, group_id: &str) {
    let label = format!("sticky-{group_id}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("index.html?sticky={group_id}").into()),
    )
    .title("AgentPad")
    .inner_size(320.0, 400.0)
    .decorations(false)
    .always_on_top(true)
    .resizable(true)
    .build();
}

fn open_settings_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html?settings=1".into()))
        .title("AgentPad Settings")
        .inner_size(420.0, 560.0)
        .build();
}

fn open_capture_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("capture") {
        let _ = win.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "capture", WebviewUrl::App("index.html?capture=1".into()))
        .title("Quick Capture")
        .inner_size(420.0, 60.0)
        .decorations(false)
        .always_on_top(true)
        .center()
        .resizable(false)
        .build();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:agentpad.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Supervisor(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            run_agent,
            pause_agent,
            start_local_redirect_listener,
            detect_obsidian_vault,
            write_vault_note,
            google::google_auth_start,
            google::google_auth_status,
            google::google_auth_sign_out,
            google::google_calendar_ensure,
            google::google_calendar_upsert_event,
            google::google_calendar_delete_event,
            google::google_calendar_list_events,
        ])
        .setup(|app| {
            let show_board = MenuItem::with_id(app, "show_board", "Show Board", true, None::<&str>)?;
            let new_sticky =
                MenuItem::with_id(app, "new_sticky", "New Sticky Note", true, None::<&str>)?;
            let open_settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_board, &new_sticky, &open_settings, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_board" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "new_sticky" => open_sticky_window(app, "default"),
                    "settings" => open_settings_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            let capture_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(capture_shortcut, move |_app, shortcut, event| {
                if shortcut == &capture_shortcut && event.state() == ShortcutState::Pressed {
                    open_capture_window(&handle);
                }
            })?;
            if let Err(e) = app.global_shortcut().register(capture_shortcut) {
                eprintln!("warning: could not register global capture shortcut: {e}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
