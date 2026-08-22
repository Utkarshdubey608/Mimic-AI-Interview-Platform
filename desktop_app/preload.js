// Runs in the renderer's isolated world before the page's own scripts. Its
// only job is to hand the website the one non-secret configuration value it
// cannot correctly derive for itself in this shell: the real, externally
// reachable web origin candidates should use in links this app generates
// (invite emails, "copy link", etc). The renderer is served from a custom
// app:// scheme (see main.js) so it can run offline — window.location.origin
// there is meaningless to an outside candidate. See
// web_version/talbotiq-platform/src/lib/candidateOrigin.ts, the one place
// that reads this.
'use strict'

const { contextBridge } = require('electron')

const FLAG_PREFIX = '--talbotiq-public-web-origin='
const flag = process.argv.find((arg) => arg.startsWith(FLAG_PREFIX))
const publicWebOrigin = flag ? flag.slice(FLAG_PREFIX.length) : ''

contextBridge.exposeInMainWorld('__TALBOTIQ_DESKTOP__', { publicWebOrigin })
