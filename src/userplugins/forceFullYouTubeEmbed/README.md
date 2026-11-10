# ForceFullYouTubeEmbed (diagnostic build)

This Vencord userplugin adjusts YouTube embed permissions, removes the invalid `allow-fullscreen` sandbox token if it is present, enables `fs=1`/`controls=1` when explicitly disabled, and widens portrait Shorts embeds.

## Important: first test with LightWork disabled

The plugin setting **Use LightWork legacy player UI** is off by default. Keep it off for the first test. This runs YouTube's own current embed player and lets us check whether the freeze is caused by the experimental LightWork player replacement or by the Discord iframe itself.

Once playback is stable, you can turn that setting on and restart Discord to test LightWork. LightWork is a beta third-party userscript; this build disables its automatic iframe-reload retry so a late injection cannot repeatedly navigate the embedded player.

## Install

1. Extract this archive.
2. Copy the `forceFullYouTubeEmbed` folder into `Vencord/src/userplugins/`.
3. Make sure the result is `Vencord/src/userplugins/forceFullYouTubeEmbed/index.ts` and `native.ts`.
4. Rebuild Vencord and fully restart Discord.
5. Test a YouTube Short while **Use LightWork legacy player UI** remains off.

## What changed in this build

- `allow="fullscreen"` is the only fullscreen permission written by the plugin. The redundant legacy `allowfullscreen` attribute is removed to avoid Chromium's precedence warning.
- The invalid `allow-fullscreen` token is removed from `sandbox`, while every other sandbox restriction is preserved.
- The plugin no longer reloads an iframe just because its permission attributes changed. It only changes the iframe URL if `fs=0` or `controls=0` is explicitly present.
- LightWork is optional and disabled by default. When enabled, it runs in the iframe's main world through Electron's `contextBridge.executeInMainWorld` and its upstream automatic reload retry is disabled.
- The console reports whether the frame preload actually ran and whether LightWork loaded.

## Useful console messages

Filter the developer console for `ForceFullYouTubeEmbed`:

- `Prepared YouTube iframe` — the parent iframe was found and inspected.
- `Removed invalid 'allow-fullscreen' token` — the bad sandbox token was found and removed.
- `frame-preload-ran` — Electron's frame preload executed inside the YouTube iframe.
- `LightWork-disabled` — the native YouTube player is being used (expected in the first test).
- `LightWorkLoaded` — the legacy player successfully began loading (only when enabled).

If the video still freezes with LightWork disabled, the issue is not caused by LightWork's legacy-player patch. Send the `ForceFullYouTubeEmbed` messages and the iframe's `allow`/`sandbox` values from `Prepared YouTube iframe`.
