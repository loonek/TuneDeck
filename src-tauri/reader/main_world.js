(function ()
{
  // YTM registers a beforeunload handler; a capturing listener that stops propagation
  // runs first and prevents its "unsaved changes" prompt on our navigations.
  window.addEventListener("beforeunload", (e) => e.stopImmediatePropagation(), true);

  // If we arrived here with shuffle intent, turn shuffle on once the player is ready, then
  // skip one (the list autoplays in order first).
  try
  {
    if (sessionStorage.getItem("tunedeckShuffle"))
    {
      sessionStorage.removeItem("tunedeckShuffle");
      let stries = 0;
      const siv = setInterval(() =>
      {
        const v = document.querySelector("video");
        const shuf = [...document.querySelectorAll("ytmusic-player-bar button[aria-label]")]
          .find((b) => /shuffle|losow/i.test(b.getAttribute("aria-label")));
        if (shuf && v && v.duration > 0)
        {
          clearInterval(siv);
          if (shuf.getAttribute("aria-pressed") !== "true") shuf.click();
          setTimeout(() => document.querySelector(".next-button")?.click(), 500);
        }
        else if (++stries > 80) clearInterval(siv);
      }, 250);
    }
  }
  catch (e) {}

  // Deduplicated queue rows from the engine's Up Next list.
  function queueRows()
  {
    const q = document.querySelector("ytmusic-player-queue");
    if (!q) return [];
    return [...q.querySelectorAll("ytmusic-player-queue-item")].filter((el) =>
    {
      const wrap = el.closest("ytmusic-playlist-panel-video-wrapper-renderer");
      return !wrap || wrap.querySelector("ytmusic-player-queue-item") === el;
    });
  }

  function readQueue()
  {
    return queueRows().slice(0,100).map((el) =>
    ({
        title: el.querySelector(".song-title")?.textContent.trim() || "",
        sub:   el.querySelector(".byline")?.textContent.trim() || "",
        thumb: el.data?.thumbnail?.thumbnails?.at(-1)?.url || el.querySelector("img")?.src || "",
        cur:   el.hasAttribute("selected"),
        auto:  !!el.closest("#automix-contents"),
        id:    el.data?.videoId || "",
        artists: artistsOf(el.data?.longBylineText?.runs),
        album: albumFromRuns(el.data?.longBylineText?.runs)
    }));
  }

  // --- now playing ---
  let npLastId = null;   // to force the timer to 0 on the first snapshot of a new track
  function snapshot()
  {
    const mp = document.getElementById("movie_player");
    const v  = document.querySelector("video");
    if (!mp || !v) return null;
    const d = mp.getVideoData ? mp.getVideoData() : {};
    // Duration/id from the player response, not the raw <video>: YTM streams the next track
    // via MSE into the same element, so v.duration lags (or is Infinity) mid-transition.
    const pr = mp.getPlayerResponse ? mp.getPlayerResponse() : null;
    const details = pr && pr.videoDetails ? pr.videoDetails : null;
    const len = details ? parseInt(details.lengthSeconds, 10) : 0;
    const id = (details && details.videoId) || d.video_id || null;
    // getCurrentTime tracks the active video more reliably than v.currentTime across
    // transitions; still, force 0 on the tick where the track id first changes, since the
    // raw time can briefly report the previous track's position.
    let cur = mp.getCurrentTime ? mp.getCurrentTime() : v.currentTime;
    if (id !== npLastId) { npLastId = id; cur = 0; }
    const m = navigator.mediaSession && navigator.mediaSession.metadata;
    const cover = m && m.artwork && m.artwork.length ? m.artwork[m.artwork.length - 1].src : null;
    let liked = false;
    try { const lb = document.querySelector("ytmusic-player-bar ytmusic-like-button-renderer"); if (lb) liked = lb.getAttribute("like-status") === "LIKE"; } catch (e) {}
    let album = null, year = null, albumId = null;
    const artists = [];   // [{name, id}] - a track can credit several artists, each its own link
    try
    {
      const sel = queueRows().find((el) => el.hasAttribute("selected"));
      for (const r of (sel?.data?.longBylineText?.runs || []))
      {
        const ep = r.navigationEndpoint?.browseEndpoint;
        const pt = ep?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
        if (pt === "MUSIC_PAGE_TYPE_ALBUM") { album = r.text; albumId = ep.browseId; }
        else if (pt === "MUSIC_PAGE_TYPE_ARTIST") artists.push({ name: r.text, id: ep.browseId });
        else if (/^\d{4}$/.test((r.text || "").trim())) year = r.text.trim();
      }
    }
    catch (e) {}
    return { title: d.title, author: d.author,
             playing: !v.paused, cur: cur, dur: len > 0 ? len : v.duration,
             vol: mp.getVolume ? mp.getVolume() : null,
             cover: cover, id: id, liked: liked,
             album: album, year: year, albumId: albumId, artists: artists };
  }

  // Extract runs' text, since text is stored in runs tables on innerTube
  function firstRun(x)
  {
    return x && x.runs && x.runs[0] ? x.runs[0].text : "";
  }

  // firstRun takes the first fragment, joinRuns gathers the rest
  function joinRuns(x)
  {
    return x && x.runs ? x.runs.map((r) => r.text).join("") : "";
  }

  // Gets target from navigationEndpoint. 
  // watchEndpoint.videoId -> v, watchPlaylistEndpoint.playlistId -> p, browseEndpoint.browseId -> b
  function itemTarget(nav)
  {
    if (!nav) return { id: "", kind: "" };
    if (nav.watchEndpoint) return { id: nav.watchEndpoint.videoId, kind: "v" };
    if (nav.watchPlaylistEndpoint) return { id: nav.watchPlaylistEndpoint.playlistId, kind: "p" };
    if (nav.browseEndpoint) return { id: nav.browseEndpoint.browseId, kind: "b" };
    return { id: "", kind: "" };
  }

  // Reads a thumbnail URL from a renderer, normalized to ~96px
  function thumbUrl(node)
  {
    let arr;
    try { arr = node.musicThumbnailRenderer.thumbnail.thumbnails; }
    catch (e) { return ""; }
    if (!arr || !arr.length) return "";
    return arr[arr.length - 1].url.replace(/=w\d+-h\d+/, "=w300-h300").replace(/=s\d+/, "=s300");
  }

  function likeStatusOf(it)
  {
    try {
      for (const b of it.menu.menuRenderer.topLevelButtons || [])
        if (b.likeButtonRenderer) return b.likeButtonRenderer.likeStatus;
    } catch (e) {}
    return null;
  }

  // Reads an album tile into {title, sub, id, kind, thumb}
  // Collects clickable artists from a runs array: the runs whose browse endpoint is an artist
  // page. Used for bylines everywhere (cards, track rows, queue) so each artist links separately.
  function artistsOf(runs)
  {
    const out = [];
    for (const r of (runs || []))
    {
      const ep = r.navigationEndpoint?.browseEndpoint;
      const pt = ep?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
      if (pt === "MUSIC_PAGE_TYPE_ARTIST") out.push({ name: r.text, id: ep.browseId });
    }
    return out;
  }

  // First album link in a runs array (for "Go to album"), or null.
  function albumFromRuns(runs)
  {
    for (const r of (runs || []))
    {
      const ep = r.navigationEndpoint?.browseEndpoint;
      if (ep?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === "MUSIC_PAGE_TYPE_ALBUM")
        return { name: r.text, id: ep.browseId };
    }
    return null;
  }

  // Scans all flex columns of a list row for an album link (position varies by response).
  function albumOfRow(it)
  {
    for (const fc of (it.flexColumns || []))
    {
      const a = albumFromRuns(fc.musicResponsiveListItemFlexColumnRenderer?.text?.runs);
      if (a) return a;
    }
    return null;
  }

  function parseTwoRow(it)
  {
    const target = itemTarget(it.navigationEndpoint);
    return {
      title: firstRun(it.title),
      sub: joinRuns(it.subtitle),
      id: target.id,
      kind: target.kind,
      thumb: thumbUrl(it.thumbnailRenderer),
      liked: likeStatusOf(it) === "LIKE",
      artists: artistsOf(it.subtitle?.runs),
      album: albumFromRuns(it.subtitle?.runs)
    };
  }

  // Reads a song row into {title, sub, id, kind}
  function parseListRow(it)
  {
    let title = "";
    let sub = "";
    try { title = firstRun(it.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text); }
    catch (e) {}
    try { sub = joinRuns(it.flexColumns[1].musicResponsiveListItemFlexColumnRenderer.text).split(" • ")[0]; }
    catch (e) {}

    const thumb = thumbUrl(it.thumbnail);
    if (it.playlistItemData && it.playlistItemData.videoId)
    {
      return { 
        title: title, 
        sub: sub, 
        id: it.playlistItemData.videoId,
        kind: "v",
        thumb: thumb,
        liked: likeStatusOf(it) === "LIKE",
        artists: artistsOf(it.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs),
        album: albumOfRow(it),
        setVideoId: it.playlistItemData.playlistSetVideoId || ""
      };
    }
    let nav = it.navigationEndpoint;
    try { if (!nav) nav = it.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0].navigationEndpoint; }
    catch (e) {}
    const target = itemTarget(nav);
    return { 
      title: title, 
      sub: sub, 
      id: target.id, 
      kind: target.kind, 
      thumb: thumb,
      liked: likeStatusOf(it) === "LIKE",
      artists: artistsOf(it.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs),
      album: albumOfRow(it)
    };
  }

  // Returns an array of shelves. Tries 2 paths, since they can look different.
  function shelvesOf(resp)
  {
    try { return resp.contents.singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents; } catch (e) {}
    try { return resp.continuationContents.sectionListContinuation.contents; } catch (e) {}
    try
    {
      for (const a of resp.onResponseReceivedActions || [])
        if (a.appendContinuationItemsAction) return a.appendContinuationItemsAction.continuationItems;
    } catch (e) {}
    return [];
  }

  // Takes the next page token from the same response as the last function. It is used in browse to lookup next shelves
  function contTokenOf(resp)
  {
    try { return resp.contents.singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.continuations[0].nextContinuationData.continuation; } catch (e) {}
    try { return resp.continuationContents.sectionListContinuation.continuations[0].nextContinuationData.continuation; } catch (e) {}
    try
    {
      const arr = shelvesOf(resp);
      const last = arr[arr.length - 1];
      if (last && last.continuationItemRenderer)
        return last.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
    } catch (e) {}
    return null;
  }

  // Adds new shelf, takes the title from the firstRun and goes through the contents. Checks type for each item:
  // album -> parseTwoRow
  // song -> parseListRow
  // Returns title and contents
  function parseShelf(sec)
  {
    const shelf = sec.musicCarouselShelfRenderer || sec.musicImmersiveCarouselShelfRenderer;
    if (!shelf) return null;

    let title = "";
    try { title = firstRun(shelf.header.musicCarouselShelfBasicHeaderRenderer.title); }
    catch (e) {}

    try { console.log("[shelf]", title,
      "| immersive:", immersive,
      "| thumb:", !!shelf.header?.musicCarouselShelfBasicHeaderRenderer?.thumbnail,
      "| browseId:", shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId); } catch (e) {}

    const items = [];
    for (const c of shelf.contents || [])
    {
      let item = null;
      if (c.musicTwoRowItemRenderer) item = parseTwoRow(c.musicTwoRowItemRenderer);
      else if (c.musicResponsiveListItemRenderer) item = parseListRow(c.musicResponsiveListItemRenderer);
      if (item && item.id) items.push(item);
    }
    if (!items.length) return null;

    const hdr = shelf.header && shelf.header.musicCarouselShelfBasicHeaderRenderer;
    const browseId = hdr && hdr.title && hdr.title.runs && hdr.title.runs[0]
      && hdr.title.runs[0].navigationEndpoint && hdr.title.runs[0].navigationEndpoint.browseEndpoint
      && hdr.title.runs[0].navigationEndpoint.browseEndpoint.browseId;
    const hasThumb = !!(hdr && hdr.thumbnail);

    let key = title, label = title;
    if (browseId && browseId.indexOf("FEmusic_") === 0) key = browseId;
    else if (hasThumb && browseId && browseId.indexOf("UC") === 0)
    { key = "artist-spotlight"; label = "Artist highlight"; }

    return { title: title, key: key, label: label, items: items };
  }

  const FEED_WANT = ["quick picks"];

  // Feed section titles the extension owns (change per language for translations)
  const SEC_HISTORY = "Last played";
  const SEC_PLAYLISTS = "Your Playlists";

  // Builds auth headers (SAPISIDHASH + PageId) proving the logged-in user, so YT returns personalized data
  async function authHeaders()
  {
    const headers = { "Content-Type": "application/json" };
    const m = document.cookie.match(/SAPISID=([^;]+)/) || document.cookie.match(/__Secure-3PAPISID=([^;]+)/);
    if (!m) return headers;
    const origin = "https://music.youtube.com";
    const ts = Math.floor(Date.now() / 1000);
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + m[1] + " " + origin));
    const hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    headers["Authorization"] = "SAPISIDHASH " + ts + "_" + hash;
    headers["X-Goog-AuthUser"] = "0";
    const pageId = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("DELEGATED_SESSION_ID") : null;
    if (pageId) headers["X-Goog-PageId"] = pageId;
    return headers;
  }

  // Sends HTTP request to yt
  async function browse(key, headers, body, params)
  {
    const res = await fetch("/youtubei/v1/browse?prettyPrint=false&key=" + key + (params || ""), {
      method: "POST",
      headers: headers,
      credentials: "include", // Uses login cookies
      body: JSON.stringify(body),
    });
    return res.json();
  }

  // Parses user's listening history, removes duplicates and creates "recently listened"
  function parseHistory(resp)
  {
    let sl;
    try { sl = resp.contents.singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents; }
    catch (e) { return null; }

    const items = [];
    const seen = {};
    const eat = (shelf) =>
    {
      for (const c of shelf.contents || [])
      {
        if (!c.musicResponsiveListItemRenderer) continue;
        const it = parseListRow(c.musicResponsiveListItemRenderer);
        if (it.id && !seen[it.id]) { seen[it.id] = 1; items.push(it); }
      }
    };
    for (const sec of sl)
    {
      if (sec.musicShelfRenderer) eat(sec.musicShelfRenderer);
      else if (sec.itemSectionRenderer)
      {
        for (const c of sec.itemSectionRenderer.contents || []) if (c.musicShelfRenderer) eat(c.musicShelfRenderer);
      }
    }
    if (!items.length) return null;
    return { title: SEC_HISTORY, items: items.slice(0, 20) };
  }

  // Reads the user's library playlists into a "Your playlists" section (kind "s" = shuffle)
  async function parsePlaylists(resp)
  {
    let grid;
    try
    {
      const sl = resp.contents.singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents;
      grid = (sl.find((s) => s.gridRenderer) || {}).gridRenderer;
    }
    catch (e) { return null; }
    if (!grid) return null;

    const items = [];
    for (const g of grid.items || [])
    {
      const it = g.musicTwoRowItemRenderer;
      if (!it) continue;

      let shuffle = null;
      try
      {
        for (const mi of it.menu.menuRenderer.items)
        {
          const e = mi.menuNavigationItemRenderer;
          if (e && e.icon && e.icon.iconType === "MUSIC_SHUFFLE")
          {
            shuffle = e.navigationEndpoint.watchPlaylistEndpoint;
            break;
          }
        }
      }
      catch (e) {}
      if (!shuffle || !shuffle.playlistId) continue;

      let openId = null;
      try { openId = it.navigationEndpoint.browseEndpoint.browseId; } catch (e) {}
      items.push({
        title: firstRun(it.title),
        sub: joinRuns(it.subtitle).split(" • ")[0],
        id: shuffle.playlistId,
        openId: openId,
        kind: "s",
        thumb: thumbUrl(it.thumbnailRenderer),
      });
    }
    if (!items.length) return null;
    return { title: SEC_PLAYLISTS, kind: "p", items: items };
  }

  // Looks for "quick picks" from the feed, and adds the "recently listened" feed
  async function fetchFeed()
  {
    const key = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_API_KEY") : null;
    const ctx0 = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_CONTEXT") : null;
    if (!key || !ctx0) return [];
    const ctx = JSON.parse(JSON.stringify(ctx0));
    try { ctx.client.hl = "en"; } catch (e) {}
    const headers = await authHeaders();

    const out = [];
    const seen = {};
    let resp = await browse(key, headers, { context: ctx, browseId: "FEmusic_home" });
    for (let page = 0; page < 8; page++)
    {
      for (const sec of shelvesOf(resp))
      {
        const parsed = parseShelf(sec);
        if (!parsed || !parsed.items.length) continue;
        const k = parsed.key;
        if (seen[k]) continue;
        seen[k] = 1;
        out.push(parsed);
      }
      const token = contTokenOf(resp);
      if (!token) break;
      resp = await browse(key, headers, { context: ctx, continuation: token });
    }
    return out;
  }

  // Reads the user's library playlists (for the sidebar).
  async function fetchLibraryPlaylists()
  {
    const key = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_API_KEY") : null;
    const ctx0 = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_CONTEXT") : null;
    if (!key || !ctx0) return null;
    const ctx = JSON.parse(JSON.stringify(ctx0));
    try { ctx.client.hl = "en"; } catch (e) {}
    const headers = await authHeaders();
    const resp = await browse(key, headers, { context: ctx, browseId: "FEmusic_liked_playlists" });
    return await parsePlaylists(resp);
  }

  // Header thumbnails come in a couple of shapes.
  function headerThumb(node)
  {
    try { return node.musicThumbnailRenderer.thumbnail.thumbnails.slice(-1)[0].url; } catch (e) {}
    try { return node.croppedSquareThumbnailRenderer.thumbnail.thumbnails.slice(-1)[0].url; } catch (e) {}
    return "";
  }

  // Fetches a playlist's header info + tracks by playlist id.
  async function fetchPlaylist(id)
  {
    const key = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_API_KEY") : null;
    const ctx0 = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_CONTEXT") : null;
    if (!key || !ctx0 || !id) return null;
    const ctx = JSON.parse(JSON.stringify(ctx0));
    try { ctx.client.hl = "en"; } catch (e) {}
    const headers = await authHeaders();
    const vl = id.indexOf("VL") === 0 ? id : "VL" + id;
    const resp = await browse(key, headers, { context: ctx, browseId: vl });

    const two = (resp.contents || {}).twoColumnBrowseResultsRenderer || {};

    let title = "", author = "", meta = "", cover = "", editable = false;
    try
    {
      const wrap = two.tabs[0].tabRenderer.content.sectionListRenderer.contents[0];
      editable = !!wrap.musicEditablePlaylistDetailHeaderRenderer;   // only the user's own playlists
      const hdr = editable ? wrap.musicEditablePlaylistDetailHeaderRenderer.header : wrap;
      const h = hdr.musicResponsiveHeaderRenderer || hdr.musicDetailHeaderRenderer || {};
      title = firstRun(h.title);
      author = joinRuns(h.subtitle);
      meta = joinRuns(h.secondSubtitle);
      cover = headerThumb(h.thumbnail);
    }
    catch (e) {}

    let shelf = null;
    try
    {
      const sl = two.secondaryContents.sectionListRenderer.contents;
      shelf = (sl.find((s) => s.musicPlaylistShelfRenderer) || {}).musicPlaylistShelfRenderer;
    }
    catch (e) {}

    const tracks = [];
    if (shelf)
    {
      for (const c of shelf.contents || [])
      {
        if (!c.musicResponsiveListItemRenderer) continue;
        const r = c.musicResponsiveListItemRenderer;
        const it = parseListRow(r);
        if (!it.title) continue;
        let dur = "";
        try { dur = firstRun(r.fixedColumns[0].musicResponsiveListItemFixedColumnRenderer.text); } catch (e) {}
        tracks.push({ title: it.title, sub: it.sub, id: it.id, kind: it.kind, thumb: it.thumb, dur: dur, liked: it.liked, artists: it.artists, album: it.album, setVideoId: it.setVideoId });
      }
    }
    return { title: title, author: author, meta: meta, cover: cover, id: id, editable: editable, tracks: tracks.slice(0, 200) };
  }

  // Mutates a playlist via InnerTube edit_playlist (add / remove / move). Auth required.
  // playlistId is the raw id (VL prefix stripped). Returns true on success.
  async function editPlaylist(playlistId, actions)
  {
    const key = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_API_KEY") : null;
    const ctx0 = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_CONTEXT") : null;
    if (!key || !ctx0 || !playlistId) return false;
    const ctx = JSON.parse(JSON.stringify(ctx0));
    const headers = await authHeaders();
    const pid = String(playlistId).replace(/^VL/, "");
    try
    {
      const resp = await fetch(`/youtubei/v1/browse/edit_playlist?key=${key}&prettyPrint=false`,
        { method: "POST", headers: headers, body: JSON.stringify({ context: ctx, playlistId: pid, actions: actions }) }).then((r) => r.json());
      return resp && resp.status === "STATUS_SUCCEEDED";
    }
    catch (e) { console.warn("[editPlaylist] failed", e); return false; }
  }
  // action: "add" (a=videoId) | "remove" (a=setVideoId, b=videoId) | "move" (a=movedSetVideoId, b=beforeSetVideoId; b empty = to end)
  window.__tunedeckPlaylistEdit = function (action, playlistId, a, b)
  {
    let actions;
    if (action === "add") actions = [{ action: "ACTION_ADD_VIDEO", addedVideoId: a }];
    else if (action === "remove") actions = [{ action: "ACTION_REMOVE_VIDEO", setVideoId: a, removedVideoId: b }];
    else if (action === "move")
    {
      const m = { action: "ACTION_MOVE_VIDEO_BEFORE", setVideoId: a, movedSetVideoId: a };
      if (b) m.beforeSetVideoId = b;
      actions = [m];
    }
    else return;
    return editPlaylist(playlistId, actions);
  };

  // Fetches an album page by its MPRE browseId. Same twoColumn layout as a playlist, but the
  // browseId is used as-is (no VL prefix) and the tracks live in a musicShelfRenderer.
  async function fetchAlbum(id)
  {
    const key = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_API_KEY") : null;
    const ctx0 = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_CONTEXT") : null;
    if (!key || !ctx0 || !id) return null;
    const ctx = JSON.parse(JSON.stringify(ctx0));
    try { ctx.client.hl = "en"; } catch (e) {}
    const headers = await authHeaders();
    const resp = await browse(key, headers, { context: ctx, browseId: id });
    const two = (resp.contents || {}).twoColumnBrowseResultsRenderer || {};

    let title = "", artist = "", year = "", meta = "", cover = "", playId = "";
    const artists = [];   // an album can credit several artists, each its own link
    try
    {
      const wrap = two.tabs[0].tabRenderer.content.sectionListRenderer.contents[0];
      const h = wrap.musicResponsiveHeaderRenderer || wrap.musicDetailHeaderRenderer || {};
      title = firstRun(h.title);
      artist = joinRuns(h.straplineTextOne) || joinRuns(h.subtitle);
      meta = joinRuns(h.secondSubtitle);
      const ym = joinRuns(h.subtitle).match(/\b(19|20)\d{2}\b/);
      year = ym ? ym[0] : "";
      cover = headerThumb(h.thumbnail);
      for (const r of (h.straplineTextOne?.runs || []))
      {
        const bid = r.navigationEndpoint?.browseEndpoint?.browseId;
        if (bid && /^UC/.test(bid)) artists.push({ name: r.text, id: bid });
      }
    }
    catch (e) {}

    let shelf = null;
    try
    {
      const sl = two.secondaryContents.sectionListRenderer.contents;
      shelf = (sl.find((s) => s.musicShelfRenderer) || {}).musicShelfRenderer
           || (sl.find((s) => s.musicPlaylistShelfRenderer) || {}).musicPlaylistShelfRenderer;
    }
    catch (e) {}

    const tracks = [];
    if (shelf)
    {
      for (const c of shelf.contents || [])
      {
        if (!c.musicResponsiveListItemRenderer) continue;
        const r = c.musicResponsiveListItemRenderer;
        const it = parseListRow(r);
        if (!it.title) continue;
        let dur = "";
        try { dur = firstRun(r.fixedColumns[0].musicResponsiveListItemFixedColumnRenderer.text); } catch (e) {}
        tracks.push({ title: it.title, sub: it.sub || artist, id: it.id, kind: it.kind, thumb: it.thumb || cover, dur: dur, liked: it.liked, artists: it.artists, album: it.album });
      }
    }

    // The whole album plays via its OLAK audio playlist, not the MPRE browseId.
    let ol = null;
    (function findOlak(o){ if (ol || !o || typeof o !== "object") return; if (typeof o.playlistId === "string" && /^OLAK/.test(o.playlistId)) { ol = o.playlistId; return; } for (const k in o) findOlak(o[k]); })(resp);
    playId = ol || "";

    return { title, artist, artists, year, meta, cover, id, playId, tracks: tracks.slice(0, 200) };
  }
  window.__tunedeckOpenAlbum = async function (id)
  {
    try { const a = await fetchAlbum(id); if (a) window.__TAURI__?.event?.emit("ytm-album", a); }
    catch (e) {}
  };

  // Fetches an artist page by its UC browseId: header + "Top songs" + carousels.
  async function fetchArtist(id)
  {
    const key = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_API_KEY") : null;
    const ctx0 = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_CONTEXT") : null;
    if (!key || !ctx0 || !id) return null;
    const ctx = JSON.parse(JSON.stringify(ctx0));
    try { ctx.client.hl = "en"; } catch (e) {}
    const headers = await authHeaders();
    const resp = await browse(key, headers, { context: ctx, browseId: id });

    const h = resp.header?.musicImmersiveHeaderRenderer || resp.header?.musicVisualHeaderRenderer || {};
    const name = firstRun(h.title);
    const cover = headerThumb(h.thumbnail);
    const listeners = joinRuns(h.monthlyListenerCount);

    const topSongs = [];
    const shelves = [];
    for (const sec of shelvesOf(resp))
    {
      if (sec.musicShelfRenderer)
      {
        for (const c of sec.musicShelfRenderer.contents)
        {
          if (c.musicResponsiveListItemRenderer)
          {
            const r = parseListRow(c.musicResponsiveListItemRenderer);
            if (r.id) topSongs.push(r);
          }
        }
      }
      else
      {
        const s = parseShelf(sec);
        if (s) shelves.push(s);
      }
    }

    return { id, name, cover, listeners, topSongs, shelves };
  }
  window.__tunedeckOpenArtist = async function (id)
  {
    try { const a = await fetchArtist(id); if (a) window.__TAURI__?.event?.emit("ytm-artist", a); }
    catch (e) {}
  };

  let lastFeed = null;
  let lastPlaylists = null;
  let audioOnly = false;
  let lastQueueSig = "";
  try { audioOnly = localStorage.getItem("tunedeckAudioOnly") === "1"; } catch (e) {}

  // When audio-only is on, keep the Song variant selected over Video (classes are
  // language-independent; aria-pressed marks the active one).
  function enforceAudioOnly()
  {
    if (!audioOnly) return;
    const song = document.querySelector("ytmusic-av-toggle .song-button");
    if (song && song.getAttribute("aria-pressed") !== "true") song.click();
  }

  // Emit now playing every second
  setInterval(() => {
    const s = snapshot();
    if (s) window.__TAURI__?.event?.emit("ytm-state", s);
    // Connection status, always (even when YTM hasn't loaded) so TuneDeck can show it.
    window.__TAURI__?.event?.emit("ytm-status", {
      online: navigator.onLine,
      ready: !!(window.ytcfg && window.ytcfg.get && window.ytcfg.get("INNERTUBE_API_KEY"))
    });
    enforceAudioOnly();
    const q = readQueue();
    const sig = q.map((x) => x.title + x.cur).join("|");
    if (sig !== lastQueueSig)
    {
      lastQueueSig = sig;
      window.__TAURI__?.event?.emit("ytm-queue", q);
    }
  }, 1000);

  // Parses the "Top result" card: its entity target (for navigation) + a play/shuffle playlist.
  function parseSearchCard(c)
  {
    if (!c) return null;
    const nav = c.onTap || c.title?.runs?.[0]?.navigationEndpoint;
    const tgt = itemTarget(nav);
    let playId = "", playKind = "p";
    for (const b of (c.buttons || []))
    {
      const r = b.buttonRenderer;
      const wpe = (r?.command || r?.navigationEndpoint || {}).watchPlaylistEndpoint;
      if (!wpe) continue;
      const txt = firstRun(r?.text);
      if (/play/i.test(txt)) { playId = wpe.playlistId; playKind = "p"; break; }
      if (!playId) { playId = wpe.playlistId; playKind = /shuffle/i.test(txt) ? "s" : "p"; }
    }
    return { title: firstRun(c.title), sub: joinRuns(c.subtitle), id: tgt.id, kind: tgt.kind, thumb: headerThumb(c.thumbnail), playId: playId, playKind: playKind };
  }

  async function fetchSearch(query)
  {
    const key = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_API_KEY") : null;
    const ctx0 = window.ytcfg && window.ytcfg.get ? window.ytcfg.get("INNERTUBE_CONTEXT") : null;
    if (!key || !ctx0 || !query) return null;
    const ctx = JSON.parse(JSON.stringify(ctx0));
    try { ctx.client.hl = "en"; } catch (e) {}
    const headers = await authHeaders();
    const resp = await fetch(`/youtubei/v1/search?key=${key}&prettyPrint=false`,
      { method: "POST", headers: headers, body: JSON.stringify({ context: ctx, query: query }) }).then((r) => r.json());

    const sections = resp.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    const results = [];
    let top = null;
    for (const sec of sections)
    {
      if (sec.musicCardShelfRenderer && !top) { top = parseSearchCard(sec.musicCardShelfRenderer); continue; }
      const it = sec.itemSectionRenderer?.contents?.[0]?.musicResponsiveListItemRenderer;
      if (it)
      {
        const row = parseListRow(it);
        if (row.id && row.title) results.push(row);
      }
    }
    return { query: query, top: top, results: results };
  }
  window.__tunedeckSearch = async function (query)
  {
    try { const r = await fetchSearch(query); if (r) window.__TAURI__?.event?.emit("ytm-search", r); }
    catch (e) { console.warn("[search] failed", e); }
  };


  // Download and send feed, when InnerTube's config's ready. Cached in sessionStorage so a
  // navigation (playing something) reuses the same feed instead of re-fetching / re-shuffling.
  let feedReady = false;

  // Loads the feed + library playlists and caches them. Returns true on success.
  async function loadFeed()
  {
    const ready = window.ytcfg && window.ytcfg.get && window.ytcfg.get("INNERTUBE_API_KEY");
    if (!ready) return false;
    try
    {
      const feed = await fetchFeed();
      lastFeed = feed;
      window.__TAURI__?.event?.emit("ytm-feed", feed);

      let plItems = null;
      const pls = await fetchLibraryPlaylists();
      if (pls) { plItems = pls.items || []; lastPlaylists = plItems; window.__TAURI__?.event?.emit("ytm-playlists", plItems); }

      try { sessionStorage.setItem("tunedeckFeedCache", JSON.stringify({ ts: Date.now(), feed: feed, playlists: plItems })); } catch (e) {}
      feedReady = true;
      return true;
    }
    catch (e) { console.warn("[feed] failed", e); return false; }
  }

  (function pushFeed()
  {
    try
    {
      const raw = sessionStorage.getItem("tunedeckFeedCache");
      if (raw)
      {
        const o = JSON.parse(raw);
        if (o && Date.now() - o.ts < 10 * 60 * 1000)
        {
          lastFeed = o.feed || null;
          lastPlaylists = o.playlists || null;
          if (lastFeed) window.__TAURI__?.event?.emit("ytm-feed", lastFeed);
          if (lastPlaylists) window.__TAURI__?.event?.emit("ytm-playlists", lastPlaylists);
          feedReady = true;
          return;
        }
      }
    }
    catch (e) {}

    // Keep retrying until it loads: covers ytcfg-not-ready-yet AND transient fetch failures,
    // so a brief outage at startup self-heals instead of giving up forever.
    const iv = setInterval(async () =>
    {
      if (feedReady) { clearInterval(iv); return; }
      if (await loadFeed()) clearInterval(iv);
    }, 1500);
  })();

  // Network came back: if the engine has a real YTM (ytcfg present) just re-fetch; if it loaded
  // an offline error page (no ytcfg), reload the engine so it fetches a working page.
  window.addEventListener("online", () =>
  {
    const ok = window.ytcfg && window.ytcfg.get && window.ytcfg.get("INNERTUBE_API_KEY");
    if (ok) { feedReady = false; loadFeed(); }
    else location.reload();
  });

  // TuneDeck's Reload button: soft re-fetch, or a hard engine reload if the engine never became
  // ready (e.g. it was loaded while offline) - that is the only way to recover a broken page.
  window.__tunedeckReloadFeed = async function ()
  {
    const ok = window.ytcfg && window.ytcfg.get && window.ytcfg.get("INNERTUBE_API_KEY");
    if (!ok) { location.reload(); return; }
    try { sessionStorage.removeItem("tunedeckFeedCache"); } catch (e) {}
    feedReady = false;
    await loadFeed();
  };
  window.__TAURI__?.event?.listen("ui-ready", () =>
  {
    if (lastFeed) window.__TAURI__?.event?.emit("ytm-feed", lastFeed);
    if (lastPlaylists) window.__TAURI__?.event?.emit("ytm-playlists", lastPlaylists);
    lastQueueSig = "";   // force the next tick to re-emit the queue to a freshly-loaded UI
  })
  window.__tunedeckPlay = function(id, kind)
  {
    if (!id) return;
    let path;
    if (kind === "s") { try { sessionStorage.setItem("tunedeckShuffle", "1"); } catch (e) {} path = "/watch?list=" + String(id).replace(/^VL/, ""); }
    else if (kind === "p") path = "/watch?list=" + String(id).replace(/^VL/, "");
    else if (kind === "b") path = "/browse/" + id;
    else path = "/watch?v=" + id;
    location.assign(path);
  };

  // Called from Rust for playback control. value is 0..100 for seek/volume.
  window.__tunedeckCmd = function(action, value)
  {
    const mp = document.getElementById("movie_player");
    const v = document.querySelector("video");
    if (action === "playpause")
    {
      if (v) { if (v.paused) v.play(); else v.pause(); }
    }
    else if (action === "next") document.querySelector(".next-button")?.click();
    else if (action === "prev") document.querySelector(".previous-button")?.click();
    else if (action === "seek")
    {
      // Duration: prefer the player-response length (reliable), then getDuration, then the
      // raw element. Never gate the seek on getDuration alone - it can be 0 and block it.
      const pr = mp && mp.getPlayerResponse ? mp.getPlayerResponse() : null;
      const len = pr && pr.videoDetails ? parseInt(pr.videoDetails.lengthSeconds, 10) : 0;
      let dur = len > 0 ? len : (mp && mp.getDuration ? mp.getDuration() : 0);
      if (!(dur > 0) && v) dur = v.duration;
      if (dur > 0)
      {
        let t = (value / 100) * dur;
        if (t > dur - 0.75) t = dur - 0.75;   // stay off the very end so YTM won't auto-advance mid-seek
        if (t < 0) t = 0;
        if (mp && mp.seekTo) mp.seekTo(t, true);   // player seek handles MSE buffering
        else if (v) v.currentTime = t;             // fallback
      }
    }
    else if (action === "volume")
    {
      if (mp && mp.setVolume) mp.setVolume(value);
    }
  };

  // Called from Rust to toggle audio-only; persists in the engine's own localStorage
  // so it survives navigation.
  window.__tunedeckSetAudioOnly = function (on)
  {
    audioOnly = !!on;
    try { localStorage.setItem("tunedeckAudioOnly", on ? "1" : "0"); } catch (e) {}
    enforceAudioOnly();
  };

  // Called from Rust to open a playlist: fetch it, emit its data to the UI.
  // Jumps to the i-th queue row (YTM plays that track). The play handler lives on the
  // row's inner #play-button, not the host element, so we click that (same as TuneFrame).
  window.__tunedeckQueueJump = function (index)
  {
    const el = queueRows()[index];
    if (el) el.querySelector("#play-button")?.click();
  };

  // Opens the i-th queue row's ... menu and clicks the item whose text matches rx.
  // The popup renders into a shared container elsewhere in the DOM, hence the wait + global search.
  // This is how YTM natively adds/removes queue items (proven: Add to queue hits get_queue).
  async function queueMenuClick(index, rx)
  {
    const el = queueRows()[index];
    if (!el) return;
    // YTM's menu button is now a plain <button class="ytSpecButtonShapeNextHost">, not the
    // old tp-yt-paper-icon-button — match the button broadly.
    const btn = el.querySelector("ytmusic-menu-renderer button, ytmusic-menu-renderer tp-yt-paper-icon-button, ytmusic-menu-renderer yt-icon-button");
    if (!btn) return;
    btn.click();
    await new Promise((r) => setTimeout(r, 200));   // let the popup mount
    const items = document.querySelectorAll(
      "ytmusic-menu-popup-renderer ytmusic-menu-service-item-renderer, ytmusic-menu-popup-renderer ytmusic-menu-navigation-item-renderer, ytmusic-menu-popup-renderer tp-yt-paper-item"
    );
    for (const it of items)
    {
      if (rx.test(it.textContent || "")) { it.click(); return; }
    }
  }
  // "Move to next": native Play next adds a copy after current, so we then remove the
  // ORIGINAL - the row with the same videoId that is neither the current nor the new copy.
  async function queuePlayNextMove(index)
  {
    const vid = queueRows()[index]?.data?.videoId;
    if (!vid) return;
    await queueMenuClick(index, /play next/i);
    await new Promise((r) => setTimeout(r, 900));   // wait for the async get_queue insert
    const now = queueRows();
    const cur = now.findIndex((el) => el.hasAttribute("selected"));
    const target = now.findIndex((el, i) => el?.data?.videoId === vid && i !== cur && i !== cur + 1);
    if (target >= 0) await queueMenuClick(target, /remove from queue/i);
  }
  window.__tunedeckQueueRemove = (index) => queueMenuClick(index, /remove from queue/i);
  window.__tunedeckQueueMenu = (index, action) =>
    action === "move"     ? queuePlayNextMove(index)
  : action === "playnext" ? queueMenuClick(index, /play next/i)
  : action === "addqueue" ? queueMenuClick(index, /add to queue/i)
  :                         queueMenuClick(index, /remove from queue/i);

  // Adds an arbitrary videoId (e.g. a feed item with no queue row) to the queue by reusing a
  // rendered "Add to queue"/"Play next" menu item with its target videoId swapped, then clicking
  // it. YTM's insert callback is private and only fires from a real menu-item click, so this
  // borrows one. action: "playnext" (after current) or "addqueue" (end).
  async function queueAddVideo(videoId, action)
  {
    if (!videoId) return;
    const row = queueRows()[0];
    if (!row) return;
    const btn = row.querySelector("ytmusic-menu-renderer button, ytmusic-menu-renderer tp-yt-paper-icon-button");
    if (!btn) return;
    btn.click();
    await new Promise((r) => setTimeout(r, 220));
    const rx = action === "playnext" ? /play next/i : /add to queue/i;
    const it = [...document.querySelectorAll("ytmusic-menu-popup-renderer ytmusic-menu-service-item-renderer")].find((x) => rx.test(x.textContent || ""));
    if (!it) return;
    try
    {
      const tgt = it.data.serviceEndpoint.queueAddEndpoint.queueTarget;
      const orig = tgt.videoId;
      tgt.videoId = videoId;
      it.click();
      setTimeout(() => { try { tgt.videoId = orig; } catch (e) {} }, 300);   // restore the borrowed item
    }
    catch (e) {}
  }
  window.__tunedeckQueueAdd = (videoId, action) => queueAddVideo(videoId, action);

  window.__tunedeckOpenPlaylist = async function (id)
  {
    try
    {
      const pl = await fetchPlaylist(id);
      if (pl) window.__TAURI__?.event?.emit("ytm-playlist", pl);
    }
    catch (e) {}
  };

  window.__tunedeckAction = async function (action, id)
  {
    // toggles like for the CURRENT song by clicking the engine's own button, so the engine
    // UI (and our next snapshot) stay in sync. No id needed.
    if (action === "like-current")
    {
      const bar = document.querySelector("ytmusic-player-bar");
      const btn = bar && [...bar.querySelectorAll("button[aria-label]")].find((b) =>
      {
        const a = b.getAttribute("aria-label").toLowerCase();
        return (a.includes("like") || a.includes("lubi")) && !a.includes("dis") && !a.includes("nie lubi");
      });
      if (btn) btn.click();
      return;
    }
    if (!id) return;
    if (action === "radio") { location.assign("/watch?v=" + id + "&list=RDAMVM" + id); return; }
    if (action === "like" || action === "unlike")
    {
      try
      {
        const key = window.ytcfg.get("INNERTUBE_API_KEY");
        const ctx = window.ytcfg.get("INNERTUBE_CONTEXT");
        const headers = await authHeaders();
        const ep = action === "like" ? "like/like" : "like/removelike";
        await fetch("/youtubei/v1/" + ep + "?key=" + key, {
          method: "POST", credentials: "include", headers,
          body: JSON.stringify({ context: ctx, target: { videoId: id } })
        });
      }
      catch (e) {}
    }
  };
})();
