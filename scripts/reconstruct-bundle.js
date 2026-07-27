#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const SRC_DIR = path.join(__dirname, '../public/jsproxy-src')
const OUT = path.join(__dirname, '../public/bundle.reconstructed.js')

/** @type {{ file: string, module?: number, note?: string }[]} */
const SECTIONS = [
  { file: 'path.js', module: 5 },
  { file: 'util.js', module: 2 },
  { file: 'env.js', module: 4 },
  { file: 'msg.js', module: 3 },
  { file: 'signal.js', module: 8 },
  { file: 'tld-data.js', module: 9, note: '内联于 webpack module 9（体积最大）' },
  { file: 'tld.js', module: 9 },
  { file: 'hook.js', module: 1 },
  { file: 'urlx.js', module: 0 },
  { file: 'cookie.js', module: 6 },
  { file: 'database.js', module: 11 },
  { file: 'route.js', module: 7 },
  { file: 'jsfilter.js', module: 10 },
  { file: 'storage.js', module: 12, note: '与 client.js、fakeloc.js 合并为 module 12' },
  { file: 'fakeloc.js', module: 12 },
  { file: 'client.js', module: 12 },
  { file: 'page.js', module: 14 },
  { file: 'cdn.js', module: 15, note: '与 sw.js、network.js、inject.js 合并为 module 15' },
  { file: 'network.js', module: 15 },
  { file: 'inject.js', module: 15 },
  { file: 'sw.js', module: 15 },
  { file: 'index.vc.js', module: 13, note: 'virtual-chromo 入口（上游见 index.js）' },
]

const HEADER = `/**
 * jsproxy bundle — reconstructed readable source (NOT loaded at runtime).
 *
 * Restored from EtherDream/jsproxy-browser src/proxy/src/ with virtual-chromo
 * patches in index.vc.js. Variable names are original; webpack module numbers
 * are annotated in section headers for cross-reference with bundle.formatted.js.
 *
 * Regenerate: npm run reconstruct:bundle
 * Upstream:   https://github.com/EtherDream/jsproxy-browser/tree/master/src/proxy/src
 * Runtime:    public/bundle.js (minified)
 *
 * Webpack module map:
 *   0 urlx  | 1 hook  | 2 util  | 3 msg   | 4 env   | 5 path
 *   6 cookie| 7 route | 8 signal| 9 tld*  | 10 jsfilter | 11 database
 *   12 client+storage+fakeloc | 13 index.vc (entry) | 14 page | 15 sw+cdn+network+inject
 */
`

function banner(section) {
  const mod = section.module != null ? `webpack module ${section.module}` : 'support'
  const lines = [
    '',
    `// ${'='.repeat(72)}`,
    `// ${section.file}  (${mod})`,
  ]
  if (section.note) lines.push(`// ${section.note}`)
  lines.push(`// ${'='.repeat(72)}`, '')
  return lines.join('\n')
}

let out = HEADER
for (const section of SECTIONS) {
  const filePath = path.join(SRC_DIR, section.file)
  if (!fs.existsSync(filePath)) {
    console.error('missing:', filePath)
    process.exit(1)
  }
  out += banner(section)
  out += fs.readFileSync(filePath, 'utf8')
  if (!out.endsWith('\n')) out += '\n'
}

fs.writeFileSync(OUT, out)

const lines = out.split('\n').length
const bytes = Buffer.byteLength(out)
console.log(`wrote ${OUT} (${lines} lines, ${bytes} bytes)`)
