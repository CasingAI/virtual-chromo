// Bump VC_BUILD when bridge / inject / conf change. Keep in sync with public/sw.js.
// Assign on self (no var/let/const) so importScripts + periodic re-eval never redeclare.
self.VC_VERSION = '1.3.0'
self.VC_BUILD = '20260728-v9'

jsproxy_config({
  ver: '1',
  vc_version: self.VC_VERSION,
  vc_build: self.VC_BUILD,

  node_map: {
    local: {
      label: '当前 Worker',
      lines: {
        [location.host]: 1,
      },
    },
  },

  node_default: 'local',
  assets_cdn: '/',
  index_path: 'viewer.html',
  // Must use absolute URL: prepended HTML sets <base href="target site"> so
  // relative /inject.js would resolve against the proxied origin, not Worker.
  inject_html:
    '<script src="' +
    self.location.origin +
    '/inject.js?b=' +
    self.VC_BUILD +
    '"><\/script>',
})
