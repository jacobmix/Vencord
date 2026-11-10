# ForceFullYouTubeEmbed (Vencord userplugin)

This plugin targets Discord's YouTube embeds, especially portrait Shorts embeds.

## What it changes

- Adds `allow="fullscreen"`, `allowfullscreen`, and `webkitallowfullscreen` to YouTube embed iframes.
- Rewrites explicit `fs=0` / `controls=0` embed parameters to `1`.
- Reloads an iframe once after changing its permissions, so Chromium creates the frame with the updated fullscreen policy.
- Uses an Electron frame preload to run the upstream [LightWork](https://github.com/YoutubeQuirks/LightWork) script in YouTube's main world at document-start.
- Widens portrait Shorts embeds to a 16:9 viewport in Discord.

## Installation

1. Extract the `forceFullYouTubeEmbed` folder into your Vencord source tree at:

   `Vencord/src/userplugins/forceFullYouTubeEmbed/`

2. Confirm the folder contains `index.ts`, `native.ts`, and `README.md`.
3. Rebuild/reinstall your Vencord development build using your usual Vencord build process.
4. Enable **ForceFullYouTubeEmbed** in Vencord settings and fully restart Discord.
5. Open a Shorts embed. If one was already loaded when the plugin started, the plugin refreshes that iframe once so the preload and fullscreen permission can take effect.

## Diagnostics

Open Discord's developer console and filter for `ForceFullYouTubeEmbed`.

Expected messages include:

- `Native preload registered` — the native code registered the Electron frame preload.
- `frame-preload-ran` — Electron executed the preload in a YouTube iframe.
- `main-world-injection-started` — the preload entered the YouTube page's main world. Its detail reports `fullscreenEnabled=true/false`.
- `LightWorkLoaded` — LightWork finished its player setup.

If you never see `frame-preload-ran`, check whether the native registration succeeded and whether the embed URL is an `/embed/` URL on `youtube.com` or `youtube-nocookie.com`.

If the frame reports `fullscreenEnabled=false` even after the iframe was updated, the parent document's Permissions Policy may be denying fullscreen. This plugin can add the iframe permission but cannot override a restrictive policy sent by Discord.

## LightWork source and cache

The native helper downloads the upstream LightWork userscript from the YoutubeQuirks GitHub repository the first time it starts, validates its identifying header, and caches it under the Vencord application data directory. The cache is reused on later starts. To fetch a newer LightWork version, close Discord and delete `LightWork.user.js` in the `forceFullYouTubeEmbed` data folder; the plugin downloads it again at next startup.

LightWork is a separate third-party project, currently described by its author as beta. This plugin does not include or claim to maintain LightWork. See `LightWork-LICENSE.txt` and the [upstream project](https://github.com/YoutubeQuirks/LightWork).
