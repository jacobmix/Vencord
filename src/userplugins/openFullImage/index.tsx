/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { OpenExternalIcon } from "@components/Icons";
import definePlugin from "@utils/types";
import { Menu } from "@webpack/common";

function getFullImageUrl(src: unknown): string | null {
    if (typeof src !== "string") return null;

    try {
        const url = new URL(src);
        if (url.protocol !== "https:" || !/(^|\.)discord(app)?\.com$/i.test(url.hostname)) return null;

        // Discord adds these parameters to request a resized preview. Preserve
        // signed attachment parameters and format, which may be needed to load it.
        url.searchParams.delete("width");
        url.searchParams.delete("height");
        url.searchParams.delete("size");

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


