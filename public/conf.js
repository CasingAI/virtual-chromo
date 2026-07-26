jsproxy_config({
  ver: '1',

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
  inject_html: '<script src="/inject.js"><\/script>',
})
