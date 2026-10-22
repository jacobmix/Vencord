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
    const viewerImage = document.querySelector<HTMLImageElement>('[role="dialog"] img');
    const viewerVideo = document.querySelector<HTMLVideoElement>('[role="dialog"] video');
    const url = getFullImageUrl(
        props?.src || props?.href || props?.target?.src || props?.target?.href || viewerImage?.currentSrc || viewerImage?.src || viewerVideo?.currentSrc
    );

    children.push(
        <Menu.MenuItem
            id="open-full-image-in-browser"
            label="Open Full Image in Browser"
            leadingAccessory={{ type: "icon", icon: OpenExternalIcon }}
            action={() => url && open(url, "_blank")}
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
