use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create note_groups and tasks",
        kind: MigrationKind::Up,
        sql: include_str!("../migrations/0001_init.sql"),
    }]
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
        .setup(|app| {
            let show_board = MenuItem::with_id(app, "show_board", "Show Board", true, None::<&str>)?;
            let new_sticky =
                MenuItem::with_id(app, "new_sticky", "New Sticky Note", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_board, &new_sticky, &quit])?;

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
