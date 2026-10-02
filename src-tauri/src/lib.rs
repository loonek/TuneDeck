use tauri::{Listener, Manager};
mod serial;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Plays an item in the hidden engine by running the reader's play helper there.
#[tauri::command]
fn play(app: tauri::AppHandle, id: String, kind: String) {
    if let Some(win) = app.get_webview_window("ytm") 
    {
        let js = format!(
            "window.__tunedeckPlay && window.__tunedeckPlay({}, {})",
            serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".into()),
            serde_json::to_string(&kind).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn control(app: tauri::AppHandle, action: String, value: Option<f64>)
{
    if let Some(win) = app.get_webview_window("ytm") 
    {
        let js = format!(
            "window.__tunedeckCmd && window.__tunedeckCmd({}, {})",
            serde_json::to_string(&action).unwrap_or_else(|_| "\"\"".into()),
            value.unwrap_or(0.0)
        );
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn set_audio_only(app: tauri::AppHandle, on: bool)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!("window.__tunedeckSetAudioOnly && window.__tunedeckSetAudioOnly({})", on);
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn open_playlist(app: tauri::AppHandle, id: String) {
    if let Some(win) = app.get_webview_window("ytm") {
        let js = format!(
            "window.__tunedeckOpenPlaylist && window.__tunedeckOpenPlaylist({})",
            serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn item_action(app: tauri::AppHandle, action: String, id: String)
{
    if let Some(win) = app.get_webview_window("ytm") {
        let js = format!(
            "window.__tunedeckAction && window.__tunedeckAction({}, {})",
            serde_json::to_string(&action).unwrap_or_else(|_| "\"\"".into()),
            serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn queue_jump(app: tauri::AppHandle, index: i64)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!("window.__tunedeckQueueJump && window.__tunedeckQueueJump({})", index);
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn queue_remove(app: tauri::AppHandle, index: i64)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!("window.__tunedeckQueueRemove && window.__tunedeckQueueRemove({})", index);
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn queue_menu(app: tauri::AppHandle, index: i64, action: String)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!(
            "window.__tunedeckQueueMenu && window.__tunedeckQueueMenu({}, {})",
            index,
            serde_json::to_string(&action).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn queue_add(app: tauri::AppHandle, video_id: String, action: String)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!(
            "window.__tunedeckQueueAdd && window.__tunedeckQueueAdd({}, {})",
            serde_json::to_string(&video_id).unwrap_or_else(|_| "\"\"".into()),
            serde_json::to_string(&action).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn open_album(app: tauri::AppHandle, id: String)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!(
            "window.__tunedeckOpenAlbum && window.__tunedeckOpenAlbum({})",
            serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn open_artist(app: tauri::AppHandle, id: String)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!(
            "window.__tunedeckOpenArtist && window.__tunedeckOpenArtist({})",
            serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

// Reloads the feed (soft), or hard-reloads the engine if it never came up (offline load).
#[tauri::command]
fn reload_feed(app: tauri::AppHandle)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let _ = win.eval("window.__tunedeckReloadFeed && window.__tunedeckReloadFeed()");
    }
}

#[tauri::command]
fn search(app: tauri::AppHandle, query: String)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!(
            "window.__tunedeckSearch && window.__tunedeckSearch({})",
            serde_json::to_string(&query).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn playlist_edit(app: tauri::AppHandle, action: String, playlist_id: String, a: String, b: String)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!(
            "window.__tunedeckPlaylistEdit && window.__tunedeckPlaylistEdit({}, {}, {}, {})",
            serde_json::to_string(&action).unwrap_or_else(|_| "\"\"".into()),
            serde_json::to_string(&playlist_id).unwrap_or_else(|_| "\"\"".into()),
            serde_json::to_string(&a).unwrap_or_else(|_| "\"\"".into()),
            serde_json::to_string(&b).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "ytm",
                tauri::WebviewUrl::External("https://music.youtube.com".parse().unwrap()),
            )
            .title("TuneDeck - YTM Engine")
            .inner_size(1000.0, 700.0)
            .initialization_script(include_str!("../reader/main_world.js"))
            .visible(cfg!(debug_assertions))
            .build()?;

            let (tx, rx) = std::sync::mpsc::channel::<String>();
            serial::start(rx);
            app.listen("ytm-state", move |event| {
                let _ = tx.send(event.payload().to_string());
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet, play, control, set_audio_only, open_playlist, item_action,
            queue_jump, queue_remove, queue_menu, queue_add, open_album, open_artist,
            reload_feed, search, playlist_edit])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
