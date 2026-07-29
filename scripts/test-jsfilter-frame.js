/**
 * Smoke tests for jsfilter-frame AST rewrite.
 * Run: node scripts/test-jsfilter-frame.js
 */

import path from 'path'
import {fileURLToPath, pathToFileURL} from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const frameUrl = pathToFileURL(
  path.join(root, 'public/jsproxy-src/jsfilter-frame.js'),
).href

const {transformFrameSpoof} = await import(frameUrl)

/** @type {{ name: string, input: string, expectIncludes?: string[], expectExcludes?: string[], expectUnchanged?: boolean }}[] */
const cases = [
  {
    name: 'bare top !== self',
    input: 'if (top !== self) open(location.href, "_top")',
    expectIncludes: ['__vcWin !== __vcWin'],
    expectExcludes: ['top !== self'],
  },
  {
    name: 'window.top !== window.self',
    input: 'if (window.top !== window.self) open(x, "_top")',
    expectIncludes: ['__vcWin !== __vcWin'],
  },
  {
    name: 'window["top"]',
    input: 'var t = window["top"];',
    expectIncludes: ['__vcWin'],
  },
  {
    name: 'local function top not rewritten',
    input: 'function top(){ return 1 } top()',
    expectUnchanged: true,
  },
  {
    name: 'local const top not rewritten',
    input: 'const top = 1; console.log(top)',
    expectUnchanged: true,
  },
  {
    name: 'no candidates → null',
    input: 'var x = 1; console.log(x)',
    expectUnchanged: true,
  },
  {
    name: 'globalThis.parent',
    input: 'if (globalThis.parent !== globalThis) bust()',
    expectIncludes: ['__vcWin'],
  },
  {
    name: 'preserve surrounding source (no pretty-print)',
    input:
      "this['MMmgvz']=function(){return'newState';};(self,function(){return 1})",
    expectIncludes: [
      "this['MMmgvz']=function(){return'newState';};(__vcWin,function(){return 1})",
    ],
    expectExcludes: ['function ()'],
  },
]

let failed = 0
for (const c of cases) {
  const out = transformFrameSpoof(c.input)
  const unchanged = out === null
  let ok = true
  let detail = ''

  if (c.expectUnchanged) {
    if (!unchanged) {
      ok = false
      detail = 'expected null, got: ' + out
    }
  } else {
    if (unchanged) {
      ok = false
      detail = 'expected rewrite, got null'
    } else {
      for (const s of c.expectIncludes || []) {
        if (!out.includes(s)) {
          ok = false
          detail = 'missing "' + s + '" in: ' + out
          break
        }
      }
      for (const s of c.expectExcludes || []) {
        if (out && out.includes(s)) {
          ok = false
          detail = 'should not include "' + s + '" in: ' + out
          break
        }
      }
    }
  }

  if (ok) {
    console.log('ok  ', c.name)
  } else {
    failed++
    console.error('FAIL', c.name, '—', detail)
  }
}

if (failed) {
  console.error('\n' + failed + ' failed')
  process.exit(1)
}
console.log('\nall passed')
