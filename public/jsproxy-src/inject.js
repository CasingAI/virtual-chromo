import * as path from './path.js'
import * as util from "./util"
// import * as jsfilter from './jsfilter.js'

let mConf


const WORKER_INJECT = util.strToBytes(`\
if (typeof importScripts === 'function' && !self.window && !self.__PATH__) {
  self.__PATH__ = '${path.ROOT}';
  importScripts('${path.HELPER}');
}
`)


export function getWorkerCode() {
  return WORKER_INJECT
}


export function setConf(conf) {
  mConf = conf
}


const PADDING = ' '.repeat(500)

const CSP = `\
'self' \
'unsafe-inline' \
file: \
data: \
blob: \
mediastream: \
filesystem: \
chrome-extension-resource: \
`

// Turnstile widget iframes load directly from Cloudflare (see page.js hookFrameSrc).
const TURNSTILE_FRAME_SRC = `\
https://challenges.cloudflare.com \
https://challenges.fed.cloudflare.com \
https://challenges.cloudflare-cn.com \
`

/**
 * @param {URL} urlObj 
 * @param {number} pageId 
 */
export function getHtmlCode(urlObj, pageId) {
  const icoUrl = path.PREFIX + urlObj.origin + '/favicon.ico'
  const custom = mConf.inject_html || ''

  return util.strToBytes(`\
<!-- JS PROXY HELPER -->
<!doctype html>
<link rel="icon" href="${icoUrl}" type="image/x-icon">
<meta http-equiv="content-security-policy" content="frame-src ${CSP}${TURNSTILE_FRAME_SRC}; object-src ${CSP}">
<base href="${urlObj.href}">
<script data-id="${pageId}" src="${path.HELPER}"></script>
${custom}
<!-- PADDING ${PADDING} -->

`)
}
