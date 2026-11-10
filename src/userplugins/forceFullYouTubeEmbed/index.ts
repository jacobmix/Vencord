import definePlugin, { PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.ForceFullYouTubeEmbed as PluginNative<typeof import("./native")>;

const STYLE_ID = "vc-force-full-youtube-embed";

// Discord renders portrait Shorts as 253x450 preview cards and then creates a
// 253x450 iframe when Play is pressed. Widen only those portrait embeds; leave
// ordinary landscape/4:3 YouTube embeds at their existing dimensions.
const PORTRAIT_EMBED_CSS = `
/* Portrait preview card. The exact inline aspect-ratio comes from Discord's
   current embed renderer; :has() lets us style the parent article. */
article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) {
    width: 432px !important;
    max-width: 432px !important;
}

article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="gridContainer"],
article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="grid"] {
    width: 100% !important;
    max-width: 100% !important;
}

article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="embedVideo"] {
    width: 400px !important;
    max-width: 400px !important;
}

article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="imageContainer"],
article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="imageWrapper"],
article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) [class*="loadingOverlay"] {
    width: 400px !important;
    max-width: 400px !important;
    aspect-ratio: 16 / 9 !important;
    background: #000 !important;
}

article[class*="embedFull"]:has([class*="imageWrapper"][style*="253 / 450"]) img[class*="embedVideoImageComponentInner"] {
    display: block !important;
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

/* Active iframe after Play is clicked. Discord retains the portrait iframe
   attributes (253x450), so we can identify it without affecting other videos. */
article[class*="embedFull"]:has(iframe[src*="youtube.com/embed/"][width="253"][height="450"]) {
    width: 432px !important;
    max-width: 432px !important;
}

article[class*="embedFull"]:has(iframe[src*="youtube.com/embed/"][width="253"][height="450"]) [class*="gridContainer"],
article[class*="embedFull"]:has(iframe[src*="youtube.com/embed/"][width="253"][height="450"]) [class*="grid"] {
    width: 100% !important;
    max-width: 100% !important;
}

article[class*="embedFull"]:has(iframe[src*="youtube.com/embed/"][width="253"][height="450"]) [class*="embedMedia"] {
    width: 400px !important;
    max-width: 400px !important;
    max-height: 225px !important;
}

article[class*="embedFull"]:has(iframe[src*="youtube.com/embed/"][width="253"][height="450"]) [class*="embedVideo"] {
    width: 400px !important;
    max-width: 400px !important;
    padding-bottom: 56.25% !important;
}

article[class*="embedFull"]:has(iframe[src*="youtube.com/embed/"][width="253"][height="450"]) iframe[src*="youtube.com/embed/"] {
    width: 400px !important;
    height: 225px !important;
    max-width: 400px !important;
    max-height: 225px !important;
}
`;

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

export default definePlugin({
    name: "ForceFullYouTubeEmbed",
    description: "Restores the classic YouTube embed controls and widens portrait Shorts embeds.",
    authors: [{ name: "Custom UserPlugin", id: 0n }],
    tags: ["Media", "Utility"],
    requiresRestart: true,

    async start() {
        addPortraitEmbedStyle();
        try {
            await Native.start();
        } catch (error) {
            console.error("[ForceFullYouTubeEmbed] Failed to register the YouTube frame preload:", error);
        }
    },

    async stop() {
        removePortraitEmbedStyle();
        try {
            await Native.stop();
        } catch (error) {
            console.error("[ForceFullYouTubeEmbed] Failed to unregister the YouTube frame preload:", error);
        }
    }
});
