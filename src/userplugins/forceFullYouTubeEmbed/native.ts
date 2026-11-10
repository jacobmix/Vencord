import { app, session, type IpcMainInvokeEvent } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SOURCE_COMMIT = "9ed4f14df6606ebddea1ca3228f1964b3582496f";
const SOURCE_URL = `https://raw.githubusercontent.com/YoutubeQuirks/LightWork/${SOURCE_COMMIT}/LightWork.user.js`;
const PRELOAD_ID = "vencord-force-full-youtube-embed-v3";
const MESSAGE_KEY = "__FORCE_FULL_YOUTUBE_EMBED_V3_DIAGNOSTIC__";

let registeredPreloadId: string | undefined;

function isExpectedLightWork(source: string): boolean {
    return source.startsWith("/*\nCopyright © 2026 YoutubeQuirks")
        && source.includes("@name         LightWork")
        && source.includes("LightWork_init();");
}

async function getLightWorkSource(cachePath: string): Promise<string> {
    try {
        const cached = await readFile(cachePath, "utf8");
        if (isExpectedLightWork(cached)) return cached;
    } catch {
        // Cache miss: fetch the pinned upstream project URL below.
    }

    const response = await fetch(SOURCE_URL, {
        headers: { "User-Agent": "Vencord-ForceFullYouTubeEmbed" },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store"
    });
    if (!response.ok) throw new Error(`LightWork download failed (HTTP ${response.status}).`);

    const source = await response.text();
    if (source.length > 1_500_000 || !isExpectedLightWork(source)) {
        throw new Error("Downloaded LightWork source did not pass the expected-source checks.");
    }

    await writeFile(cachePath, source, "utf8");
    return source;
}

function makeFramePreload(lightWorkSource: string): string {
    return `/* ForceFullYouTubeEmbed v3 YouTube-frame preload */
'use strict';

const DIAG_KEY = ${JSON.stringify(MESSAGE_KEY)};
const LIGHTWORK_SOURCE = ${JSON.stringify(lightWorkSource)};
const report = (status, detail) => {
    try {
        window.parent.postMessage({
            [DIAG_KEY]: true,
            status,
            href: location.href,
            detail: detail == null ? null : String(detail)
        }, '*');
    } catch (_) { }
};

report('frame-preload-ran', 'document.fullscreenEnabled=' + document.fullscreenEnabled);

try {
    const { contextBridge } = require('electron');
    if (typeof contextBridge?.executeInMainWorld !== 'function') {
        report('executeInMainWorld-unavailable', 'This Electron build does not expose contextBridge.executeInMainWorld.');
        console.error('[ForceFullYouTubeEmbed] contextBridge.executeInMainWorld is unavailable.');
    } else {
        contextBridge.executeInMainWorld({
            func: (source, diagnosticKey) => {
                const reportFromPage = (status, detail) => {
                    try {
                        window.parent.postMessage({
                            [diagnosticKey]: true,
                            status,
                            href: location.href,
                            detail: detail == null ? null : String(detail)
                        }, '*');
                    } catch (_) { }
                };

                if (window.__FORCE_FULL_YOUTUBE_EMBED_V3__) {
                    reportFromPage('LightWork-already-injected');
                    return;
                }
                if (window._yt_player) {
                    reportFromPage('LightWork-skipped-player-already-started', 'Player bootstrap already exists; no forced reload was attempted.');
                    return;
                }

                window.__FORCE_FULL_YOUTUBE_EMBED_V3__ = { startedAt: Date.now(), loaded: false };
                window.addEventListener('LightWorkLoaded', () => {
                    window.__FORCE_FULL_YOUTUBE_EMBED_V3__.loaded = true;
                    reportFromPage('LightWorkLoaded', 'Legacy embedded player started loading.');
                }, { once: true });

                // Disable upstream's retry navigation. A late injection is reported,
                // not handled by reloading the Discord iframe in a loop.
                source = source.replace(
                    /let LightWork_retryInjection\\s*=\\s*true\\s*;/,
                    'let LightWork_retryInjection = false;'
                );

                try {
                    (0, eval)(source);
                    reportFromPage('LightWork-script-evaluated');
                } catch (error) {
                    reportFromPage('LightWork-eval-error', error?.stack || error);
                    console.error('[ForceFullYouTubeEmbed] LightWork evaluation failed:', error);
                }
            },
            args: [LIGHTWORK_SOURCE, DIAG_KEY]
        });
    }
} catch (error) {
    report('main-world-injection-error', error?.stack || error);
    console.error('[ForceFullYouTubeEmbed] Main-world injection failed:', error);
}
`;
}

/**
 * Vencord injects IpcMainInvokeEvent as the first argument of every native
 * function. The user option is therefore the SECOND argument. Returning only
 * a string avoids Electron structured-clone failures from complex status data.
 */
export async function start(_event: IpcMainInvokeEvent, enableLightWork = false): Promise<string> {
    if (!enableLightWork) return "skipped: LightWork is disabled";
    if (registeredPreloadId) return "already registered";

    await app.whenReady();
    const ses = session.defaultSession;
    if (typeof ses.registerPreloadScript !== "function") {
        throw new Error(`Electron ${process.versions.electron} does not support Session.registerPreloadScript.`);
    }

    const dataDir = join(app.getPath("userData"), "..", "Vencord", "forceFullYouTubeEmbed");
    const sourcePath = join(dataDir, `LightWork-${SOURCE_COMMIT}.user.js`);
    const preloadPath = join(dataDir, "youtube-frame-preload-v3.js");
    await mkdir(dataDir, { recursive: true });

    let source = await getLightWorkSource(sourcePath);
    // Avoid any upstream navigation retry if the player bundle has loaded too early.
    source = source.replace(
        /let LightWork_retryInjection\s*=\s*true\s*;/,
        "let LightWork_retryInjection = false;"
    );
    await writeFile(preloadPath, makeFramePreload(source), "utf8");

    // Remove any previous registration with our v3 ID if the plugin restarted.
    try {
        const previous = ses.getPreloadScripts().find(script => script.id === PRELOAD_ID);
        if (previous) ses.unregisterPreloadScript(previous.id);
    } catch (error) {
        console.warn("[ForceFullYouTubeEmbed] Could not inspect an old v3 preload registration:", String(error));
    }

    registeredPreloadId = ses.registerPreloadScript({
        type: "frame",
        id: PRELOAD_ID,
        filePath: preloadPath,
        matches: [
            "https://youtube.com/embed/*",
            "https://*.youtube.com/embed/*",
            "https://youtube-nocookie.com/embed/*",
            "https://*.youtube-nocookie.com/embed/*"
        ]
    });

    console.info("[ForceFullYouTubeEmbed] Registered optional LightWork preload", {
        electronVersion: process.versions.electron,
        id: registeredPreloadId,
        lightWorkCommit: SOURCE_COMMIT,
        filePath: preloadPath
    });

    // IMPORTANT: native IPC return values must be structured-cloneable.
    return "registered";
}

export async function stop(_event: IpcMainInvokeEvent): Promise<string> {
    if (!registeredPreloadId) return "not registered";
    try {
        session.defaultSession.unregisterPreloadScript(registeredPreloadId);
    } finally {
        registeredPreloadId = undefined;
    }
    return "unregistered";
}
