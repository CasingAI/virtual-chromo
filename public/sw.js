// virtual-chromo static assets must bypass jsproxy fetch routing.
// Bump VC_BUILD whenever bridge/bundle/conf change so clients pick up a new SW.
const VC_BUILD = '20260727-v15'
// Runtime bundle: 'bundle.js' (vendor) | 'bundle.built.js' (from jsproxy-src, npm run build:bundle)
const VC_BUNDLE = 'bundle.built.js'
self.addEventListener('fetch', (event) => {
  const path = new URL(event.request.url).pathname
  if (
    /^\/(?:index\.html|viewer(?:\.html)?|bridge\.js|bundle(?:\.built)?\.js|conf\.js|inject\.js|sw\.js|404\.html|favicon\.ico)$/.test(
      path,
    )
  ) {
    // Avoid stale browser/CDN HTTP cache for shell assets after deploy.
    event.respondWith(fetch(event.request, { cache: 'no-store' }))
  }
})

jsproxy_config = (x) => {
  __CONF__ = x
  __FILE__ = x.assets_cdn + VC_BUNDLE + '?b=' + VC_BUILD
  importScripts(__FILE__)
}
importScripts('conf.js?b=' + VC_BUILD)
