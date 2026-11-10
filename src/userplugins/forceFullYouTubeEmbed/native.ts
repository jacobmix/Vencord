import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, session } from "electron";

const SOURCE_URL = "https://raw.githubusercontent.com/YoutubeQuirks/LightWork/refs/heads/main/LightWork.user.js";
const PRELOAD_ID = "vencord-force-full-youtube-embed";

let registeredPreloadId: string | undefined;

function isExpectedLightWork(source: string): boolean {
    return source.startsWith("/*\nCopyright © 2026 YoutubeQuirks")
        && source.includes("@name         LightWork")
        && source.includes("LightWork_init();");
}

async function getLightWorkSource(lightWorkFile: string): Promise<string> {
    // Keep the first verified copy locally so startup does not depend on GitHub
    // being reachable every time Discord launches. Delete this file to refresh it.
    try {
        const cached = await readFile(lightWorkFile, "utf8");
        if (isExpectedLightWork(cached)) return cached;
    } catch {
        // First install or missing cache: download below.
    }

    const response = await fetch(SOURCE_URL, {
        headers: { "User-Agent": "Vencord-ForceFullYouTubeEmbed" },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(`Could not download LightWork (HTTP ${response.status}).`);
    }

    const source = await response.text();
    if (source.length > 1_500_000 || !isExpectedLightWork(source)) {
        throw new Error("The downloaded LightWork source failed its sanity checks.");
    }

    await writeFile(lightWorkFile, source, "utf8");
    return source;
}

function makeFramePreload(source: string): string {
    // Electron executes this registered frame preload before the YouTube page's
    // own scripts. executeInMainWorld runs LightWork in the page's real JS world
    // (not the isolated preload world), which is required to patch YT player init.
    // The embedded LightWork source and its original copyright header are kept
    // intact in LIGHTWORK_FILE and copied verbatim into this generated preload.
    return `/*
Copyright © 2026 YoutubeQuirks (https://github.com/YoutubeQuirks).
Permission is granted to modify and use this file for personal or public use, provided that the modifications do not aim to
hide the script’s original identity or trademarks.
This copyright notice must remain at the top of the file and not be modified.
*/

const { contextBridge } = require("electron");

if (typeof contextBridge?.executeInMainWorld !== "function") {
    console.error("[ForceFullYouTubeEmbed] Electron contextBridge.executeInMainWorld is unavailable.");
} else {
    try {
        contextBridge.executeInMainWorld({
            func: () => {
${source}
            }
        });
    } catch (error) {
        console.error("[ForceFullYouTubeEmbed] Failed to initialize LightWork in the YouTube frame:", error);
    }
}
`;
}

export async function start() {
    if (registeredPreloadId) return;

    await app.whenReady();

    const ses = session.defaultSession;
    if (typeof ses.registerPreloadScript !== "function") {
        throw new Error("This Electron build does not expose Session.registerPreloadScript; update Discord/Vencord.");
    }

    const pluginDataDir = join(app.getPath("userData"), "..", "Vencord", "forceFullYouTubeEmbed");
    const lightWorkFile = join(pluginDataDir, "LightWork.user.js");
    const preloadFile = join(pluginDataDir, "lightwork-frame-preload.js");

    await mkdir(pluginDataDir, { recursive: true });
    const lightWorkSource = await getLightWorkSource(lightWorkFile);
    await writeFile(preloadFile, makeFramePreload(lightWorkSource), "utf8");

    registeredPreloadId = ses.registerPreloadScript({
        type: "frame",
        id: PRELOAD_ID,
        filePath: preloadFile,
        matches: [
            "https://youtube.com/embed/*",
            "https://*.youtube.com/embed/*",
            "https://youtube-nocookie.com/embed/*",
            "https://*.youtube-nocookie.com/embed/*"
        ]
    });

    console.info("[ForceFullYouTubeEmbed] Registered document-start preload for YouTube embed frames. Cache:", lightWorkFile);
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
