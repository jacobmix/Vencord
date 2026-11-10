import definePlugin, { PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.ForceFullYouTubeEmbed as PluginNative<typeof import("./native")>;

const STYLE_ID = "vc-force-full-youtube-embed";
const FRAME_SELECTOR = [
    'iframe[src*="youtube.com/embed/"]',
    'iframe[src*="youtube-nocookie.com/embed/"]'
].join(",");
const MESSAGE_KEY = "__FORCE_FULL_YOUTUBE_EMBED_DIAGNOSTIC__";

const PORTRAIT_EMBED_CSS = `
/* Give Shorts embeds a landscape-sized viewport, matching normal video embeds. */
article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]),
article[class*="embedFull"]:has(iframe[src*="/embed/"][width="253"][height="450"]) {
    width: min(432px, 100%) !important;
    max-width: 432px !important;
}

article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="gridContainer"],
article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="grid"],
article[class*="embedFull"]:has(iframe[src*="/embed/"][width="253"][height="450"]) [class*="gridContainer"],
article[class*="embedFull"]:has(iframe[src*="/embed/"][width="253"][height="450"]) [class*="grid"] {
    width: 100% !important;
    max-width: 100% !important;
}

article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="embedVideo"],
article[class*="embedFull"]:has(iframe[src*="/embed/"][width="253"][height="450"]) [class*="embedMedia"],
article[class*="embedFull"]:has(iframe[src*="/embed/"][width="253"][height="450"]) [class*="embedVideo"] {
    width: 400px !important;
    max-width: 100% !important;
}

article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="imageContainer"],
article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="imageWrapper"],
article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="loadingOverlay"] {
    width: 400px !important;
    max-width: 100% !important;
    aspect-ratio: 16 / 9 !important;
    background: #000 !important;
}

article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) img[class*="embedVideoImageComponentInner"] {
    width: 100% !important;
    max-width: 400px !important;
    max-height: 225px !important;
    aspect-ratio: 16 / 9 !important;
    object-fit: contain !important;
    background: #000 !important;
}

article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="embedVideoActions"] {
    width: 100% !important;
}

article[class*="embedFull"]:has(iframe[src*="/embed/"][width="253"][height="450"]) [class*="embedMedia"] {
    max-height: 225px !important;
}

article[class*="embedFull"]:has(iframe[src*="/embed/"][width="253"][height="450"]) [class*="embedVideo"] {
    padding-bottom: 56.25% !important;
}

article[class*="embedFull"]:has(iframe[src*="/embed/"][width="253"][height="450"]) iframe[src*="/embed/"] {
    width: 400px !important;
    height: 225px !important;
    max-width: 100% !important;
    max-height: 225px !important;
}
`;

let observer: MutationObserver | undefined;
let messageListener: ((event: MessageEvent) => void) | undefined;

function addPortraitEmbedStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = PORTRAIT_EMBED_CSS;
    (document.head ?? document.documentElement).appendChild(style);
}

function removePortraitEmbedStyle() {
    document.getElementById(STYLE_ID)?.remove();
}

function isYouTubeEmbed(iframe: HTMLIFrameElement): boolean {
    try {
        const url = new URL(iframe.getAttribute("src") ?? "", location.href);
        return (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")
            || url.hostname === "youtube-nocookie.com" || url.hostname.endsWith(".youtube-nocookie.com"))
            && url.pathname.startsWith("/embed/");
    } catch {
        return false;
    }
}

function addFullscreenPermission(iframe: HTMLIFrameElement): boolean {
    const originalAllow = iframe.getAttribute("allow") ?? "";
    const directives = originalAllow.split(";").map(part => part.trim()).filter(Boolean);
    const fullscreenIndex = directives.findIndex(part => /^fullscreen(?:\s|$)/i.test(part));

    if (fullscreenIndex === -1) {
        directives.push("fullscreen");
    } else {
        // Avoid leaving an explicit restrictive fullscreen directive in place.
        directives[fullscreenIndex] = "fullscreen";
    }

    const nextAllow = directives.join("; ");
    let changed = nextAllow !== originalAllow;
    if (changed) iframe.setAttribute("allow", nextAllow);

    if (!iframe.hasAttribute("allowfullscreen")) {
        iframe.setAttribute("allowfullscreen", "");
        changed = true;
    }
    if (!iframe.hasAttribute("webkitallowfullscreen")) {
        iframe.setAttribute("webkitallowfullscreen", "");
        changed = true;
    }
    iframe.allowFullscreen = true;

    return changed;
}

function prepareYouTubeIframe(iframe: HTMLIFrameElement) {
    if (!isYouTubeEmbed(iframe)) return;

    let nextSrc = iframe.getAttribute("src") ?? "";
    let url: URL;
    try {
        url = new URL(nextSrc, location.href);
    } catch {
        return;
    }

    let changed = addFullscreenPermission(iframe);

    // YouTube documents fs=0 as the switch that hides its fullscreen button.
    if (url.searchParams.get("fs") === "0") {
        url.searchParams.set("fs", "1");
        changed = true;
    }
    if (url.searchParams.get("controls") === "0") {
        url.searchParams.set("controls", "1");
        changed = true;
    }

    const rewrittenSrc = url.toString();
    if (rewrittenSrc !== nextSrc) {
        nextSrc = rewrittenSrc;
        changed = true;
    }

    // Permissions Policy is applied when the iframe's browsing context is created.
    // If we had to add permissions after Discord inserted the iframe, reload it once
    // so the new policy is applied and the frame preload can run from document-start.
    if (changed && iframe.dataset.vcFfytPermissionReloaded !== "1") {
        iframe.dataset.vcFfytPermissionReloaded = "1";
        iframe.setAttribute("src", nextSrc);
        console.debug("[ForceFullYouTubeEmbed] Updated YouTube iframe permissions/parameters", {
            src: nextSrc,
            allow: iframe.getAttribute("allow"),
            allowFullscreen: iframe.allowFullscreen
        });
    }
}

function scanForYouTubeIframes(root: ParentNode = document) {
    if (root instanceof HTMLIFrameElement && isYouTubeEmbed(root)) {
        prepareYouTubeIframe(root);
    }

    root.querySelectorAll?.(FRAME_SELECTOR).forEach(element => {
        if (element instanceof HTMLIFrameElement) prepareYouTubeIframe(element);
    });
}

function startIframeObserver() {
    if (observer) return;

    scanForYouTubeIframes();
    observer = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === "attributes" && record.target instanceof HTMLIFrameElement) {
                prepareYouTubeIframe(record.target);
                continue;
            }

            for (const node of record.addedNodes) {
                if (node instanceof HTMLElement) scanForYouTubeIframes(node);
            }
        }
    });

    observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["src", "allow", "allowfullscreen"]
    });
}

function stopIframeObserver() {
    observer?.disconnect();
    observer = undefined;
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

function stopListeningForFrameDiagnostics() {
    if (!messageListener) return;
    window.removeEventListener("message", messageListener);
    messageListener = undefined;
}

export default definePlugin({
    name: "ForceFullYouTubeEmbed",
    description: "Restores classic YouTube embed controls, grants fullscreen to Shorts embeds, and widens portrait embeds.",
    authors: [{ name: "Custom UserPlugin", id: 0n }],
    tags: ["Media", "Utility"],
    requiresRestart: true,

    async start() {
        addPortraitEmbedStyle();
        listenForFrameDiagnostics();

        try {
            const status = await Native.start();
            console.info("[ForceFullYouTubeEmbed] Native preload registered:", status);
        } catch (error) {
            console.error("[ForceFullYouTubeEmbed] Could not register the YouTube frame preload. The iframe permission fixes will still run, but LightWork will not load:", error);
        }

        // Register the frame preload first, then scan. Any existing Shorts iframe
        // that was created before plugin startup is refreshed once below.
        startIframeObserver();
    },

    async stop() {
        stopIframeObserver();
        removePortraitEmbedStyle();
        stopListeningForFrameDiagnostics();

        try {
            await Native.stop();
        } catch (error) {
            console.error("[ForceFullYouTubeEmbed] Failed to unregister the YouTube frame preload:", error);
        }
    }
});
