// Serial link to a TDSP device (TuneFrame or any third-party board).
// Protocol: docs/PROTOCOL.md. JSON lines, one per `\n`, each tagged by `t`.
use std::io::{Read, Write};
use std::time::{Duration, Instant};
use std::sync::mpsc::{channel, Receiver, Sender, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

// Cover art and feed thumbnails sent to the device as RGB565 (Phase B).
#[derive(Clone, Copy)]
enum ImgKind { Cover, Thumb(usize) }
struct FetchReq { url: String, size: u32, kind: ImgKind }
struct ImgReady { kind: ImgKind, w: u32, h: u32, data: Vec<u8> }

// User-tweakable serial-interaction options (from Settings). Shared with the worker.
#[derive(Clone)]
pub struct Opts
{
    pub subtitle_full: bool,        // true = send the full byline, false = short (one clean segment)
    pub feed_filter: Vec<String>,   // allowed feed-section titles; empty = send all sections
}
impl Default for Opts
{
    fn default() -> Self { Opts { subtitle_full: false, feed_filter: Vec::new() } }
}

// Data pushed to the worker from the app, tagged by its source event.
pub enum Msg
{
    State(String),       // ytm-state JSON (now-playing + playback)
    Queue(String),       // ytm-queue JSON (array of rows) - cached, sent on request
    Feed(String),        // ytm-feed JSON (sections) - cached, sent on request
    Playlists(String),   // ytm-playlists JSON (library list) - cached, appended to the feed as a "Playlists" section
    Playlist(String),    // ytm-playlist JSON - sent as soon as it arrives (answer to a `playlist` cmd)
}

// What the connected device asked for in its `sub` handshake reply. Defaults = everything
struct Profile
{
    queue: bool,
    feed: bool,
    playlist: bool,
    art: Option<u32>,    // cover art panel size (square), Phase B
    thumb: Option<u32>,  // feed thumbnail size (square), Phase B
    queue_n: usize,
    feed_n: usize,
}
impl Default for Profile
{
    fn default() -> Self
    {
        Profile { queue: true, feed: true, playlist: true, art: Some(200), thumb: Some(96), queue_n: 50, feed_n: 64 }
    }
}

// Auto-detects an Espressif board by USB VID (TuneFrame's default identity).
pub fn find_board() -> Option<String>
{
    let ports = serialport::available_ports().ok()?;
    for p in ports
    {
        if let serialport::SerialPortType::UsbPort(info) = p.port_type
        {
            if info.vid == 0x303A { return Some(p.port_name); }
        }
    }
    None
}

// Lists all serial ports as (name, human label) for the UI picker.
pub fn list_ports() -> Vec<(String, String)>
{
    let ports = match serialport::available_ports() { Ok(p) => p, Err(_) => return Vec::new() };
    ports.into_iter().map(|p|
    {
        let label = match &p.port_type
        {
            serialport::SerialPortType::UsbPort(info) => format!("{} (USB {:04x}:{:04x})", p.port_name, info.vid, info.pid),
            _ => p.port_name.clone(),
        };
        (p.port_name, label)
    }).collect()
}

fn drain(rx: &Receiver<Msg>) { while rx.try_recv().is_ok() {} }

// Evaluates JS in the YTM engine window (same path the Tauri commands use).
fn eval(app: &AppHandle, js: &str)
{
    if let Some(win) = app.get_webview_window("ytm") { let _ = win.eval(js); }
}

pub fn start(rx: Receiver<Msg>, selected: Arc<Mutex<Option<String>>>, opts: Arc<Mutex<Opts>>,
             enabled: Arc<Mutex<bool>>, app: AppHandle)
{
    std::thread::spawn(move ||
    {
        let mut last_vid = String::new();
        let mut last_art_vid = String::new();          // cover is (re)sent only when this changes
        let mut queue_cache: Option<String> = None;   // latest ytm-queue payload
        let mut feed_cache: Option<String> = None;     // latest ytm-feed payload
        let mut pls_cache: Option<String> = None;      // latest ytm-playlists (library) payload

        // Image pipeline: a background thread fetches + resizes + packs RGB565 so the np/state
        // stream never stalls on the network; the worker just writes the ready bytes to the port.
        let (req_tx, req_rx) = channel::<FetchReq>();
        let (img_tx, img_rx) = channel::<ImgReady>();
        spawn_image_worker(req_rx, img_tx);

        loop
        {
            // 1. Pick a port: an explicit user selection wins, else auto-detect. While the plugin is
            //    disabled, stay idle (drain the stream, don't touch the board).
            let name = loop
            {
                if !*enabled.lock().unwrap() { drain(&rx); std::thread::sleep(Duration::from_secs(1)); continue; }
                let sel = selected.lock().unwrap().clone();
                if let Some(n) = sel.or_else(find_board) { break n; }
                drain(&rx);
                std::thread::sleep(Duration::from_secs(2));
            };

            // 2. Open it.
            let mut port = match serialport::new(&name, 115200)
                .timeout(Duration::from_millis(50))
                .open()
            {
                Ok(p)  => { println!("[serial] connected {name}"); p }
                Err(e) =>
                {
                    println!("[serial] open failed: {e}");
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }
            };

            // 3. Handshake: announce ourselves, listen ~1s for the device's `sub`.
            let profile = handshake(&mut *port);
            println!("[serial] profile queue={} feed={} playlist={} art={:?} thumb={:?}",
                     profile.queue, profile.feed, profile.playlist, profile.art, profile.thumb);
            drain(&rx);
            last_vid.clear();
            last_art_vid.clear();
            while img_rx.try_recv().is_ok() {}   // drop stale images from the previous link

            let mut rx_line: Vec<u8> = Vec::new();
            let mut lost = false;

            // 4. Interleave outgoing frames (from the channel) with incoming `cmd` frames.
            while !lost
            {
                // plugin disabled -> drop the link (the outer loop then idles until re-enabled)
                if !*enabled.lock().unwrap() { break; }
                // user repointed the port -> drop this link and reconnect
                if let Some(w) = selected.lock().unwrap().clone() { if w != name { break; } }

                // send any ready cover/thumbnail images (RGB565, chunked + acked)
                while let Ok(img) = img_rx.try_recv()
                {
                    if !send_image(&mut *port, &img) { lost = true; break; }
                }
                if lost { break; }

                // incoming: read whatever bytes are waiting, parse complete lines as commands
                read_commands(&mut *port, &mut rx_line, &app, &queue_cache, &feed_cache, &pls_cache, &profile, &opts, &req_tx);

                // outgoing: wait briefly for the next data message
                match rx.recv_timeout(Duration::from_millis(15))
                {
                    Ok(Msg::State(p)) =>
                    {
                        if let Some(f) = np_frame(&p, &mut last_vid) { lost = port.write_all(f.as_bytes()).is_err(); }
                        // request cover art on a track change (the background thread fetches + resizes)
                        if let Some(size) = profile.art
                        {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&p)
                            {
                                let vid = v["id"].as_str().unwrap_or("");
                                let cover = v["cover"].as_str().unwrap_or("");
                                if !vid.is_empty() && vid != last_art_vid && cover.starts_with("http")
                                {
                                    last_art_vid = vid.to_string();
                                    let _ = req_tx.send(FetchReq { url: cover.to_string(), size, kind: ImgKind::Cover });
                                }
                            }
                        }
                    }
                    Ok(Msg::Queue(p)) => { queue_cache = Some(p); }
                    Ok(Msg::Feed(p))  => { feed_cache = Some(p); }
                    Ok(Msg::Playlists(p)) => { pls_cache = Some(p); }
                    Ok(Msg::Playlist(p)) =>
                    {
                        let full = opts.lock().map(|o| o.subtitle_full).unwrap_or(false);
                        if profile.playlist { if let Some(f) = playlist_frames(&p, full) { lost = port.write_all(f.as_bytes()).is_err(); } }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            println!("[serial] link lost, reconnecting");
        }
    });
}

// Sends `hello`, then reads lines for up to 1s looking for the device's `sub` reply.
fn handshake(port: &mut dyn serialport::SerialPort) -> Profile
{
    let hello = "{\"t\":\"hello\",\"proto\":1,\"app\":\"TuneDeck\",\"frames\":[\"np\",\"queue\",\"feed\",\"playlist\",\"art\"]}\n";
    let _ = port.write_all(hello.as_bytes());
    let _ = port.flush();

    let deadline = Instant::now() + Duration::from_secs(1);
    let mut line: Vec<u8> = Vec::new();
    let mut byte = [0u8; 1];
    while Instant::now() < deadline
    {
        match std::io::Read::read(port, &mut byte)
        {
            Ok(1) =>
            {
                if byte[0] == b'\n'
                {
                    if let Some(p) = parse_sub(&line) { return p; }
                    line.clear();
                }
                else if byte[0] != b'\r' { line.push(byte[0]); }
            }
            _ => {}   // timeout tick; keep waiting until the deadline
        }
    }
    Profile::default()
}

fn parse_sub(line: &[u8]) -> Option<Profile>
{
    let v: serde_json::Value = serde_json::from_slice(line).ok()?;
    if v["t"].as_str()? != "sub" { return None; }

    let frames = v["frames"].as_array();
    let want = |name: &str| match &frames
    {
        Some(a) => a.iter().any(|x| x.as_str() == Some(name)),
        None    => true,   // frames omitted -> send everything
    };
    let art = if want("art")
    {
        Some(v["art"]["w"].as_u64().unwrap_or(200) as u32)
    } else { None };
    let thumb = if want("feed")
    {
        Some(v["thumb"].as_u64().unwrap_or(96) as u32)
    } else { None };

    Some(Profile
    {
        queue: want("queue"),
        feed: want("feed"),
        playlist: want("playlist"),
        art,
        thumb,
        queue_n: v["queue"].as_u64().unwrap_or(50) as usize,
        feed_n: v["feed"].as_u64().unwrap_or(64) as usize,
    })
}

// Reads pending bytes, parses each complete line, and acts on `cmd` frames from the device.
fn read_commands(port: &mut dyn serialport::SerialPort, line: &mut Vec<u8>, app: &AppHandle,
                 queue_cache: &Option<String>, feed_cache: &Option<String>, pls_cache: &Option<String>,
                 profile: &Profile, opts: &Arc<Mutex<Opts>>, req_tx: &Sender<FetchReq>)
{
    let avail = port.bytes_to_read().unwrap_or(0) as usize;
    if avail == 0 { return; }
    let mut buf = vec![0u8; avail];
    let n = match std::io::Read::read(port, &mut buf) { Ok(n) => n, Err(_) => 0 };
    for &b in &buf[..n]
    {
        if b == b'\n'
        {
            handle_command(line, app, queue_cache, feed_cache, pls_cache, profile, opts, req_tx, port);
            line.clear();
        }
        else if b != b'\r' { line.push(b); }
    }
}

fn handle_command(line: &[u8], app: &AppHandle, queue_cache: &Option<String>, feed_cache: &Option<String>,
                  pls_cache: &Option<String>, profile: &Profile, opts: &Arc<Mutex<Opts>>,
                  req_tx: &Sender<FetchReq>, port: &mut dyn serialport::SerialPort)
{
    let v: serde_json::Value = match serde_json::from_slice(line) { Ok(v) => v, Err(_) => return };
    if v["t"].as_str() != Some("cmd") { return; }
    let a = v["a"].as_str().unwrap_or("");
    match a
    {
        // transport + volume all route to the engine; vol stepping lives in the reader (original feel)
        "prev" | "next" | "playpause" | "vol_up" | "vol_down" =>
            eval(app, &format!("window.__tunedeckCmd && window.__tunedeckCmd({}, 0)", jstr(a))),
        "play" =>
        {
            let id = v["id"].as_str().unwrap_or("");
            let k  = v["k"].as_str().unwrap_or("v");
            eval(app, &format!("window.__tunedeckPlay && window.__tunedeckPlay({}, {})", jstr(id), jstr(k)));
        }
        "qjump" =>
        {
            // the firmware sends the queue index as a string in `id`
            let idx: i64 = v["id"].as_str().and_then(|s| s.parse().ok()).unwrap_or(-1);
            if idx >= 0 { eval(app, &format!("window.__tunedeckQueueJump && window.__tunedeckQueueJump({idx})")); }
        }
        "playlist" =>
        {
            let id = v["id"].as_str().unwrap_or("");
            eval(app, &format!("window.__tunedeckOpenPlaylist && window.__tunedeckOpenPlaylist({})", jstr(id)));
            // the resulting ytm-playlist arrives via Msg::Playlist and is streamed back then
        }
        "queue" =>
        {
            let full = opts.lock().map(|o| o.subtitle_full).unwrap_or(false);
            if profile.queue { if let Some(p) = queue_cache { if let Some(f) = queue_frames(p, profile, full) { let _ = port.write_all(f.as_bytes()); } } }
        }
        "feed" =>
        {
            let (full, filter) = opts.lock().map(|o| (o.subtitle_full, o.feed_filter.clone())).unwrap_or((false, Vec::new()));
            if profile.feed
            {
                if let Some(p) = feed_cache
                {
                    if let Some((frames, thumbs)) = feed_frames(p, profile, full, &filter, pls_cache.as_deref())
                    {
                        let _ = port.write_all(frames.as_bytes());
                        if let Some(ts) = profile.thumb
                        {
                            for (idx, url) in thumbs
                            {
                                let _ = req_tx.send(FetchReq { url, size: ts, kind: ImgKind::Thumb(idx) });
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

// JSON-encodes a string for safe embedding in an eval expression.
fn jstr(s: &str) -> String { serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into()) }

// Trims a YTM byline to one clean segment the device font can render: drops a leading
// content-type word, keeps the first " • " segment, and strips any stray bullet (tofu on the ESP).
fn clean_sub(s: &str, full: bool) -> String
{
    // full = keep the whole byline (just make the bullet renderable); short = one clean segment.
    if full { return s.replace('•', "-").trim().to_string(); }
    const TYPES: [&str; 8] = ["Song", "Video", "Playlist", "Album", "Single", "EP", "Artist", "Episode"];
    let mut parts: Vec<&str> = s.split(" • ").collect();
    if parts.len() > 1 && TYPES.contains(&parts[0].trim()) { parts.remove(0); }
    parts.first().unwrap_or(&"").replace('•', "-").trim().to_string()
}

// Builds the `np` frame from a ytm-state payload, in the firmware's field shape.
fn np_frame(payload: &str, last_vid: &mut String) -> Option<String>
{
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    let vid = v["id"].as_str().unwrap_or("");
    let status = if vid.is_empty() { "none" }
                 else if v["playing"].as_bool().unwrap_or(false) { "playing" } else { "paused" };
    last_vid.clear();
    last_vid.push_str(vid);
    let frame = serde_json::json!(
    {
        "t":      "np",
        "status": status,
        "title":  v["title"].as_str().unwrap_or(""),
        "artist": v["author"].as_str().unwrap_or(""),
        "vid":    vid,
        "pos":    v["cur"].as_f64().unwrap_or(0.0) as i64,
        "dur":    v["dur"].as_f64().unwrap_or(0.0) as i64,
        "vol":    v["vol"].as_f64().map(|x| x as i64),
    });
    Some(format!("{frame}\n"))
}

// Builds qb / qi* / qe from a ytm-queue array.
fn queue_frames(payload: &str, profile: &Profile, full: bool) -> Option<String>
{
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    let arr = v.as_array()?;
    let mut out = String::from("{\"t\":\"qb\"}\n");
    for it in arr.iter().take(profile.queue_n)
    {
        let row = serde_json::json!(
        {
            "t":     "qi",
            "title": it["title"].as_str().unwrap_or(""),
            "sub":   clean_sub(it["sub"].as_str().unwrap_or(""), full),
            "cur":   it["cur"].as_bool().unwrap_or(false),
        });
        out.push_str(&row.to_string());
        out.push('\n');
    }
    out.push_str("{\"t\":\"qe\"}\n");
    Some(out)
}

// Builds pb / pi* / pe from a ytm-playlist object.
fn playlist_frames(payload: &str, full: bool) -> Option<String>
{
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    let head = serde_json::json!({ "t": "pb", "title": v["title"].as_str().unwrap_or("") });
    let mut out = format!("{head}\n");
    if let Some(tracks) = v["tracks"].as_array()
    {
        for it in tracks
        {
            let row = serde_json::json!(
            {
                "t":     "pi",
                "title": it["title"].as_str().unwrap_or(""),
                "sub":   clean_sub(it["sub"].as_str().unwrap_or(""), full),
            });
            out.push_str(&row.to_string());
            out.push('\n');
        }
    }
    out.push_str("{\"t\":\"pe\"}\n");
    Some(out)
}

// Builds fb / fs* / fi* / fe from a ytm-feed sections array. (Thumbnails: Phase B.)
fn feed_frames(payload: &str, profile: &Profile, full: bool, allow: &[String], pls: Option<&str>)
    -> Option<(String, Vec<(usize, String)>)>
{
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    let sections = v.as_array()?;
    let mut out = String::from("{\"t\":\"fb\"}\n");
    let mut thumbs: Vec<(usize, String)> = Vec::new();   // (global fi index, thumb url) for Phase-B art
    let mut count = 0usize;

    for sec in sections
    {
        let title = sec["label"].as_str().or_else(|| sec["title"].as_str()).unwrap_or("");
        // an empty allow-list means "send everything"; otherwise only the chosen sections
        if !allow.is_empty() && !allow.iter().any(|a| a == title) { continue; }
        out.push_str(&serde_json::json!({ "t": "fs", "title": title, "k": "" }).to_string());
        out.push('\n');
        if let Some(items) = sec["items"].as_array()
        {
            for it in items
            {
                if count >= profile.feed_n { break; }
                let kind = it["kind"].as_str().unwrap_or("");
                push_fi(&mut out, &mut thumbs, it, kind, full, &mut count);
            }
        }
    }

    // Append the user's library playlists as a "Playlists" section (k="p" routes it to the device's
    // Playlists tab; each item is kind "s" so a tap opens its track list via a `playlist` cmd).
    if let Some(items) = pls.and_then(|p| serde_json::from_str::<serde_json::Value>(p).ok()).as_ref().and_then(|v| v.as_array()).map(|a| a.to_vec())
    {
        out.push_str("{\"t\":\"fs\",\"title\":\"Playlists\",\"k\":\"p\"}\n");
        for it in items.iter()
        {
            if count >= profile.feed_n { break; }
            push_fi(&mut out, &mut thumbs, it, "s", full, &mut count);
        }
    }

    out.push_str("{\"t\":\"fe\"}\n");
    Some((out, thumbs))
}

// Emits one `fi` row and records its thumbnail (if any) against the running global index.
fn push_fi(out: &mut String, thumbs: &mut Vec<(usize, String)>, it: &serde_json::Value, kind: &str, full: bool, count: &mut usize)
{
    let row = serde_json::json!(
    {
        "t":     "fi",
        "title": it["title"].as_str().unwrap_or(""),
        "sub":   clean_sub(it["sub"].as_str().unwrap_or(""), full),
        "id":    it["id"].as_str().unwrap_or(""),
        "k":     kind,
    });
    out.push_str(&row.to_string());
    out.push('\n');
    let thumb = it["thumb"].as_str().unwrap_or("");
    if !thumb.is_empty() { thumbs.push((*count, thumb.to_string())); }
    *count += 1;
}

// Phase B: cover/thumbnail image pipeline (RGB565)
// Background thread: fetch + resize + pack each requested image, hand the bytes back to the worker.
fn spawn_image_worker(req_rx: Receiver<FetchReq>, img_tx: Sender<ImgReady>)
{
    std::thread::spawn(move ||
    {
        for req in req_rx
        {
            if let Some(data) = fetch_rgb565(&req.url, req.size)
            {
                let _ = img_tx.send(ImgReady { kind: req.kind, w: req.size, h: req.size, data });
            }
        }
    });
}

// Downloads an image, resizes it to size x size, and packs it as RGB565 little-endian (what the
// firmware blits directly). None on any network/decode failure.
fn fetch_rgb565(url: &str, size: u32) -> Option<Vec<u8>>
{
    let resp = ureq::get(url).timeout(Duration::from_secs(6)).call().ok()?;
    let mut bytes: Vec<u8> = Vec::new();
    resp.into_reader().take(16 * 1024 * 1024).read_to_end(&mut bytes).ok()?;
    let img = image::load_from_memory(&bytes).ok()?;
    let rgb = image::imageops::resize(&img.to_rgb8(), size, size, image::imageops::FilterType::Lanczos3);
    let mut out = Vec::with_capacity((size * size * 2) as usize);
    for p in rgb.pixels()
    {
        let (r, g, b) = (p.0[0] as u16, p.0[1] as u16, p.0[2] as u16);
        let v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
        out.push((v & 0xFF) as u8);        // low byte first
        out.push((v >> 8) as u8);
    }
    Some(out)
}

// Sends one image: header frame + RGB565 bytes in <=4096-byte chunks, waiting for the device's
// `{"t":"ok"}` after each chunk. Returns false only if a write failed (link lost).
fn send_image(port: &mut dyn serialport::SerialPort, img: &ImgReady) -> bool
{
    let header = match img.kind
    {
        ImgKind::Cover    => format!("{{\"t\":\"art\",\"w\":{},\"h\":{}}}\n", img.w, img.h),
        ImgKind::Thumb(i) => format!("{{\"t\":\"ft\",\"i\":{},\"w\":{},\"h\":{}}}\n", i, img.w, img.h),
    };
    if port.write_all(header.as_bytes()).is_err() { return false; }
    for chunk in img.data.chunks(4096)
    {
        if port.write_all(chunk).is_err() { return false; }
        if !wait_ok(port) { return true; }   // no ack: abort this image, but the link is still alive
    }
    true
}

// Reads lines for up to 1s waiting for a `{"t":"ok"}` chunk ack from the device.
fn wait_ok(port: &mut dyn serialport::SerialPort) -> bool
{
    let deadline = Instant::now() + Duration::from_secs(1);
    let mut line: Vec<u8> = Vec::new();
    let mut byte = [0u8; 1];
    while Instant::now() < deadline
    {
        if let Ok(1) = std::io::Read::read(port, &mut byte)
        {
            if byte[0] == b'\n'
            {
                if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&line)
                {
                    if v["t"].as_str() == Some("ok") { return true; }
                }
                line.clear();
            }
            else if byte[0] != b'\r' { line.push(byte[0]); }
        }
    }
    false
}
