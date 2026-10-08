# TODO

Rough backlog, not promises. Ordered loosely by what's next.

## Next
- Demo mode: launch without a YTM login or hardware, UI fed by canned data, so the
  whole thing can be clicked through (decide on/off switch and how deep it fakes
  playback)
- Screenshots + a "Screens" section in the README once the UI is settled

## Distribution
- Prebuilt installer / release so people don't have to build it themselves
- Sort out which OSes to actually support and test

## Features / polish
- Context-menu actions that are still missing
- Media-key / keyboard-shortcut handling
- Accent presets + light-theme pass
- Benchmark idle/playback RAM+CPU and startup time vs the site in a browser and an
  existing wrapper - only claim "lighter/faster" in the README if it's measured

## Plugins
- Sandbox + permissions model for JS plugins (currently unsandboxed)
- Revisit the ad-skip plugin idea - risky, low priority; I'm on Premium anyway

## Bigger / maybe
- Group listening (own sync + backend, probably a plugin)
- TuneFrame: external tactile buttons (firmware side)
- Local music download + caching the rest of the data - would mean storing user data,
  so only with care, and not in a way that's blatant against YouTube's terms. Needs
  thought before it goes anywhere near shipping.


Like button on miniplayer