use tauri::{Listener, Manager};
mod serial;
mod plugins;

// Holds the user-selected serial port (None = auto-detect). Shared with the serial worker.
struct SerialSel(std::sync::Arc<std::sync::Mutex<Option<String>>>);
// Holds the serial-interaction options from Settings. Shared with the serial worker.
struct SerialOpts(std::sync::Arc<std::sync::Mutex<serial::Opts>>);
// The plugin host (registered plugins + enabled state + config), shared with the event dispatcher.
struct PluginState(std::sync::Arc<std::sync::Mutex<plugins::PluginHost>>);

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
fn open_library(app: tauri::AppHandle)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let _ = win.eval("window.__tunedeckOpenLibrary && window.__tunedeckOpenLibrary()");
    }
}

#[tauri::command]
fn create_playlist(app: tauri::AppHandle, title: String, privacy: String)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!(
            "window.__tunedeckCreatePlaylist && window.__tunedeckCreatePlaylist({}, {})",
            serde_json::to_string(&title).unwrap_or_else(|_| "\"\"".into()),
            serde_json::to_string(&privacy).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

#[tauri::command]
fn delete_playlist(app: tauri::AppHandle, id: String)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!(
            "window.__tunedeckDeletePlaylist && window.__tunedeckDeletePlaylist({})",
            serde_json::to_string(&id).unwrap_or_else(|_| "\"\"".into())
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

// Lists serial ports for the picker: [{name, label}], newest-friendly label with USB ids.
#[tauri::command]
fn list_serial_ports() -> Vec<serde_json::Value>
{
    serial::list_ports()
        .into_iter()
        .map(|(name, label)| serde_json::json!({ "name": name, "label": label }))
        .collect()
}

// Repoints the serial link. name = Some(port) to force a port, None to auto-detect.
// Takes effect within ~1s (the worker drops the current link and reconnects).
#[tauri::command]
fn set_serial_port(state: tauri::State<SerialSel>, name: Option<String>)
{
    if let Ok(mut g) = state.0.lock() { *g = name; }
}

// Applies serial-interaction options from Settings. subtitle_full -> the bridge; vol_mode -> the
// engine (stored in the engine's localStorage so the reader's vol stepping survives a reload).
#[tauri::command]
fn set_serial_opts(state: tauri::State<SerialOpts>, app: tauri::AppHandle,
                   subtitle_full: bool, vol_mode: String, vol_low_fine: bool, feed_sections: Vec<String>)
{
    if let Ok(mut g) = state.0.lock()
    {
        g.subtitle_full = subtitle_full;
        g.feed_filter = feed_sections;
    }
    if let Some(win) = app.get_webview_window("ytm")
    {
        let m = serde_json::to_string(&vol_mode).unwrap_or_else(|_| "\"snap\"".into());
        let lf = if vol_low_fine { "1" } else { "0" };
        let js = format!(
            "try {{ localStorage.setItem(\"tunedeckVolMode\", {m}); localStorage.setItem(\"tunedeckVolLowFine\", \"{lf}\"); }} catch (e) {{}}");
        let _ = win.eval(&js);
    }
}

// Enables or disables a plugin by id (e.g. "discord") at runtime.
#[tauri::command]
fn plugin_set_enabled(state: tauri::State<PluginState>, id: String, on: bool)
{
    if let Ok(mut g) = state.0.lock() { g.set_enabled(&id, on); }
}

// Returns the plugin list + config schema + current values + enabled state, for the settings UI.
#[tauri::command]
fn plugins_manifest(state: tauri::State<PluginState>) -> serde_json::Value
{
    state.0.lock().map(|g| g.manifests_json()).unwrap_or_else(|_| serde_json::json!([]))
}

// Sets one config value of a plugin.
#[tauri::command]
fn plugin_set_config(state: tauri::State<PluginState>, id: String, key: String, value: String)
{
    if let Ok(mut g) = state.0.lock() { g.set_config(&id, &key, &value); }
}

// Returns the app's drop-in JS plugins (manifest + source), creating the folder if missing.
#[tauri::command]
fn js_plugins_list(app: tauri::AppHandle) -> Vec<serde_json::Value>
{
    match app.path().app_data_dir()
    {
        Ok(d) => { let dir = d.join("plugins"); let _ = std::fs::create_dir_all(&dir); plugins::scan_js_plugins(&dir) }
        Err(_) => Vec::new(),
    }
}

// The folder where JS plugins live (so the UI can point the user at it).
#[tauri::command]
fn js_plugins_dir(app: tauri::AppHandle) -> String
{
    app.path().app_data_dir().map(|d| d.join("plugins").to_string_lossy().into_owned()).unwrap_or_default()
}

// Injects JS into the YTM engine on behalf of a plugin (adblock / tweaks).
#[tauri::command]
fn plugin_inject_engine(app: tauri::AppHandle, js: String)
{
    if let Some(win) = app.get_webview_window("ytm") { let _ = win.eval(&js); }
}

// Performs an HTTP request for a plugin via the host (no CORS). Returns { status, body }.
#[tauri::command]
fn plugin_http(url: String, method: Option<String>, body: Option<String>) -> serde_json::Value
{
    let m = method.unwrap_or_else(|| "GET".into());
    let req = if m.eq_ignore_ascii_case("POST") { ureq::post(&url) } else { ureq::get(&url) };
    let resp = match body { Some(b) => req.send_string(&b), None => req.call() };
    match resp
    {
        Ok(r) => { let status = r.status(); let text = r.into_string().unwrap_or_default(); serde_json::json!({ "status": status, "body": text }) }
        Err(e) => serde_json::json!({ "status": 0, "body": format!("{e}"), "error": true }),
    }
}

// True only in a build made with `--features demo`. The frontend asks once on startup;
// when true it skips the backend and renders labelled placeholder data instead.
#[tauri::command]
fn is_demo() -> bool
{
    cfg!(feature = "demo")
}

// Opens sign-in: navigates the engine to the Google login page and shows the window. Once
// login completes the window auto-hides (see the ytm-auth listener in setup), so only the
// Google sign-in page is visible.
#[tauri::command]
fn sign_in(app: tauri::AppHandle)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let _ = win.eval("location.href='https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F'");
        let _ = win.show();
        let _ = win.center();
        let _ = win.set_focus();
    }
}

// Asks the engine for the account/channel list; it replies with the ytm-accounts event so
// TuneDeck can render its own switcher (no window shown).
#[tauri::command]
fn load_accounts(app: tauri::AppHandle)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let _ = win.eval("window.__tunedeckLoadAccounts && window.__tunedeckLoadAccounts()");
    }
}

// Switches to the given YouTube channel, driven inside the hidden engine (no window). After
// the switch YTM reloads and ytm-auth re-emits.
#[tauri::command]
fn switch_to(app: tauri::AppHandle, key: String)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        let js = format!(
            "window.__tunedeckSwitchTo && window.__tunedeckSwitchTo({})",
            serde_json::to_string(&key).unwrap_or_else(|_| "\"\"".into())
        );
        let _ = win.eval(&js);
    }
}

// Signs out via Google's logout, then returns to YTM. This drops the account session but
// keeps the cookie-consent cookie, so the consent prompt does not reappear. TuneDeck
// keeps nothing about the account itself.
#[tauri::command]
fn sign_out(app: tauri::AppHandle)
{
    if let Some(win) = app.get_webview_window("ytm")
    {
        // Keep the engine on screen in dev; hide it only in release builds.
        #[cfg(not(debug_assertions))]
        let _ = win.hide();
        let _ = win.eval("location.href='https://accounts.google.com/Logout?continue=https%3A%2F%2Fmusic.youtube.com'");
        let w = win.clone();
        std::thread::spawn(move ||
        {
            // If Google ignored the continue param and stayed on its own page, return to YTM.
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let _ = w.eval("if (!location.host.includes('music.youtube.com')) { location.replace('https://music.youtube.com'); }");
        });
    }
}

// Prompts to install a newer signed release, then downloads and restarts into it. Any missing
// piece (no endpoint, no pubkey, no newer version, offline) just returns, so it never interrupts.
#[cfg(all(desktop, not(debug_assertions)))]
async fn check_update(app: tauri::AppHandle)
{
    use tauri_plugin_updater::UpdaterExt;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

    let updater = match app.updater() { Ok(u) => u, Err(_) => return };
    let update = match updater.check().await { Ok(Some(u)) => u, _ => return };   // no update / not configured

    let msg = format!("TuneDeck {} is available. Download and install it now?", update.version);
    let ok = app.dialog().message(msg).title("Update available")
        .buttons(MessageDialogButtons::OkCancelCustom("Update".into(), "Later".into()))
        .blocking_show();
    if !ok { return; }

    if update.download_and_install(|_, _| {}, || {}).await.is_ok() { app.restart(); }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init());
    // Desktop-only: remember the main window's size/position, and self-update from signed releases.
    // The engine window is denylisted so its (hidden) state is never persisted.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_window_state::Builder::default().with_denylist(&["ytm"]).build())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .setup(|app| {
            // Plugin host first, so enabled plugins' engine scripts can be injected into the engine.
            let serial_enabled = std::sync::Arc::new(std::sync::Mutex::new(true));
            let mut host = plugins::PluginHost::new();
            host.register(Box::new(plugins::SerialPlugin::new(serial_enabled.clone())), true);
            host.register(Box::new(plugins::discord::DiscordPlugin::new()), false);
            let scripts = host.engine_scripts();

            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "ytm",
                tauri::WebviewUrl::External("https://music.youtube.com".parse().unwrap()),
            )
            .title("Sign in")
            .inner_size(1000.0, 700.0)
            .initialization_script(include_str!("../reader/main_world.js"))
            .visible(cfg!(debug_assertions));
            for s in scripts { builder = builder.initialization_script(s); }
            // Demo build: no hidden engine window (no login, no network); the UI feeds
            // itself placeholder data. Everything else below idles with no events.
            #[cfg(not(feature = "demo"))]
            {
                let engine = builder.build()?;
                // sign_in shows this window; closing it should only hide it, not destroy
                // the engine (that would break the app), so intercept the close.
                let eh = engine.clone();
                engine.on_window_event(move |ev|
                {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = ev
                    {
                        api.prevent_close();
                        let _ = eh.hide();
                    }
                });
            }
            #[cfg(feature = "demo")]
            let _ = builder;

            let (tx, rx) = std::sync::mpsc::channel::<serial::Msg>();
            let selected = std::sync::Arc::new(std::sync::Mutex::new(None::<String>));
            let opts = std::sync::Arc::new(std::sync::Mutex::new(serial::Opts::default()));
            serial::start(rx, selected.clone(), opts.clone(), serial_enabled.clone(), app.handle().clone());
            app.manage(SerialSel(selected));
            app.manage(SerialOpts(opts));

            let tx_state = tx.clone();
            app.listen("ytm-state", move |event| {
                let _ = tx_state.send(serial::Msg::State(event.payload().to_string()));
            });
            let tx_queue = tx.clone();
            app.listen("ytm-queue", move |event| {
                let _ = tx_queue.send(serial::Msg::Queue(event.payload().to_string()));
            });
            let tx_feed = tx.clone();
            app.listen("ytm-feed", move |event| {
                let _ = tx_feed.send(serial::Msg::Feed(event.payload().to_string()));
            });
            let tx_pls = tx.clone();
            app.listen("ytm-playlists", move |event| {
                let _ = tx_pls.send(serial::Msg::Playlists(event.payload().to_string()));
            });
            app.listen("ytm-playlist", move |event| {
                let _ = tx.send(serial::Msg::Playlist(event.payload().to_string()));
            });

            // Plugins: start the enabled ones, then fan ytm-state out to them as parsed Tracks.
            host.start_enabled(app.handle().clone());
            let host = std::sync::Arc::new(std::sync::Mutex::new(host));
            app.manage(PluginState(host.clone()));
            app.listen("ytm-state", move |event| {
                if let Some(t) = plugins::Track::from_state(event.payload()) {
                    if let Ok(mut g) = host.lock() { g.dispatch_track(&t); }
                }
            });

            // After a login or account switch, hide the engine so only the Google page is seen.
            // Release builds only; in development the engine window stays visible.
            let ah = app.handle().clone();
            app.listen("ytm-auth", move |event| {
                let _ = (&ah, &event);
                #[cfg(not(debug_assertions))]
                if event.payload().contains("\"signedIn\":true")
                {
                    if let Some(win) = ah.get_webview_window("ytm") { let _ = win.hide(); }
                }
            });

            // Check for an update on launch (release desktop builds only). Does nothing until the
            // updater endpoint and public key are configured.
            #[cfg(all(desktop, not(debug_assertions)))]
            {
                let uh = app.handle().clone();
                tauri::async_runtime::spawn(async move { check_update(uh).await; });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet, play, control, open_playlist, item_action,
            queue_jump, queue_remove, queue_menu, queue_add, open_album, open_artist,
            reload_feed, search, playlist_edit, create_playlist, delete_playlist, open_library,
            list_serial_ports, set_serial_port, set_serial_opts,
            plugin_set_enabled, plugins_manifest, plugin_set_config,
            js_plugins_list, js_plugins_dir, plugin_inject_engine, plugin_http, is_demo,
            sign_in, load_accounts, switch_to, sign_out])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
