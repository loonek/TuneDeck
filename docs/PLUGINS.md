# TuneDeck plugins

TuneDeck has two kinds of plugins:

- **Native plugins** (built in, written in Rust) for things a web page cannot do: Discord Rich
  Presence, the TuneFrame serial link. You cannot add these without rebuilding the app.
- **JS plugins** (drop-in) for everything else: engine tweaks (theming, keeping the page awake), now-playing
  side effects, HTTP-based integrations (scrobblers, webhooks). These you just drop in a folder.

Both show up in **Settings -> Plugins**, where their config is auto-rendered from their manifest.

> Phase 2 note: JS plugins run in TuneDeck's own UI context with no sandbox yet - only install
> plugins whose code you trust. A sandbox + permissions model is planned (Phase 3).

## Where plugins live

A folder shown at the bottom of Settings -> Plugins (the app data dir's `plugins/`). Each plugin is
a subfolder with two files:

```
plugins/
  my-plugin/
    manifest.json
    index.js
```

## manifest.json

Same schema as a native plugin's manifest. `fields` is the config schema; TuneDeck renders a control
per field and persists the value.

```json
{
  "id": "my-plugin",
  "label": "My Plugin",
  "description": "What it does, shown next to the enable toggle.",
  "version": "1.0",
  "fields": [
    { "key": "greeting", "label": "Greeting", "hint": "shown before the title",
      "kind": "text", "default": "Now playing", "options": [], "advanced": false }
  ]
}
```

- `kind`: `"bool"` (a switch), `"text"` (an input), or `"select"` (uses `options`).
- `advanced: true` hides the field behind an "Advanced" toggle.

## index.js

Runs once when the plugin is enabled, with a `tunedeck` object in scope:

```js
tunedeck.onTrack((t) => {
  if (!t.id) return;                       // nothing playing
  tunedeck.log(tunedeck.config.get("greeting") + ": " + t.title + " - " + t.artist);
});
```

### The `tunedeck` API

- `tunedeck.onTrack(cb)` - `cb(t)` on every playback update. `t`: `{ title, artist, album, cover,
  id, dur, pos, playing }` (seconds for dur/pos).
- `tunedeck.onQueue(cb)` - `cb(items)` when the queue changes.
- `tunedeck.injectEngine(js)` - runs `js` inside the YouTube Music engine page (DOM/network access).
  This is how a theme or other engine tweak works.
- `tunedeck.http(url, { method, body })` - an HTTP request made by the host (no CORS); resolves to
  `{ status, body }`. For scrobblers / webhooks.
- `tunedeck.config.get(key)` / `tunedeck.config.set(key, value)` - this plugin's persisted config
  (the same values shown in Settings).
- `tunedeck.onConfig(cb)` - `cb(key, value)` when a config value changes.
- `tunedeck.log(...args)` - logs to the console, tagged with the plugin id.

### Example: keep playback going through the idle prompt

```js
// index.js - dismiss YTM's "Continue watching?" idle dialog so music keeps playing
tunedeck.injectEngine(`
  setInterval(() => {
    const btn = document.querySelector('yt-confirm-dialog-renderer #confirm-button, tp-yt-paper-button#confirm-button');
    if (btn) btn.click();
  }, 1000);
`);
```

## Enabling

Drop the folder in, open **Settings -> Plugins**, flip the toggle. A JS plugin starts the moment you
enable it; engine injections last until the engine reloads. Disabling stops its callbacks.
