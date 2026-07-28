/** @type {{ disableCache: boolean }} */
let mCtx = { disableCache: false }

/**
 * @param {{ disableCache?: boolean }|null|undefined} ctx
 */
export function setFetchContext(ctx) {
  mCtx = {
    disableCache: !!(ctx && ctx.disableCache),
  }
}

export function getFetchContext() {
  return mCtx
}

export function resetFetchContext() {
  mCtx = { disableCache: false }
}
