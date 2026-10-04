// TuneDeck plugin framework. A plugin declares a manifest (id, label, description, version + a config
// schema); the UI auto-renders its settings from that schema, so nothing is hardcoded per plugin. This
// is the declarative foundation the runtime (drop-in JS) plugin loader will build on. Native plugins
// (Discord, later serial) stay compiled in; they get the playback stream + can inject engine JS.
use std::collections::HashMap;
use std::path::Path;
use tauri::AppHandle;

pub mod discord;

// Phase 2: scans the drop-in plugins folder for JS plugins. Each plugin is a subfolder with a
// manifest.json (same schema as a native Manifest) + an index.js entry. Returns one entry per plugin:
// { id, manifest, source }. The UI runs the enabled ones with the `tunedeck` API.
pub fn scan_js_plugins(dir: &Path) -> Vec<serde_json::Value>
{
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(dir) { Ok(e) => e, Err(_) => return out };
    for e in entries.flatten()
    {
        let p = e.path();
        if !p.is_dir() { continue; }
        let man = match std::fs::read_to_string(p.join("manifest.json")) { Ok(s) => s, Err(_) => continue };
        let src = match std::fs::read_to_string(p.join("index.js")) { Ok(s) => s, Err(_) => continue };
        let manifest: serde_json::Value = match serde_json::from_str(&man) { Ok(v) => v, Err(_) => continue };
        let id = manifest["id"].as_str().unwrap_or("").to_string();
        if id.is_empty() { continue; }
        out.push(serde_json::json!({ "id": id, "manifest": manifest, "source": src }));
    }
    out
}

// Parsed now-playing snapshot handed to every plugin (from a ytm-state payload).
#[derive(Default, Clone)]
pub struct Track
{
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover: String,
    pub id: String,
    pub dur: i64,
    pub pos: i64,
    pub playing: bool,
}
impl Track
{
    pub fn from_state(payload: &str) -> Option<Track>
    {
        let v: serde_json::Value = serde_json::from_str(payload).ok()?;
        Some(Track
        {
            title:   v["title"].as_str().unwrap_or("").to_string(),
            artist:  v["author"].as_str().unwrap_or("").to_string(),
            album:   v["album"].as_str().unwrap_or("").to_string(),
            cover:   v["cover"].as_str().unwrap_or("").to_string(),
            id:      v["id"].as_str().unwrap_or("").to_string(),
            dur:     v["dur"].as_f64().unwrap_or(0.0) as i64,
            pos:     v["cur"].as_f64().unwrap_or(0.0) as i64,
            playing: v["playing"].as_bool().unwrap_or(false),
        })
    }
}

// One config control a plugin exposes. The UI renders it from these fields.
pub struct CfgField
{
    pub key: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub kind: &'static str,                  // "bool" | "text" | "select"
    pub default: &'static str,
    pub options: &'static [&'static str],    // for "select"
    pub advanced: bool,                       // hidden behind "Advanced" by default (e.g. a Discord app id)
}

pub struct Manifest
{
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub version: &'static str,
    pub fields: &'static [CfgField],
}

// Wraps the (pre-existing, hardware-tested) serial worker as a plugin: it only toggles the worker's
// `enabled` flag. The serial link's rich config stays in its own Settings "Device" tab, since a live
// port list + a feed-section picker don't fit the declarative schema.
pub struct SerialPlugin { enabled: std::sync::Arc<std::sync::Mutex<bool>> }
impl SerialPlugin
{
    pub fn new(enabled: std::sync::Arc<std::sync::Mutex<bool>>) -> Self { SerialPlugin { enabled } }
}
impl Plugin for SerialPlugin
{
    fn manifest(&self) -> Manifest
    {
        Manifest
        {
            id: "serial",
            label: "TuneFrame / device",
            description: "Serial link to a TuneFrame or any TDSP device (configure it in the Device tab).",
            version: "1.0",
            fields: &[],
        }
    }
    fn start(&mut self, _app: &AppHandle) { if let Ok(mut g) = self.enabled.lock() { *g = true; } }
    fn stop(&mut self) { if let Ok(mut g) = self.enabled.lock() { *g = false; } }
}

pub trait Plugin: Send
{
    fn manifest(&self) -> Manifest;
    fn engine_scripts(&self) -> &[&'static str] { &[] }
    fn start(&mut self, _app: &AppHandle) {}
    fn stop(&mut self) {}
    fn on_track(&mut self, _t: &Track) {}
    fn apply_config(&mut self, _cfg: &HashMap<String, String>) {}   // called with this plugin's config
}

// Holds the registered plugins, their enabled state and config; fans events out to the enabled ones.
pub struct PluginHost
{
    plugins: Vec<(Box<dyn Plugin>, bool)>,
    config: HashMap<String, HashMap<String, String>>,   // plugin id -> (key -> value)
    app: Option<AppHandle>,
}
impl PluginHost
{
    pub fn new() -> Self { PluginHost { plugins: Vec::new(), config: HashMap::new(), app: None } }

    pub fn register(&mut self, plugin: Box<dyn Plugin>, enabled: bool)
    {
        let m = plugin.manifest();
        let entry = self.config.entry(m.id.to_string()).or_default();
        for f in m.fields { entry.entry(f.key.to_string()).or_insert_with(|| f.default.to_string()); }
        self.plugins.push((plugin, enabled));
    }

    pub fn engine_scripts(&self) -> Vec<&'static str>
    {
        let mut out = Vec::new();
        for (p, en) in &self.plugins { if *en { out.extend_from_slice(p.engine_scripts()); } }
        out
    }

    pub fn start_enabled(&mut self, app: AppHandle)
    {
        self.app = Some(app.clone());
        let cfgs = self.config.clone();
        for (p, en) in &mut self.plugins
        {
            if let Some(cfg) = cfgs.get(p.manifest().id) { p.apply_config(cfg); }
            if *en { p.start(&app); }
        }
    }

    pub fn dispatch_track(&mut self, t: &Track)
    {
        for (p, en) in &mut self.plugins { if *en { p.on_track(t); } }
    }

    pub fn set_enabled(&mut self, id: &str, on: bool)
    {
        let app = self.app.clone();
        for (p, en) in &mut self.plugins
        {
            if p.manifest().id == id && *en != on
            {
                *en = on;
                match (&app, on) { (Some(a), true) => p.start(a), (_, false) => p.stop(), _ => {} }
            }
        }
    }

    pub fn set_config(&mut self, id: &str, key: &str, val: &str)
    {
        self.config.entry(id.to_string()).or_default().insert(key.to_string(), val.to_string());
        let cfg = self.config.get(id).cloned().unwrap_or_default();
        for (p, _) in &mut self.plugins { if p.manifest().id == id { p.apply_config(&cfg); } }
    }

    // The plugin list + schema + current values + enabled state, for the settings UI.
    pub fn manifests_json(&self) -> serde_json::Value
    {
        let list: Vec<serde_json::Value> = self.plugins.iter().map(|(p, en)|
        {
            let m = p.manifest();
            let cfg = self.config.get(m.id).cloned().unwrap_or_default();
            let fields: Vec<serde_json::Value> = m.fields.iter().map(|f| serde_json::json!(
            {
                "key": f.key, "label": f.label, "hint": f.hint, "kind": f.kind,
                "default": f.default, "options": f.options, "advanced": f.advanced,
                "value": cfg.get(f.key).cloned().unwrap_or_else(|| f.default.to_string()),
            })).collect();
            serde_json::json!({ "id": m.id, "label": m.label, "description": m.description, "version": m.version, "enabled": en, "fields": fields })
        }).collect();
        serde_json::json!(list)
    }
}
