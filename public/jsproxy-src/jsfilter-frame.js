/**
 * AST rewrite: global top / parent / self → __vcWin so common
 * iframe-bust checks (top !== self) become false.
 * Parse with meriyah; generate with astring. Failures return null.
 */

import {parseScript} from 'meriyah'
import {generate} from 'astring'

/** Quick skip when source has no candidate identifiers. */
export const FRAME_SPOOF_QUICK_RE =
  /(?:\b(?:top|parent|self)\b|\b(?:window|globalThis)\s*(?:\.\s*(?:top|parent|self)|\s*\[\s*['"](?:top|parent|self)['"]\s*\]))/

const FRAME_NAMES = new Set(['top', 'parent', 'self'])
const WINDOW_ROOTS = new Set(['window', 'globalThis', 'self'])
const VC_WIN = '__vcWin'

/**
 * @returns {{ names: Set<string> }}
 */
function makeScope() {
  return { names: new Set() }
}

/**
 * @param {{ names: Set<string> }[]} stack
 * @param {string} name
 */
function bind(stack, name) {
  if (!name || !stack.length) {
    return
  }
  stack[stack.length - 1].names.add(name)
}

/**
 * @param {{ names: Set<string> }[]} stack
 * @param {string} name
 * @returns {boolean}
 */
function isShadowed(stack, name) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].names.has(name)) {
      return true
    }
  }
  return false
}

/**
 * @param {object|null|undefined} id
 * @param {{ names: Set<string> }[]} stack
 */
function bindPattern(id, stack) {
  if (!id || typeof id !== 'object') {
    return
  }
  switch (id.type) {
    case 'Identifier':
      bind(stack, id.name)
      break
    case 'ObjectPattern':
      for (const prop of id.properties || []) {
        if (prop.type === 'Property') {
          bindPattern(prop.value, stack)
        } else if (prop.type === 'RestElement') {
          bindPattern(prop.argument, stack)
        }
      }
      break
    case 'ArrayPattern':
      for (const el of id.elements || []) {
        if (el) {
          bindPattern(el, stack)
        }
      }
      break
    case 'RestElement':
      bindPattern(id.argument, stack)
      break
    case 'AssignmentPattern':
      bindPattern(id.left, stack)
      break
    default:
      break
  }
}

/**
 * Collect function/var/class bindings that hoist into `stack` top scope.
 * @param {object} node
 * @param {{ names: Set<string> }[]} stack
 */
function collectHoisted(node, stack) {
  if (!node || typeof node !== 'object') {
    return
  }
  switch (node.type) {
    case 'FunctionDeclaration':
      if (node.id) {
        bind(stack, node.id.name)
      }
      return
    case 'ClassDeclaration':
      if (node.id) {
        bind(stack, node.id.name)
      }
      return
    case 'VariableDeclaration':
      if (node.kind === 'var') {
        for (const d of node.declarations || []) {
          bindPattern(d.id, stack)
        }
      }
      return
    case 'BlockStatement':
    case 'Program':
      for (const stmt of node.body || []) {
        collectHoisted(stmt, stack)
      }
      return
    case 'IfStatement':
      collectHoisted(node.consequent, stack)
      collectHoisted(node.alternate, stack)
      return
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WithStatement':
    case 'LabeledStatement':
      collectHoisted(node.body, stack)
      return
    case 'SwitchStatement':
      for (const c of node.cases || []) {
        for (const s of c.consequent || []) {
          collectHoisted(s, stack)
        }
      }
      return
    case 'TryStatement':
      collectHoisted(node.block, stack)
      if (node.handler) {
        collectHoisted(node.handler.body, stack)
      }
      collectHoisted(node.finalizer, stack)
      return
    default:
      return
  }
}

/**
 * @param {object} node
 * @returns {boolean}
 */
function isFrameMember(node) {
  if (!node || node.type !== 'MemberExpression') {
    return false
  }
  const obj = node.object
  if (!obj || obj.type !== 'Identifier' || !WINDOW_ROOTS.has(obj.name)) {
    return false
  }
  if (node.computed) {
    const prop = node.property
    return (
      prop &&
      prop.type === 'Literal' &&
      typeof prop.value === 'string' &&
      FRAME_NAMES.has(prop.value)
    )
  }
  return (
    node.property &&
    node.property.type === 'Identifier' &&
    FRAME_NAMES.has(node.property.name)
  )
}

/**
 * @returns {{ type: 'Identifier', name: string }}
 */
function vcWinId() {
  return { type: 'Identifier', name: VC_WIN }
}

/**
 * @param {object|null|undefined} node
 * @param {{ names: Set<string> }[]} stack
 * @param {{ parent: object|null, key: string|null, isBinding: boolean }} ctx
 * @param {{ changed: boolean }} state
 * @returns {object|null|undefined}
 */
function walk(node, stack, ctx, state) {
  if (!node || typeof node !== 'object' || !node.type) {
    return node
  }

  // Replace window.top / window['top'] etc. before descending
  if (isFrameMember(node) && !ctx.isBinding) {
    state.changed = true
    return vcWinId()
  }

  if (node.type === 'Identifier' && FRAME_NAMES.has(node.name)) {
    if (!ctx.isBinding && !isShadowed(stack, node.name)) {
      // Skip property keys: { top: 1 } or obj.top as MemberExpression.property when !computed
      if (
        ctx.parent &&
        ctx.parent.type === 'MemberExpression' &&
        ctx.key === 'property' &&
        !ctx.parent.computed
      ) {
        return node
      }
      if (
        ctx.parent &&
        ctx.parent.type === 'Property' &&
        ctx.key === 'key' &&
        !ctx.parent.computed
      ) {
        return node
      }
      if (
        ctx.parent &&
        ctx.parent.type === 'MethodDefinition' &&
        ctx.key === 'key' &&
        !ctx.parent.computed
      ) {
        return node
      }
      if (ctx.parent && ctx.parent.type === 'LabeledStatement' && ctx.key === 'label') {
        return node
      }
      if (
        ctx.parent &&
        (ctx.parent.type === 'BreakStatement' || ctx.parent.type === 'ContinueStatement') &&
        ctx.key === 'label'
      ) {
        return node
      }
      if (
        ctx.parent &&
        ctx.parent.type === 'ImportSpecifier' &&
        (ctx.key === 'imported' || ctx.key === 'local')
      ) {
        return node
      }
      if (
        ctx.parent &&
        ctx.parent.type === 'ExportSpecifier' &&
        (ctx.key === 'exported' || ctx.key === 'local')
      ) {
        return node
      }
      if (
        ctx.parent &&
        (ctx.parent.type === 'FunctionDeclaration' ||
          ctx.parent.type === 'FunctionExpression' ||
          ctx.parent.type === 'ClassDeclaration' ||
          ctx.parent.type === 'ClassExpression') &&
        ctx.key === 'id'
      ) {
        return node
      }
      state.changed = true
      return vcWinId()
    }
    return node
  }

  switch (node.type) {
    case 'Program': {
      const next = makeScope()
      stack.push(next)
      collectHoisted(node, stack)
      for (const stmt of node.body || []) {
        if (stmt && stmt.type === 'VariableDeclaration' && stmt.kind !== 'var') {
          for (const d of stmt.declarations || []) {
            bindPattern(d.id, stack)
          }
        }
        if (stmt && stmt.type === 'ClassDeclaration' && stmt.id) {
          bind(stack, stmt.id.name)
        }
      }
      node.body = (node.body || []).map((stmt) =>
        walk(stmt, stack, { parent: node, key: 'body', isBinding: false }, state),
      )
      stack.pop()
      return node
    }

    case 'BlockStatement': {
      const next = makeScope()
      stack.push(next)
      // let/const bind in this block; var already hoisted to function/program
      for (const stmt of node.body || []) {
        if (stmt && stmt.type === 'VariableDeclaration' && stmt.kind !== 'var') {
          for (const d of stmt.declarations || []) {
            bindPattern(d.id, stack)
          }
        }
        if (stmt && stmt.type === 'ClassDeclaration' && stmt.id) {
          bind(stack, stmt.id.name)
        }
        if (stmt && stmt.type === 'FunctionDeclaration' && stmt.id) {
          bind(stack, stmt.id.name)
        }
      }
      node.body = (node.body || []).map((stmt) =>
        walk(stmt, stack, { parent: node, key: 'body', isBinding: false }, state),
      )
      stack.pop()
      return node
    }

    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      const fnScope = makeScope()
      stack.push(fnScope)
      // Named function expression binds its name in its own scope.
      // FunctionDeclaration name is already bound in the outer scope.
      if (node.type === 'FunctionExpression' && node.id) {
        bind(stack, node.id.name)
      }
      for (const p of node.params || []) {
        bindPattern(p, stack)
      }
      if (node.body && node.body.type === 'BlockStatement') {
        collectHoisted(node.body, stack)
      }
      node.params = (node.params || []).map((p) => walkParam(p, stack, state))
      node.body = walk(
        node.body,
        stack,
        { parent: node, key: 'body', isBinding: false },
        state,
      )
      stack.pop()
      return node
    }

    case 'CatchClause': {
      const next = makeScope()
      stack.push(next)
      if (node.param) {
        bindPattern(node.param, stack)
      }
      node.body = walk(
        node.body,
        stack,
        { parent: node, key: 'body', isBinding: false },
        state,
      )
      stack.pop()
      return node
    }

    case 'VariableDeclarator': {
      // id is binding; init is expression
      node.init = walk(
        node.init,
        stack,
        { parent: node, key: 'init', isBinding: false },
        state,
      )
      return node
    }

    case 'AssignmentExpression': {
      // left may be Identifier binding-like assignment target — still a reference to existing binding
      node.left = walk(
        node.left,
        stack,
        { parent: node, key: 'left', isBinding: false },
        state,
      )
      node.right = walk(
        node.right,
        stack,
        { parent: node, key: 'right', isBinding: false },
        state,
      )
      return node
    }

    case 'MemberExpression': {
      node.object = walk(
        node.object,
        stack,
        { parent: node, key: 'object', isBinding: false },
        state,
      )
      if (node.computed) {
        node.property = walk(
          node.property,
          stack,
          { parent: node, key: 'property', isBinding: false },
          state,
        )
      }
      // non-computed property Identifier is not a free reference
      return node
    }

    case 'Property': {
      if (node.computed) {
        node.key = walk(
          node.key,
          stack,
          { parent: node, key: 'key', isBinding: false },
          state,
        )
      }
      node.value = walk(
        node.value,
        stack,
        { parent: node, key: 'value', isBinding: false },
        state,
      )
      return node
    }

    case 'ForInStatement':
    case 'ForOfStatement': {
      const next = makeScope()
      stack.push(next)
      if (node.left && node.left.type === 'VariableDeclaration') {
        for (const d of node.left.declarations || []) {
          bindPattern(d.id, stack)
        }
      }
      node.left = walk(
        node.left,
        stack,
        { parent: node, key: 'left', isBinding: false },
        state,
      )
      node.right = walk(
        node.right,
        stack,
        { parent: node, key: 'right', isBinding: false },
        state,
      )
      node.body = walk(
        node.body,
        stack,
        { parent: node, key: 'body', isBinding: false },
        state,
      )
      stack.pop()
      return node
    }

    case 'ForStatement': {
      const next = makeScope()
      stack.push(next)
      if (node.init && node.init.type === 'VariableDeclaration') {
        for (const d of node.init.declarations || []) {
          if (node.init.kind === 'var') {
            // already in outer via collectHoisted for function body; still bind for let/const
          }
          if (node.init.kind !== 'var') {
            bindPattern(d.id, stack)
          } else {
            bindPattern(d.id, stack)
          }
        }
      }
      node.init = walk(
        node.init,
        stack,
        { parent: node, key: 'init', isBinding: false },
        state,
      )
      node.test = walk(
        node.test,
        stack,
        { parent: node, key: 'test', isBinding: false },
        state,
      )
      node.update = walk(
        node.update,
        stack,
        { parent: node, key: 'update', isBinding: false },
        state,
      )
      node.body = walk(
        node.body,
        stack,
        { parent: node, key: 'body', isBinding: false },
        state,
      )
      stack.pop()
      return node
    }

    default:
      break
  }

  // Generic descent for remaining node types
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue
    }
    const val = node[key]
    if (Array.isArray(val)) {
      node[key] = val.map((child) =>
        walk(child, stack, { parent: node, key, isBinding: false }, state),
      )
    } else if (val && typeof val === 'object' && val.type) {
      node[key] = walk(val, stack, { parent: node, key, isBinding: false }, state)
    }
  }
  return node
}

/**
 * Walk binding pattern defaults without treating pattern ids as free refs.
 * @param {object} p
 * @param {{ names: Set<string> }[]} stack
 * @param {{ changed: boolean }} state
 */
function walkParam(p, stack, state) {
  if (!p || typeof p !== 'object') {
    return p
  }
  if (p.type === 'AssignmentPattern') {
    p.right = walk(
      p.right,
      stack,
      { parent: p, key: 'right', isBinding: false },
      state,
    )
    return p
  }
  if (p.type === 'RestElement') {
    return p
  }
  if (p.type === 'ObjectPattern') {
    for (const prop of p.properties || []) {
      if (prop.type === 'Property') {
        if (prop.computed) {
          prop.key = walk(
            prop.key,
            stack,
            { parent: prop, key: 'key', isBinding: false },
            state,
          )
        }
        if (prop.value && prop.value.type === 'AssignmentPattern') {
          prop.value.right = walk(
            prop.value.right,
            stack,
            { parent: prop.value, key: 'right', isBinding: false },
            state,
          )
        }
      }
    }
    return p
  }
  if (p.type === 'ArrayPattern') {
    p.elements = (p.elements || []).map((el) =>
      el ? walkParam(el, stack, state) : el,
    )
    return p
  }
  return p
}

/**
 * @param {string} code
 * @returns {string|null} rewritten code, or null if unchanged / failed
 */
export function transformFrameSpoof(code) {
  if (!code || typeof code !== 'string') {
    return null
  }
  if (!FRAME_SPOOF_QUICK_RE.test(code)) {
    return null
  }
  let ast
  try {
    ast = parseScript(code, {
      next: true,
      webcompat: true,
      loc: false,
      ranges: false,
    })
  } catch {
    return null
  }
  const state = { changed: false }
  try {
    walk(ast, [], { parent: null, key: null, isBinding: false }, state)
  } catch {
    return null
  }
  if (!state.changed) {
    return null
  }
  try {
    return generate(ast)
  } catch {
    return null
  }
}
