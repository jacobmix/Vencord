# ForceFullYouTubeEmbed v3

A Vencord userplugin that identifies portrait YouTube embeds (such as Shorts), gives the iframe a 16:9 landscape viewport, ensures fullscreen permission is present, and adds a small parent-side fullscreen fallback control in the top-right of Shorts embeds. The fallback button fullscreenes the Discord embed container, so it works even when YouTube's own Shorts toolbar omits its fullscreen control.

## Why this build is different

- The previous native method used the first native IPC argument as the LightWork setting. Vencord injects `IpcMainInvokeEvent` as argument 1, so the user setting must be argument 2. This build fixes that.
- The native method now returns only a string. Vencord requires every native return value to be serializable using the structured-clone algorithm; complex Electron status objects can fail with `An object could not be cloned`.
- LightWork is not loaded and no native preload is registered unless the user explicitly enables **Use LightWork legacy player UI**.
- The automatic LightWork retry navigation is disabled to avoid iframe reload loops.
- Portrait embed dimensions are applied to the iframe and its Discord wrapper, not just to a broad CSS selector.
- A dedicated fullscreen fallback button is added over each portrait embed. It uses the browser Fullscreen API from a direct click and also serves as the exit-fullscreen control.
- An existing `allow="autoplay; fullscreen"` is preserved. The invalid `allow-fullscreen` sandbox token is removed if present; all other sandbox restrictions remain.

## Install

1. Fully close Discord.
2. Remove the previous `forceFullYouTubeEmbed` folder from `Vencord/src/userplugins/`.
3. Extract this archive and copy the included `forceFullYouTubeEmbed` folder into `Vencord/src/userplugins/`.
4. Verify the files are at:
   - `Vencord/src/userplugins/forceFullYouTubeEmbed/index.ts`
   - `Vencord/src/userplugins/forceFullYouTubeEmbed/native.ts`
5. Rebuild Vencord and restart Discord.
6. Test a Short. A new square-corners fullscreen button should appear in the top-right of the Shorts player. Click it to fullscreen the player area; click it again or press Esc to exit.
7. The setting **Use LightWork legacy player UI** is OFF by default. Enable it only if you also want to try restoring YouTube's older built-in controls, then fully restart Discord.

## LightWork security note

Enabling **Use LightWork legacy player UI** downloads the open-source LightWork userscript from `YoutubeQuirks/LightWork` and executes it inside YouTube embed frames. It is an optional third-party script and is disabled by default. Review the upstream source before enabling it:

- https://github.com/YoutubeQuirks/LightWork
- https://github.com/YoutubeQuirks/LightWork/blob/main/LightWork.user.js

The plugin pins LightWork to upstream commit `9ed4f14df6606ebddea1ca3228f1964b3582496f` (November 8, 2026) rather than following a moving branch. It caches that exact downloaded script in Vencord's user data directory. I inspected this source snapshot for this build; it contains YouTube-player code and no Discord token or message-reading logic. This is not a guarantee about other LightWork revisions.

## Diagnostics

- `Added parent-side fullscreen fallback button to Shorts embed` confirms the replacement button was inserted.
- `Fullscreen fallback failed` reports why the browser rejected a fullscreen request, if that happens.

Open the Discord developer console and filter for `ForceFullYouTubeEmbed`.

- `Applied landscape viewport to portrait YouTube embed` reports the actual iframe rectangle after the style changes.
- `YouTube iframe inspection` reports the `fs` and `controls` query parameters and the iframe `allow` policy.
- `LightWork preload: registered` means the native preload registration succeeded.
- `frame-preload-ran` means Electron executed the preload inside a YouTube frame.
- `LightWorkLoaded` means the legacy player started loading.
- `LightWork-skipped-player-already-started` means the embed loaded before the preload could patch the player; no automatic reload is attempted.
