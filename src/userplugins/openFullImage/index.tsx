/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { OpenExternalIcon } from "@components/Icons";
import definePlugin from "@utils/types";
import { Menu } from "@webpack/common";

const DISCORD_IMAGE_HOSTS = new Set([
    "cdn.discordapp.com",
    "media.discordapp.net",
    "media.discordapp.com",
]);

function getFullImageUrl(src: unknown): string | null {
    if (typeof src !== "string") return null;

    try {
        const url = new URL(src);
        if (url.protocol !== "https:" || !DISCORD_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return null;

        // Media proxy URLs point at the same attachment through a resize/transcode endpoint.
        // Switch to the CDN and remove presentation options to request the original file.
        if (url.hostname.toLowerCase() === "media.discordapp.net" && url.pathname.startsWith("/attachments/"))
            url.hostname = "cdn.discordapp.com";

        for (const parameter of ["width", "height", "size", "format", "quality", ""]) {
            url.searchParams.delete(parameter);
        }

        return url.toString();
    } catch {
        return null;
    }
}

const imageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    const url = getFullImageUrl(props?.src);
    if (!url) return;

    children.push(
        <Menu.MenuItem
            id="open-full-image-in-browser"
            label="Open Full Image in Browser"
            leadingAccessory={{ type: "icon", icon: OpenExternalIcon }}
            action={() => open(url, "_blank")}
        />
    );
};

export default definePlugin({
    name: "OpenFullImage",
    description: "Adds an image context-menu action to open the largest available image URL in your browser.",
    tags: ["Media", "Utility"],
    authors: [{ name: "JacobMIX", id: 104027164143267840n }],

    contextMenus: {
        "image-context": imageContextMenuPatch,
    },
});
