# TuneDeck - Design Brief

## What it is
TuneDeck is a custom, configurable desktop client for YouTube Music. It is *not* a
browser wrapper that shows YTM's own page - it renders its own interface. A hidden
WebView2 window runs `music.youtube.com` purely as an engine (login, audio/DRM, data);
TuneDeck reads state from it, sends control back, and draws everything the user sees
itself.

## Why
YTM has no desktop app and no open API. Existing wrappers just re-skin the site.
TuneDeck's point is **control and calm**: keep YTM's familiar structure, but let the
user hide/reorder the parts they don't use and present it more cleanly.

## Architecture
- **Hidden engine** - WebView2 window loads `music.youtube.com`, fully hidden in the
  finished app.
- **Reader** - injected JS extracts state (now-playing, home sections, playlists,
  search, queue), ported from the proven TuneFrame extension.
- **Up** - page -> Tauri event -> Rust.
- **Down** - Rust -> `webview.eval(...)` -> player actions.
- **UI** - TuneDeck's own HTML/CSS/JS in `src/`, fed by Rust.
- **Board (add-on, decoupled)** - the existing JC4827W543 firmware is unchanged. Rust's
  serial module sends it the same protocol frames as before (`np` now; feed/queue/
  playlist later). The board is independent of the app's UI configuration.

## Screens (v1)
Home (configurable sections) - Playlist - Search - Now-playing (full) - Queue -
Settings. Radio/autoplay, infinite scroll and context menus are left to the engine
for now.

## Navigation & layout
Left sidebar (like YTM) with Home, Library, "New playlist", and the user's playlists as
a scrollable list with thumbnails. **No Explore** - it isn't useful. A content column to
the right holds a top bar (search + settings + avatar) over the active view. A persistent
mini-player spans the full width at the bottom.

## Home configurability
A "section" (Quick picks, Listen again, Covers & remixes, ...) is a unit with a
**visibility toggle** and an **order**, plus a per-section **display mode**: large cards
with captions, or a compact multi-column list (YTM's two forms). v1: toggle + reorder
(drag) + per-section mode; no user-created sections. Playlists live in the sidebar, not
as a home section. Config persisted as JSON in the app's data dir.

## Visual language
- **Type**: "Audiowide" for the TuneDeck wordmark only; "Open Sans" everywhere else
  (matches the device font). Real fallback stacks.
- **Theme**: dark by default (follows the OS), light supported. Theme and accent live in
  Settings, not the top bar.
- **Accent**: user-configurable (presets + custom color), persisted. Principle:
  **accent = action and brand** (play, progress, focus ring, the active nav icon);
  **neutral surfaces = selection/state** (active nav chip, selected toggle). Never an
  accent-tinted pill + rail on a rounded card - that reads as generic AI design.
- **Feel**: looser than YTM - more whitespace, larger cover art, fewer chips. Neutrals
  carry a slight hue bias, not flat grey.

## Interaction
Click a track to play. Persistent mini-player at the bottom + a separate full
now-playing view. Search always reachable from the top bar.

## The board
Stays as-is. Firmware already exists and expects the current serial protocol; TuneDeck
keeps feeding it that, independent of the app's own view.

## v1 boundary
Cover ~90% of daily use (home/sections, playlists, search results, now-playing, queue,
basic controls). Anything not cleanly reproducible via reader + eval defers to the
engine rather than being reimplemented.

## Queue: owned vs lite (decided 2026-09-29)
Research flagged queue control as a Spotify differentiator, so we spiked a TuneDeck-owned
queue: our own track array, driving playback in-place with `movie_player.loadVideoById`
(which works with no reload). It is NOT viable: YTM always auto-advances its queue on the
`<video>` `ended` event and there is no way to stop it (`setAutonavState` is a no-op for
the queue; the "Autoplay is on" label has no toggle). Owning the queue would mean
reimplementing playback orchestration and fighting YTM on every update - against this
project's stability-over-cleverness stance. Shipping "queue-lite" instead: view the queue
(with the autoplay section split off), tap to jump, swipe or menu to remove. Free reorder
is deferred to PLAYLISTS, where the `edit_playlist` InnerTube API makes it clean and
reliable. Owned queue remains a possible future effort, but a large dedicated one.
