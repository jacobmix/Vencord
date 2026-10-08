/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { Logger } from "@utils/Logger";
import { FluxDispatcher } from "@webpack/common";

const logger = new Logger("NoSeasonalStuff");

const SEASONAL_SOUNDPACKS = new Set([
    "halloween",
    "winter_holiday",
]);

let originalDispatch: typeof FluxDispatcher.dispatch | null = null;

function isSeasonalSoundpack(soundpack: unknown): boolean {
    return typeof soundpack === "string" && SEASONAL_SOUNDPACKS.has(soundpack);
}

function patchSoundpackDispatch() {
    if (originalDispatch) return;

    originalDispatch = FluxDispatcher.dispatch;

    FluxDispatcher.dispatch = function (action: any) {
        if (
            action?.type === "SET_SOUNDPACK" &&
            isSeasonalSoundpack(action.soundpack)
        ) {
            logger.info(
                `Blocked seasonal soundpack "${action.soundpack}", forcing classic`
            );

            return originalDispatch!.call(this, {
                ...action,
                soundpack: "classic",
            });
        }

        return originalDispatch!.call(this, action);
    };
}

function unpatchSoundpackDispatch() {
    if (!originalDispatch) return;

    FluxDispatcher.dispatch = originalDispatch;
    originalDispatch = null;
}

export default definePlugin({
    name: "NoSeasonalStuff",

    description:
        "Prevents Discord from automatically switching to seasonal sound packs and other seasonal effects.",

    authors: [
        {
            name: "JacobMIX",
            id: 104027164143267840,
        },
    ],

    start() {
        patchSoundpackDispatch();

        logger.info("Seasonal soundpack protection enabled");
    },

    stop() {
        unpatchSoundpackDispatch();

        logger.info("Seasonal soundpack protection disabled");
    },
});