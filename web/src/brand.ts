import { isNativeApp } from './api'

/**
 * Naming: the server + web app is Caravan; the Android app (this same web client inside Capacitor) is Satchel.
 */
export const CARAVAN = 'Caravan'
export const SATCHEL = 'Satchel'
export const APP_NAME = isNativeApp() ? SATCHEL : CARAVAN

export const SATCHEL_REPO = 'GetHorizontal63/satchel'
export const SATCHEL_RELEASES_URL = `https://github.com/${SATCHEL_REPO}/releases`
export const SATCHEL_LATEST_URL = `${SATCHEL_RELEASES_URL}/latest`
export const SATCHEL_LATEST_API = `https://api.github.com/repos/${SATCHEL_REPO}/releases/latest`

/** Servers answer /api/system/info with name "Caravan" (or "JellyReader" before the rename). */
export const isCaravanServer = (info: { name?: string } | null | undefined) => info?.name === 'Caravan' || info?.name === 'JellyReader'

if (typeof document !== 'undefined') document.title = APP_NAME
