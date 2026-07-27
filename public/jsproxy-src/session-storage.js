import {Database} from './database.js'
import * as session from './session.js'


/** @type {Database} */
let mDB

/** @type {Map<string, Map<string, string>>} */
const mMem = new Map()


/**
 * @param {string} sessionId
 * @param {string} siteOrigin
 */
function memKey(sessionId, siteOrigin) {
  return `${sessionId}\0${siteOrigin}`
}


/**
 * @param {string} sessionId
 * @param {string} siteOrigin
 */
function getMemMap(sessionId, siteOrigin) {
  const k = memKey(sessionId, siteOrigin)
  let map = mMem.get(k)
  if (!map) {
    map = new Map()
    mMem.set(k, map)
  }
  return map
}


/**
 * @param {string} sessionId
 * @param {string} siteOrigin
 * @param {string} key
 */
function storageId(sessionId, siteOrigin, key) {
  return `${sessionId}$${siteOrigin}$${key}`
}


/**
 * @param {Database} db
 */
export async function setDB(db) {
  mDB = db
}


/**
 * @param {string} sessionId
 * @param {string} siteOrigin
 * @param {string} key
 */
export async function getItem(sessionId, siteOrigin, key) {
  const map = getMemMap(sessionId, siteOrigin)
  if (map.has(key)) {
    return map.get(key)
  }
  if (!mDB) {
    return null
  }
  const rec = await mDB.get('web-storage', storageId(sessionId, siteOrigin, key))
  if (rec && rec.value !== undefined) {
    map.set(key, rec.value)
    return rec.value
  }
  return null
}


/**
 * @param {string} sessionId
 * @param {string} siteOrigin
 * @param {string} key
 * @param {string} value
 */
export async function setItem(sessionId, siteOrigin, key, value) {
  getMemMap(sessionId, siteOrigin).set(key, value)
  if (mDB) {
    await mDB.put('web-storage', {
      id: storageId(sessionId, siteOrigin, key),
      sessionId,
      siteOrigin,
      key,
      value,
    })
  }
}


/**
 * @param {string} sessionId
 * @param {string} siteOrigin
 * @param {string} key
 */
export async function removeItem(sessionId, siteOrigin, key) {
  getMemMap(sessionId, siteOrigin).delete(key)
  if (mDB) {
    await mDB.delete('web-storage', storageId(sessionId, siteOrigin, key))
  }
}


/**
 * @param {string} sessionId
 * @param {string} siteOrigin
 */
export async function clear(sessionId, siteOrigin) {
  mMem.delete(memKey(sessionId, siteOrigin))
  if (!mDB) {
    return
  }
  await mDB.enum('web-storage', rec => {
    if (rec.sessionId === sessionId && rec.siteOrigin === siteOrigin) {
      mDB.delete('web-storage', rec.id)
    }
    return true
  })
}


/**
 * @param {string} sessionId
 */
export async function destroySession(sessionId) {
  for (const k of mMem.keys()) {
    if (k.startsWith(sessionId + '\0')) {
      mMem.delete(k)
    }
  }
  if (!mDB) {
    return
  }
  await mDB.enum('web-storage', rec => {
    if (rec.sessionId === sessionId) {
      mDB.delete('web-storage', rec.id)
    }
    return true
  })
}
