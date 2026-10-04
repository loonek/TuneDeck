# TuneDeck - design notes

## What it is

A desktop client for YouTube Music that renders its own interface rather than
showing YTM's page in a window. A hidden WebView2 window runs `music.youtube.com`
only as an engine - login, audio and DRM, data - and TuneDeck reads state from it,
sends control back, and draws everything the user sees itself.

The reason to bother is that YTM has no desktop app and no open API, and I wanted
to keep its library and playback but present them my own way: hide and reorder the
parts of the home feed I don't use, and have somewhere to add things YTM won't (a
hardware display, Discord presence, plugins).

## How the pieces fit

The hidden engine is a WebView2 window loading `music.youtube.com`, invisible in a
release build. A reader (injected JS, grown out of the TuneFrame extension) pulls
out the state TuneDeck needs - now playing, home sections, playlists, search,
queue. State goes up as page -> Tauri event -> Rust; control goes down as Rust ->
`webview.eval(...)` -> player actions. The interface is TuneDeck's own HTML/CSS/JS
in `src/`, fed by Rust.

The TuneFrame board is a decoupled add-on. Rust's serial module sends it protocol
frames independently of the app's own UI, so how the user configures TuneDeck
doesn't change what the board sees.

## Screens

Home (with its configurable sections), a playlist view, search, the full
now-playing view, the queue, and settings. Radio, autoplay, infinite scroll and
most context-menu actions are left to the engine rather than reimplemented.

## Navigation and layout

A left sidebar like YTM's: Home, Library, a "New playlist" entry, and the user's
playlists as a scrollable list with thumbnails. No Explore - I don't find it
useful. The content column on the right has a top bar (search, settings, avatar)
over the active view, and a mini-player runs full-width along the bottom.

## Configurable home

Each home section (Quick picks, Listen again, and so on) can be hidden, reordered
by dragging, and shown either as large captioned cards or as a compact multi-column
list - the two shapes YTM itself uses. No user-created sections. Playlists stay in
the sidebar, not as a home section. The config is saved as JSON in the app data
dir.

## Look

The TuneDeck wordmark is in Audiowide; everything else is Open Sans, the same font
as on the board, with normal fallbacks behind it. The theme follows the OS by
default - light or dark - and you can pin it either way in Settings, where you also
pick the accent colour rather than from the top bar. The accent can be one of the
presets or your own colour.

## Interaction

Click a track to play it. There's the bottom mini-player and a separate full
now-playing view, and search is always one click away in the top bar.

## Scope

The aim was to cover roughly the daily 90%: the home feed, playlists, search
results, now playing, the queue, and the basic controls. Anything that doesn't come
out cleanly through the reader and eval is left to the engine instead of being
rebuilt.

## Queue: owned vs lite

Queue control kept coming up as the thing Spotify does well, so I tried a
TuneDeck-owned queue: my own track array, driving playback in place with
`movie_player.loadVideoById` (which works with no reload). It doesn't hold up. YTM
always auto-advances its own queue on the `<video>` `ended` event and there's no
way to stop it. There is an "Autoplay" toggle, but it only governs autoplay - the
tracks YTM tacks on after your queue runs out - not the queue stepping through its
own items; `setAutonavState` is a no-op for the queue itself. Owning the queue would
mean reimplementing playback orchestration and fighting YTM on every update, which
isn't worth it.

So the queue is view-and-nudge instead: see the queue (with the autoplay part split
off), tap to jump, swipe or use the menu to remove. Free reorder lives in playlists,
where the `edit_playlist` InnerTube API does it cleanly. A properly owned queue is
still possible one day, but it's a big piece of work on its own.

## Dead ends / platform limits

Things I tried or looked into and couldn't ship, with the reason, so nobody burns
days walking into the same wall. "Not possible" here means not without
disproportionate effort (reversing a client-side store, fighting the player)
relative to what you'd get.

- **Owned queue**: see above. YTM auto-advances on `ended` with no stoppable hook.
  Shipped queue-lite instead.
- **Free queue reorder to an arbitrary position**: YTM web has no drag-reorder and
  no InnerTube call for it; only "Play next" and "Add to queue" (after-current /
  end) exist. Checking the live queue service: `queueApi` exposes no mutation
  methods, `serverQueueApi`
  only `removeItem` and `shuffle`, and the Redux `store` holds `queue.items` and
  `selectedItemIndex` but has no reorder action (so neither a dispatch nor a direct
  array mutation reorders playback). Insert positions are a fixed enum
  (`INSERT_AFTER_CURRENT_VIDEO` / `INSERT_AT_END`), with no "insert after video X",
  so even an id held in memory can't be dropped at an arbitrary slot. A
  deferred-playNext idea (remember to playNext(X) once X's intended predecessor
  becomes the current track) fits the limit on paper but only materialises as
  playback advances and breaks on skip or restart - too fragile. The shipped
  reorder is two reliable gestures: drop to the top for Play next, drop to the
  bottom for Add to queue. Arbitrary reorder is a playlist thing (`edit_playlist`),
  not a queue thing.
- **Downloads tab**: YTM downloads aren't reachable through InnerTube.
  `FEmusic_offline` returns only a two-tab shell whose Downloads tab carries the
  literal placeholder continuation `CONTENT_RELOAD_CONTINUATION_TOKEN_DEFAULT`; the
  web client fills that tab from its own local offline store (IndexedDB), and the
  media is DRM-encrypted for YTM's player. The tell is that opening Downloads in YTM
  fires no network request at all. Every fetch variant (body continuation,
  query-param ctoken/continuation) 400s. So there's no Downloads tab - it can't be
  populated from here, and an empty tab pointing people back at the YTM app wasn't
  worth keeping.
