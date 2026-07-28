import * as hook from './hook.js'
import * as urlx from './urlx.js'
import * as MSG from './msg.js'


const {
  apply,
  defineProperty,
  ownKeys,
  getOwnPropertyDescriptor,
} = Reflect


/** @type {((cmd: number, val: unknown) => void) | null} */
let mSendToSw = null

/** @type {string} */
let mSiteOrigin = ''

/** @type {string} */
let mLocalPrefix = ''

/** @type {string} */
let mSessionPrefix = ''


/**
 * @param {(cmd: number, val: unknown) => void} fn
 */
export function setStorageMessenger(fn) {
  mSendToSw = fn
}


/**
 * @param {string} siteOrigin
 * @param {string} localPrefix
 * @param {string} sessionPrefix
 */
export function setStorageContext(siteOrigin, localPrefix, sessionPrefix) {
  mSiteOrigin = siteOrigin
  mLocalPrefix = localPrefix
  mSessionPrefix = sessionPrefix
}


/**
 * @param {WindowOrWorkerGlobalScope} win
 * @param {string} name
 * @param {string} prefix
 * @param {boolean} syncAcrossTabs
 */
function setup(win, name, prefix, syncAcrossTabs) {
  const raw = win[name]
  if (!raw) {
    return
  }
  const prefixLen = prefix.length
  /** @type {Map<string, string|null>} */
  const cache = new Map()

  function persist(key, value, oldValue) {
    if (!mSendToSw || name !== 'localStorage') {
      return
    }
    if (value === null || value === undefined) {
      mSendToSw(MSG.PAGE_STORAGE_REMOVE, { siteOrigin: mSiteOrigin, key, oldValue })
    } else {
      mSendToSw(MSG.PAGE_STORAGE_SET, { siteOrigin: mSiteOrigin, key, value, oldValue })
    }
  }

  function getItem(key) {
    if (cache.has(key)) {
      const v = cache.get(key)
      return v === undefined ? null : v
    }
    const v = raw.getItem(prefix + key)
    if (v === null) {
      return null
    }
    cache.set(key, v)
    return v
  }

  function setItem(key, val) {
    const oldValue = getItem(key)
    cache.set(key, val)
    raw.setItem(prefix + key, val)
    if (syncAcrossTabs) {
      persist(String(key), val, oldValue)
    }
  }

  function removeItem(key) {
    const oldValue = getItem(key)
    cache.delete(key)
    raw.removeItem(prefix + key)
    if (syncAcrossTabs) {
      persist(String(key), null, oldValue)
    }
  }

  function clear() {
    const keys = getAllKeys()
    for (const key of keys) {
      removeItem(key)
    }
    if (syncAcrossTabs && mSendToSw) {
      mSendToSw(MSG.PAGE_STORAGE_CLEAR, { siteOrigin: mSiteOrigin })
    }
  }

  function key(val) {
    const arr = getAllKeys()
    const ret = arr[val | 0]
    return ret === undefined ? null : ret
  }

  function getAllKeys() {
    const ret = []
    const keys = ownKeys(raw)
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      if (typeof k !== 'string' || !k.startsWith(prefix)) {
        continue
      }
      ret.push(k.substr(prefixLen))
    }
    return ret
  }

  const nativeMap = {
    getItem,
    setItem,
    removeItem,
    clear,
    key,
    constructor: raw.constructor,
    toString: () => raw.toString(),
    [Symbol.toStringTag]: 'Storage',
    get length() {
      return getAllKeys().length
    },
  }

  const storage = new Proxy(raw, {
    get(obj, prop) {
      const val = nativeMap[prop]
      if (val !== undefined) {
        return val
      }
      const ret = getItem(prop)
      return ret === null ? undefined : ret
    },
    set(obj, prop, val) {
      if (prop in nativeMap) {
        nativeMap[prop] = val
        return true
      }
      setItem(String(prop), String(val))
      return true
    },
    deleteProperty(obj, prop) {
      removeItem(String(prop))
      return true
    },
    has(obj, prop) {
      if (typeof prop === 'string') {
        return (prefix + prop) in obj
      }
      return false
    },
    ownKeys() {
      return getAllKeys()
    },
    getOwnPropertyDescriptor(obj, prop) {
      if (typeof prop === 'string') {
        return getOwnPropertyDescriptor(raw, prefix + prop)
      }
    },
  })

  defineProperty(win, name, { value: storage })

  return {
    applyRemoteChange(key, value, oldValue) {
      if (value === null || value === undefined) {
        cache.delete(key)
        raw.removeItem(prefix + key)
      } else {
        cache.set(key, value)
        raw.setItem(prefix + key, value)
      }
      if (name !== 'localStorage') {
        return
      }
      try {
        const ev = new win.StorageEvent('storage', {
          key,
          oldValue: oldValue || null,
          newValue: value,
          url: win.location.href,
          storageArea: storage,
        })
        win.dispatchEvent(ev)
      } catch {
        // ignore
      }
    },
    clearAll() {
      cache.clear()
      const keys = ownKeys(raw)
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]
        if (typeof k === 'string' && k.startsWith(prefix)) {
          raw.removeItem(k)
        }
      }
    },
  }
}


/** @type {{ local: ReturnType<typeof setup> | null, session: ReturnType<typeof setup> | null }} */
const mHandles = { local: null, session: null }


/**
 * @param {WindowOrWorkerGlobalScope} global
 * @param {string} origin
 */
export function createStorage(global, origin) {
  const localPrefix = `${origin}$`
  const sessionPrefix = `${origin}$session$`
  setStorageContext(origin, localPrefix, sessionPrefix)

  mHandles.local = setup(global, 'localStorage', localPrefix, true)
  mHandles.session = setup(global, 'sessionStorage', sessionPrefix, false)

  function delPrefix(str) {
    return str.startsWith(idbPrefix) ? str.substr(idbPrefix.length) : str
  }

  function delPrefixGetter(oldFn) {
    return function() {
      const val = oldFn.call(this)
      return val && delPrefix(val)
    }
  }

  const StorageEventProto = global['StorageEvent'].prototype

  hook.prop(StorageEventProto, 'key', getter => function() {
    const val = getter.call(this)
    if (val && val.startsWith(localPrefix)) {
      return val.substr(localPrefix.length)
    }
    return val
  })
  hook.prop(StorageEventProto, 'url', getter => function() {
    const val = getter.call(this)
    return urlx.decUrlStrAbs(val)
  })

  const idbPrefix = `${origin}$`

  function addPrefixHook(oldFn) {
    return function(name) {
      if (arguments.length > 0) {
        arguments[0] = idbPrefix + name
      }
      return apply(oldFn, this, arguments)
    }
  }

  const IDBFactoryProto = global['IDBFactory'].prototype
  hook.func(IDBFactoryProto, 'open', addPrefixHook)
  hook.func(IDBFactoryProto, 'deleteDatabase', addPrefixHook)
  hook.func(IDBFactoryProto, 'databases', oldFn => async function() {
    const arr = await apply(oldFn, this, arguments)
    const ret = []
    for (const v of arr) {
      if (v.name[0] !== '.' && v.name.startsWith(idbPrefix)) {
        v.name = v.name.substr(idbPrefix.length)
        ret.push(v)
      }
    }
    return ret
  })

  const IDBDatabaseProto = global['IDBDatabase'].prototype
  hook.prop(IDBDatabaseProto, 'name', delPrefixGetter)

  const cacheStorageProto = global['CacheStorage'].prototype
  hook.func(cacheStorageProto, 'open', addPrefixHook)
  hook.func(cacheStorageProto, 'delete', addPrefixHook)
  hook.func(cacheStorageProto, 'keys', oldFn => async function() {
    const arr = await apply(oldFn, this, arguments)
    const ret = []
    for (const v of arr) {
      if (v[0] !== '.' && v.startsWith(idbPrefix)) {
        ret.push(v.substr(idbPrefix.length))
      }
    }
    return ret
  })

  hook.func(global, 'openDatabase', addPrefixHook)
}


/**
 * @param {{ siteOrigin?: string, key?: string, value?: string|null, oldValue?: string|null, clear?: boolean }} msg
 */
export function handleStoragePush(msg) {
  if (!mHandles.local) {
    return
  }
  if (msg.clear && msg.siteOrigin === mSiteOrigin) {
    mHandles.local.clearAll()
    return
  }
  if (msg.siteOrigin !== mSiteOrigin || !msg.key) {
    return
  }
  mHandles.local.applyRemoteChange(msg.key, msg.value, msg.oldValue)
}


export function clearAllStorage() {
  if (mHandles.local) {
    mHandles.local.clearAll()
  }
  if (mHandles.session) {
    mHandles.session.clearAll()
  }
}
