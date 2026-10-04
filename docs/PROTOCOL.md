# TuneDeck Serial Protocol (TDSP) v1

A small, self-describing link between TuneDeck (host, on a PC) and a serial device (ESP32 or
anything with a UART / USB-CDC). TuneFrame is the reference device, but the protocol is meant
for **any** project: a desk display, an LED strip, an e-ink badge. Implement only the frames
you care about and ignore the rest.

## Wire format

- **Transport:** serial, 115200 8N1 by default. On a native USB-CDC device (e.g. ESP32-S3) the
  baud value is nominal and real throughput is far higher, so raw RGB565 art is practical.
- **Framing:** text frames are one JSON object per line, UTF-8, terminated by `\n`, each with a
  string field `t` (the type). Binary payloads (art/thumbnail pixels) follow their header frame
  as raw bytes (see `art`).
- **Direction:** host -> device for data; device -> host for `cmd`, the handshake `sub`, and the
  binary-chunk `ok` ack.
- **Forward compatibility:** a device MUST ignore any frame whose `t` it does not know and any
  field it does not use. The host may add frames/fields later without bumping `proto`.

## Handshake (capability negotiation)

1. On connecting, the host sends:
   `{"t":"hello","proto":1,"app":"TuneDeck","frames":["np","queue","feed","playlist","art"]}`
2. The device MAY reply once with what it wants:
   `{"t":"sub","frames":["np","queue","feed","playlist","art"],"art":{"w":200,"h":200},"thumb":96,"queue":50,"feed":64}`
   - `frames`: which families to send. Omit = send everything.
   - `art.w/h`: cover art pixel size the host scales to. `thumb`: feed-thumbnail pixel size.
   - `queue`/`feed`: max item counts.
3. If the device sends no `sub` within **1 second**, the host sends **everything** (default
   profile). So the reference TuneFrame firmware works with or without answering the handshake.
4. The handshake re-runs on every reconnect.

A minimal device needs no handshake code at all: just parse the frames it cares about.

## Host -> device frames

### `np` — now playing (pushed ~1x/second)
```
{"t":"np","status":"playing","title":"Song","artist":"Artist","vid":"VIDEOID","pos":42,"dur":210,"vol":80}
```
- `status`: `playing` | `paused` | `none` (nothing playing). `pos`/`dur` whole seconds.
- `vid` is the video id, used by the device to detect a track change. `vol` 0..100 (may be absent).

### `queue` — qb / qi* / qe (sent when the device asks via `cmd {"a":"queue"}`)
```
{"t":"qb"}
{"t":"qi","title":"Track","sub":"Artist","cur":true}
{"t":"qe"}
```
- `cur` marks the currently playing row.

### `playlist` — pb / pi* / pe (sent after the device asks via `cmd {"a":"playlist","id":...}`)
```
{"t":"pb","title":"Playlist name"}
{"t":"pi","title":"Track","sub":"Artist"}
{"t":"pe"}
```

### `feed` — fb / fs* / fi* / fe (sent when the device asks via `cmd {"a":"feed"}`)
```
{"t":"fb"}
{"t":"fs","title":"Section","k":""}
{"t":"fi","title":"Item","sub":"Subtitle","id":"ID","k":"v|p|b"}
{"t":"fe"}
```
- `k` is the item kind: `v` song, `p` playlist/mix, `b` album/browse. The device echoes `id`+`k`
  back in a `play` command to start it.

### `art` — cover image (sent on track change, if subscribed)
A header frame, then the raw pixels of the cover scaled to `w`x`h`, as **RGB565 little-endian**
(2 bytes/pixel, low byte first), streamed in chunks of at most 4096 bytes. The device ACKs each
chunk by sending `{"t":"ok"}` so the host paces to the device's buffer:
```
{"t":"art","w":200,"h":200}
<w*h*2 raw bytes, in <=4096-byte chunks; device sends {"t":"ok"} after each>
```
Feed thumbnails use the same scheme under type `ft` with an extra `i` (the feed item index):
```
{"t":"ft","i":3,"w":96,"h":96}
<w*h*2 raw bytes, chunked + acked>
```

## Device -> host frames

### `cmd` — control / requests
```
{"t":"cmd","a":"playpause"}
```
`a` is one of: `prev`, `next`, `playpause`, `vol_up`, `vol_down` (transport);
`queue` (send me the queue), `feed` (send me the feed);
`play` with `id` + `k` (play that feed item); `qjump` with `id` = queue index (string);
`playlist` with `id` = playlist id (open it; the host answers with the `playlist` frames).

### `ok` — binary-chunk ack
`{"t":"ok"}` after each received art/thumbnail chunk (see `art`).

### `sub` — handshake reply
See **Handshake**.

## Notes for device authors
- Parse text frames line by line (ArduinoJson or simple key spotting). Binary pixels follow the
  `art`/`ft` header as raw bytes, not JSON.
- You only implement what you need: an LED strip can read just `np.status`.
