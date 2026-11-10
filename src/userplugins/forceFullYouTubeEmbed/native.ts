import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, session } from "electron";

const SOURCE_URL = "https://raw.githubusercontent.com/YoutubeQuirks/LightWork/refs/heads/main/LightWork.user.js";
const PRELOAD_ID = "vencord-force-full-youtube-embed";
const MESSAGE_KEY = "__FORCE_FULL_YOUTUBE_EMBED_DIAGNOSTIC__";

let registeredPreloadId: string | undefined;
let lightWorkFilePath: string | undefined;
let preloadFilePath: string | undefined;
let lightWorkVersion: string | undefined;

function isExpectedLightWork(source: string): boolean {
    return source.startsWith("/*\nCopyright © 2026 YoutubeQuirks")
        && source.includes("@name         LightWork")
        && source.includes("LightWork_init();");
}

async function getLightWorkSource(lightWorkFile: string): Promise<string> {
    try {
        const cached = await readFile(lightWorkFile, "utf8");
        if (isExpectedLightWork(cached)) return cached;
    } catch {
        // No cached script yet; download the upstream copy below.
    }

    const response = await fetch(SOURCE_URL, {
        headers: { "User-Agent": "Vencord-ForceFullYouTubeEmbed" },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store"
    });

    if (!response.ok) throw new Error(`Could not download LightWork (HTTP ${response.status}).`);

    const source = await response.text();
    if (source.length > 1_500_000 || !isExpectedLightWork(source)) {
        throw new Error("The downloaded LightWork source failed its sanity checks.");
    }

    await writeFile(lightWorkFile, source, "utf8");
    return source;
}

function makeFramePreload(source: string): string {
    const serializedSource = JSON.stringify(source);
    const serializedKey = JSON.stringify(MESSAGE_KEY);

    return `/* ForceFullYouTubeEmbed YouTube frame preload */
'use strict';

const { contextBridge } = require('electron');
const DIAG_KEY = ${serializedKey};
const LIGHTWORK_SOURCE = ${serializedSource};

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

report('frame-preload-ran');

if (typeof contextBridge?.executeInMainWorld !== 'function') {
    report('executeInMainWorld-unavailable', 'This Electron build does not expose contextBridge.executeInMainWorld.');
    console.error('[ForceFullYouTubeEmbed] contextBridge.executeInMainWorld is unavailable in this YouTube frame.');
} else {
    try {
        contextBridge.executeInMainWorld({
            func: (lightWorkSource, diagnosticKey) => {
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

                window.__FORCE_FULL_YOUTUBE_EMBED__ = {
                    injectedAt: Date.now(),
                    href: location.href,
                    lightWorkLoaded: false
                };

                reportFromPage('main-world-injection-started', 'fullscreenEnabled=' + document.fullscreenEnabled);
                window.addEventListener('LightWorkLoaded', () => {
                    window.__FORCE_FULL_YOUTUBE_EMBED__.lightWorkLoaded = true;
                    reportFromPage('LightWorkLoaded', 'fullscreenEnabled=' + document.fullscreenEnabled);
                }, { once: true });

                try {
                    // LightWork must run in the page's main world at document-start.
                    (0, eval)(lightWorkSource);
                    reportFromPage('LightWork-script-evaluated');
                } catch (error) {
                    reportFromPage('LightWork-eval-error', error?.stack || error);
                    console.error('[ForceFullYouTubeEmbed] LightWork evaluation failed:', error);
                }
            },
            args: [LIGHTWORK_SOURCE, DIAG_KEY]
        });
    } catch (error) {
        report('executeInMainWorld-threw', error?.stack || error);
        console.error('[ForceFullYouTubeEmbed] executeInMainWorld failed:', error);
    }
}
`;
}

async function currentStatus() {
    const ses = session.defaultSession;
    let registeredScripts: unknown = "getPreloadScripts unavailable";

    try {
        registeredScripts = typeof ses.getPreloadScripts === "function"
            ? ses.getPreloadScripts().map(script => ({
                id: script.id,
                type: script.type,
                filePath: script.filePath,
                matches: script.matches
            }))
            : registeredScripts;
    } catch (error) {
        registeredScripts = `getPreloadScripts failed: ${String(error)}`;
    }

    let cachedBytes: number | null = null;
    if (lightWorkFilePath) {
        try {
            cachedBytes = (await stat(lightWorkFilePath)).size;
        } catch { }
    }

    return {
        electronVersion: process.versions.electron,
        registerPreloadScriptAvailable: typeof ses.registerPreloadScript === "function",
        executeInMainWorldExpected: true,
        registeredPreloadId: registeredPreloadId ?? null,
        lightWorkVersion: lightWorkVersion ?? null,
        lightWorkCachePath: lightWorkFilePath ?? null,
        lightWorkCacheBytes: cachedBytes,
        preloadFilePath: preloadFilePath ?? null,
        registeredScripts
    };
}

export async function start() {
    if (registeredPreloadId) return currentStatus();

    await app.whenReady();

    const ses = session.defaultSession;
    if (typeof ses.registerPreloadScript !== "function") {
        throw new Error(`Electron ${process.versions.electron} does not expose Session.registerPreloadScript. A newer Electron/Vencord desktop build is required for document-start frame injection.`);
    }

    const pluginDataDir = join(app.getPath("userData"), "..", "Vencord", "forceFullYouTubeEmbed");
    lightWorkFilePath = join(pluginDataDir, "LightWork.user.js");
    preloadFilePath = join(pluginDataDir, "lightwork-frame-preload.js");

    await mkdir(pluginDataDir, { recursive: true });
    const source = await getLightWorkSource(lightWorkFilePath);
    lightWorkVersion = source.match(/@version\s+([^\s]+)/)?.[1] ?? "unknown";
    await writeFile(preloadFilePath, makeFramePreload(source), "utf8");

    // Avoid registering duplicate copies if the plugin's native module was reloaded.
    try {
        const existing = typeof ses.getPreloadScripts === "function"
            ? ses.getPreloadScripts().find(script => script.id === PRELOAD_ID)
            : undefined;
        if (existing) ses.unregisterPreloadScript(existing.id);
    } catch (error) {
        console.warn("[ForceFullYouTubeEmbed] Could not inspect an older preload registration:", error);
    }

    registeredPreloadId = ses.registerPreloadScript({
        type: "frame",
        id: PRELOAD_ID,
        filePath: preloadFilePath,
        matches: [
            "https://youtube.com/embed/*",
            "https://*.youtube.com/embed/*",
            "https://youtube-nocookie.com/embed/*",
            "https://*.youtube-nocookie.com/embed/*"
        ]
    });

    console.info("[ForceFullYouTubeEmbed] Registered YouTube frame preload", {
        electronVersion: process.versions.electron,
        id: registeredPreloadId,
        filePath: preloadFilePath,
        lightWorkVersion
    });

    return currentStatus();
}

export async function getStatus() {
    return currentStatus();
}

export async function stop() {
    if (!registeredPreloadId) return;

    try {
        session.defaultSession.unregisterPreloadScript(registeredPreloadId);
        console.info("[ForceFullYouTubeEmbed] Unregistered YouTube frame preload.");
    } finally {
        registeredPreloadId = undefined;
    }
}
