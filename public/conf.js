// Bump VC_BUILD when bridge / inject / conf change. Keep in sync with public/sw.js.
var VC_VERSION = '1.3.0'
var VC_BUILD = '20260727-v2'

jsproxy_config({
  ver: '1',
  vc_version: VC_VERSION,
  vc_build: VC_BUILD,

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
    VC_BUILD +
    '"><\/script>',
})
