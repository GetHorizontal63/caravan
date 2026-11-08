// Post-generation tweaks for the Android project created by `npx cap add android`.
// Idempotent: safe to re-run after `npx cap sync`.
const fs = require('node:fs')

// 1. Allow plain-HTTP connections to a server on your LAN (most home servers have no TLS)
//    and resize the WebView when the keyboard opens.
const manifest = 'android/app/src/main/AndroidManifest.xml'
let xml = fs.readFileSync(manifest, 'utf8')
if (!xml.includes('usesCleartextTraffic')) xml = xml.replace('<application', '<application android:usesCleartextTraffic="true"')
xml = xml.replace(/android:windowSoftInputMode="[^"]*"/, 'android:windowSoftInputMode="adjustResize"')
fs.writeFileSync(manifest, xml)

// 2. Night Ink window background: Capacitor paints the status/navigation bar areas with it.
const styles = 'android/app/src/main/res/values/styles.xml'
let st = fs.readFileSync(styles, 'utf8')
if (!st.includes('android:windowBackground')) {
  st = st.replace('<item name="android:background">@null</item>',
    '<item name="android:background">@null</item>\n        <item name="android:windowBackground">@color/jr_background</item>')
}
fs.writeFileSync(styles, st)
const colors = 'android/app/src/main/res/values/jr_colors.xml'
fs.writeFileSync(colors, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="jr_background">#1B2238</color>\n</resources>\n')

// 3. Launcher icon background: Oasis Teal (Satchel's colour)
const iconBg = 'android/app/src/main/res/values/ic_launcher_background.xml'
if (fs.existsSync(iconBg)) fs.writeFileSync(iconBg, fs.readFileSync(iconBg, 'utf8').replace(/<color name="ic_launcher_background">#[0-9A-Fa-f]{6}<\/color>/, '<color name="ic_launcher_background">#1F6F6A</color>'))

console.log('Patched Android project')
