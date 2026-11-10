import { definePluginSettings } from "@api/Settings";
import definePlugin, { PluginNative, OptionType } from "@utils/types";

const Native = VencordNative.pluginHelpers.ForceFullYouTubeEmbed as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    useLightWork: {
        type: OptionType.BOOLEAN,
        description: "Load the experimental LightWork legacy YouTube player UI inside embeds. Leave off while testing playback stability.",
        default: false,
        restartNeeded: true
    }
});

const STYLE_ID = "vc-force-full-youtube-embed";
const FRAME_SELECTOR = [
    'iframe[src*="youtube.com/embed/"]',
    'iframe[src*="youtube-nocookie.com/embed/"]'
].join(",");
const MESSAGE_KEY = "__FORCE_FULL_YOUTUBE_EMBED_DIAGNOSTIC__";

const PORTRAIT_EMBED_CSS = `
/* Widen portrait Shorts cards and give their player a 16:9 viewport. */
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
    width: 400px !important;
    max-width: 100% !important;
    max-height: 225px !important;
    aspect-ratio: 16 / 9 !important;
}

article[class*="embedFull"]:has(iframe[src*="/embed/"][width="253"][height="450"]) iframe[src*="/embed/"] {
    display: block !important;
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
        const host = url.hostname.toLowerCase();
        return (host === "youtube.com" || host.endsWith(".youtube.com")
            || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com"))
            && url.pathname.startsWith("/embed/");
    } catch {
        return false;
    }
}

/**
 * `allow-fullscreen` is NOT a valid iframe sandbox token. Fullscreen belongs
 * in the Permissions Policy `allow` attribute instead. Keep all other sandbox
 * restrictions intact.
 */
function removeInvalidSandboxToken(iframe: HTMLIFrameElement): boolean {
    const sandbox = iframe.getAttribute("sandbox");
    if (sandbox === null) return false;

    const tokens = sandbox.split(/\s+/).filter(Boolean);
    const filtered = tokens.filter(token => token.toLowerCase() !== "allow-fullscreen");
    if (filtered.length === tokens.length) return false;

    iframe.setAttribute("sandbox", filtered.join(" "));
    console.warn("[ForceFullYouTubeEmbed] Removed invalid 'allow-fullscreen' token from iframe sandbox; retained other sandbox restrictions.", {
        before: sandbox,
        after: iframe.getAttribute("sandbox")
    });
    return true;
}

function addFullscreenPermission(iframe: HTMLIFrameElement): boolean {
    const originalAllow = iframe.getAttribute("allow") ?? "";
    const directives = originalAllow.split(";").map(part => part.trim()).filter(Boolean);
    const fullscreenIndex = directives.findIndex(part => /^fullscreen(?:\s|$)/i.test(part));

    if (fullscreenIndex === -1) {
        directives.push("fullscreen");
    } else {
        // Replace any restrictive fullscreen directive (for example fullscreen 'none').
        directives[fullscreenIndex] = "fullscreen";
    }

    const nextAllow = directives.join("; ");
    let changed = nextAllow !== originalAllow;
    if (changed) iframe.setAttribute("allow", nextAllow);

    // Do not add the legacy allowfullscreen attribute: Chromium warns when it is
    // combined with `allow`, and `allow` is the authoritative Permissions Policy.
    if (iframe.hasAttribute("allowfullscreen")) {
        iframe.removeAttribute("allowfullscreen");
        changed = true;
    }
    if (iframe.hasAttribute("webkitallowfullscreen")) {
        iframe.removeAttribute("webkitallowfullscreen");
        changed = true;
    }

    return changed;
}

function prepareYouTubeIframe(iframe: HTMLIFrameElement) {
    if (!isYouTubeEmbed(iframe)) return;

    removeInvalidSandboxToken(iframe);
    addFullscreenPermission(iframe);

    const src = iframe.getAttribute("src") ?? "";
    try {
        const url = new URL(src, location.href);
        let urlChanged = false;

        // YouTube's `fs=0` explicitly hides its fullscreen button.
        if (url.searchParams.get("fs") === "0") {
            url.searchParams.set("fs", "1");
            urlChanged = true;
        }
        if (url.searchParams.get("controls") === "0") {
            url.searchParams.set("controls", "1");
            urlChanged = true;
        }

        // Avoid reloading every iframe simply because its permissions changed.
        // Only change src when YouTube explicitly disabled controls/fullscreen.
        if (urlChanged && iframe.dataset.vcFfytUrlPatched !== "1") {
            iframe.dataset.vcFfytUrlPatched = "1";
            iframe.setAttribute("src", url.toString());
            console.info("[ForceFullYouTubeEmbed] Enabled YouTube embed controls in iframe URL.", url.toString());
        }
    } catch (error) {
        console.warn("[ForceFullYouTubeEmbed] Could not inspect YouTube iframe URL:", error);
    }

    if (!iframe.dataset.vcFfytInspected) {
        iframe.dataset.vcFfytInspected = "1";
        console.info("[ForceFullYouTubeEmbed] Prepared YouTube iframe:", {
            src: iframe.getAttribute("src"),
            allow: iframe.getAttribute("allow"),
            sandbox: iframe.getAttribute("sandbox"),
            allowFullscreenLegacyRemoved: !iframe.hasAttribute("allowfullscreen")
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
        attributeFilter: ["src", "allow", "allowfullscreen", "sandbox"]
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
    description: "Enables fullscreen permissions for YouTube embeds and widens Shorts; LightWork legacy UI is optional.",
    authors: [{ name: "Custom UserPlugin", id: 0n }],
    tags: ["Media", "Utility"],
    requiresRestart: true,
    settings,

    async start() {
        addPortraitEmbedStyle();
        listenForFrameDiagnostics();

        try {
            const status = await Native.start(settings.store.useLightWork);
            console.info("[ForceFullYouTubeEmbed] Native preload registered:", status);
        } catch (error) {
            console.error("[ForceFullYouTubeEmbed] Failed to register the YouTube frame preload:", error);
        }

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
