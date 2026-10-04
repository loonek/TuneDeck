// Example TuneDeck JS plugin. Logs each track change; the greeting is configurable in Settings.
let last = "";
tunedeck.onTrack((t) =>
{
  if (!t.id || t.id === last) return;
  last = t.id;
  tunedeck.log(`${tunedeck.config.get("greeting")}: ${t.title} - ${t.artist}`);
});
tunedeck.onConfig((key, value) => tunedeck.log(`config ${key} = ${value}`));
