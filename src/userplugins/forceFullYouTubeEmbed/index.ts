import { definePluginSettings } from "@api/Settings";
import definePlugin, { PluginNative, OptionType } from "@utils/types";

const Native = VencordNative.pluginHelpers.ForceFullYouTubeEmbed as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    useLightWork: {
        type: OptionType.BOOLEAN,
        description: "Opt in to LightWork's third-party legacy YouTube embed UI. This downloads and runs LightWork inside YouTube frames; leave off for the built-in player.",
        default: false,
        restartNeeded: true
    }
});

const STYLE_ID = "vc-force-full-youtube-embed-v3";
const FULLSCREEN_BUTTON_CLASS = "vc-ffyt-fullscreen-button";
const FRAME_SELECTOR = [
    'iframe[src*="youtube.com/embed/"]',
    'iframe[src*="youtube-nocookie.com/embed/"]'
].join(",");
const MESSAGE_KEY = "__FORCE_FULL_YOUTUBE_EMBED_V3_DIAGNOSTIC__";

// Use a landscape-sized iframe viewport for portrait (Shorts) embeds. YouTube's
// embedded player chooses its responsive control layout from the iframe viewport.
const LANDSCAPE_CSS = `
article[class*="embedFull"]:has(iframe[data-vc-ffyt-short="1"]) {
    width: min(432px, 100%) !important;
    max-width: 432px !important;
}
article[class*="embedFull"]:has(iframe[data-vc-ffyt-short="1"]) [class*="gridContainer"],
article[class*="embedFull"]:has(iframe[data-vc-ffyt-short="1"]) [class*="grid"] {
    width: 100% !important;
    max-width: 100% !important;
}
article[class*="embedFull"]:has(iframe[data-vc-ffyt-short="1"]) [class*="embedMedia"] {
    width: 400px !important;
    max-width: 100% !important;
    max-height: 225px !important;
}
article[class*="embedFull"]:has(iframe[data-vc-ffyt-short="1"]) [class*="embedVideo"] {
    position: relative !important;
    width: 400px !important;
    max-width: 100% !important;
    height: 0 !important;
    padding-bottom: 56.25% !important;
}
article[class*="embedFull"]:has(iframe[data-vc-ffyt-short="1"]) iframe[data-vc-ffyt-short="1"] {
    position: absolute !important;
    inset: 0 !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    max-width: 100% !important;
    max-height: 100% !important;
}
.${FULLSCREEN_BUTTON_CLASS} {
    position: absolute !important;
    top: 8px !important;
    right: 8px !important;
    z-index: 2147483647 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 36px !important;
    height: 36px !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 4px !important;
    background: rgba(0, 0, 0, .76) !important;
    color: #fff !important;
    cursor: pointer !important;
    opacity: .94 !important;
}
.${FULLSCREEN_BUTTON_CLASS}:hover {
    background: rgba(0, 0, 0, .95) !important;
    opacity: 1 !important;
}
.${FULLSCREEN_BUTTON_CLASS} svg {
    display: block !important;
    width: 20px !important;
    height: 20px !important;
}
`;


let observer: MutationObserver | undefined;
let messageListener: ((event: MessageEvent) => void) | undefined;
let fullscreenListener: (() => void) | undefined;
let nativeStarted = false;

interface InlineStyleSnapshot {
    value: string;
    priority: string;
}
const originalInlineStyles = new Map<HTMLElement, Map<string, InlineStyleSnapshot>>();

function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = LANDSCAPE_CSS;
    (document.head ?? document.documentElement).appendChild(style);
}

function removeStyle() {
    document.getElementById(STYLE_ID)?.remove();
}

function isYouTubeEmbed(iframe: HTMLIFrameElement): boolean {
    try {
        const url = new URL(iframe.getAttribute("src") ?? "", location.href);
        const host = url.hostname.toLowerCase();
        return (host === "youtube.com" || host.endsWith(".youtube.com")
            || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com"))
            && url.pathname.startsWith("/embed/");
    } catch {
        return false;
    }
}

function isPortraitShortFrame(iframe: HTMLIFrameElement): boolean {
    if (iframe.dataset.vcFfytShort === "1") return true;

    const width = Number(iframe.getAttribute("width"));
    const height = Number(iframe.getAttribute("height"));
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > width * 1.2;
}

function setImportant(element: HTMLElement | null, styles: Record<string, string>) {
    if (!element) return;
    let snapshots = originalInlineStyles.get(element);
    if (!snapshots) {
        snapshots = new Map();
        originalInlineStyles.set(element, snapshots);
    }

    for (const [property, value] of Object.entries(styles)) {
        if (!snapshots.has(property)) {
            snapshots.set(property, {
                value: element.style.getPropertyValue(property),
                priority: element.style.getPropertyPriority(property)
            });
        }
        if (element.style.getPropertyValue(property) !== value
            || element.style.getPropertyPriority(property) !== "important") {
            element.style.setProperty(property, value, "important");
        }
    }
}

function restoreInlineStyles() {
    for (const [element, snapshots] of originalInlineStyles) {
        for (const [property, snapshot] of snapshots) {
            if (snapshot.value) element.style.setProperty(property, snapshot.value, snapshot.priority);
            else element.style.removeProperty(property);
        }
    }
    originalInlineStyles.clear();
}

function removeInvalidSandboxFlag(iframe: HTMLIFrameElement) {
    const sandbox = iframe.getAttribute("sandbox");
    if (sandbox === null) return;

    const tokens = sandbox.split(/\s+/).filter(Boolean);
    const filtered = tokens.filter(token => token.toLowerCase() !== "allow-fullscreen");
    if (filtered.length !== tokens.length) {
        iframe.setAttribute("sandbox", filtered.join(" "));
        console.warn("[ForceFullYouTubeEmbed] Removed invalid allow-fullscreen sandbox token; other sandbox restrictions were preserved.");
    }
}

function ensureFullscreenPermission(iframe: HTMLIFrameElement) {
    const allow = iframe.getAttribute("allow") ?? "";
    const directives = allow.split(";").map(value => value.trim()).filter(Boolean);
    const fullscreenIndex = directives.findIndex(value => /^fullscreen(?:\s|$)/i.test(value));

    if (fullscreenIndex === -1) {
        directives.push("fullscreen");
        iframe.setAttribute("allow", directives.join("; "));
        console.info("[ForceFullYouTubeEmbed] Added fullscreen to iframe allow policy.");
    } else if (/^fullscreen\s+'none'$/i.test(directives[fullscreenIndex])) {
        directives[fullscreenIndex] = "fullscreen";
        iframe.setAttribute("allow", directives.join("; "));
        console.info("[ForceFullYouTubeEmbed] Removed restrictive fullscreen policy.");
    }
    // The user's current embed already has allow="autoplay; fullscreen". Do not
    // add allowfullscreen as well; Chromium warns when both forms are present.
}

const ENTER_FULLSCREEN_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const EXIT_FULLSCREEN_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function resizeShortHostForFullscreen(host: HTMLElement, iframe: HTMLIFrameElement, active: boolean) {
    if (active) {
        setImportant(host, {
            position: "relative",
            width: "100vw",
            "max-width": "100vw",
            height: "100vh",
            "max-height": "100vh",
            "padding-bottom": "0px",
            margin: "0px",
            background: "#000"
        });
    } else {
        setImportant(host, {
            position: "relative",
            width: "400px",
            "max-width": "100%",
            height: "0px",
            "max-height": "none",
            "padding-bottom": "56.25%",
            margin: "0px",
            background: "#000"
        });
    }
    setImportant(iframe, {
        position: "absolute",
        top: "0px",
        right: "0px",
        bottom: "0px",
        left: "0px",
        display: "block",
        width: "100%",
        height: "100%",
        "max-width": "100%",
        "max-height": "100%"
    });
}

function updateFullscreenButtons() {
    document.querySelectorAll<HTMLElement>(`[data-vc-ffyt-short-host="1"]`).forEach(host => {
        const iframe = host.querySelector<HTMLIFrameElement>('iframe[data-vc-ffyt-short="1"]');
        const button = host.querySelector<HTMLButtonElement>(`.${FULLSCREEN_BUTTON_CLASS}`);
        if (!iframe || !button) return;

        const active = document.fullscreenElement === host;
        resizeShortHostForFullscreen(host, iframe, active);
        button.innerHTML = active ? EXIT_FULLSCREEN_ICON : ENTER_FULLSCREEN_ICON;
        button.title = active ? "Exit fullscreen" : "Fullscreen";
        button.setAttribute("aria-label", button.title);
    });
}

function addFullscreenFallback(host: HTMLElement, iframe: HTMLIFrameElement) {
    host.dataset.vcFfytShortHost = "1";
    if (host.querySelector(`.${FULLSCREEN_BUTTON_CLASS}`)) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = FULLSCREEN_BUTTON_CLASS;
    button.innerHTML = ENTER_FULLSCREEN_ICON;
    button.title = "Fullscreen";
    button.setAttribute("aria-label", "Fullscreen");
    button.setAttribute("data-vc-ffyt-fullscreen-button", "1");

    button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();

        try {
            if (!document.fullscreenEnabled) {
                throw new Error("Fullscreen is disabled by the current document policy.");
            }
            if (document.fullscreenElement === host) {
                await document.exitFullscreen();
            } else if (!document.fullscreenElement) {
                // This direct click handler provides the transient user activation
                // required by the Fullscreen API. Fullscreen the wrapper so the
                // fallback control remains available for exiting fullscreen.
                await host.requestFullscreen();
            } else {
                throw new Error("Another element is already fullscreen. Press Esc first.");
            }
        } catch (error) {
            console.error("[ForceFullYouTubeEmbed] Fullscreen fallback failed:", error);
        }
    });

    host.appendChild(button);
    resizeShortHostForFullscreen(host, iframe, document.fullscreenElement === host);
    console.info("[ForceFullYouTubeEmbed] Added parent-side fullscreen fallback button to Shorts embed.");
}

function applyLandscapeViewport(iframe: HTMLIFrameElement) {
    iframe.dataset.vcFfytShort = "1";

    const article = iframe.closest<HTMLElement>('article[class*="embedFull"]');
    const gridContainer = iframe.closest<HTMLElement>('[class*="gridContainer"]');
    const grid = iframe.closest<HTMLElement>('[class*="grid"]');
    const media = iframe.closest<HTMLElement>('[class*="embedMedia"]');
    const video = iframe.closest<HTMLElement>('[class*="embedVideo"]');

    setImportant(article, { width: "432px", "max-width": "432px" });
    setImportant(gridContainer, { width: "100%", "max-width": "100%" });
    setImportant(grid, { width: "100%", "max-width": "100%" });
    setImportant(media, {
        width: "400px",
        "max-width": "100%",
        "max-height": "225px"
    });
    setImportant(video, {
        position: "relative",
        width: "400px",
        "max-width": "100%",
        height: "0px",
        "padding-bottom": "56.25%"
    });
    setImportant(iframe, {
        position: "absolute",
        top: "0px",
        right: "0px",
        bottom: "0px",
        left: "0px",
        display: "block",
        width: "100%",
        height: "100%",
        "max-width": "100%",
        "max-height": "100%"
    });
    if (video) {
        addFullscreenFallback(video, iframe);
        // MutationObserver may revisit the iframe during a fullscreen transition;
        // preserve fullscreen dimensions rather than collapsing back to the card size.
        resizeShortHostForFullscreen(video, iframe, document.fullscreenElement === video);
    }

    const rect = iframe.getBoundingClientRect();
    console.info("[ForceFullYouTubeEmbed] Applied landscape viewport to portrait YouTube embed:", {
        src: iframe.getAttribute("src"),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        allow: iframe.getAttribute("allow"),
        sandbox: iframe.getAttribute("sandbox")
    });
}

function prepareYouTubeIframe(iframe: HTMLIFrameElement) {
    if (!isYouTubeEmbed(iframe)) return;

    removeInvalidSandboxFlag(iframe);
    ensureFullscreenPermission(iframe);

    if (isPortraitShortFrame(iframe)) {
        applyLandscapeViewport(iframe);
    }

    try {
        const url = new URL(iframe.getAttribute("src") ?? "", location.href);
        const fs = url.searchParams.get("fs");
        const controls = url.searchParams.get("controls");

        // YouTube documents fs and controls as enabled by default. Only rewrite
        // the URL when Discord/another patch explicitly disables either option.
        let changed = false;
        if (fs === "0") {
            url.searchParams.set("fs", "1");
            changed = true;
        }
        if (controls === "0") {
            url.searchParams.set("controls", "1");
            changed = true;
        }
        if (changed && iframe.dataset.vcFfytUrlPatched !== "1") {
            iframe.dataset.vcFfytUrlPatched = "1";
            iframe.setAttribute("src", url.toString());
            console.info("[ForceFullYouTubeEmbed] Re-enabled YouTube controls/fullscreen in embed URL.", url.toString());
        }

        if (iframe.dataset.vcFfytInspected !== "1") {
            iframe.dataset.vcFfytInspected = "1";
            console.info("[ForceFullYouTubeEmbed] YouTube iframe inspection:", {
                src: url.toString(),
                fsParameter: fs ?? "default (1)",
                controlsParameter: controls ?? "default (1)",
                fullscreenPermission: iframe.getAttribute("allow") ?? "(not set)",
                portraitShort: iframe.dataset.vcFfytShort === "1"
            });
        }
    } catch (error) {
        console.warn("[ForceFullYouTubeEmbed] Could not inspect YouTube embed URL:", error);
    }
}

function scan(root: ParentNode = document) {
    if (root instanceof HTMLIFrameElement) prepareYouTubeIframe(root);
    root.querySelectorAll?.(FRAME_SELECTOR).forEach(element => {
        if (element instanceof HTMLIFrameElement) prepareYouTubeIframe(element);
    });
}

function startObserver() {
    if (observer) return;
    scan();
    if (!fullscreenListener) {
        fullscreenListener = updateFullscreenButtons;
        document.addEventListener("fullscreenchange", fullscreenListener);
    }

    observer = new MutationObserver(records => {
        for (const record of records) {
            if (record.target instanceof HTMLIFrameElement) {
                prepareYouTubeIframe(record.target);
                continue;
            }
            for (const node of record.addedNodes) {
                if (node instanceof HTMLElement) scan(node);
            }
        }
    });

    observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["src", "allow", "sandbox", "width", "height", "style"]
    });
}

function stopObserver() {
    observer?.disconnect();
    observer = undefined;
    if (fullscreenListener) {
        document.removeEventListener("fullscreenchange", fullscreenListener);
        fullscreenListener = undefined;
    }
    document.querySelectorAll(`.${FULLSCREEN_BUTTON_CLASS}`).forEach(button => button.remove());
    document.querySelectorAll<HTMLElement>(`[data-vc-ffyt-short-host="1"]`).forEach(host => {
        delete host.dataset.vcFfytShortHost;
    });
    document.querySelectorAll<HTMLIFrameElement>('iframe[data-vc-ffyt-short="1"]').forEach(iframe => {
        delete iframe.dataset.vcFfytShort;
        delete iframe.dataset.vcFfytInspected;
        delete iframe.dataset.vcFfytUrlPatched;
    });
    restoreInlineStyles();
}

function listenForFrameDiagnostics() {
    if (messageListener) return;
    messageListener = event => {
        if (event.origin !== "https://www.youtube.com" &&
            event.origin !== "https://youtube.com" &&
            event.origin !== "https://www.youtube-nocookie.com" &&
            event.origin !== "https://youtube-nocookie.com") return;

        const data = event.data;
        if (!data || data[MESSAGE_KEY] !== true) return;
        console.info("[ForceFullYouTubeEmbed] YouTube frame diagnostic:", {
            status: data.status,
            href: data.href,
            detail: data.detail
        });
    };
    window.addEventListener("message", messageListener);
}

function stopFrameDiagnostics() {
    if (!messageListener) return;
    window.removeEventListener("message", messageListener);
    messageListener = undefined;
}

export default definePlugin({
    name: "ForceFullYouTubeEmbed",
    description: "Expands portrait Shorts embeds to a landscape player viewport and optionally restores the legacy YouTube embed UI.",
    authors: [{ name: "Custom UserPlugin", id: 0n }],
    tags: ["Media", "Utility"],
    requiresRestart: true,
    settings,

    async start() {
        addStyle();
        listenForFrameDiagnostics();
        startObserver();

        // Native code is not invoked at all unless the user explicitly opts in.
        // This also keeps third-party LightWork code out of YouTube frames by default.
        if (settings.store.useLightWork) {
            try {
                const status = await Native.start(true);
                nativeStarted = true;
                console.info("[ForceFullYouTubeEmbed] LightWork preload:", status);
            } catch (error) {
                console.error("[ForceFullYouTubeEmbed] Could not register the optional LightWork preload:", error);
            }
        } else {
            console.info("[ForceFullYouTubeEmbed] LightWork is disabled; using YouTube's built-in player with the portrait viewport fix.");
        }
    },

    async stop() {
        if (document.fullscreenElement instanceof HTMLElement
            && document.fullscreenElement.dataset.vcFfytShortHost === "1") {
            try {
                await document.exitFullscreen();
            } catch { }
        }
        stopObserver();
        removeStyle();
        stopFrameDiagnostics();

        if (nativeStarted) {
            try {
                await Native.stop();
            } catch (error) {
                console.error("[ForceFullYouTubeEmbed] Failed to unregister the optional LightWork preload:", error);
            } finally {
                nativeStarted = false;
            }
        }
    }
});
