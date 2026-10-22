/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import managedStyle from "./styles.css?managed";

const settings = definePluginSettings({
    saveZoomValues: { type: OptionType.BOOLEAN, description: "Save zoom and lens size changes", default: true },
    invertScroll: { type: OptionType.BOOLEAN, description: "Invert scroll wheel adjustments", default: true },
    nearestNeighbour: { type: OptionType.BOOLEAN, description: "Use nearest neighbour image scaling", default: false },
    square: { type: OptionType.BOOLEAN, description: "Make the lens square", default: false },
    zoom: { type: OptionType.SLIDER, description: "Lens zoom", markers: [1, 5, 10, 20, 30, 40, 50], default: 2, stickToMarkers: false },
    size: { type: OptionType.SLIDER, description: "Lens diameter", markers: [50, 100, 250, 500, 750, 1000], default: 100, stickToMarkers: false },
    zoomSpeed: { type: OptionType.SLIDER, description: "Scroll adjustment speed", markers: [0.1, 0.5, 1, 2, 3, 4, 5], default: 0.5, stickToMarkers: false },
});

type Media = HTMLImageElement | HTMLVideoElement;
const PREFIX = "vc-imgzoom-middle";

function sourceFor(media: Media) {
    const src = media instanceof HTMLImageElement ? media.currentSrc || media.src : media.currentSrc || media.src;
    try {
        const url = new URL(src);
        if (url.hostname === "media.discordapp.net") url.hostname = "cdn.discordapp.com";
        for (const key of ["width", "height", "size", "format", "quality"]) url.searchParams.delete(key);
        // Discord may append an empty query key when serving resized previews.
        url.searchParams.delete("");
        return url.toString();
    } catch { return src; }
}

function createLens(media: Media, x: number, y: number) {
    const overlay = document.createElement("div");
    const lens = document.createElement("div");
    const rect = media.getBoundingClientRect();
    const zoom = settings.store.zoom;
    const size = settings.store.size;
    const isVideo = media instanceof HTMLVideoElement;
    const content = document.createElement(isVideo ? "video" : "img") as HTMLImageElement | HTMLVideoElement;

    overlay.className = `${PREFIX}-overlay`;
    lens.className = `${PREFIX}-lens${settings.store.square ? ` ${PREFIX}-square` : ""}`;
    if (settings.store.nearestNeighbour) lens.classList.add(`${PREFIX}-nearest`);
    content.className = `${PREFIX}-content`;
    content.style.width = `${rect.width * zoom}px`;
    content.style.height = `${rect.height * zoom}px`;
    content.style.left = `${size / 2 - (x - rect.left) * zoom}px`;
    content.style.top = `${size / 2 - (y - rect.top) * zoom}px`;
    content.setAttribute("draggable", "false");
    if (isVideo) {
        const video = content as HTMLVideoElement;
        video.src = sourceFor(media);
        video.muted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.currentTime = media.currentTime;
        void video.play().catch(() => {});
    } else {
        (content as HTMLImageElement).src = sourceFor(media);
        (content as HTMLImageElement).alt = "";
    }

    lens.style.width = `${size}px`;
    lens.style.height = `${size}px`;
    lens.style.left = `${x - size / 2}px`;
    lens.style.top = `${y - size / 2}px`;
    lens.append(content);
    overlay.append(lens);
    document.body.append(overlay);
    return { overlay, lens, content, media, zoom, size };
}

let active: ReturnType<typeof createLens> | undefined;
let middleDown = false;

function mediaFromEvent(event: MouseEvent): Media | undefined {
    for (const target of event.composedPath()) {
        if (target instanceof HTMLImageElement && target.complete && target.naturalWidth) return target;
        if (target instanceof HTMLVideoElement && target.videoWidth) return target;
    }
}

function moveLens(x: number, y: number) {
    if (!active) return;
    const { lens, content, media, zoom, size } = active;
    const rect = media.getBoundingClientRect();
    lens.style.left = `${x - size / 2}px`;
    lens.style.top = `${y - size / 2}px`;
    content.style.left = `${size / 2 - (x - rect.left) * zoom}px`;
    content.style.top = `${size / 2 - (y - rect.top) * zoom}px`;
}

function stopLens() {
    middleDown = false;
    active?.overlay.remove();
    active = undefined;
}

function onMouseDown(event: MouseEvent) {
    if (event.button !== 1) return;
    const media = mediaFromEvent(event);
    if (!media) return;
    // Suppress the browser's middle-click autoscroll, without touching Discord's left-click path.
    event.preventDefault();
    stopLens();
    middleDown = true;
    active = createLens(media, event.clientX, event.clientY);
}

function onMouseMove(event: MouseEvent) {
    if (middleDown) moveLens(event.clientX, event.clientY);
}

function onWheel(event: WheelEvent) {
    if (!middleDown || !active) return;
    event.preventDefault();
    const direction = settings.store.invertScroll ? -1 : 1;
    const delta = event.deltaY / 100 * direction * settings.store.zoomSpeed;
    if (event.shiftKey) {
        active.size = Math.max(50, Math.min(1000, active.size + delta * 10));
        active.lens.style.width = `${active.size}px`;
        active.lens.style.height = `${active.size}px`;
    } else {
        active.zoom = Math.max(1, Math.min(50, active.zoom + delta));
        active.content.style.width = `${active.media.getBoundingClientRect().width * active.zoom}px`;
        active.content.style.height = `${active.media.getBoundingClientRect().height * active.zoom}px`;
    }
    if (settings.store.saveZoomValues) {
        settings.store.zoom = active.zoom;
        settings.store.size = active.size;
    }
    moveLens(event.clientX, event.clientY);
}

export default definePlugin({
    name: "ImageZoomMiddleClick",
    description: "Shows a zoom lens while holding the middle mouse button over media. Discord's normal image viewer controls remain untouched.",
    tags: ["Media", "Utility"],
    authors: [Devs.Aria],
    settings,
    managedStyle,
    start() {
        document.addEventListener("mousedown", onMouseDown);
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", stopLens);
        document.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("blur", stopLens);
    },
    stop() {
        document.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", stopLens);
        document.removeEventListener("wheel", onWheel);
        window.removeEventListener("blur", stopLens);
        stopLens();
    }
});
