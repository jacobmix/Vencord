/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
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
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;

        const hostname = url.hostname.toLowerCase();
        if (!DISCORD_IMAGE_HOSTS.has(hostname)) return url.toString();

        if (hostname === "media.discordapp.net" && url.pathname.startsWith("/attachments/"))
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
    if (!url) return;

    const menuItem = (
        <Menu.MenuItem
            key="open-full-image-in-browser"
            id="open-full-image-in-browser"
            label="Open Full Image in Browser"
            leadingAccessory={{ type: "icon", icon: OpenExternalIcon }}
            action={() => open(url, "_blank")}
        />
    );

    const mediaLinkGroup = findGroupChildrenByChildId("open-native-link", children);
    if (mediaLinkGroup) {
        const openMediaLinkIndex = mediaLinkGroup.findIndex(child => child?.props?.id === "open-native-link");
        mediaLinkGroup.splice(openMediaLinkIndex + 1, 0, menuItem);
    } else {
        children.push(menuItem);
    }
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
