// Discord Rich Presence plugin: reports the current track to Discord as a "Listening to ..." status
// with cover art and a progress bar. Pure Rust, no engine injection - a clean consumer of on_track.
use super::{CfgField, Manifest, Plugin, Track};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

// App id is "advanced": baked default, hidden in the UI unless the user opens Advanced.
const FIELDS: &[CfgField] = &[CfgField
{
    key: "app_id",
    label: "Application ID",
    hint: "advanced - a custom Discord app id",
    kind: "text",
    default: "1555916503780560936",
    options: &[],
    advanced: true,
}];

pub struct DiscordPlugin
{
    app_id: String,
    client: Option<DiscordIpcClient>,
    last_id: String,
    last_playing: bool,
}

impl DiscordPlugin
{
    pub fn new() -> Self
    {
        DiscordPlugin { app_id: FIELDS[0].default.to_string(), client: None, last_id: String::new(), last_playing: false }
    }

    // Lazily (re)connects to the local Discord client. False if no app id or Discord is unavailable.
    fn ensure(&mut self) -> bool
    {
        if self.client.is_some() { return true; }
        if self.app_id.is_empty() { return false; }
        match DiscordIpcClient::new(&self.app_id)
        {
            Ok(mut c) => { if c.connect().is_ok() { self.client = Some(c); true } else { false } }
            Err(_) => false,
        }
    }
}

impl Plugin for DiscordPlugin
{
    fn manifest(&self) -> Manifest
    {
        Manifest
        {
            id: "discord",
            label: "Discord Rich Presence",
            description: "Shows your current track in Discord as a \"Listening to\" status.",
            version: "1.0",
            fields: FIELDS,
        }
    }

    fn apply_config(&mut self, cfg: &HashMap<String, String>)
    {
        if let Some(v) = cfg.get("app_id")
        {
            if *v != self.app_id
            {
                self.app_id = v.clone();
                if let Some(mut c) = self.client.take() { let _ = c.close(); }   // reconnect with the new id
                self.last_id.clear();
            }
        }
    }

    fn stop(&mut self)
    {
        if let Some(mut c) = self.client.take() { let _ = c.clear_activity(); let _ = c.close(); }
        self.last_id.clear();
        self.last_playing = false;
    }

    fn on_track(&mut self, t: &Track)
    {
        if t.id.is_empty()
        {
            if let Some(c) = self.client.as_mut() { let _ = c.clear_activity(); }
            self.last_id.clear();
            self.last_playing = false;
            return;
        }
        if t.id == self.last_id && t.playing == self.last_playing { return; }
        if !self.ensure() { return; }
        self.last_id = t.id.clone();
        self.last_playing = t.playing;

        let state = format!("by {}", t.artist);
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        let start = now - t.pos;

        // Discord REJECTS the whole activity if a referenced asset key is not (yet) resolvable, and
        // freshly uploaded Rich Presence assets can take a long time to propagate. So try with the
        // small badge first, then fall back to no badge so the presence always shows.
        let mut sent = false;
        for with_badge in [true, false]
        {
            let mut assets = activity::Assets::new();
            if t.cover.starts_with("http") { assets = assets.large_image(&t.cover); }
            if !t.album.is_empty() { assets = assets.large_text(&t.album); }
            if with_badge { assets = assets.small_image("1024x1024logo").small_text("TuneDeck"); }

            let mut act = activity::Activity::new()
                .activity_type(activity::ActivityType::Listening)
                .details(&t.title)
                .state(&state)
                .assets(assets);
            if t.playing && t.dur > 0
            {
                act = act.timestamps(activity::Timestamps::new().start(start).end(start + t.dur));
            }

            match self.client.as_mut()
            {
                Some(c) => { if c.set_activity(act).is_ok() { sent = true; break; } }
                None => break,
            }
        }
        if !sent { self.client = None; }
    }
}
