// TuneDeck UI.
// Home sections arrive from the hidden engine via the "ytm-feed" event, the mini-player via
// "ytm-state", and the sidebar playlists via "ytm-playlists".

// helpers
function esc(s)
{
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Drops parenthetical noise like "(Single Version)" / "(feat. ...)" for compact previews.
function cleanTitle(t)
{
  return (t || "").replace(/\s*\([^)]*\)/g, "").trim() || (t || "");
}

// A short label for what a section mostly contains, from its items' kinds (v/p/b/a).
function sectionKindLabel(items)
{
  const counts = {};
  (items || []).forEach((it) => { if (it.kind) counts[it.kind] = (counts[it.kind] || 0) + 1; });
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return { v: "Songs", p: "Playlists", b: "Albums", a: "Artists" }[top] || "Mixed";
}

// Sends a play request to the engine; Rust evals the reader's play helper there.
function playFromUI(it)
{
  if (!it || !it.id) return;
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("play", { id: it.id, kind: it.kind || "v" });
}

function itemAction(action, id)
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("item_action", { action, id });
}
function copyLink(item)
{
  const id = item.id || "";
  let url;
  if (item.kind === "p") url = "https://music.youtube.com/watch?list=" + String(id).replace(/^VL/, "");
  else if (item.kind === "b") url = "https://music.youtube.com/browse/" + id;
  else url = "https://music.youtube.com/watch?v=" + id;
  try { navigator.clipboard.writeText(url); } catch (e) {}
}

let openMenuEl = null;
function closeItemMenu()
{
  if (!openMenuEl) return;
  openMenuEl.remove();
  openMenuEl = null;
  document.removeEventListener("pointerdown", onDocDown, true);
}
function onDocDown(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeItemMenu(); }

// "Save to playlist" picker: lists library playlists, adds the given video on pick
let pickerEl = null;
function closePlaylistPicker()
{
  if (!pickerEl) return;
  pickerEl.remove();
  pickerEl = null;
  document.removeEventListener("keydown", onPickerKey, true);
}
function onPickerKey(e) { if (e.key === "Escape") closePlaylistPicker(); }

function openPlaylistPicker(videoId)
{
  if (!videoId) return;
  closePlaylistPicker();

  const back = document.createElement("div");
  back.className = "picker-back";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) closePlaylistPicker(); });

  const box = document.createElement("div");
  box.className = "picker";
  box.innerHTML = `<header><h3>Save to playlist</h3>
    <button class="picker-x" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
    <input class="picker-search" placeholder="Filter playlists" />
    <div class="picker-list"></div>`;

  const list = box.querySelector(".picker-list");
  const render = (q) =>
  {
    list.innerHTML = "";
    const ql = (q || "").toLowerCase();
    const items = playlists.filter((p) => !ql || (p.title || "").toLowerCase().includes(ql));
    if (!items.length) { list.innerHTML = `<p class="picker-empty">No playlists.</p>`; return; }
    items.forEach((p, i) =>
    {
      const row = document.createElement("button");
      row.className = "picker-row";
      const bg = p.thumb
        ? `background-image:url('${p.thumb}');background-size:cover;background-position:center;`
        : `background:${cover(i + 2)};`;
      row.innerHTML = `<span class="picker-th" style="${bg}"></span><span class="picker-n">${esc(p.title)}</span>`;
      row.addEventListener("click", () =>
      {
        playlistEdit("add", p.openId || p.id, videoId);   // reader strips any VL prefix
        toast(`Added to ${p.title}`);
        closePlaylistPicker();
      });
      list.appendChild(row);
    });
  };
  render("");
  box.querySelector(".picker-search").addEventListener("input", (e) => render(e.target.value));
  box.querySelector(".picker-x").addEventListener("click", closePlaylistPicker);

  back.appendChild(box);
  document.body.appendChild(back);
  pickerEl = back;
  setTimeout(() => { const s = box.querySelector(".picker-search"); if (s) s.focus(); }, 0);
  document.addEventListener("keydown", onPickerKey, true);
}

// transient toast (optimistic feedback; edits are fire-and-forget)
let toastTimer = null;
function toast(msg)
{
  let el = document.getElementById("toast");
  if (!el)
  {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// small confirm dialog (reuses the picker/modal shell); onYes runs on "Delete"
function openConfirm(title, body, confirmLabel, onYes)
{
  const back = document.createElement("div");
  back.className = "picker-back";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) back.remove(); });
  const box = document.createElement("div");
  box.className = "picker npl-modal";
  box.innerHTML = `<header><h3>${esc(title)}</h3>
    <button class="picker-x" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
    <div class="npl-body">
      <p style="margin:0;color:var(--text-dim)">${esc(body || "")}</p>
      <div class="npl-actions">
        <button class="npl-cancel">Cancel</button>
        <button class="danger">${esc(confirmLabel || "Delete")}</button>
      </div>
    </div>`;
  box.querySelector(".npl-cancel").addEventListener("click", () => back.remove());
  box.querySelector(".picker-x").addEventListener("click", () => back.remove());
  box.querySelector(".danger").addEventListener("click", () => { back.remove(); onYes(); });
  back.appendChild(box);
  document.body.appendChild(back);
}

// account / channel switcher (TuneDeck's own UI, fed by the ytm-accounts event)
let accountsRequested = false;   // gate: open the picker on the next ytm-accounts, not on every emit
function openAccountPicker(list)
{
  const back = document.createElement("div");
  back.className = "picker-back";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) back.remove(); });
  const box = document.createElement("div");
  box.className = "picker";
  box.innerHTML = `<header><h3>Switch account</h3>
    <button class="picker-x" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
    <div class="picker-list"></div>`;
  const listEl = box.querySelector(".picker-list");
  if (!list || !list.length) listEl.innerHTML = `<p class="picker-empty">No channels found.</p>`;
  else list.forEach((a) =>
  {
    const row = document.createElement("button");
    row.className = "picker-row";
    const bg = a.thumb
      ? `background-image:url('${a.thumb}');background-size:cover;background-position:center;`
      : `background:${cover(3)};`;
    row.innerHTML = `<span class="picker-th" style="${bg};border-radius:50%"></span>
      <span class="picker-n">${esc(a.name)}${a.handle ? `<small style="display:block;color:var(--text-dim)">${esc(a.handle)}</small>` : ""}</span>
      ${a.selected ? `<span class="picker-check">&#10003;</span>` : ""}`;
    row.addEventListener("click", () =>
    {
      const c = window.__TAURI__ && window.__TAURI__.core;
      if (!a.selected && c) { c.invoke("switch_to", { key: a.handle || a.name }); toast("Switching account…"); }
      back.remove();
    });
    listEl.appendChild(row);
  });
  box.querySelector(".picker-x").addEventListener("click", () => back.remove());
  back.appendChild(box);
  document.body.appendChild(back);
}

// "New playlist" modal: title + privacy, then create_playlist in the engine
function openNewPlaylist()
{
  const back = document.createElement("div");
  back.className = "picker-back";
  back.addEventListener("pointerdown", (e) => { if (e.target === back) back.remove(); });

  const box = document.createElement("div");
  box.className = "picker npl-modal";
  box.innerHTML = `<header><h3>New playlist</h3>
    <button class="picker-x" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
    <div class="npl-body">
      <input class="npl-title" placeholder="Playlist title" maxlength="150" />
      <div class="npl-privacy">
        <button data-priv="PRIVATE" class="on">Private</button>
        <button data-priv="UNLISTED">Unlisted</button>
        <button data-priv="PUBLIC">Public</button>
      </div>
      <div class="npl-actions">
        <button class="npl-cancel">Cancel</button>
        <button class="npl-create">Create</button>
      </div>
    </div>`;

  let privacy = "PRIVATE";
  box.querySelectorAll(".npl-privacy button").forEach((b) =>
    b.addEventListener("click", () =>
    {
      privacy = b.dataset.priv;
      box.querySelectorAll(".npl-privacy button").forEach((x) => x.classList.toggle("on", x === b));
    }));

  const titleInput = box.querySelector(".npl-title");
  const submit = () =>
  {
    const t = titleInput.value.trim();
    if (!t) { titleInput.focus(); return; }
    createPlaylistCmd(t, privacy);
    toast(`Creating "${t}"…`);   // fire-and-forget; ytm-playlist-created confirms + opens it
    back.remove();
  };
  box.querySelector(".npl-create").addEventListener("click", submit);
  box.querySelector(".npl-cancel").addEventListener("click", () => back.remove());
  box.querySelector(".picker-x").addEventListener("click", () => back.remove());
  titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  back.appendChild(box);
  document.body.appendChild(back);
  setTimeout(() => titleInput.focus(), 0);
}

function openItemMenu(anchor, item, opts)
{
  closeItemMenu();
  opts = opts || {};
  const H = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  const HF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  const R = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M19.1 4.9a10 10 0 0 1 0 14.2"/></svg>';
  const L = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>';
  const PN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h11M4 12h11M4 18h7M16 15l5 3-5 3z"/></svg>';
  const AQ = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h11M4 12h11M4 18h7M18 15v6M15 18h6"/></svg>';
  const AL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/></svg>';
  const SP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h13M3 10h13M3 14h8M13 15v6M10 18h6"/></svg>';
  const isSong = (item.kind || "v") === "v";
  const liked = !!item.liked;
  const actions = [];
  (opts.extra || []).forEach((a) => actions.push(a));
  if (isSong && !opts.noQueueAdd)
  {
    actions.push({ label: "Play next", ic: PN, run: () => queueAdd(item.id, "playnext") });
    actions.push({ label: "Add to queue", ic: AQ, run: () => queueAdd(item.id, "addqueue") });
  }
  if (isSong && !opts.noLike)
    actions.push(liked
      ? { label: "Remove from liked songs", ic: HF, run: () => { itemAction("unlike", item.id); item.liked = false; } }
      : { label: "Add to liked songs", ic: H, run: () => { itemAction("like", item.id); item.liked = true; } });
  if (isSong) actions.push({ label: "Start radio", ic: R, run: () => itemAction("radio", item.id) });
  if (isSong) actions.push({ label: "Save to playlist", ic: SP, run: () => openPlaylistPicker(item.id) });
  if (item.album && item.album.id)
    actions.push({ label: "Go to album", ic: AL, run: () => openAlbum(item.album.id) });
  actions.push({ label: "Copy link", ic: L, run: () => copyLink(item) });

  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  actions.forEach((a) =>
  {
    const b = document.createElement("button");
    b.className = "ctx-item";
    b.innerHTML = `${a.ic}<span>${esc(a.label)}</span>`;
    b.addEventListener("click", () => { a.run(); closeItemMenu(); });
    menu.appendChild(b);
  });
  document.body.appendChild(menu);

  const r = anchor.getBoundingClientRect();
  let top = r.bottom + 4;
  let left = r.right - menu.offsetWidth;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = r.top - menu.offsetHeight - 4;
  if (left < 8) left = 8;
  menu.style.top = top + "px";
  menu.style.left = left + "px";

  openMenuEl = menu;
  setTimeout(() => document.addEventListener("pointerdown", onDocDown, true), 0);
}

// Sends a playback control action to the engine (value: 0..100 for seek/volume).
function control(action, value)
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("control", { action, value });
}

// Jumps to the i-th row of the engine's queue.
function queueJump(index)
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("queue_jump", { index });
}

// Removes the i-th row from the engine's queue.
function queueRemove(index)
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("queue_remove", { index });
}

// Runs a native queue-menu action on the i-th row: "move" | "addqueue" | "remove".
function queueMenu(index, action)
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("queue_menu", { index, action });
}

// Adds an arbitrary videoId to the queue (for items with no queue row, e.g. feed/playlist
// songs). action: "playnext" (after current) or "addqueue" (end).
function queueAdd(videoId, action)
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("queue_add", { videoId, action });
}

// Edits a playlist: action "add" (a=videoId) | "remove" (a=setVideoId, b=videoId) | "move" (a=setVideoId moved, b=setVideoId placed before).
function playlistEdit(action, playlistId, a, b)
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("playlist_edit", { action, playlistId, a: a || "", b: b || "" });
}

// Creates a new playlist in the engine. privacy: "PRIVATE" | "UNLISTED" | "PUBLIC".
function createPlaylistCmd(title, privacy)
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("create_playlist", { title, privacy });
}

// Deletes a playlist in the engine (editable/owned only).
function deletePlaylistCmd(id)
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("delete_playlist", { id });
}


// Percent (0..100) of where the pointer clicked along a horizontal bar element.
function clickPct(el, e)
{
  const r = el.getBoundingClientRect();
  return Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
}

// Module scope to not acccidentally fight drag
let volDragging =   false;
let seekDragging =  false;
let currentVol = 100, lastVol = 100;   // for the mute toggle + icon state

// Swaps the volume glyph to match the level: muted (X), low (one wave), high (two waves).
function renderVolIcon(pct)
{
  const el = document.getElementById("volIcon");
  if (!el) return;
  const spk = "M3 10v4h4l5 5V5L7 10z";
  const waves = pct <= 0 ? "M16 9l6 6M22 9l-6 6"
              : pct < 50 ? "M16 9a3 3 0 0 1 0 6"
              :            "M16 9a3 3 0 0 1 0 6M19 7a6 6 0 0 1 0 10";
  el.innerHTML = `<path d="${spk}"/><path d="${waves}"/>`;
}

function wirePlayer()
{
  document.getElementById("playBtn").addEventListener("click", () =>
  {
    document.getElementById("playBtn").classList.toggle("playing");   // optimistic; ytm-state re-syncs
    control("playpause");
  });
  document.getElementById("prevBtn").addEventListener("click", () => control("prev"));
  document.getElementById("nextBtn").addEventListener("click", () => control("next"));

  document.querySelector(".np .like").addEventListener("click", () =>
  {
    if (!currentNp || !currentNp.id) return;
    const want = !currentNp.liked;
    itemAction(want ? "like" : "unlike", currentNp.id);   // reliable InnerTube like/removelike (same path as the menu)
    currentNp.liked = want;
    likeState[currentNp.id] = want;   // the API toggle does not change YTM's player-bar like-status, so remember
    renderNpLike();                    // it locally - otherwise the next snapshot would revert the heart
  });

  document.querySelector(".np-menu").addEventListener("click", (e) =>
  {
    if (!currentNp || !currentNp.id) return;
    openItemMenu(e.currentTarget, { id: currentNp.id, kind: "v", liked: currentNp.liked, artists: currentNp.artists,
      album: currentNp.albumId ? { name: currentNp.album, id: currentNp.albumId } : null }, { noLike: true });
  });

  const npExpand = document.getElementById("npExpand");
  npExpand.addEventListener("click", () =>
  {
    const open = document.getElementById("npView").classList.toggle("open");
    npExpand.classList.toggle("flip", open);   // chevron points down when the view is open
  });


  const seek = document.querySelector(".seek");
  let seekPending = 0, seekRaf = 0;
  function seekApply(e)
  {
    const pct = clickPct(seek, e);
    document.getElementById("npFill").style.width = pct + "%";
    seekPending = pct;
    if (!seekRaf) seekRaf = requestAnimationFrame(() => { seekRaf = 0; control("seek", seekPending); });
  }
  seek.addEventListener("mousedown", (e) => { seekDragging = true; seekApply(e); e.preventDefault(); });
  window.addEventListener("mousemove", (e) => { if (seekDragging) seekApply(e); });
  window.addEventListener("mouseup", () => { seekDragging = false; });

  const vol = document.querySelector(".vol");
  let volPending = 0, volRaf = 0;
  function volApply(e)
  {
    const pct = clickPct(vol, e);
    vol.querySelector(".fill").style.width = pct + "%";     // follow the cursor instantly
    currentVol = pct;
    renderVolIcon(pct);
    volPending = pct;
    if (!volRaf) volRaf = requestAnimationFrame(() => { volRaf = 0; control("volume", volPending); });
  }
  vol.addEventListener("mousedown", (e) => { volDragging = true; volApply(e); e.preventDefault(); });
  window.addEventListener("mousemove", (e) => { if (volDragging) volApply(e); });
  window.addEventListener("mouseup", () => { volDragging = false; });

  // Speaker icon = mute toggle: remember the level, drop to 0, click again to restore.
  document.getElementById("volBtn").addEventListener("click", () =>
  {
    const target = currentVol > 0 ? 0 : (lastVol > 0 ? lastVol : 100);
    if (currentVol > 0) lastVol = currentVol;
    currentVol = target;
    vol.querySelector(".fill").style.width = target + "%";
    renderVolIcon(target);
    control("volume", target);
  });
}

const hues = [[350,80],[210,75],[275,70],[160,68],[35,85],[300,65],[190,70],[15,80],[240,70],[120,55],[55,80],[330,72]];
function cover(i)
{
  const [h, s] = hues[i % hues.length];
  return `linear-gradient(135deg, hsl(${h} ${s}% 55%), hsl(${(h + 40) % 360} ${s}% 40%))`;
}
function artStyle(it, i)
{
  return it.thumb
    ? `background-image:url('${it.thumb}');background-size:cover;background-position:center;`
    : `background:${cover(i)};`;
}

// Loads a thumbnail into an element's background with retries, so a transient network failure
// doesn't leave a permanently blank card. The gradient fallback shows until it succeeds.
function setBg(el, url, tries)
{
  if (!el || !url) return;   // note: el may not be in the DOM yet (set before append) - check on load
  const img = new Image();
  img.onload = () =>
  {
    img.onload = img.onerror = null;
    if (!el.isConnected) return;                 // row was replaced while loading -> drop it
    el.style.backgroundImage = `url('${url}')`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
  };
  img.onerror = () =>
  {
    img.onload = img.onerror = null;
    img.src = "";                                // cancel the stale request so it frees a connection
    if (el.isConnected && (tries || 0) < 2) setTimeout(() => setBg(el, url, (tries || 0) + 1), 1500 * ((tries || 0) + 1));
  };
  img.src = url;
}

// Lazy thumbnails: only load an element's image when it scrolls into view, and drop it (restoring the
// gradient placeholder) when it leaves - so a long feed/search/list loads a handful of images instead
// of dozens at once, and off-screen ones free memory. The placeholder gradient is captured from the
// element's inline background set before lazyBg() is called.
const _lazyObs = (typeof IntersectionObserver !== "undefined")
  ? new IntersectionObserver((entries) =>
    {
      entries.forEach((en) => { if (en.isIntersecting) loadLazyBg(en.target); else releaseLazyBg(en.target); });
    }, { rootMargin: "300px" })
  : null;

function lazyBg(el, url)
{
  if (!el || !url) return;
  el.dataset.lazyUrl = url;
  if (el.dataset.ph === undefined) el.dataset.ph = el.style.backgroundImage || "";   // gradient placeholder
  if (_lazyObs) _lazyObs.observe(el);
  else setBg(el, url);   // no IntersectionObserver -> eager fallback
}
function loadLazyBg(el)
{
  const url = el.dataset.lazyUrl;
  if (!url || el.dataset.loaded === url) return;
  const img = new Image();
  el._lazyImg = img;
  img.onload = () =>
  {
    img.onload = img.onerror = null;
    if (!el.isConnected || el.dataset.lazyUrl !== url) return;
    el.style.backgroundImage = `url('${url}')`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.dataset.loaded = url;
  };
  img.onerror = () => { img.onload = img.onerror = null; img.src = ""; };   // keep placeholder; retry on next enter
  img.src = url;
}
function releaseLazyBg(el)
{
  if (el._lazyImg) { el._lazyImg.onload = el._lazyImg.onerror = null; el._lazyImg.src = ""; el._lazyImg = null; }
  if (el.dataset.loaded) { el.style.backgroundImage = el.dataset.ph || ""; delete el.dataset.loaded; }
}

// Kept for callers: searches now use the lazy loader too (which also fixes the old connection pile-up).
function cancelSearchImgs() {}
function searchThumb(el, url) { lazyBg(el, url); }

// config persistence (keyed by stable English section title, namespaced per account)
// Each account keeps its own feed layout (hidden sections, card/list modes, order). The namespace
// is a non-reversible hash of an opaque YTM account id - never a name or email - so TuneDeck stores
// no account data, only "which layout goes with which login". Signed out, it falls back to the
// un-suffixed keys (also what pre-namespacing installs already have).
let acctKey = "";
function hashAcct(s)
{
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;   // djb2
  return h.toString(36);
}
function cfgSuffix() { return acctKey ? "-" + acctKey : ""; }
function loadCfg()
{
  const sx = cfgSuffix();
  try
  {
    return {
      hidden: JSON.parse(localStorage.getItem("td-hidden" + sx) || "[]"),
      modes: JSON.parse(localStorage.getItem("td-modes" + sx) || "{}"),
      order: JSON.parse(localStorage.getItem("td-order" + sx) || "[]")
    };
  }
  catch (e) { return { hidden: [], modes: {}, order: [] }; }
}
function persist()
{
  const sx = cfgSuffix();
  try
  {
    localStorage.setItem("td-hidden" + sx, JSON.stringify(sections.filter(s => s.off).map(s => s.key)));
    // only non-default modes, so untouched sections are not persisted
    localStorage.setItem("td-modes" + sx, JSON.stringify(Object.fromEntries(sections.filter(s => s.mode !== "row").map(s => [s.key, s.mode]))));
    localStorage.setItem("td-order" + sx, JSON.stringify(sections.map(s => s.key)));
  }
  catch (e) {}
}

// sidebar playlists (populated from the ytm-playlists event)
let playlists = [];   // library playlists, from the ytm-playlists event
let lastPlaylistsSig = "";
const deletedPlaylistIds = new Set();   // VL-stripped ids deleted this session (never re-show them)
function stripVL(id) { return String(id || "").replace(/^VL/, ""); }
function isDeletedPlaylist(x) { return deletedPlaylistIds.has(stripVL(x.id)) || deletedPlaylistIds.has(stripVL(x.openId)); }
function renderPlaylists()
{
  const wrap = document.getElementById("playlists");
  wrap.innerHTML = "";
  playlists.forEach((p, i) =>
  {
    const el = document.createElement("div");
    el.className = "pl";
    const bg = p.thumb
      ? `background-image:url('${p.thumb}');background-size:cover;background-position:center;`
      : `background:${cover(i + 2)};`;
    el.innerHTML = `<div class="thumb" style="${bg}"></div>
                    <div class="info"><div class="n">${esc(p.title)}</div><div class="m">${esc(p.sub || "Playlist")}</div></div>`;
    el.addEventListener("click", () => openPlaylist(p.openId || p.id));
    wrap.appendChild(el);
  });
}

// playlist view (router: home <-> playlist)
const DOTS_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>';

function showHome()
{
  cancelSearchImgs();   // leaving a view -> drop any pending search thumbnail loads
  document.getElementById("homeView").hidden = false;
  document.getElementById("playlistView").hidden = true;
  document.querySelectorAll('.nav a[data-view]').forEach((a) => a.classList.toggle("active", a.dataset.view === "home"));
}

function openPlaylist(id)
{
  if (!id) return;
  document.getElementById("homeView").hidden = true;
  const v = document.getElementById("playlistView");
  v.hidden = false;
  v.innerHTML = `<p style="color:var(--text-dim)">Loading playlist…</p>`;
  if (DEMO) { renderPlaylistView(demoPlaylist()); return; }
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("open_playlist", { id: id });
}

// Library view (playlists / albums / subscriptions, + a Downloads tab)
let libraryData = { sections: [] };
function openLibrary()
{
  cancelSearchImgs();
  closeNpView();
  document.getElementById("homeView").hidden = true;
  const v = document.getElementById("playlistView");
  v.hidden = false;
  v.innerHTML = `<p style="color:var(--text-dim)">Loading your library…</p>`;
  if (DEMO) { renderLibraryView(demoLibrary()); return; }
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("open_library");
}

// Per-section cards/list layout, remembered across sessions (like the feed's toggle).
let libModes = {};
try { libModes = JSON.parse(localStorage.getItem("tunedeckLibModes") || "{}"); } catch (e) {}
function saveLibModes() { try { localStorage.setItem("tunedeckLibModes", JSON.stringify(libModes)); } catch (e) {} }

const LIB_TOGGLE = `<div class="layout-toggle">
  <button data-m="row" title="Large cards"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg></button>
  <button data-m="grid" title="Compact list"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="5" height="5" rx="1"/><rect x="10" y="5" width="11" height="3" rx="1.5"/><rect x="3" y="15" width="5" height="5" rx="1"/><rect x="10" y="16" width="11" height="3" rx="1.5"/></svg></button>
</div>`;

function libSection(sec, onClick)
{
  const s = document.createElement("section");
  s.className = "section";
  s.innerHTML = `<div class="section-head"><h3>${esc(sec.title)}</h3>${LIB_TOGGLE}</div><div class="items"></div>`;
  const items = s.querySelector(".items");
  let mode = libModes[sec.title] || "row";
  renderItems(items, sec.items, mode, onClick);
  s.querySelectorAll(".layout-toggle button").forEach((b) =>
  {
    if (b.dataset.m === mode) b.classList.add("on");
    b.addEventListener("click", () =>
    {
      mode = b.dataset.m;
      libModes[sec.title] = mode; saveLibModes();
      s.querySelectorAll(".layout-toggle button").forEach((x) => x.classList.toggle("on", x.dataset.m === mode));
      renderItems(items, sec.items, mode, onClick);
    });
  });
  return s;
}

function renderLibraryView(lib)
{
  libraryData = lib || { sections: [] };
  closeNpView();
  document.getElementById("homeView").hidden = true;
  const v = document.getElementById("playlistView");
  v.hidden = false;
  v.innerHTML = `
    <div class="lib-head">
      <h1>Library</h1>
    </div>
    <div id="libLibrary"></div>`;

  const libWrap = v.querySelector("#libLibrary");
  if (!libraryData.sections.length)
  {
    libWrap.innerHTML = `<p style="color:var(--text-dim)">Your library is empty.</p>`;
  }
  else libraryData.sections.forEach((sec) =>
  {
    const onClick = sec.route === "album" ? (it) => openAlbum(it.id)
      : sec.route === "artist" ? (it) => openArtist(it.id)
      : (it) => openPlaylist(it.id);
    libWrap.appendChild(libSection(sec, onClick));
  });
}

// Closes the full now-playing overlay so a page rendered in .main becomes visible.
function closeNpView()
{
  const npv = document.getElementById("npView");
  if (npv) npv.classList.remove("open");
  document.getElementById("npExpand")?.classList.remove("flip");
}

function openAlbum(id)
{
  if (!id) return;
  closeNpView();
  document.getElementById("homeView").hidden = true;
  const v = document.getElementById("playlistView");
  v.hidden = false;
  v.innerHTML = `<p style="color:var(--text-dim)">Loading album…</p>`;
  if (DEMO) { renderAlbumView(demoAlbum()); return; }
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("open_album", { id: id });
}

// Albums reuse the playlist view
function renderAlbumView(a)
{
  if (!a) return;
  renderPlaylistView({
    title: a.title,
    author: a.artist,
    authors: a.artists,
    meta: a.year ? `Album • ${a.year}` : "Album",
    cover: a.cover,
    id: a.playId,
    tracks: a.tracks,
    reorder: false
  });
}

// Search: ask the engine, then render a flat mixed results list.
function doSearch(query)
{
  query = (query || "").trim();
  if (!query) { showHome(); return; }
  closeNpView();
  document.getElementById("homeView").hidden = true;
  const v = document.getElementById("playlistView");
  v.hidden = false;
  v.innerHTML = `<p style="color:var(--text-dim)">Searching…</p>`;
  if (DEMO) { renderSearchView(demoSearch(query)); return; }
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("search", { query });
}

// Routes a search result by kind/id: album/artist/playlist pages, else play the song.
function routeSearchItem(it)
{
  if (it.kind === "b" && /^MPRE/.test(String(it.id))) openAlbum(it.id);
  else if (it.kind === "b" && /^UC/.test(String(it.id))) openArtist(it.id);
  else if ((it.kind === "b" && String(it.id).indexOf("VL") === 0) || it.kind === "p") openPlaylist(it.id);
  else playFromUI(it);
}

// Label for a mixed search result.
function searchKind(it)
{
  if (it.kind === "v") return "Song";
  const id = String(it.id);
  if (/^MPRE/.test(id)) return "Album";
  if (/^UC/.test(id)) return "Artist";
  return "Playlist";
}

// A search result row (album-track sized, single column); click routes by type.
function searchRow(it, i)
{
  const kind = searchKind(it);
  const row = document.createElement("div");
  row.className = "trk search-row" + (kind === "Artist" ? " is-artist" : "");
  const by = subHtml(it);
  row.innerHTML = `
    <div class="trk-thumb" style="background:${cover(i)};"></div>
    <div class="trk-info"><div class="t">${esc(it.title)}</div><div class="s"><span class="skind">${kind}</span>${by ? " · " + by : ""}</div></div>
    <button class="trk-menu" title="More">${DOTS_SVG}</button>`;
  searchThumb(row.querySelector(".trk-thumb"), it.thumb);
  row.querySelector(".trk-info").addEventListener("click", () => routeSearchItem(it));
  row.querySelector(".trk-thumb").addEventListener("click", () => routeSearchItem(it));
  row.querySelector(".trk-menu").addEventListener("click", (e) => { e.stopPropagation(); openItemMenu(e.currentTarget, it); });
  wireArtistLinks(row);
  return row;
}

// Big "Top result" card: cover + title/subtitle + Play (or Shuffle for artists).
function renderSearchCard(container, top)
{
  const el = document.createElement("div");
  el.className = "search-card" + (searchKind(top) === "Artist" ? " is-artist" : "");
  const playLabel = top.playKind === "s" ? "Shuffle" : "Play";
  const playIc = top.playKind === "s"
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  el.innerHTML = `
    <div class="sc-cover" style="background:${cover(1)};"></div>
    <div class="sc-info">
      <div class="sc-kind">${searchKind(top)}</div>
      <div class="sc-title">${esc(top.title)}</div>
      <div class="sc-sub">${esc(top.sub || "")}</div>
      <div class="sc-actions">${top.playId ? `<button class="pl-play sc-play">${playIc}${playLabel}</button>` : ""}</div>
    </div>`;
  searchThumb(el.querySelector(".sc-cover"), top.thumb);
  el.querySelector(".sc-cover").addEventListener("click", () => routeSearchItem(top));
  el.querySelector(".sc-title").addEventListener("click", () => routeSearchItem(top));
  const play = el.querySelector(".sc-play");
  if (play) play.addEventListener("click", () => playFromUI({ id: top.playId, kind: top.playKind || "p" }));
  container.appendChild(el);
}

function renderSearchView(data)
{
  if (!data) return;
  cancelSearchImgs();   // drop the previous search's in-flight thumbnail loads
  closeNpView();
  document.getElementById("homeView").hidden = true;
  const v = document.getElementById("playlistView");
  v.hidden = false;
  v.innerHTML = `
    <button class="pl-back" id="plBack"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>Back</button>
    <h2 class="search-h">Results for "${esc(data.query || "")}"</h2>
    <div id="searchTop"></div>
    <div id="searchBody"></div>`;
  v.querySelector("#plBack").addEventListener("click", showHome);

  const results = data.results || [];
  if (data.top && data.top.id) renderSearchCard(v.querySelector("#searchTop"), data.top);
  if (!results.length && !(data.top && data.top.id))
  { v.querySelector("#searchBody").innerHTML = `<p style="color:var(--text-dim)">Nothing found.</p>`; return; }

  // group the flat results by type, render each non-empty group under a header
  const groups = {};
  results.forEach((it) => { const k = searchKind(it); (groups[k] || (groups[k] = [])).push(it); });
  const body = v.querySelector("#searchBody");
  [["Song", "Songs"], ["Album", "Albums"], ["Artist", "Artists"], ["Playlist", "Playlists"]].forEach(([k, label]) =>
  {
    const items = groups[k];
    if (!items || !items.length) return;
    const sec = document.createElement("section");
    sec.className = "artist-shelf";
    sec.innerHTML = `<h3>${label}</h3><div class="pl-tracks"></div>`;
    const box = sec.querySelector(".pl-tracks");
    items.forEach((it, i) => box.appendChild(searchRow(it, i)));
    body.appendChild(sec);
  });
}

function openArtist(id)
{
  if (!id) return;
  closeNpView();
  document.getElementById("homeView").hidden = true;
  const v = document.getElementById("playlistView");
  v.hidden = false;
  v.innerHTML = `<p style="color:var(--text-dim)">Loading artist…</p>`;
  if (DEMO) { renderArtistView(demoArtist()); return; }
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core) core.invoke("open_artist", { id: id });
}

// Routes a click on an artist-page card by id shape: album -> album page, artist -> artist
// page, playlist -> shuffle, otherwise play.
function routeArtistItem(it)
{
  if (it.kind === "b" && /^MPRE/.test(String(it.id))) openAlbum(it.id);
  else if (it.kind === "b" && /^UC/.test(String(it.id))) openArtist(it.id);
  else if (it.kind === "p" || (it.kind === "b" && String(it.id).indexOf("VL") === 0)) playFromUI({ id: it.id, kind: "s" });
  else playFromUI(it);
}

// Artist page: hero header + a "Top songs" track list + carousels (albums, singles, ...).
function renderArtistView(a)
{
  if (!a) return;
  const v = document.getElementById("playlistView");
  // Full-width banner shown whole at its natural height (like YTM) - the name/actions overlay
  // the bottom. Uncropped, so no badly-cut faces.
  const heroImg = a.cover ? `<img class="artist-hero-img" src="${a.cover}" alt="">` : "";
  v.innerHTML = `
    <button class="pl-back" id="plBack"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>Back</button>
    <div class="artist-hero">
      ${heroImg}
      <div class="artist-hero-inner">
        <h1>${esc(a.name)}</h1>
        <div class="artist-sub">${esc(a.listeners || "")}</div>
        <div class="pl-actions">
          <button class="pl-play" id="arPlay"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Play</button>
          <button class="pl-shuffle" id="arRadio"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M19.1 4.9a10 10 0 0 1 0 14.2"/></svg>Radio</button>
        </div>
      </div>
    </div>
    <div id="artistBody"></div>`;

  const body = v.querySelector("#artistBody");
  if (a.topSongs && a.topSongs.length)
  {
    const sec = document.createElement("section");
    sec.className = "artist-shelf";
    sec.innerHTML = `<h3>Top songs</h3><div class="pl-tracks" id="arTop"></div>`;
    body.appendChild(sec);
    const tw = sec.querySelector("#arTop");
    a.topSongs.forEach((t, i) => tw.appendChild(trackRow(t, i, false)));
  }
  (a.shelves || []).forEach((sh) =>
  {
    if (!sh.items || !sh.items.length) return;
    const sec = document.createElement("section");
    sec.className = "artist-shelf";
    sec.innerHTML = `<h3>${esc(sh.title)}</h3><div class="items"></div>`;
    body.appendChild(sec);
    renderItems(sec.querySelector(".items"), sh.items, "row", routeArtistItem);
  });

  v.querySelector("#plBack").addEventListener("click", showHome);
  v.querySelector("#arPlay").addEventListener("click", () => { if (a.topSongs && a.topSongs[0]) playFromUI(a.topSongs[0]); });
  v.querySelector("#arRadio").addEventListener("click", () => { if (a.topSongs && a.topSongs[0]) itemAction("radio", a.topSongs[0].id); });
}

let currentPlaylist = null;

// After a track drag: reorder the local track list to match the DOM (view only; moving
// tracks in the actual YouTube Music playlist needs the edit API - a later step).
function commitTrackOrder(row)
{
  if (!currentPlaylist) return;
  const ids = [...document.getElementById("plTracks").children].map((r) => r.dataset.id);
  const byId = {};
  currentPlaylist.tracks.forEach((t) => { byId[t.id] = t; });
  currentPlaylist.tracks = ids.map((id) => byId[id]).filter(Boolean);
  // persist to the real playlist (editable only): move the dragged track before its new neighbour
  if (currentPlaylist.editable && row && row.dataset.setvid)
  {
    const next = row.nextElementSibling;
    playlistEdit("move", currentPlaylist.id, row.dataset.setvid, next ? (next.dataset.setvid || "") : "");
  }
}

// Byline HTML: clickable artist links when the item carries `artists`, else the plain sub.
function subHtml(item)
{
  if (item.artists && item.artists.length)
    return item.artists.map((a) => `<a href="#" class="meta-link" data-aid="${esc(a.id)}">${esc(a.name)}</a>`).join(" & ");
  return esc(item.sub || "");
}
// Wires the artist links inside a scope; stopPropagation so the row/card click doesn't also fire.
function wireArtistLinks(scope)
{
  scope.querySelectorAll(".meta-link[data-aid]").forEach((el) =>
    el.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openArtist(el.dataset.aid); }));
}

// Fills an element with clickable artist links from np.artists (or plain np.author fallback).
function renderNpArtists(el, np)
{
  if (!el) return;
  if (np.artists && np.artists.length)
  {
    el.innerHTML = np.artists.map((a) => `<a href="#" class="meta-link" data-aid="${esc(a.id)}">${esc(a.name)}</a>`).join(" & ");
    wireArtistLinks(el);
  }
  else el.textContent = np.author || "-";
}

// One track row (used by playlist, album and artist pages). reorder adds the drag grip.
function trackRow(t, i, reorder, onRemove)
{
  const row = document.createElement("div");
  row.className = "trk";
  row.dataset.id = t.id || "";
  row.dataset.setvid = t.setVideoId || "";   // for playlist reorder/remove
  const bg = t.thumb
    ? `background-image:url('${t.thumb}');background-size:cover;background-position:center;`
    : `background:${cover(i)};`;
  row.innerHTML = `
    ${reorder ? '<span class="trk-grip" title="Drag to reorder"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>' : ''}
    <span class="trk-idx">${i + 1}</span>
    <div class="trk-thumb" style="${bg}"></div>
    <div class="trk-info"><div class="t">${esc(t.title)}</div><div class="s">${subHtml(t)}</div></div>
    <span class="trk-dur">${esc(t.dur || "")}</span>
    <button class="trk-menu" title="More">${DOTS_SVG}</button>`;
  row.querySelector(".trk-info").addEventListener("click", () => playFromUI({ id: t.id, kind: t.kind }));
  row.querySelector(".trk-thumb").addEventListener("click", () => playFromUI({ id: t.id, kind: t.kind }));
  row.querySelector(".trk-menu").addEventListener("click", (e) =>
  {
    e.stopPropagation();
    const X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    openItemMenu(e.currentTarget, t, onRemove
      ? { extra: [{ label: "Remove from playlist", ic: X, run: () => onRemove(t, row) }] }
      : undefined);
  });
  wireArtistLinks(row);
  return row;
}

function renderPlaylistView(pl)
{
  if (!pl) return;
  currentPlaylist = pl;
  const canReorder = (pl.reorder !== false) && !!pl.editable;   // only the user's own playlists persist a reorder
  const onRemove = pl.editable ? (t, row) => { playlistEdit("remove", pl.id, t.setVideoId, t.id); row.remove(); } : null;
  const v = document.getElementById("playlistView");
  const coverBg = pl.cover
    ? `background-image:url('${pl.cover}');background-size:cover;background-position:center;`
    : `background:${cover(0)};`;
  const authorHtml = (pl.authors && pl.authors.length)
    ? pl.authors.map((a) => `<a href="#" class="meta-link" data-aid="${esc(a.id)}">${esc(a.name)}</a>`).join(" & ")
    : pl.author
      ? (pl.authorId ? `<a href="#" class="meta-link" data-aid="${esc(pl.authorId)}">${esc(pl.author)}</a>` : esc(pl.author))
      : "";
  const sub = [authorHtml, pl.meta ? esc(pl.meta) : ""].filter(Boolean).join(" · ");
  v.innerHTML = `
    <button class="pl-back" id="plBack"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>Back</button>
    <div class="pl-header">
      <div class="pl-cover" style="${coverBg}"></div>
      <div class="pl-meta">
        <h1>${esc(pl.title)}</h1>
        <div class="pl-sub">${sub}</div>
        <div class="pl-actions">
          <button class="pl-play" id="plPlay"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>Play</button>
          <button class="pl-shuffle" id="plShuffle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>Shuffle</button>
          ${pl.editable ? `<button class="pl-del" id="plDelete" title="Delete playlist"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6M10 11v6M14 11v6"/></svg>Delete</button>` : ""}
        </div>
      </div>
    </div>
    <div class="pl-tracks" id="plTracks"></div>`;

  const tw = v.querySelector("#plTracks");
  pl.tracks.forEach((t, i) => tw.appendChild(trackRow(t, i, canReorder, onRemove)));
  if (canReorder) makeSortable(tw, ".trk-grip", commitTrackOrder);   // #plTracks is rebuilt each open, so attach here

  v.querySelector("#plBack").addEventListener("click", showHome);
  v.querySelector("#plPlay").addEventListener("click", () => playFromUI({ id: pl.id, kind: "p" }));
  v.querySelector("#plShuffle").addEventListener("click", () => playFromUI({ id: pl.id, kind: "s" }));
  const delBtn = v.querySelector("#plDelete");
  if (delBtn) delBtn.addEventListener("click", () =>
    openConfirm(`Delete "${pl.title}"?`, "This permanently removes the playlist from your library.", "Delete", () =>
    {
      deletePlaylistCmd(pl.id);
      deletedPlaylistIds.add(stripVL(pl.id));                  // and keep it out of the sidebar for good
      playlists = playlists.filter((x) => !isDeletedPlaylist(x));
      lastPlaylistsSig = "";                                    // force the next emit through
      renderPlaylists();
      toast("Deleting playlist…");
      showHome();
    }));
  wireArtistLinks(v.querySelector(".pl-header"));
}

// home sections (populated from the feed)
let sections = [];
let lastFeed = null;         // the last feed array, so it can be re-applied when the account namespace changes
let lastFeedSig = "";        // skip re-rendering home when the feed is unchanged (e.g. after a navigation)
let authKnown = false;       // true once the first ytm-auth tick has reported signed-in vs signed-out

function renderItems(container, items, mode, onClick)
{
  container.className = mode;                // "row" or "grid"
  container.innerHTML = "";
  items.forEach((it, i) =>
  {
    const el = document.createElement("div");
    const bg = `background:${cover(i)};`;   // gradient placeholder; the real thumb loads (with retry) below
    if (mode === "row")
    {
      el.className = "card";
      el.innerHTML = `<div class="art" style="${bg}">
          <div class="play-ov"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
          <button class="card-menu" title="More">${DOTS_SVG}</button>
        </div><div class="t">${esc(it.title)}</div><div class="s">${subHtml(it)}</div>`;
    }
    else
    {
      el.className = "grow";
      el.innerHTML = `<div class="thumb" style="${bg}"></div>
        <div class="info"><div class="t">${esc(it.title)}</div><div class="s">${subHtml(it)}</div></div>
        <button class="grow-menu" title="More">${DOTS_SVG}</button>`;
    }
    lazyBg(el.querySelector(".art, .thumb"), it.thumb);   // lazy: load only when scrolled into view
    const menuBtn = el.querySelector(".card-menu, .grow-menu");
    if (menuBtn) menuBtn.addEventListener("click", (e) => { e.stopPropagation(); openItemMenu(e.currentTarget, it); });
    wireArtistLinks(el);
    el.addEventListener("click", () =>
    {
      if (onClick) { onClick(it); return; }
      // in the feed, playlist-like items (mixes + playlists) shuffle-play - hearing a playlist
      // in the same order every time is terrible, and mixes don't mind. Songs play; albums
      // navigate. Opening the playlist page is sidebar-only.
      const shuffleIt = it.kind === "p" || (it.kind === "b" && String(it.id).indexOf("VL") === 0);
      if (shuffleIt) playFromUI({ id: it.id, kind: "s" });
      else playFromUI(it);
    });
    container.appendChild(el);
  });
}

function renderSections()
{
  const wrap = document.getElementById("sections");
  wrap.innerHTML = "";
  if (!sections.length)
  {
    // Signed out there is no feed to load, so show a sign-in prompt instead of a permanent
    // "Loading". authKnown gates it until the first auth tick, so the prompt never flashes before
    // a signed-in session is known.
    if (authKnown && !signedIn)
    {
      wrap.innerHTML = `<div class="home-empty">
        <p>Log in to YouTube Music to load your home.</p>
        <button class="pl-play" id="homeSignIn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>Log in</button>
      </div>`;
      const b = document.getElementById("homeSignIn");
      if (b) b.addEventListener("click", () => { const c = window.__TAURI__ && window.__TAURI__.core; if (c) c.invoke("sign_in"); });
    }
    else wrap.innerHTML = `<p style="color:var(--text-dim)">Loading your home…</p>`;
    return;
  }
  sections.forEach(sec =>
  {
    const s = document.createElement("section");
    s.className = "section";
    s.hidden = !!sec.off;
    s.innerHTML = `
      <div class="section-head">
        <h3>${esc(sec.label)}</h3>
        <div class="layout-toggle">
          <button data-m="row" title="Large cards"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg></button>
          <button data-m="grid" title="Compact list"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="5" height="5" rx="1"/><rect x="10" y="5" width="11" height="3" rx="1.5"/><rect x="3" y="15" width="5" height="5" rx="1"/><rect x="10" y="16" width="11" height="3" rx="1.5"/></svg></button>
        </div>
        <button class="hide-btn" title="Hide this section"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg></button>
      </div>
      <div class="items"></div>`;
    const items = s.querySelector(".items");
    renderItems(items, sec.items, sec.mode);
    s.querySelector(".hide-btn").addEventListener("click", () =>
    {
      sec.off = true;
      renderSections();
      persist();
    });
    s.querySelectorAll(".layout-toggle button").forEach(b =>
    {
      if (b.dataset.m === sec.mode) b.classList.add("on");
      b.addEventListener("click", () =>
      {
        sec.mode = b.dataset.m;
        s.querySelectorAll(".layout-toggle button").forEach(x => x.classList.toggle("on", x.dataset.m === sec.mode));
        renderItems(items, sec.items, sec.mode);
        persist();
      });
    });
    wrap.appendChild(s);
  });
}

const ARROW_UP = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 15l6-6 6 6"/></svg>';
const ARROW_DOWN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>';

// Moves an active row one step by swapping it with its neighbour in the DOM and the array,
// WITHOUT a full re-render - so rows toggled off (dimmed, pending) don't jump to Hidden.
function moveSection(btn, dir)
{
  const row = btn.closest(".cfg-row");
  const sibling = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!row || !sibling) return;
  const fi = sections.findIndex((s) => s.key === row.dataset.key);
  const ti = sections.findIndex((s) => s.key === sibling.dataset.key);
  if (fi < 0 || ti < 0) return;
  const tmp = sections[fi]; sections[fi] = sections[ti]; sections[ti] = tmp;
  if (dir < 0) row.parentNode.insertBefore(row, sibling);
  else row.parentNode.insertBefore(sibling, row);
  persist();
  renderSections();          // reflect new order on home; the Customize DOM is already reordered
}

function rowAtY(list, y)
{
  for (const row of list.children)
  {
    const r = row.getBoundingClientRect()
    const centX = r.top + r.height / 2;
    if (y < centX)  return row;
  }
  return null;
}

// Makes a list reorderable by dragging a handle: a floating ghost follows the cursor,
// the placeholder row moves live, onDrop fires on release.
function makeSortable(list, handleSel, onDrop)
{
  list.addEventListener("pointerdown", (e) =>
  {
    if (e.button !== 0) return;
    const handle = e.target.closest(handleSel);
    if (!handle || !list.contains(handle)) return;

    let row = handle;
    while (row.parentElement && row.parentElement !== list) row = row.parentElement;
    if (row.parentElement !== list) return;

    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}

    const rect = row.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const scroller = list.closest(".main") || list;

    const ghost = row.cloneNode(true);
    ghost.classList.add("lift-ghost");
    ghost.style.width = rect.width + "px";
    ghost.style.left = rect.left + "px";
    ghost.style.top = (e.clientY - offsetY) + "px";
    document.body.appendChild(ghost);
    row.classList.add("lift-placeholder");

    let scrollDir = 0;
    const tick = setInterval(() => { if (scrollDir) scroller.scrollTop += scrollDir * 7; }, 16);

    function onMove(ev)
    {
      ghost.style.top = (ev.clientY - offsetY) + "px";
      const before = rowAtY(list, ev.clientY);
      if (before !== row)
      {
        if (before) list.insertBefore(row, before);
        else list.appendChild(row);
      }
      const sr = scroller.getBoundingClientRect();
      scrollDir = ev.clientY < sr.top + 40 ? -1 : ev.clientY > sr.bottom - 40 ? 1 : 0;
    }
    function onUp()
    {
      clearInterval(tick);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
      ghost.remove();
      row.classList.remove("lift-placeholder");
      onDrop(row);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

// After a Customize drag: rebuild the sections order from the DOM (active rows first,
// committed-hidden ones keep their order after).
function commitCustomizeOrder()
{
  const activeKeys = [...document.getElementById("cfgActive").children].map((r) => r.dataset.key);
  const inActive = new Set(activeKeys);
  const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));
  const ordered = activeKeys.map((k) => byKey[k]).filter(Boolean);
  const rest = sections.filter((s) => !inActive.has(s.key));
  sections = ordered.concat(rest);
  persist();
  renderSections();
}

// Builds one Customize row: reorder arrows (active only), name + content preview, on/off switch.
function buildCfgRow(sec, i, active)
{
  const row = document.createElement("div");
  row.className = "cfg-row";
  row.dataset.label = sec.label;
  row.dataset.key = sec.key;
  const kind = sectionKindLabel(sec.items);
  const prev = (sec.items || []).slice(0, 2).map((it) => cleanTitle(it.title)).filter(Boolean);
  const previewHtml = prev.map((t) => `<span>${esc(t)}</span>`).join('<span class="cfg-dot">·</span>');
  const controls = active
    ? `<span class="cfg-grip" title="Drag to reorder"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>`
    : `<span class="cfg-arrows-spacer"></span>`;
  row.innerHTML = `
    ${controls}
    <div class="cfg-info">
      <div class="cfg-name-row"><span class="name">${esc(sec.label)}</span><span class="cfg-kind">${kind}</span></div>
      ${previewHtml ? `<div class="cfg-preview">${previewHtml}</div>` : ""}
    </div>
    <span class="switch"><input type="checkbox" id="cfg-sw-${i}" ${sec.off ? "" : "checked"}><label for="cfg-sw-${i}"></label></span>`;
  const cb = row.querySelector("input");
  cb.addEventListener("change", () =>
  {
    sec.off = !cb.checked;
    row.classList.toggle("cfg-off", sec.off);   // dim in place; commit to Hidden on Apply/reopen
    renderSections();
    persist();
    // keep the Hidden header (and its Apply button) reachable the moment anything is off
    document.getElementById("cfgHiddenHead").hidden = !sections.some((s) => s.off);
  });
  return row;
}

// Hides Customize rows that don't match the search box; applies to both lists.
function filterCfg()
{
  const q = (document.getElementById("cfgSearch").value || "").toLowerCase();
  document.querySelectorAll("#customizePanel .cfg-row").forEach(r =>
  {
    const name = (r.dataset.label || "").toLowerCase();
    r.style.display = (!q || name.includes(q)) ? "" : "none";
  });
}

function renderCustomizeRows()
{
  const active = document.getElementById("cfgActive");
  const hiddenList = document.getElementById("cfgHidden");
  active.innerHTML = "";
  hiddenList.innerHTML = "";

  // active: visible sections in their real order (reorder via arrows)
  sections.forEach((sec, i) => { if (!sec.off) active.appendChild(buildCfgRow(sec, i, true)); });

  // hidden: disabled sections, alphabetical
  const hidden = sections
    .map((sec, i) => ({ sec, i }))
    .filter((x) => x.sec.off)
    .sort((a, b) => a.sec.label.localeCompare(b.sec.label));
  hidden.forEach(({ sec, i }) => hiddenList.appendChild(buildCfgRow(sec, i, false)));

  document.getElementById("cfgHiddenHead").hidden = hidden.length === 0;
  filterCfg();
}

// apply the live feed, keeping the user's saved config
function applyFeed(feed)
{
  if (!Array.isArray(feed)) return;
  lastFeed = feed;   // keep it so an account change can re-key the layout without a round-trip to the engine
  document.getElementById("reloadBtn")?.classList.remove("spin");   // feed arrived -> stop the reload spinner
  const sig = feed.map((s) => (s.key || s.title) + ":" + (s.items || []).map((i) => i.id).join(",")).join("|");
  if (sig === lastFeedSig) return;   // identical feed -> don't rebuild the DOM (keeps scroll position)
  lastFeedSig = sig;
  const cfg = loadCfg();
  sections = feed.map(sec =>
  {
    const key = sec.key || sec.title;
    return {
      key: key,
      label: sec.label || sec.title,
      items: sec.items || [],
      mode: cfg.modes[key] || "row",
      off: cfg.hidden.includes(key)
    };
  });
  // freeze order: known sections keep their saved position, new ones append in feed order
  const pos = (k) => { const i = cfg.order.indexOf(k); return i === -1 ? Infinity : i; };
  sections.sort((a, b) => pos(a.key) - pos(b.key));
  persist();                    // writes the frozen (and now extended) order back
  renderSections();
  renderCustomizeRows();
}

// now playing (live)
function fmt(sec)
{
  if (!sec || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

let currentNp = null;
// videoId -> liked, set when the heart is toggled. The like/unlike API does not update YTM's own
// player-bar like-status, so the snapshot keeps reporting the old value; this override keeps the
// heart on the user's choice until the track changes.
const likeState = Object.create(null);
const NP_HEART = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
const NP_HEART_FILLED = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';

function renderNpLike()
{
  const b = document.querySelector(".np .like");
  const liked = !!(currentNp && currentNp.liked);
  b.innerHTML = liked ? NP_HEART_FILLED : NP_HEART;
  b.classList.toggle("liked", liked);
}

// Gesture wiring for one queue row: a small move counts as a tap (jump to the track),
// a horizontal drag past a threshold swipes the row away (remove from queue).
function wireQueueRow(row, i)
{
  let sx = 0, sy = 0, active = false, mode = null;   // mode: null | "swipe" | "cancel"
  const SLOP = 6;   // px of movement before a gesture counts as a swipe rather than a tap

  row.addEventListener("pointerdown", (e) =>
  {
    if (e.button !== 0 || e.target.closest(".q-menu") || e.target.closest(".meta-link")) return;
    sx = e.clientX; sy = e.clientY; active = true; mode = null;
    try { row.setPointerCapture(e.pointerId); } catch (err) {}
  });

  row.addEventListener("pointermove", (e) =>
  {
    if (!active) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!mode)
    {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      mode = Math.abs(dx) > Math.abs(dy) ? "swipe" : "cancel";   // vertical intent is not a swipe
    }
    if (mode === "swipe")
    {
      row.style.transform = `translateX(${dx}px)`;
      row.style.opacity = String(Math.max(0.15, 1 - Math.abs(dx) / row.offsetWidth));
    }
  });

  row.addEventListener("pointerup", (e) =>
  {
    if (!active) return;
    active = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;

    if (mode === "swipe")
    {
      if (Math.abs(dx) > row.offsetWidth * 0.35)   // far enough: remove
      {
        row.style.transition = "transform .18s, opacity .18s";
        row.style.transform = `translateX(${dx > 0 ? row.offsetWidth : -row.offsetWidth}px)`;
        row.style.opacity = "0";
        queueRemove(i);
        setTimeout(() => row.remove(), 180);
        return;
      }
      row.style.transition = "transform .18s, opacity .18s";   // snap back
      row.style.transform = "";
      row.style.opacity = "";
      setTimeout(() => { row.style.transition = ""; }, 180);
    }
    else if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP)
    {
      queueJump(i);   // tap
    }
  });
}

// Renders the Up Next list in the NP view. Items: {title, sub, thumb, cur, auto, id}.
function renderQueue(items)
{
  const wrap = document.getElementById("npvQueue");
  if (!wrap) return;
  wrap.innerHTML = "";
  let autoShown = false;
  (items || []).forEach((t, i) =>
  {
    if (t.auto && !autoShown)
    {
      autoShown = true;
      const div = document.createElement("div");
      div.className = "q-divider";
      div.textContent = "Autoplay";
      wrap.appendChild(div);
    }
    const row = document.createElement("div");
    row.className = "q-row" + (t.cur ? " q-cur" : "") + (t.auto ? " q-auto" : "");
    const bg = t.thumb
      ? `background-image:url('${t.thumb}');background-size:cover;background-position:center;`
      : `background:${cover(i)};`;
    row.innerHTML = `<div class="q-thumb" style="${bg}"></div>
      <div class="q-info"><div class="t">${esc(t.title)}</div><div class="s">${subHtml(t)}</div></div>
      <button class="q-menu" title="More">${DOTS_SVG}</button>`;
    wireQueueRow(row, i);
    wireArtistLinks(row);
    row.querySelector(".q-menu").addEventListener("click", (e) =>
    {
      e.stopPropagation();
      const X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      const PN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h11M4 12h11M4 18h7M16 15l5 3-5 3z"/></svg>';
      openItemMenu(e.currentTarget, { id: t.id, kind: "v", title: t.title, liked: t.liked, artists: t.artists, album: t.album }, {
        noQueueAdd: true,   // queue rows use index-based move/remove, not videoId add
        extra: [
          { label: "Play next", ic: PN, run: () => queueMenu(i, "move") },
          { label: "Remove from queue", ic: X, run: () => { queueRemove(i); row.remove(); } }
        ]
      });
    });
    wrap.appendChild(row);
  });
}

function updateNowPlaying(np)
{
  if (!np) return;
  currentNp = np;
  if (np.id && np.id in likeState) currentNp.liked = likeState[np.id];   // keep a just-toggled heart from reverting
  document.getElementById("npTitle").textContent = np.title || "Nothing playing";
  renderNpArtists(document.getElementById("npArtist"), np);
  const cur = np.cur || 0, dur = np.dur || 0;
  document.getElementById("npCur").textContent = fmt(cur);
  document.getElementById("npDur").textContent = fmt(dur);
  //if (!seekDragging)
    document.getElementById("npFill").style.width = dur > 0 ? `${Math.min(100, (cur / dur) * 100)}%` : "0%";
  document.getElementById("playBtn").classList.toggle("playing", !!np.playing);
  if (typeof np.vol === "number" && !volDragging)
  {
    currentVol = np.vol;
    document.querySelector(".vol .fill").style.width = np.vol + "%";
    renderVolIcon(np.vol);
  }
  document.getElementById("npArt").style.backgroundImage = np.cover ? `url("${np.cover}")` : "none";
  renderNpLike();

  const npvCover = document.getElementById("npvCover");
  if (npvCover)
  {
    npvCover.style.backgroundImage = np.cover ? `url("${np.cover}")` : "none";
    document.getElementById("npvTitle").textContent = np.title || "Nothing playing";
    renderNpArtists(document.getElementById("npvArtist"), np);
    const npvMeta = document.getElementById("npvMeta");
    if (npvMeta)
    {
      if (np.album)
      {
        const yr = np.year ? ` • ${esc(np.year)}` : "";
        npvMeta.innerHTML = np.albumId
          ? `<a href="#" class="meta-link">${esc(np.album)}</a>${yr}`
          : `${esc(np.album)}${yr}`;
        npvMeta.style.display = "";
        const link = npvMeta.querySelector(".meta-link");
        if (link) link.addEventListener("click", (e) => { e.preventDefault(); openAlbum(np.albumId); });
      }
      else { npvMeta.textContent = ""; npvMeta.style.display = "none"; }
    }
  }
}

// Login state, driven by the reader's ytm-auth event. The avatar's click action and
// tooltip follow it.
let signedIn = false;
let lastAcct = null;   // last seen account hash, to tell a switch from the first login
function updateAvatar()
{
  const a = document.querySelector(".avatar");
  if (a) a.title = "Account";
  const btn = document.getElementById("acctAction");
  if (btn) { btn.textContent = signedIn ? "Log out" : "Log in"; btn.classList.toggle("logout", signedIn); }
  const sw = document.getElementById("acctSwitch");
  if (sw) sw.hidden = !signedIn;   // switching only makes sense while signed in
}

// listen to the engine
function listenToEngine()
{
  const ev = window.__TAURI__ && window.__TAURI__.event;
  if (!ev) return;                          // running outside Tauri (plain browser preview)
  ev.listen("ytm-state", (e) => { updateNowPlaying(e.payload); dispatchJsTrack(e.payload); });
  ev.listen("ytm-feed", (e) => applyFeed(e.payload));
  ev.listen("ytm-playlists", (e) =>
  {
    let p = e.payload || [];
    if (deletedPlaylistIds.size) p = p.filter((x) => !isDeletedPlaylist(x));   // never resurrect a deleted one
    const sig = p.map((x) => (x.id || "") + (x.title || "")).join("|");
    if (sig === lastPlaylistsSig) return;
    lastPlaylistsSig = sig;
    playlists = p;
    renderPlaylists();
  });
  ev.listen("ytm-playlist", (e) => renderPlaylistView(e.payload));
  ev.listen("ytm-album", (e) => renderAlbumView(e.payload));
  ev.listen("ytm-artist", (e) => renderArtistView(e.payload));
  ev.listen("ytm-search", (e) => renderSearchView(e.payload));
  ev.listen("ytm-library", (e) => renderLibraryView(e.payload));
  ev.listen("ytm-status", (e) =>
  {
    const bar = document.getElementById("offlineBar");
    if (bar) bar.hidden = (e.payload || {}).online !== false;   // show only when offline
    reinjectEngineScripts();   // re-apply plugin engine scripts after an engine reload (idempotent)
  });
  ev.listen("ytm-queue", (e) => { renderQueue(e.payload); dispatchJsQueue(e.payload); });
  ev.listen("ytm-auth", (e) =>
  {
    const p = e.payload || {};
    signedIn = !!p.signedIn;
    authKnown = true;
    const h = signedIn && p.acct ? hashAcct(String(p.acct)) : "";
    const changed = h !== acctKey;
    acctKey = h;                 // feed config is namespaced per account from here on
    updateAvatar();
    if (!sections.length) renderSections();   // swap the "Loading" placeholder for the login nudge, or back
    if (changed && signedIn && lastAcct !== null && !DEMO)
    {
      // Account switch: pull the new account's feed (content differs, not just the layout).
      lastFeedSig = "";
      const core = window.__TAURI__ && window.__TAURI__.core;
      if (core) core.invoke("reload_feed");
    }
    else if (changed && lastFeed && !DEMO)
    {
      // The config namespace just became known (first auth tick) or changed: re-apply the current
      // feed so hidden/order come from this account's saved layout, not the namespace read before
      // auth landed. Without this a feed that arrived before ytm-auth keeps the wrong layout, and
      // hidden sections reappear.
      lastFeedSig = "";
      applyFeed(lastFeed);
    }
    lastAcct = h;
  });
  ev.listen("ytm-accounts", (e) => { if (accountsRequested) { accountsRequested = false; openAccountPicker(e.payload || []); } });
  ev.listen("ytm-playlist-created", (e) =>
  {
    const o = e.payload || {};
    toast("Playlist created");
    if (o.id) openPlaylist(o.id);   // jump to the new (empty) playlist as confirmation
  });
  ev.listen("ytm-playlist-deleted", () => toast("Playlist deleted"));
  // request the feed now that the listeners are attached
  ev.emit("ui-ready");
  setTimeout(() => ev.emit("ui-ready"), 1500);   // retry once in case the reader wasn't listening yet
}

// theme + accent
function setAccent(color)
{
  document.documentElement.style.setProperty("--accent", color);
  try { localStorage.setItem("td-accent", color); } catch (e) {}
}
function applyTheme(t)
{
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
  document.querySelectorAll("#themeSeg button").forEach(b => b.classList.toggle("on", b.dataset.themeOpt === (t || "system")));
}

function wireControls()
{
  document.getElementById("customizeBtn").addEventListener("click", () =>
  {
    const p = document.getElementById("customizePanel");
    p.hidden = !p.hidden;
    if (!p.hidden) renderCustomizeRows();   // rebuild on open so toggled sections move to the right list
  });

  document.getElementById("cfgSearch").addEventListener("input", filterCfg);
  document.getElementById("cfgApply").addEventListener("click", renderCustomizeRows);

  const navLinks = document.querySelectorAll('.nav a[data-view]');
  const setNavActive = (view) => navLinks.forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  const homeNav = document.querySelector('.nav a[data-view="home"]');
  if (homeNav) homeNav.addEventListener("click", (e) => { e.preventDefault(); setNavActive("home"); showHome(); });
  const libNav = document.querySelector('.nav a[data-view="library"]');
  if (libNav) libNav.addEventListener("click", (e) => { e.preventDefault(); setNavActive("library"); openLibrary(); });

  const reloadBtn = document.getElementById("reloadBtn");
  let reloadStop = 0;
  reloadBtn.addEventListener("click", () =>
  {
    const plv = document.getElementById("playlistView");
    if (plv && !plv.hidden && plv.querySelector(".lib-head")) { openLibrary(); return; }   // library view: reload it instead
    reloadBtn.classList.add("spin");                                  // spins until the feed returns
    clearTimeout(reloadStop);
    reloadStop = setTimeout(() => reloadBtn.classList.remove("spin"), 12000);   // safety stop
    if (DEMO) { applyFeed(demoFeed()); return; }
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (core) core.invoke("reload_feed");
  });

  document.querySelector(".newpl")?.addEventListener("click", openNewPlaylist);

  const searchInput = document.querySelector(".search input");
  let searchTimer = 0;
  searchInput.addEventListener("input", () =>
  {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { searchTimer = setTimeout(showHome, 250); return; }
    searchTimer = setTimeout(() => doSearch(q), 450);   // debounce live search
  });
  searchInput.addEventListener("keydown", (e) =>
  {
    if (e.key === "Enter") { clearTimeout(searchTimer); doSearch(searchInput.value); }
  });

  const modal = document.getElementById("settingsModal");
  document.getElementById("settingsBtn").addEventListener("click", () => { modal.classList.add("show"); loadSerialPorts(); renderSerialFeedPick(); renderPluginsTab(); });
  document.getElementById("settingsClose").addEventListener("click", () => modal.classList.remove("show"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("show"); });

  document.querySelectorAll(".swatch[data-accent]").forEach(b =>
    b.addEventListener("click", () =>
    {
      document.querySelectorAll(".swatch").forEach(s => s.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      setAccent(b.dataset.accent);
    }));
  document.getElementById("customColor").addEventListener("input", (e) =>
  {
    document.querySelectorAll(".swatch").forEach(s => s.setAttribute("aria-pressed", "false"));
    setAccent(e.target.value);
  });

  document.querySelectorAll("#themeSeg button").forEach(b =>
    b.addEventListener("click", () =>
    {
      const t = b.dataset.themeOpt;
      try { localStorage.setItem("td-theme", t); } catch (e) {}
      applyTheme(t);
    }));

  // Account menu: hovering or clicking the avatar reveals one action - Log in when signed
  // out, Log out when signed in. No account controls in Settings.
  const core0 = () => window.__TAURI__ && window.__TAURI__.core;
  const doSignOut = () =>
    openConfirm("Log out?", "This signs you out of YouTube Music. TuneDeck keeps nothing about your account.", "Log out", () =>
    {
      const c = core0(); if (c) c.invoke("sign_out"); toast("Logging out…");
    });
  const doSignIn = () => { const c = core0(); if (c) c.invoke("sign_in"); };
  const acct = document.getElementById("account");
  document.querySelector(".avatar")?.addEventListener("click", (e) => { e.stopPropagation(); acct?.classList.toggle("open"); });
  document.getElementById("acctAction")?.addEventListener("click", () => { acct?.classList.remove("open"); if (signedIn) doSignOut(); else doSignIn(); });
  document.getElementById("acctSwitch")?.addEventListener("click", () => { acct?.classList.remove("open"); accountsRequested = true; const c = core0(); if (c) c.invoke("load_accounts"); });
  document.addEventListener("click", () => acct?.classList.remove("open"));
  updateAvatar();

  const portSel = document.getElementById("serialPort");
  if (portSel)
  {
    portSel.addEventListener("change", () =>
    {
      const v = portSel.value;
      try { localStorage.setItem("td-serialport", v); } catch (e) {}
      const core = window.__TAURI__ && window.__TAURI__.core;
      if (core) core.invoke("set_serial_port", { name: v || null });
    });
    // initial fill, then push the remembered port to Rust so it applies on startup
    loadSerialPorts().then(() =>
    {
      const core = window.__TAURI__ && window.__TAURI__.core;
      if (core && portSel.value) core.invoke("set_serial_port", { name: portSel.value });
    });
  }

  const subSel = document.getElementById("serialSub");
  const volSel = document.getElementById("serialVol");
  const volLow = document.getElementById("serialVolLow");
  if (subSel && volSel && volLow)
  {
    try { subSel.value = localStorage.getItem("td-serialsub") || "short"; } catch (e) {}
    try { volSel.value = localStorage.getItem("td-serialvol") || "snap"; } catch (e) {}
    try { volLow.checked = (localStorage.getItem("td-serialvollow") || "1") === "1"; } catch (e) {}
    subSel.addEventListener("change", () => { try { localStorage.setItem("td-serialsub", subSel.value); } catch (e) {} pushSerialOpts(); });
    volSel.addEventListener("change", () => { try { localStorage.setItem("td-serialvol", volSel.value); } catch (e) {} pushSerialOpts(); });
    volLow.addEventListener("change", () => { try { localStorage.setItem("td-serialvollow", volLow.checked ? "1" : "0"); } catch (e) {} pushSerialOpts(); });
    pushSerialOpts();                 // apply on startup
    setTimeout(pushSerialOpts, 2500); // re-apply once the engine window is ready (vol mode)
  }

  // settings tabs (General / Device / Plugins)
  const setPanes = { general: "setGeneral", device: "setDevice", plugins: "setPlugins" };
  document.querySelectorAll(".set-tabs button").forEach((b) =>
    b.addEventListener("click", () =>
    {
      document.querySelectorAll(".set-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      Object.entries(setPanes).forEach(([k, elid]) => { const el = document.getElementById(elid); if (el) el.hidden = b.dataset.set !== k; });
      if (b.dataset.set === "device") renderSerialFeedPick();
      if (b.dataset.set === "plugins") renderPluginsTab();
    }));

  applySavedPlugins();   // push saved native-plugin enabled/config to the backend on startup
  loadJsPlugins();        // run enabled drop-in JS plugins

  makeSortable(document.getElementById("cfgActive"), ".cfg-grip", commitCustomizeOrder);
}

// Fills the serial-port picker from the OS, keeping the remembered selection (even if unplugged).
async function loadSerialPorts()
{
  const portSel = document.getElementById("serialPort");
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (!portSel || !core) return;
  let saved = "";
  try { saved = localStorage.getItem("td-serialport") || ""; } catch (e) {}
  let ports = [];
  try { ports = await core.invoke("list_serial_ports"); } catch (e) {}
  let html = `<option value="">Auto-detect</option>` +
    ports.map((p) => `<option value="${esc(p.name)}">${esc(p.label)}</option>`).join("");
  if (saved && !ports.some((p) => p.name === saved))
    html += `<option value="${esc(saved)}">${esc(saved)} (not connected)</option>`;
  portSel.innerHTML = html;
  portSel.value = saved;
}

// plugins (declarative: UI auto-rendered from each plugin's manifest/config schema)
// Native plugins live in Rust (plugins_manifest). JS plugins are drop-in folders run here in the UI
// webview with a `tunedeck` API (Phase 2). Both share the same manifest/config model and settings UI.

const jsPluginHandlers = { track: [], queue: [] };   // {id, cb}
const jsLoadedIds = new Set();                         // JS plugin ids already executed
const jsConfigCbs = {};                                // id -> [cb]
const engineInjections = [];                           // {id, js} re-applied on engine reload

// Re-applies plugins' engine scripts after an engine reload (eval does not survive navigation).
// Scripts must be idempotent (guard with a window flag); re-applying is cheap + safe.
function reinjectEngineScripts()
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (!core || !engineInjections.length) return;
  engineInjections.forEach((e) => { if (isPluginEnabled(e.id)) core.invoke("plugin_inject_engine", { js: e.js }); });
}

function isPluginEnabled(id) { try { return localStorage.getItem(`td-plugin-${id}-enabled`) === "1"; } catch (e) { return false; } }
function pluginCfgValue(id, f)
{
  try { const s = localStorage.getItem(`td-plugin-${id}-${f.key}`); if (s !== null) return s; } catch (e) {}
  return f.default;
}

// The `tunedeck` API handed to each JS plugin.
function jsPluginApi(id, manifest)
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  jsConfigCbs[id] = jsConfigCbs[id] || [];
  const fieldDefault = (key) => { const f = (manifest.fields || []).find((x) => x.key === key); return f ? f.default : undefined; };
  return {
    id,
    onTrack: (cb) => jsPluginHandlers.track.push({ id, cb }),
    onQueue: (cb) => jsPluginHandlers.queue.push({ id, cb }),
    injectEngine: (js) => { const s = String(js); engineInjections.push({ id, js: s }); if (core) core.invoke("plugin_inject_engine", { js: s }); },
    http: (url, opts) => { opts = opts || {}; return core ? core.invoke("plugin_http", { url, method: opts.method || "GET", body: opts.body || null }) : Promise.resolve(null); },
    config:
    {
      get: (key) => { try { const s = localStorage.getItem(`td-plugin-${id}-${key}`); if (s !== null) return s; } catch (e) {} return fieldDefault(key); },
      set: (key, val) => { try { localStorage.setItem(`td-plugin-${id}-${key}`, String(val)); } catch (e) {} notifyJsConfig(id, key, String(val)); },
    },
    onConfig: (cb) => jsConfigCbs[id].push(cb),
    log: (...a) => console.log(`[plugin:${id}]`, ...a),
  };
}
function notifyJsConfig(id, key, val) { (jsConfigCbs[id] || []).forEach((cb) => { try { cb(key, val); } catch (e) {} }); }

// Executes one JS plugin's source with its `tunedeck` API (once).
function runJsPlugin(entry)
{
  if (jsLoadedIds.has(entry.id)) return;
  jsLoadedIds.add(entry.id);
  try { new Function("tunedeck", entry.source)(jsPluginApi(entry.id, entry.manifest || {})); }
  catch (e) { console.warn(`[plugin:${entry.id}] failed to load`, e); }
}

async function loadJsPluginById(id)
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (!core || jsLoadedIds.has(id)) return;
  let list = [];
  try { list = await core.invoke("js_plugins_list"); } catch (e) {}
  const entry = list.find((p) => p.id === id);
  if (entry) runJsPlugin(entry);
}

// Startup: run every enabled JS plugin.
async function loadJsPlugins()
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (!core) return;
  let list = [];
  try { list = await core.invoke("js_plugins_list"); } catch (e) {}
  list.forEach((entry) => { if (isPluginEnabled(entry.id)) runJsPlugin(entry); });
}

// Fan playback events out to enabled JS plugins (called from the ytm-state / ytm-queue listeners).
function dispatchJsTrack(p)
{
  if (!jsPluginHandlers.track.length) return;
  p = p || {};
  const t = { title: p.title || "", artist: p.author || "", album: p.album || "", cover: p.cover || "", id: p.id || "", dur: p.dur || 0, pos: p.cur || 0, playing: !!p.playing };
  jsPluginHandlers.track.forEach((h) => { if (isPluginEnabled(h.id)) { try { h.cb(t); } catch (e) {} } });
}
function dispatchJsQueue(q)
{
  if (!jsPluginHandlers.queue.length) return;
  jsPluginHandlers.queue.forEach((h) => { if (isPluginEnabled(h.id)) { try { h.cb(q || []); } catch (e) {} } });
}

// Pushes saved NATIVE plugin enabled/config to the backend on startup (localStorage = persistence).
async function applySavedPlugins()
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (!core) return;
  let list = [];
  try { list = await core.invoke("plugins_manifest"); } catch (e) {}
  list.forEach((pl) =>
  {
    (pl.fields || []).forEach((f) =>
    {
      try { const s = localStorage.getItem(`td-plugin-${pl.id}-${f.key}`); if (s !== null) core.invoke("plugin_set_config", { id: pl.id, key: f.key, value: s }); } catch (e) {}
    });
    try { const s = localStorage.getItem(`td-plugin-${pl.id}-enabled`); const on = s !== null ? s === "1" : !!pl.enabled; core.invoke("plugin_set_enabled", { id: pl.id, on }); } catch (e) {}
  });
}

// One config control from a manifest field; persists + routes the change (native -> Rust, js -> plugin).
function pluginFieldRow(entry, f)
{
  const key = `td-plugin-${entry.id}-${f.key}`;
  let val = pluginCfgValue(entry.id, f);
  const core = window.__TAURI__ && window.__TAURI__.core;
  const push = (v) =>
  {
    try { localStorage.setItem(key, v); } catch (e) {}
    if (entry.kind === "native") { if (core) core.invoke("plugin_set_config", { id: entry.id, key: f.key, value: v }); }
    else notifyJsConfig(entry.id, f.key, v);
  };
  const row = document.createElement("div");
  row.className = "opt-row";
  const label = `<span>${esc(f.label)}${f.hint ? ` <span class="opt-hint">${esc(f.hint)}</span>` : ""}</span>`;
  if (f.kind === "bool")
  {
    const on = val === "1" || val === "true";
    const uid = `plf_${entry.id}_${f.key}`;
    row.innerHTML = `${label}<span class="switch"><input type="checkbox" id="${uid}" ${on ? "checked" : ""}><label for="${uid}"></label></span>`;
    row.querySelector("input").addEventListener("change", (e) => push(e.target.checked ? "1" : "0"));
  }
  else if (f.kind === "select")
  {
    const opts = (f.options || []).map((o) => `<option value="${esc(o)}" ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("");
    row.innerHTML = `${label}<select class="port-select">${opts}</select>`;
    row.querySelector("select").addEventListener("change", (e) => push(e.target.value));
  }
  else
  {
    row.innerHTML = `${label}<input class="port-select" type="text">`;
    const inp = row.querySelector("input");
    inp.value = val || "";
    inp.addEventListener("change", () => push(inp.value.trim()));
  }
  return row;
}

function pluginCard(entry)
{
  const enKey = `td-plugin-${entry.id}-enabled`;
  let enabled = !!entry.enabled;
  try { const s = localStorage.getItem(enKey); if (s !== null) enabled = s === "1"; } catch (e) {}

  const field = document.createElement("div");
  field.className = "field";
  const tag = entry.kind === "js" ? ` <span class="opt-hint">plugin</span>` : "";
  field.innerHTML = `<label class="k">${esc(entry.label)}${tag}</label>`;

  const head = document.createElement("div");
  head.className = "opt-row";
  const uid = `pl_${entry.id}`;
  head.innerHTML = `<span>${esc(entry.description || "Enable")}</span>
    <span class="switch"><input type="checkbox" id="${uid}" ${enabled ? "checked" : ""}><label for="${uid}"></label></span>`;
  head.querySelector("input").addEventListener("change", (e) =>
  {
    try { localStorage.setItem(enKey, e.target.checked ? "1" : "0"); } catch (err) {}
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (entry.kind === "native") { if (core) core.invoke("plugin_set_enabled", { id: entry.id, on: e.target.checked }); }
    else if (e.target.checked) loadJsPluginById(entry.id);   // js: run on enable; disable just stops its callbacks
  });
  field.appendChild(head);

  (entry.fields || []).filter((f) => !f.advanced).forEach((f) => field.appendChild(pluginFieldRow(entry, f)));
  const adv = (entry.fields || []).filter((f) => f.advanced);
  if (adv.length)
  {
    const advWrap = document.createElement("div");
    advWrap.hidden = true;
    adv.forEach((f) => advWrap.appendChild(pluginFieldRow(entry, f)));
    const advBtn = document.createElement("button");
    advBtn.className = "adv-toggle";
    advBtn.textContent = "Advanced";
    advBtn.addEventListener("click", () => { advWrap.hidden = !advWrap.hidden; });
    field.appendChild(advBtn);
    field.appendChild(advWrap);
  }
  return field;
}

// Auto-renders the Plugins tab: native plugins + drop-in JS plugins, uniformly.
async function renderPluginsTab()
{
  const wrap = document.getElementById("pluginsList");
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (!wrap || !core) return;
  let native = [], js = [], dir = "";
  try { native = await core.invoke("plugins_manifest"); } catch (e) {}
  try { js = await core.invoke("js_plugins_list"); } catch (e) {}
  try { dir = await core.invoke("js_plugins_dir"); } catch (e) {}

  const entries = [];
  native.forEach((p) => entries.push({ kind: "native", id: p.id, label: p.label, description: p.description, fields: p.fields || [], enabled: p.enabled }));
  js.forEach((p) => { const m = p.manifest || {}; entries.push({ kind: "js", id: p.id, label: m.label || p.id, description: m.description || "", fields: (m.fields || []).map((f) => ({ ...f, value: f.default })), enabled: false }); });

  wrap.innerHTML = "";
  entries.forEach((e) => wrap.appendChild(pluginCard(e)));

  const note = document.createElement("p");
  note.className = "plugins-note";
  note.textContent = dir ? `Drop-in JS plugins folder: ${dir}` : "";
  wrap.appendChild(note);
}

// Pushes all serial-interaction options to Rust/engine (reads from localStorage so it is DOM-free).
function pushSerialOpts()
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (!core) return;
  let sub = "short", vol = "snap", low = true, feed = [];
  try { sub = localStorage.getItem("td-serialsub") || "short"; } catch (e) {}
  try { vol = localStorage.getItem("td-serialvol") || "snap"; } catch (e) {}
  try { low = (localStorage.getItem("td-serialvollow") || "1") === "1"; } catch (e) {}
  try { const f = localStorage.getItem("td-serialfeed"); feed = f ? JSON.parse(f) : []; } catch (e) {}
  core.invoke("set_serial_opts", {
    subtitleFull: sub === "full",
    volMode: vol,
    volLowFine: low,
    feedSections: Array.isArray(feed) ? feed : [],
  });
}

// Renders the "which feed sections reach the device" checkboxes from the current home feed.
// No saved set = all sections allowed (empty filter on the Rust side).
function renderSerialFeedPick()
{
  const wrap = document.getElementById("serialFeedSections");
  if (!wrap) return;
  let saved = null;
  try { const s = localStorage.getItem("td-serialfeed"); saved = s ? JSON.parse(s) : null; } catch (e) {}
  const labels = (typeof sections !== "undefined" && sections) ? sections.map((s) => s.label).filter(Boolean) : [];
  if (!labels.length) { wrap.innerHTML = `<p class="fp-empty">Feed not loaded yet - open Home first.</p>`; return; }
  wrap.innerHTML = "";
  labels.forEach((label) =>
  {
    const checked = !Array.isArray(saved) || saved.includes(label);
    const row = document.createElement("label");
    row.innerHTML = `<input type="checkbox" ${checked ? "checked" : ""}><span>${esc(label)}</span>`;
    row.querySelector("input").addEventListener("change", () =>
    {
      const inputs = [...wrap.querySelectorAll("input")];
      const picked = labels.filter((_, i) => inputs[i] && inputs[i].checked);
      try { localStorage.setItem("td-serialfeed", JSON.stringify(picked)); } catch (e) {}
      pushSerialOpts();
    });
    wrap.appendChild(row);
  });
}

function restorePrefs()
{
  try
  {
    const a = localStorage.getItem("td-accent");
    if (a)
    {
      setAccent(a);
      document.querySelectorAll(".swatch").forEach(s => s.setAttribute("aria-pressed", s.dataset.accent === a ? "true" : "false"));
    }
    applyTheme(localStorage.getItem("td-theme") || "system");
  }
  catch (e) { applyTheme("system"); }
}

// demo mode
// A build made with `--features demo` has no hidden engine: the backend command is_demo
// returns true and the whole UI runs on labelled placeholder data, so the interface can be
// clicked through (and screenshotted) with no login or network. Field values are their own
// labels on purpose ("Song Title", "Artist Name", ...).
function demoSongs(n)
{
  return Array.from({ length: n }, () => ({ id: "demo", title: "Song Title", sub: "Artist Name", kind: "v" }));
}
function demoTracks(n)
{
  return Array.from({ length: n }, () => ({ id: "demo", title: "Song Title", sub: "Artist Name", dur: "3:00", kind: "v" }));
}
function demoFeed()
{
  return [
    { key: "demo-1", title: "Section Title", items: demoSongs(8) },
    { key: "demo-2", title: "Section Title", items: demoSongs(8) },
    { key: "demo-3", title: "Section Title", items: demoSongs(8) }
  ];
}
function demoState()
{
  return { title: "Song Title", artists: [{ id: "demo", name: "Artist Name" }], album: "Album Name", albumId: "demo", year: "Year", cur: 72, dur: 210, playing: true, vol: 60, cover: null, liked: false };
}
function demoQueue()
{
  const q = Array.from({ length: 6 }, (_, i) => ({ title: "Song Title", sub: "Artist Name", id: "demo", cur: i === 0 }));
  q.push({ title: "Song Title", sub: "Artist Name", id: "demo", auto: true });
  q.push({ title: "Song Title", sub: "Artist Name", id: "demo", auto: true });
  return q;
}
function demoPlaylistsList()
{
  return Array.from({ length: 6 }, () => ({ id: "demo", openId: "demo", title: "Playlist Title", sub: "Playlist Author" }));
}
function demoPlaylist()
{
  return { title: "Playlist Title", author: "Playlist Author", authorId: "demo", meta: "Playlist", cover: null, id: "demo", editable: false, reorder: false, tracks: demoTracks(10) };
}
function demoAlbum()
{
  return { title: "Album Name", artist: "Album Artist", year: "Year", cover: null, playId: "demo", tracks: demoTracks(10) };
}
function demoArtist()
{
  return {
    name: "Artist Name", listeners: "Monthly Listeners", cover: null,
    topSongs: demoTracks(5),
    shelves: [
      { title: "Shelf Title", items: Array.from({ length: 6 }, () => ({ id: "MPREdemo", title: "Album Name", sub: "Year", kind: "b" })) },
      { title: "Shelf Title", items: demoSongs(6) }
    ]
  };
}
function demoSearch(query)
{
  return {
    query: query || "Search Query",
    top: { id: "demo", title: "Top Result", sub: "Artist Name", kind: "v", playId: "demo", playKind: "p" },
    results: [
      { id: "demo", title: "Song Title", sub: "Artist Name", kind: "v" },
      { id: "demo", title: "Song Title", sub: "Artist Name", kind: "v" },
      { id: "MPREdemo", title: "Album Name", sub: "Album Artist", kind: "b" },
      { id: "UCdemo", title: "Artist Name", sub: "Artist", kind: "b" },
      { id: "VLdemo", title: "Playlist Title", sub: "Playlist Author", kind: "p" }
    ]
  };
}
function demoLibrary()
{
  return { sections: [
    { title: "Playlists", items: Array.from({ length: 6 }, () => ({ id: "demo", title: "Playlist Title", sub: "Playlist Author" })) },
    { title: "Albums", route: "album", items: Array.from({ length: 6 }, () => ({ id: "demo", title: "Album Name", sub: "Album Artist" })) },
    { title: "Subscriptions", route: "artist", items: Array.from({ length: 6 }, () => ({ id: "demo", title: "Artist Name", sub: "Artist" })) }
  ] };
}

// Set true by maybeStartDemo in a demo build. The navigation functions check it and render
// placeholder data instead of calling the (absent) backend. Swapping window.__TAURI__.core.invoke
// itself is not an option: it is read-only, and main.js is a module, so the assignment throws.
let DEMO = false;

async function maybeStartDemo()
{
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (!core) return;
  let demo = false;
  try { demo = await core.invoke("is_demo"); } catch (e) {}
  console.info("[TuneDeck] demo mode:", demo);   // false here = not a demo build (run `npm run dev:demo`)
  if (!demo) return;
  DEMO = true;                // nav functions now render placeholders instead of hitting the backend
  document.title = "TuneDeck (demo)";
  playlists = demoPlaylistsList();
  renderPlaylists();
  applyFeed(demoFeed());
  updateNowPlaying(demoState());
  renderQueue(demoQueue());
}

window.addEventListener("DOMContentLoaded", () =>
{
  renderPlaylists();
  renderSections();          // shows "Loading your home…" until the feed arrives
  renderCustomizeRows();
  wireControls();
  wirePlayer();
  restorePrefs();
  listenToEngine();
  maybeStartDemo();          // no-op unless this is a demo build (is_demo)
});
