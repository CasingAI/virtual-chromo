/**
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

// ========================================================================
// path.js  (webpack module 5)
// ========================================================================

export const ROOT = getRootPath() 
export const HOME = ROOT + 'index.html'
export const CONF = ROOT + 'conf.js'
export const ICON = ROOT + 'favicon.ico'
export const HELPER = ROOT + '__sys__/helper.js'
export const ASSETS = ROOT + '__sys__/assets/'
export const PREFIX = ROOT + '-----'


function getRootPath() {
  //
  // 如果运行在代理页面，当前路径：
  //   https://example.com/path/to/-----url
  // 如果运行在 SW，当前路径：
  //   https://example.com/path/to/sw.js
  // 如果运行在 Worker，当前路径：
  //   __PATH__
  // 返回：
  //   https://example.com/path/to/
  //
  /** @type {string} */
  const envPath = self['__PATH__']
  if (envPath) {
    return envPath
  }
  let url = location.href
  const pos = url.indexOf('/-----http')
  if (pos === -1) {
    // sw
    url = url.replace(/[^/]+$/, '')
  } else {
    // page
    url = url.substr(0, pos)
  }
  return url.replace(/\/*$/, '/')
}

// ========================================================================
// util.js  (webpack module 2)
// ========================================================================
const ENC = new TextEncoder()

/**
 * @param {string} str 
 */
export function strToBytes(str) {
  return ENC.encode(str)
}

/**
 * @param {BufferSource} bytes 
 * @param {string} charset 
 */
export function bytesToStr(bytes, charset = 'utf-8') {
  return new TextDecoder(charset).decode(bytes)
}

/**
 * @param {string} label 
 */
export function isUtf8(label) {
  return /^utf-?8$/i.test(label)
}


const R_IP = /^(?:\d+\.){0,3}\d+$/

/**
 * @param {string} str 
 */
export function isIPv4(str) {
  return R_IP.test(str)
}


const JS_MIME_SET = new Set([
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'application/x-ecmascript',
  'module',
])

/**
 * @param {string} mime 
 */
export function isJsMime(mime) {
  return JS_MIME_SET.has(mime)
}


/**
 * 将多个 Uint8Array 拼接成一个
 * @param {Uint8Array[]} bufs 
 */
export function concatBufs(bufs) {
  let size = 0
  bufs.forEach(v => {
    size += v.length
  })

  let ret = new Uint8Array(size)
  let pos = 0
  bufs.forEach(v => {
    ret.set(v, pos)
    pos += v.length
  })
  return ret
}


/**
 * @param {string} str 
 */
export function strHash(str) {
  let sum = 0
  for (let i = 0, n = str.length; i < n; i++) {
    sum = (sum * 31 + str.charCodeAt(i)) >>> 0
  }
  return sum
}


/**
 * @param {number} num 
 * @param {number} len 
 */
export function numToHex(num, len) {
  return ('00000000' + num.toString(16)).slice(-len)
}


/**
 * @param {number} ms 
 */
export async function sleep(ms) {
  return new Promise(y => setTimeout(y, ms))
}


export function getTimeSeconds() {
  return (Date.now() / 1000) | 0
}

// ========================================================================
// env.js  (webpack module 4)
// ========================================================================
export const ENV_PAGE = 1
export const ENV_WORKER = 2
export const ENV_SW = 3

let mEnvType = 0

export function setEnvType(v) {
  mEnvType = v
}

export function isSwEnv() {
  return mEnvType === ENV_SW
}

export function isWorkerEnv() {
  return mEnvType === ENV_WORKER
}


/**
 * @type {WeakMap<Object, {loc: Location, doc: Document, ori: URL, domHook: object}>}
 */
const objInfoMap = new WeakMap()

export function add(win, info) {
  objInfoMap.set(win.Function, info)
}

export function get(obj) {
  const Function = obj.constructor.constructor
  return objInfoMap.get(Function)
}

// ========================================================================
// msg.js  (webpack module 3)
// ========================================================================
export const PAGE_INFO_PULL = 1
export const SW_INFO_PUSH = 2

export const PAGE_COOKIE_PUSH = 3
export const SW_COOKIE_PUSH = 4

export const PAGE_INIT_BEG = 5
export const PAGE_INIT_END = 6

export const PAGE_CONF_SET = 110
export const PAGE_CONF_GET = 111
export const PAGE_RELOAD_CONF = 112

export const SW_CONF_RETURN = 112
export const SW_CONF_CHANGE = 113

export const PAGE_READY_CHECK = 200
export const SW_READY = 201

// ========================================================================
// signal.js  (webpack module 8)
// ========================================================================
/**
 * Promise 简单封装
 * 
 * 封装前
 * ```
 * function get(...) {
 *   return new Promise(function(resolve, reject) {
 *     ...
 *     function callback(err, result) {
 *       if (err) {
 *         reject(err)
 *       } else {
 *         resolve(result)
 *       }
 *     }
 *     ...
 *   }
 * }
 * ...
 * await get(...)
 * ```
 * 
 * 
 * 封装后
 * ```
 * function get(...) {
 *   ...
 *   const s = new Signal()
 *   function callback(err, result) {
 *     if (err) {
 *       s.abort(err)
 *     } else {
 *       s.notify(result)
 *     }
 *   }
 *   ...
 *   return s.wait()
 * }
 * ...
 * await get(...)
 * ```
 */
export class Signal {
  constructor() {
    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })
  }

  wait() {
    return this._promise
  }

  notify(arg) {
    this._resolve(arg)
  }

  abort(arg) {
    this._reject(arg)
  }
}

// ========================================================================
// tld-data.js  (webpack module 9)
// 内联于 webpack module 9（体积最大）
// ========================================================================
// THIS FILE WAS GENERATED BY './tools/tld/gen.js'
export default '0.bg,001www.com,0emm.com,1.bg,12hp.at,12hp.ch,12hp.de,1337.pictures,16-b.it,1kapp.com,2.bg,2000.hu,2038.io,2ix.at,2ix.ch,2ix.de,3.bg,32-b.it,3utilities.com,4.bg,4lima.at,4lima.ch,4lima.de,4u.com,5.bg,6.bg,64-b.it,7.bg,8.bg,9.bg,9guacu.br,a.bg,a.prod.fastly.net,a.run.app,a.se,a.ssl.fastly.net,aa.no,aaa,aaa.pro,aarborte.no,aarp,ab.ca,abarth,abashiri.hokkaido.jp,abb,abbott,abbvie,abc,abc.br,abeno.osaka.jp,abiko.chiba.jp,abira.hokkaido.jp,abkhazia.su,able,abo.pa,abogado,abr.it,abruzzo.it,abu.yamaguchi.jp,abudhabi,ac,ac.ae,ac.at,ac.be,ac.ci,ac.cn,ac.cr,ac.cy,ac.gn,ac.gov.br,ac.id,ac.il,ac.im,ac.in,ac.ir,ac.jp,ac.ke,ac.kr,ac.leg.br,ac.lk,ac.ls,ac.ma,ac.me,ac.mu,ac.mw,ac.mz,ac.ni,ac.nz,ac.pa,ac.pr,ac.rs,ac.ru,ac.rw,ac.se,ac.sz,ac.th,ac.tj,ac.tz,ac.ug,ac.uk,ac.vn,ac.za,ac.zm,ac.zw,aca.pro,academia.bo,academy,academy.museum,accenture,accesscam.org,accident-investigation.aero,accident-prevention.aero,accountant,accountants,acct.pro,achi.nagano.jp,aco,act.au,act.edu.au,actor,ad,ad.jp,adac,adachi.tokyo.jp,adm.br,ads,adult,adult.ht,adv.br,adv.mz,advisor.ws,adygeya.ru,adygeya.su,ae,ae.org,aeg,aejrie.no,aero,aero.mv,aero.tt,aerobatic.aero,aeroclub.aero,aerodrome.aero,aeroport.fr,aetna,af,afamilycompany,afjord.no,afl,africa,africa.com,ag,ag.it,aga.niigata.jp,agakhan,agano.niigata.jp,agdenes.no,agematsu.nagano.jp,agency,agents.aero,agr.br,agrar.hu,agric.za,agriculture.museum,agrigento.it,agrinet.tn,agro.bo,agro.pl,aguni.okinawa.jp,ah.cn,ah.no,ai,aibetsu.hokkaido.jp,aichi.jp,aid.pl,aig,aigo,aikawa.kanagawa.jp,ainan.ehime.jp,aioi.hyogo.jp,aip.ee,air-surveillance.aero,air-traffic-control.aero,air.museum,airbus,aircraft.aero,airforce,airguard.museum,airline.aero,airport.aero,airtel,airtraffic.aero,aisai.aichi.jp,aisho.shiga.jp,aizubange.fukushima.jp,aizumi.tokushima.jp,aizumisato.fukushima.jp,aizuwakamatsu.fukushima.jp,aju.br,ak.us,akabira.hokkaido.jp,akagi.shimane.jp,akaiwa.okayama.jp,akashi.hyogo.jp,akdn,aki.kochi.jp,akiruno.tokyo.jp,akishima.tokyo.jp,akita.akita.jp,akita.jp,akkeshi.hokkaido.jp,aknoluokta.no,ako.hyogo.jp,akrehamn.no,aktyubinsk.su,akune.kagoshima.jp,al,al.eu.org,al.gov.br,al.it,al.leg.br,al.no,al.us,alabama.museum,alaheadju.no,aland.fi,alaska.museum,alces.network,alessandria.it,alesund.no,alfaromeo,algard.no,alibaba,alipay,allfinanz,allstate,ally,alpha-myqnapcloud.com,alpha.bounty-full.com,alsace,alstahaug.no,alstom,alt.za,alta.no,alto-adige.it,altoadige.it,alvdal.no,alwaysdata.net,am,am.br,am.gov.br,am.leg.br,ama.aichi.jp,ama.shimane.jp,amagasaki.hyogo.jp,amakusa.kumamoto.jp,amami.kagoshima.jp,amber.museum,ambulance.aero,ambulance.museum,american.museum,americana.museum,americanantiques.museum,americanart.museum,americanexpress,americanfamily,amex,amfam,ami.ibaraki.jp,amica,amli.no,amot.no,amsterdam,amsterdam.museum,amusement.aero,an.it,analytics,anamizu.ishikawa.jp,anan.nagano.jp,anan.tokushima.jp,anani.br,ancona.it,and.mom,and.museum,andasuolo.no,andebu.no,ando.nara.jp,andoy.no,andria-barletta-trani.it,andria-trani-barletta.it,andriabarlettatrani.it,andriatranibarletta.it,android,andøy.no,anjo.aichi.jp,ann-arbor.mi.us,annaka.gunma.jp,annefrank.museum,anpachi.gifu.jp,anquan,anthro.museum,anthropology.museum,antiques.museum,anz,ao,ao.it,aogaki.hyogo.jp,aogashima.tokyo.jp,aoki.nagano.jp,aol,aomori.aomori.jp,aomori.jp,aosta-valley.it,aosta.it,aostavalley.it,aoste.it,ap-northeast-1.elasticbeanstalk.com,ap-northeast-2.elasticbeanstalk.com,ap-northeast-3.elasticbeanstalk.com,ap-south-1.elasticbeanstalk.com,ap-southeast-1.elasticbeanstalk.com,ap-southeast-2.elasticbeanstalk.com,ap.gov.br,ap.gov.pl,ap.it,ap.leg.br,aparecida.br,apartments,api.stdlib.com,apigee.io,app,app.banzaicloud.io,app.lmpm.com,app.os.fedoraproject.org,app.os.stg.fedoraproject.org,app.render.com,appchizi.com,apple,applicationcloud.io,applinzi.com,apps.fbsbx.com,apps.lair.io,appspot.com,aq,aq.it,aquarelle,aquarium.museum,aquila.it,ar,ar.com,ar.it,ar.us,arab,arai.shizuoka.jp,arakawa.saitama.jp,arakawa.tokyo.jp,aramco,arao.kumamoto.jp,arboretum.museum,archaeological.museum,archaeology.museum,archi,architecture.museum,ardal.no,aremark.no,arendal.no,arezzo.it,ariake.saga.jp,arida.wakayama.jp,aridagawa.wakayama.jp,arita.saga.jp,arkhangelsk.su,armenia.su,army,arna.no,arpa,arq.br,art,art.br,art.do,art.dz,art.ht,art.museum,art.pl,art.sn,artanddesign.museum,artcenter.museum,artdeco.museum,arte,arte.bo,arteducation.museum,artgallery.museum,arts.co,arts.museum,arts.nf,arts.ro,arts.ve,artsandcrafts.museum,arvo.network,as,as.us,asago.hyogo.jp,asahi.chiba.jp,asahi.ibaraki.jp,asahi.mie.jp,asahi.nagano.jp,asahi.toyama.jp,asahi.yamagata.jp,asahikawa.hokkaido.jp,asaka.saitama.jp,asakawa.fukushima.jp,asakuchi.okayama.jp,asaminami.hiroshima.jp,ascoli-piceno.it,ascolipiceno.it,asda,aseral.no,ashgabad.su,ashibetsu.hokkaido.jp,ashikaga.tochigi.jp,ashiya.fukuoka.jp,ashiya.hyogo.jp,ashoro.hokkaido.jp,asia,asker.no,askim.no,askoy.no,askvoll.no,askøy.no,asmatart.museum,asn.au,asn.lv,asnes.no,aso.kumamoto.jp,ass.km,assabu.hokkaido.jp,assassination.museum,assisi.museum,assn.lk,asso.bj,asso.ci,asso.dz,asso.eu.org,asso.fr,asso.gp,asso.ht,asso.km,asso.mc,asso.nc,asso.re,associates,association.aero,association.museum,asti.it,astronomy.museum,asuke.aichi.jp,at,at-band-camp.net,at.eu.org,at.it,atami.shizuoka.jp,ath.cx,athleta,atlanta.museum,atm.pl,ato.br,atsugi.kanagawa.jp,atsuma.hokkaido.jp,attorney,au,au.eu.org,auction,audi,audible,audio,audnedaln.no,augustow.pl,aukra.no,aure.no,aurland.no,aurskog-holand.no,aurskog-høland.no,auspost,austevoll.no,austin.museum,australia.museum,austrheim.no,author,author.aero,auto,auto.pl,automotive.museum,autos,av.it,av.tr,avellino.it,averoy.no,averøy.no,avianca,aviation.museum,avocat.fr,avocat.pro,avoues.fr,aw,awaji.hyogo.jp,awdev.ca,aws,ax,axa,axis.museum,aya.miyazaki.jp,ayabe.kyoto.jp,ayagawa.kagawa.jp,ayase.kanagawa.jp,az,az.us,azerbaijan.su,azimuth.network,azumino.nagano.jp,azure,azure-mobile.net,azurecontainer.io,azurewebsites.net,aéroport.ci,b-data.io,b.bg,b.br,b.se,b.ssl.fastly.net,ba,ba.gov.br,ba.it,ba.leg.br,babia-gora.pl,baby,backplaneapp.io,badaddja.no,badajoz.museum,baghdad.museum,bahcavuotna.no,bahccavuotna.no,bahn.museum,baidar.no,baidu,bajddar.no,balashov.su,balat.no,bale.museum,balena-devices.com,balestrand.no,ballangen.no,ballooning.aero,balsan-sudtirol.it,balsan-suedtirol.it,balsan-südtirol.it,balsan.it,balsfjord.no,baltimore.museum,bamble.no,banamex,bananarepublic,band,bandai.fukushima.jp,bando.ibaraki.jp,bank,bar,bar.pro,barcelona,barcelona.museum,barclaycard,barclays,bardu.no,barefoot,bargains,bari.it,barletta-trani-andria.it,barlettatraniandria.it,barreau.bj,barrel-of-knowledge.info,barrell-of-knowledge.info,barsy.bg,barsy.ca,barsy.club,barsy.co.uk,barsy.de,barsy.eu,barsy.in,barsy.info,barsy.io,barsy.me,barsy.menu,barsy.mobi,barsy.net,barsy.online,barsy.org,barsy.pro,barsy.pub,barsy.shop,barsy.site,barsy.support,barsy.uk,barsycenter.com,barsyonline.co.uk,barsyonline.com,barueri.br,barum.no,bas.it,baseball,baseball.museum,basel.museum,bashkiria.ru,bashkiria.su,basicserver.io,basilicata.it,basketball,baths.museum,bato.tochigi.jp,batsfjord.no,bauern.museum,bauhaus,bayern,bb,bbc,bbs.tr,bbt,bbva,bc.ca,bcg,bci.dnstrace.pro,bcn,bd,bd.se,be,be.eu.org,bearalvahki.no,bearalváhki.no,beardu.no,beats,beauty,beauxarts.museum,bedzin.pl,beeldengeluid.museum,beep.pl,beer,beiarn.no,bel.tr,belau.pw,belem.br,bellevue.museum,belluno.it,benevento.it,bentley,beppu.oita.jp,berg.no,bergamo.it,bergbau.museum,bergen.no,berkeley.museum,berlevag.no,berlevåg.no,berlin,berlin.museum,bern.museum,beskidy.pl,best,bestbuy,bet,beta.bounty-full.com,betainabox.com,better-than.tv,bf,bg,bg.eu.org,bg.it,bh,bharti,bhz.br,bi,bi.it,bialowieza.pl,bialystok.pl,bibai.hokkaido.jp,bible,bible.museum,bid,biei.hokkaido.jp,bielawa.pl,biella.it,bieszczady.pl,bievat.no,bievát.no,bifuka.hokkaido.jp,bihoro.hokkaido.jp,bike,bilbao.museum,bill.museum,bindal.no,bing,bingo,bio,bio.br,bir.ru,biratori.hokkaido.jp,birdart.museum,birkenes.no,birthplace.museum,bitballoon.com,biz,biz.at,biz.az,biz.bb,biz.cy,biz.dk,biz.et,biz.gl,biz.id,biz.ki,biz.ls,biz.mv,biz.mw,biz.ni,biz.nr,biz.pk,biz.pl,biz.pr,biz.tj,biz.tr,biz.tt,biz.ua,biz.vn,biz.zm,bizen.okayama.jp,bj,bj.cn,bjarkoy.no,bjarkøy.no,bjerkreim.no,bjugn.no,bl.it,black,blackbaudcdn.net,blackfriday,blockbuster,blog,blog.bo,blog.br,blogdns.com,blogdns.net,blogdns.org,blogsite.org,blogsite.xyz,blogspot.ae,blogspot.al,blogspot.am,blogspot.ba,blogspot.be,blogspot.bg,blogspot.bj,blogspot.ca,blogspot.cf,blogspot.ch,blogspot.cl,blogspot.co.at,blogspot.co.id,blogspot.co.il,blogspot.co.ke,blogspot.co.nz,blogspot.co.uk,blogspot.co.za,blogspot.com,blogspot.com.ar,blogspot.com.au,blogspot.com.br,blogspot.com.by,blogspot.com.co,blogspot.com.cy,blogspot.com.ee,blogspot.com.eg,blogspot.com.es,blogspot.com.mt,blogspot.com.ng,blogspot.com.tr,blogspot.com.uy,blogspot.cv,blogspot.cz,blogspot.de,blogspot.dk,blogspot.fi,blogspot.fr,blogspot.gr,blogspot.hk,blogspot.hr,blogspot.hu,blogspot.ie,blogspot.in,blogspot.is,blogspot.it,blogspot.jp,blogspot.kr,blogspot.li,blogspot.lt,blogspot.lu,blogspot.md,blogspot.mk,blogspot.mr,blogspot.mx,blogspot.my,blogspot.nl,blogspot.no,blogspot.pe,blogspot.pt,blogspot.qa,blogspot.re,blogspot.ro,blogspot.rs,blogspot.ru,blogspot.se,blogspot.sg,blogspot.si,blogspot.sk,blogspot.sn,blogspot.td,blogspot.tw,blogspot.ug,blogspot.vn,blogsyte.com,bloomberg,bloxcms.com,blue,bm,bmd.br,bmoattachments.org,bms,bmw,bn,bn.it,bnl,bnpparibas,bnr.la,bo,bo.it,bo.nordland.no,bo.telemark.no,boats,boavista.br,bodo.no,bodø.no,boehringer,bofa,bokn.no,boldlygoingnowhere.org,boleslawiec.pl,bolivia.bo,bologna.it,bolt.hu,bolzano-altoadige.it,bolzano.it,bom,bomlo.no,bond,bonn.museum,boo,book,booking,boomla.net,bosch,bostik,boston,boston.museum,bot,botanical.museum,botanicalgarden.museum,botanicgarden.museum,botany.museum,bounceme.net,bounty-full.com,boutique,box,boxfuse.io,bozen-sudtirol.it,bozen-suedtirol.it,bozen-südtirol.it,bozen.it,bpl.biz,bplaced.com,bplaced.de,bplaced.net,br,br.com,br.it,bradesco,brand.se,brandywinevalley.museum,brasil.museum,brasilia.me,bremanger.no,brescia.it,bridgestone,brindisi.it,bristol.museum,british.museum,britishcolumbia.museum,broadcast.museum,broadway,broke-it.net,broker,broker.aero,bronnoy.no,bronnoysund.no,brother,browsersafetymark.io,brumunddal.no,brunel.museum,brussel.museum,brussels,brussels.museum,bruxelles.museum,bryansk.su,bryne.no,brønnøy.no,brønnøysund.no,bs,bs.it,bsb.br,bss.design,bt,bt.it,bu.no,budapest,budejju.no,bugatti,build,builders,building.museum,bukhara.su,bulsan-sudtirol.it,bulsan-suedtirol.it,bulsan-südtirol.it,bulsan.it,bungoono.oita.jp,bungotakada.oita.jp,bunkyo.tokyo.jp,burghof.museum,bus.museum,busan.kr,bushey.museum,business,buy,buyshouses.net,buzen.fukuoka.jp,buzz,bv,bw,by,bydgoszcz.pl,byen.site,bygland.no,bykle.no,bytom.pl,bz,bz.it,bzh,bzz.dapps.earth,báhcavuotna.no,báhccavuotna.no,báidár.no,bájddar.no,bálát.no,bådåddjå.no,båtsfjord.no,bærum.no,bø.nordland.no,bø.telemark.no,bømlo.no,c.bg,c.cdn77.org,c.la,c.se,c66.me,ca,ca-central-1.elasticbeanstalk.com,ca.eu.org,ca.it,ca.na,ca.us,caa.aero,caa.li,cab,cable-modem.org,cadaques.museum,cafe,cagliari.it,cahcesuolo.no,cal,cal.it,calabria.it,california.museum,call,caltanissetta.it,calvinklein,cam,cam.it,cambridge.museum,camdvr.org,camera,camp,campania.it,campidano-medio.it,campidanomedio.it,campinagrande.br,campinas.br,campobasso.it,can.museum,canada.museum,cancerresearch,canon,capebreton.museum,capetown,capital,capitalone,car,caravan,carbonia-iglesias.it,carboniaiglesias.it,cards,care,career,careers,cargo.aero,carrara-massa.it,carraramassa.it,carrd.co,carrier.museum,cars,cartier,cartoonart.museum,casa,casacam.net,casadelamoneda.museum,case,caseih,caserta.it,cash,casino,casino.hu,castle.museum,castres.museum,cat,catania.it,catanzaro.it,catering,catering.aero,catholic,caxias.br,cb.it,cba,cbg.ru,cbn,cbre,cbs,cc,cc.ak.us,cc.al.us,cc.ar.us,cc.as.us,cc.az.us,cc.ca.us,cc.co.us,cc.ct.us,cc.dc.us,cc.de.us,cc.fl.us,cc.ga.us,cc.gu.us,cc.hi.us,cc.ia.us,cc.id.us,cc.il.us,cc.in.us,cc.ks.us,cc.ky.us,cc.la.us,cc.ma.us,cc.md.us,cc.me.us,cc.mi.us,cc.mn.us,cc.mo.us,cc.ms.us,cc.mt.us,cc.na,cc.nc.us,cc.nd.us,cc.ne.us,cc.nh.us,cc.nj.us,cc.nm.us,cc.nv.us,cc.ny.us,cc.oh.us,cc.ok.us,cc.or.us,cc.pa.us,cc.pr.us,cc.ri.us,cc.sc.us,cc.sd.us,cc.tn.us,cc.tx.us,cc.ua,cc.ut.us,cc.va.us,cc.vi.us,cc.vt.us,cc.wa.us,cc.wi.us,cc.wv.us,cc.wy.us,cci.fr,cd,cd.eu.org,cdn77-ssl.net,ce.gov.br,ce.it,ce.leg.br,ceb,cechire.com,celtic.museum,center,center.museum,ceo,cern,certification.aero,certmgr.org,cesena-forli.it,cesena-forlì.it,cesenaforli.it,cesenaforlì.it,cf,cfa,cfd,cg,ch,ch.eu.org,ch.it,chambagri.fr,championship.aero,chanel,channel,channelsdvr.net,charity,charter.aero,chase,chat,chattanooga.museum,cheap,cheltenham.museum,cherkassy.ua,cherkasy.ua,chernigov.ua,chernihiv.ua,chernivtsi.ua,chernovtsy.ua,chesapeakebay.museum,chiba.jp,chicago.museum,chichibu.saitama.jp,chieti.it,chigasaki.kanagawa.jp,chihayaakasaka.osaka.jp,chijiwa.nagasaki.jp,chikugo.fukuoka.jp,chikuho.fukuoka.jp,chikuhoku.nagano.jp,chikujo.fukuoka.jp,chikuma.nagano.jp,chikusei.ibaraki.jp,chikushino.fukuoka.jp,chikuzen.fukuoka.jp,children.museum,childrens.museum,childrensgarden.museum,chimkent.su,chino.nagano.jp,chintai,chippubetsu.hokkaido.jp,chiropractic.museum,chirurgiens-dentistes-en-france.fr,chirurgiens-dentistes.fr,chiryu.aichi.jp,chita.aichi.jp,chitose.hokkaido.jp,chiyoda.gunma.jp,chiyoda.tokyo.jp,chizu.tottori.jp,chocolate.museum,chofu.tokyo.jp,chonan.chiba.jp,chosei.chiba.jp,choshi.chiba.jp,choyo.kumamoto.jp,christiansburg.museum,christmas,chrome,chrysler,chtr.k12.ma.us,chungbuk.kr,chungnam.kr,chuo.chiba.jp,chuo.fukuoka.jp,chuo.osaka.jp,chuo.tokyo.jp,chuo.yamanashi.jp,church,ci,ci.it,ciencia.bo,cieszyn.pl,cim.br,cincinnati.museum,cinema.museum,cipriani,circle,circus.museum,cisco,ciscofreak.com,cistron.nl,citadel,citi,citic,city,city.hu,cityeats,civilaviation.aero,civilisation.museum,civilization.museum,civilwar.museum,ck,ck.ua,cl,cl.it,claims,clan.rip,cleaning,cleverapps.io,click,clinic,clinique,clinton.museum,clock.museum,clothing,cloud,cloud.fedoraproject.org,cloud.goog,cloud.metacentrum.cz,cloud66.ws,cloud66.zone,cloudaccess.host,cloudaccess.net,cloudapp.net,cloudapps.digital,cloudcontrolapp.com,cloudcontrolled.com,cloudeity.net,cloudera.site,cloudfront.net,cloudfunctions.net,cloudns.asia,cloudns.biz,cloudns.cc,cloudns.club,cloudns.eu,cloudns.in,cloudns.info,cloudns.org,cloudns.pro,cloudns.pw,cloudns.us,cloudycluster.net,club,club.aero,club.tw,clubmed,cm,cn,cn-north-1.eb.amazonaws.com.cn,cn-northwest-1.eb.amazonaws.com.cn,cn.com,cn.eu.org,cn.it,cn.ua,cng.br,cnpy.gdn,cns.joyent.com,cnt.br,co,co.ae,co.ag,co.am,co.ao,co.at,co.bb,co.bi,co.bn,co.business,co.bw,co.ca,co.ci,co.cl,co.cm,co.com,co.cr,co.cz,co.dk,co.education,co.events,co.financial,co.gg,co.gl,co.gy,co.hu,co.id,co.il,co.im,co.in,co.ir,co.it,co.je,co.jp,co.ke,co.kr,co.krd,co.lc,co.ls,co.ma,co.me,co.mg,co.mu,co.mw,co.mz,co.na,co.network,co.ni,co.nl,co.no,co.nz,co.om,co.pl,co.place,co.pn,co.pw,co.rs,co.rw,co.st,co.sz,co.technology,co.th,co.tj,co.tm,co.tt,co.tz,co.ua,co.ug,co.uk,co.us,co.uz,co.ve,co.vi,co.za,co.zm,co.zw,coach,coal.museum,coastaldefence.museum,codes,codespot.com,cody.museum,coffee,cog.mi.us,col.ng,coldwar.museum,collection.museum,college,collegefan.org,cologne,colonialwilliamsburg.museum,coloradoplateau.museum,columbia.museum,columbus.museum,com,com.ac,com.af,com.ag,com.ai,com.al,com.am,com.ar,com.au,com.aw,com.az,com.ba,com.bb,com.bh,com.bi,com.bm,com.bn,com.bo,com.br,com.bs,com.bt,com.by,com.bz,com.ci,com.cm,com.cn,com.co,com.cu,com.cw,com.cy,com.de,com.dm,com.do,com.dz,com.ec,com.ee,com.eg,com.es,com.et,com.fr,com.ge,com.gh,com.gi,com.gl,com.gn,com.gp,com.gr,com.gt,com.gu,com.gy,com.hk,com.hn,com.hr,com.ht,com.im,com.io,com.iq,com.is,com.jo,com.kg,com.ki,com.km,com.kp,com.kw,com.ky,com.kz,com.la,com.lb,com.lc,com.lk,com.lr,com.lv,com.ly,com.mg,com.mk,com.ml,com.mo,com.ms,com.mt,com.mu,com.mv,com.mw,com.mx,com.my,com.na,com.nf,com.ng,com.ni,com.nr,com.om,com.pa,com.pe,com.pf,com.ph,com.pk,com.pl,com.pr,com.ps,com.pt,com.py,com.qa,com.re,com.ro,com.ru,com.sa,com.sb,com.sc,com.sd,com.se,com.sg,com.sh,com.sl,com.sn,com.so,com.st,com.sv,com.sy,com.tj,com.tm,com.tn,com.to,com.tr,com.tt,com.tw,com.ua,com.ug,com.uy,com.uz,com.vc,com.ve,com.vi,com.vn,com.vu,com.ws,com.zm,comcast,commbank,commune.am,communication.museum,communications.museum,community,community.museum,como.it,company,compare,compute-1.amazonaws.com,compute.amazonaws.com,compute.amazonaws.com.cn,compute.estate,computer,computer.museum,computerhistory.museum,comsec,comunicações.museum,condos,conf.au,conf.lv,conf.se,conference.aero,construction,consulado.st,consultant.aero,consulting,consulting.aero,contact,contagem.br,contemporary.museum,contemporaryart.museum,contractors,control.aero,convent.museum,cooking,cookingchannel,cool,coop,coop.br,coop.ht,coop.km,coop.mv,coop.mw,coop.py,coop.rw,coop.tt,cooperativa.bo,copenhagen.museum,corporation.museum,correios-e-telecomunicações.museum,corsica,corvette.museum,cosenza.it,costume.museum,couchpotatofries.org,council.aero,country,countryestate.museum,county.museum,coupon,coupons,courses,cpa,cpa.pro,cq.cn,cr,cr.it,cr.ua,crafting.xyz,crafts.museum,cranbrook.museum,crd.co,creation.museum,credit,creditcard,creditunion,cremona.it,crew.aero,cri.br,cri.nz,cricket,crimea.ua,crotone.it,crown,crs,cruise,cruises,cryptonomic.net,cs.it,csc,ct.it,ct.us,cu,cuiaba.br,cuisinella,cultural.museum,culturalcenter.museum,culture.museum,cuneo.it,cupcake.is,curitiba.br,cust.dev.thingdust.io,cust.disrec.thingdust.io,cust.prod.thingdust.io,cust.testing.thingdust.io,custom.metacentrum.cz,customer.enonic.io,customer.speedpartner.de,cv,cv.ua,cw,cx,cy,cy.eu.org,cya.gg,cyber.museum,cymru,cymru.museum,cyon.link,cyon.site,cyou,cz,cz.eu.org,cz.it,czeladz.pl,czest.pl,d.bg,d.gv.vc,d.se,dabur,dad,daegu.kr,daejeon.kr,dagestan.ru,dagestan.su,daigo.ibaraki.jp,daisen.akita.jp,daito.osaka.jp,daiwa.hiroshima.jp,dali.museum,dallas.museum,damnserver.com,dance,daplie.me,dapps.earth,data,database.museum,date,date.fukushima.jp,date.hokkaido.jp,dating,datsun,dattolocal.com,dattolocal.net,dattorelay.com,dattoweb.com,davvenjarga.no,davvenjárga.no,davvesiida.no,day,dazaifu.fukuoka.jp,dc.us,dclk,dd-dns.de,ddns.me,ddns.net,ddnsfree.com,ddnsgeek.com,ddnsking.com,ddnslive.com,ddnss.de,ddnss.org,ddr.museum,dds,de,de.com,de.cool,de.eu.org,de.us,deal,dealer,deals,deatnu.no,debian.net,decorativearts.museum,dedyn.io,def.br,defense.tn,definima.io,definima.net,degree,delaware.museum,delivery,dell,dell-ogliastra.it,dellogliastra.it,delmenhorst.museum,deloitte,delta,democracia.bo,democrat,demon.nl,denmark.museum,dental,dentist,dep.no,deporte.bo,depot.museum,desa.id,desi,design,design.aero,design.museum,detroit.museum,dev,dev-myqnapcloud.com,dev.static.land,development.run,devices.resinstaging.io,df.gov.br,df.leg.br,dgca.aero,dh.bytemark.co.uk,dhl,diamonds,dielddanuorri.no,diet,digital,dinosaur.museum,direct,directory,discount,discourse.group,discover,discovery.museum,dish,diskstation.eu,diskstation.me,diskstation.org,ditchyourip.com,divtasvuodna.no,divttasvuotna.no,diy,dj,dk,dk.eu.org,dlugoleka.pl,dm,dn.ua,dnepropetrovsk.ua,dni.us,dnipropetrovsk.ua,dnp,dnsalias.com,dnsalias.net,dnsalias.org,dnsdojo.com,dnsdojo.net,dnsdojo.org,dnsfor.me,dnshome.de,dnsiskinky.com,dnsking.ch,dnsup.net,dnsupdater.de,do,docs,doctor,dodge,does-it.net,doesntexist.com,doesntexist.org,dog,dolls.museum,domains,dominic.ua,donetsk.ua,donna.no,donostia.museum,dontexist.com,dontexist.net,dontexist.org,doomdns.com,doomdns.org,doshi.yamanashi.jp,dot,dovre.no,download,dp.ua,dr.na,dr.tr,drammen.no,drangedal.no,dray-dns.de,drayddns.com,draydns.de,dreamhosters.com,drive,drobak.no,drud.io,drud.us,drøbak.no,dscloud.biz,dscloud.me,dscloud.mobi,dsmynas.com,dsmynas.net,dsmynas.org,dst.mi.us,dtv,dubai,duck,duckdns.org,dunlop,duns,dupont,durban,durham.museum,dvag,dvr,dvrcam.info,dvrdns.org,dweb.link,dy.fi,dyn-berlin.de,dyn-ip24.de,dyn-o-saur.com,dyn-vpn.de,dyn.cosidns.de,dyn.ddnss.de,dyn.home-webserver.de,dyn53.io,dynalias.com,dynalias.net,dynalias.org,dynamic-dns.info,dynamisches-dns.de,dynathome.net,dyndns-at-home.com,dyndns-at-work.com,dyndns-blog.com,dyndns-free.com,dyndns-home.com,dyndns-ip.com,dyndns-mail.com,dyndns-office.com,dyndns-pics.com,dyndns-remote.com,dyndns-server.com,dyndns-web.com,dyndns-wiki.com,dyndns-work.com,dyndns.biz,dyndns.ddnss.de,dyndns.info,dyndns.org,dyndns.tv,dyndns.ws,dyndns1.de,dynns.com,dynserv.org,dynu.net,dynv6.net,dynvpn.de,dyroy.no,dyrøy.no,dz,dønna.no,e.bg,e.se,e12.ve,e164.arpa,e4.cz,earth,east-kazakhstan.su,eastafrica.museum,eastcoast.museum,eat,eating-organic.net,eaton.mi.us,ebetsu.hokkaido.jp,ebina.kanagawa.jp,ebino.miyazaki.jp,ebiz.tw,ec,echizen.fukui.jp,ecn.br,eco,eco.br,ecologia.bo,economia.bo,ed.ao,ed.ci,ed.cr,ed.jp,ed.pw,edeka,edogawa.tokyo.jp,edu,edu.ac,edu.af,edu.al,edu.ar,edu.au,edu.az,edu.ba,edu.bb,edu.bh,edu.bi,edu.bm,edu.bn,edu.bo,edu.br,edu.bs,edu.bt,edu.bz,edu.ci,edu.cn,edu.co,edu.cu,edu.cw,edu.dm,edu.do,edu.dz,edu.ec,edu.ee,edu.eg,edu.es,edu.et,edu.eu.org,edu.ge,edu.gh,edu.gi,edu.gl,edu.gn,edu.gp,edu.gr,edu.gt,edu.gu,edu.gy,edu.hk,edu.hn,edu.ht,edu.in,edu.iq,edu.is,edu.it,edu.jo,edu.kg,edu.ki,edu.km,edu.kn,edu.kp,edu.krd,edu.kw,edu.ky,edu.kz,edu.la,edu.lb,edu.lc,edu.lk,edu.lr,edu.ls,edu.lv,edu.ly,edu.me,edu.mg,edu.mk,edu.ml,edu.mn,edu.mo,edu.ms,edu.mt,edu.mv,edu.mw,edu.mx,edu.my,edu.mz,edu.ng,edu.ni,edu.nr,edu.om,edu.pa,edu.pe,edu.pf,edu.ph,edu.pk,edu.pl,edu.pn,edu.pr,edu.ps,edu.pt,edu.py,edu.qa,edu.rs,edu.ru,edu.sa,edu.sb,edu.sc,edu.sd,edu.sg,edu.sl,edu.sn,edu.st,edu.sv,edu.sy,edu.tj,edu.tm,edu.to,edu.tr,edu.tt,edu.tw,edu.ua,edu.uy,edu.vc,edu.ve,edu.vn,edu.vu,edu.ws,edu.za,edu.zm,education,education.museum,educational.museum,educator.aero,edugit.org,edunet.tn,ee,ee.eu.org,eg,egersund.no,egyptian.museum,ehime.jp,eid.no,eidfjord.no,eidsberg.no,eidskog.no,eidsvoll.no,eigersund.no,eiheiji.fukui.jp,eisenbahn.museum,ekloges.cy,elasticbeanstalk.com,elb.amazonaws.com,elb.amazonaws.com.cn,elblag.pl,elburg.museum,elk.pl,elvendrell.museum,elverum.no,email,emb.kw,embaixada.st,embetsu.hokkaido.jp,embroidery.museum,emerck,emergency.aero,emilia-romagna.it,emiliaromagna.it,emp.br,empresa.bo,emr.it,en.it,ena.gifu.jp,encyclopedic.museum,endofinternet.net,endofinternet.org,endoftheinternet.org,enebakk.no,energy,eng.br,eng.pro,engerdal.no,engine.aero,engineer,engineer.aero,engineering,england.museum,eniwa.hokkaido.jp,enna.it,enonic.io,ens.tn,enterprisecloud.nu,enterprises,entertainment.aero,entomology.museum,environment.museum,environmentalconservation.museum,epilepsy.museum,epson,equipment,equipment.aero,er,ericsson,erimo.hokkaido.jp,erni,erotica.hu,erotika.hu,es,es.eu.org,es.gov.br,es.kr,es.leg.br,esan.hokkaido.jp,esashi.hokkaido.jp,esp.br,esq,essex.museum,est-a-la-maison.com,est-a-la-masion.com,est-le-patron.com,est-mon-blogueur.com,est.pr,estate,estate.museum,esurance,et,etajima.hiroshima.jp,etc.br,ethnology.museum,eti.br,etisalat,etne.no,etnedal.no,eu,eu-1.evennode.com,eu-2.evennode.com,eu-3.evennode.com,eu-4.evennode.com,eu-central-1.elasticbeanstalk.com,eu-west-1.elasticbeanstalk.com,eu-west-2.elasticbeanstalk.com,eu-west-3.elasticbeanstalk.com,eu.com,eu.int,eu.meteorapp.com,eu.org,eun.eg,eurovision,eus,evenassi.no,evenes.no,events,evenášši.no,everbank,evje-og-hornnes.no,ex.futurecms.at,ex.ortsinfo.at,exchange,exchange.aero,exeter.museum,exhibition.museum,exnet.su,expert,experts-comptables.fr,exposed,express,express.aero,extraspace,f.bg,f.se,fage,fail,fairwinds,faith,fam.pk,family,family.museum,familyds.com,familyds.net,familyds.org,fan,fans,fantasyleague.cc,far.br,farm,farm.museum,farmequipment.museum,farmers,farmers.museum,farmstead.museum,farsund.no,fashion,fast,fastly-terrarium.com,fastlylb.net,fastpanel.direct,fastvps-server.com,fauske.no,fbx-os.fr,fbxos.fr,fc.it,fe.it,fed.us,federation.aero,fedex,fedje.no,fedorainfracloud.org,fedorapeople.org,feedback,feira.br,fermo.it,ferrara.it,ferrari,ferrero,feste-ip.net,fet.no,fetsund.no,fg.it,fh.se,fhapp.xyz,fhs.no,fhsk.se,fhv.se,fi,fi.cr,fi.eu.org,fi.it,fiat,fidelity,fido,fie.ee,field.museum,figueres.museum,filatelia.museum,filegear-au.me,filegear-de.me,filegear-gb.me,filegear-ie.me,filegear-jp.me,filegear-sg.me,filegear.me,film,film.hu,film.museum,fin.ci,fin.ec,fin.tn,final,finance,financial,fineart.museum,finearts.museum,finland.museum,finnoy.no,finnøy.no,fire,firebaseapp.com,firenze.it,firestone,firewall-gateway.com,firewall-gateway.de,firewall-gateway.net,firm.co,firm.dk,firm.ht,firm.in,firm.nf,firm.ng,firm.ro,firm.ve,firmdale,fish,fishing,fit,fitjar.no,fitness,fj,fj.cn,fjaler.no,fjell.no,fk,fl.us,fla.no,flakstad.no,flanders.museum,flatanger.no,flekkefjord.no,flesberg.no,flickr,flight.aero,flights,flir,flog.br,flora.no,florence.it,florida.museum,floripa.br,florist,floro.no,florø.no,flowers,flt.cloud.muni.cz,fly,flynnhosting.net,flynnhub.com,flå.no,fm,fm.br,fm.it,fm.no,fnd.br,fo,foggia.it,folkebibl.no,folldal.no,foo,food,foodnetwork,football,for-better.biz,for-more.biz,for-our.info,for-some.biz,for-the.biz,for.men,for.mom,for.one,for.sale,force.museum,ford,forde.no,forex,forgot.her.name,forgot.his.name,forli-cesena.it,forlicesena.it,forlì-cesena.it,forlìcesena.it,forsale,forsand.no,fortal.br,fortmissoula.museum,fortworth.museum,forum,forum.hu,forumz.info,fosnes.no,fot.br,foundation,foundation.museum,fox,foz.br,fr,fr.eu.org,fr.it,frana.no,francaise.museum,frankfurt.museum,franziskaner.museum,fredrikstad.no,free,free.hr,freebox-os.com,freebox-os.fr,freeboxos.com,freeboxos.fr,freeddns.org,freeddns.us,freedesktop.org,freemasonry.museum,freesite.host,freetls.fastly.net,frei.no,freiburg.museum,freight.aero,fresenius,fribourg.museum,friuli-v-giulia.it,friuli-ve-giulia.it,friuli-vegiulia.it,friuli-venezia-giulia.it,friuli-veneziagiulia.it,friuli-vgiulia.it,friuliv-giulia.it,friulive-giulia.it,friulivegiulia.it,friulivenezia-giulia.it,friuliveneziagiulia.it,friulivgiulia.it,frl,frog.museum,frogans,frogn.no,froland.no,from-ak.com,from-al.com,from-ar.com,from-az.net,from-ca.com,from-co.net,from-ct.com,from-dc.com,from-de.com,from-fl.com,from-ga.com,from-hi.com,from-ia.com,from-id.com,from-il.com,from-in.com,from-ks.com,from-ky.com,from-la.net,from-ma.com,from-md.com,from-me.org,from-mi.com,from-mn.com,from-mo.com,from-ms.com,from-mt.com,from-nc.com,from-nd.com,from-ne.com,from-nh.com,from-nj.com,from-nm.com,from-nv.com,from-ny.net,from-oh.com,from-ok.com,from-or.com,from-pa.com,from-pr.com,from-ri.com,from-sc.com,from-sd.com,from-tn.com,from-tx.com,from-ut.com,from-va.com,from-vt.com,from-wa.com,from-wi.com,from-wv.com,from-wy.com,from.hr,frontdoor,frontier,frosinone.it,frosta.no,froya.no,fræna.no,frøya.no,fst.br,ftpaccess.cc,ftr,fuchu.hiroshima.jp,fuchu.tokyo.jp,fuchu.toyama.jp,fudai.iwate.jp,fuefuki.yamanashi.jp,fuel.aero,fuettertdasnetz.de,fuji.shizuoka.jp,fujieda.shizuoka.jp,fujiidera.osaka.jp,fujikawa.shizuoka.jp,fujikawa.yamanashi.jp,fujikawaguchiko.yamanashi.jp,fujimi.nagano.jp,fujimi.saitama.jp,fujimino.saitama.jp,fujinomiya.shizuoka.jp,fujioka.gunma.jp,fujisato.akita.jp,fujisawa.iwate.jp,fujisawa.kanagawa.jp,fujishiro.ibaraki.jp,fujitsu,fujixerox,fujiyoshida.yamanashi.jp,fukagawa.hokkaido.jp,fukaya.saitama.jp,fukuchi.fukuoka.jp,fukuchiyama.kyoto.jp,fukudomi.saga.jp,fukui.fukui.jp,fukui.jp,fukumitsu.toyama.jp,fukuoka.jp,fukuroi.shizuoka.jp,fukusaki.hyogo.jp,fukushima.fukushima.jp,fukushima.hokkaido.jp,fukushima.jp,fukuyama.hiroshima.jp,fun,funabashi.chiba.jp,funagata.yamagata.jp,funahashi.toyama.jp,fund,fundacio.museum,fuoisku.no,fuossko.no,furano.hokkaido.jp,furniture,furniture.museum,furubira.hokkaido.jp,furudono.fukushima.jp,furukawa.miyagi.jp,fusa.no,fuso.aichi.jp,fussa.tokyo.jp,futaba.fukushima.jp,futbol,futsu.nagasaki.jp,futtsu.chiba.jp,futurecms.at,futurehosting.at,futuremailing.at,fvg.it,fyi,fylkesbibl.no,fyresdal.no,førde.no,g.bg,g.se,g12.br,ga,ga.us,gaivuotna.no,gal,gallery,gallery.museum,gallo,gallup,galsa.no,gamagori.aichi.jp,game,game-host.org,game-server.cc,game.tw,games,games.hu,gamo.shiga.jp,gamvik.no,gangaviika.no,gangwon.kr,gap,garden,garden.museum,gateway.museum,gaular.no,gausdal.no,gay,gb,gb.com,gb.net,gbiz,gc.ca,gd,gd.cn,gda.pl,gdansk.pl,gdn,gdynia.pl,ge,ge.it,gea,geek.nz,geekgalaxy.com,geelvinck.museum,gehirn.ne.jp,geisei.kochi.jp,gemological.museum,gen.in,gen.mi.us,gen.ng,gen.nz,gen.tr,genkai.saga.jp,genoa.it,genova.it,gent,genting,geology.museum,geometre-expert.fr,george,georgia.museum,georgia.su,getmyip.com,gets-it.net,gf,gg,ggee,ggf.br,gh,gi,giehtavuoatna.no,giessen.museum,gift,gifts,gifu.gifu.jp,gifu.jp,giize.com,gildeskal.no,gildeskål.no,ginan.gifu.jp,ginowan.okinawa.jp,ginoza.okinawa.jp,giske.no,git-pages.rit.edu,git-repos.de,github.io,githubusercontent.com,gitlab.io,gives,giving,gjemnes.no,gjerdrum.no,gjerstad.no,gjesdal.no,gjovik.no,gjøvik.no,gl,glade,glas.museum,glass,glass.museum,gle,gleeze.com,gliding.aero,glitch.me,gliwice.pl,global,global.prod.fastly.net,global.ssl.fastly.net,globo,glogow.pl,gloppen.no,glug.org.uk,gm,gmail,gmbh,gmina.pl,gmo,gmx,gn,gniezno.pl,go-vip.co,go-vip.net,go.ci,go.cr,go.dyndns.org,go.gov.br,go.id,go.it,go.jp,go.ke,go.kr,go.leg.br,go.pw,go.th,go.tj,go.tz,go.ug,gob.ar,gob.bo,gob.cl,gob.do,gob.ec,gob.es,gob.gt,gob.hn,gob.mx,gob.ni,gob.pa,gob.pe,gob.pk,gob.sv,gob.ve,gobo.wakayama.jp,godaddy,godo.gifu.jp,goiania.br,goip.de,gojome.akita.jp,gok.pk,gokase.miyazaki.jp,gol.no,gold,goldpoint,golf,golffan.us,gon.pk,gonohe.aomori.jp,goo,goodyear,goog,google,googleapis.com,googlecode.com,gop,gop.pk,gorge.museum,gorizia.it,gorlice.pl,gos.pk,gose.nara.jp,gosen.niigata.jp,goshiki.hyogo.jp,got,gotdns.ch,gotdns.com,gotdns.org,gotemba.shizuoka.jp,goto.nagasaki.jp,gotpantheon.com,gotsu.shimane.jp,gouv.bj,gouv.ci,gouv.fr,gouv.ht,gouv.km,gouv.ml,gouv.sn,gov,gov.ac,gov.ae,gov.af,gov.al,gov.ar,gov.as,gov.au,gov.az,gov.ba,gov.bb,gov.bf,gov.bh,gov.bm,gov.bn,gov.br,gov.bs,gov.bt,gov.by,gov.bz,gov.cd,gov.cl,gov.cm,gov.cn,gov.co,gov.cu,gov.cx,gov.cy,gov.dm,gov.do,gov.dz,gov.ec,gov.ee,gov.eg,gov.et,gov.ge,gov.gh,gov.gi,gov.gn,gov.gr,gov.gu,gov.gy,gov.hk,gov.ie,gov.il,gov.in,gov.iq,gov.ir,gov.is,gov.it,gov.jo,gov.kg,gov.ki,gov.km,gov.kn,gov.kp,gov.kw,gov.ky,gov.kz,gov.la,gov.lb,gov.lc,gov.lk,gov.lr,gov.ls,gov.lt,gov.lv,gov.ly,gov.ma,gov.me,gov.mg,gov.mk,gov.ml,gov.mn,gov.mo,gov.mr,gov.ms,gov.mu,gov.mv,gov.mw,gov.my,gov.mz,gov.nc.tr,gov.ng,gov.nr,gov.om,gov.ph,gov.pk,gov.pl,gov.pn,gov.pr,gov.ps,gov.pt,gov.py,gov.qa,gov.rs,gov.ru,gov.rw,gov.sa,gov.sb,gov.sc,gov.sd,gov.sg,gov.sh,gov.sl,gov.st,gov.sx,gov.sy,gov.tj,gov.tl,gov.tm,gov.tn,gov.to,gov.tr,gov.tt,gov.tw,gov.ua,gov.uk,gov.vc,gov.ve,gov.vn,gov.ws,gov.za,gov.zm,gov.zw,government.aero,govt.nz,gp,gq,gr,gr.com,gr.eu.org,gr.it,gr.jp,grainger,grajewo.pl,gran.no,grandrapids.museum,grane.no,granvin.no,graphics,gratangen.no,gratis,graz.museum,green,greta.fr,grimstad.no,gripe,griw.gov.pl,grocery,groks-the.info,groks-this.info,grondar.za,grong.no,grosseto.it,groundhandling.aero,group,group.aero,grozny.ru,grozny.su,grp.lk,gru.br,grue.no,gs,gs.aa.no,gs.ah.no,gs.bu.no,gs.cn,gs.fm.no,gs.hl.no,gs.hm.no,gs.jan-mayen.no,gs.mr.no,gs.nl.no,gs.nt.no,gs.of.no,gs.ol.no,gs.oslo.no,gs.rl.no,gs.sf.no,gs.st.no,gs.svalbard.no,gs.tm.no,gs.tr.no,gs.va.no,gs.vf.no,gsm.pl,gt,gu,gu.us,guam.gu,guardian,gub.uy,gucci,guernsey.museum,guge,guide,guitars,gujo.gifu.jp,gulen.no,gunma.jp,guovdageaidnu.no,guru,gushikami.okinawa.jp,gv.ao,gv.at,gv.vc,gw,gwangju.kr,gwiddle.co.uk,gx.cn,gy,gyeongbuk.kr,gyeonggi.kr,gyeongnam.kr,gyokuto.kumamoto.jp,gz.cn,gáivuotna.no,gálsá.no,gáŋgaviika.no,h.bg,h.se,ha.cn,ha.no,habikino.osaka.jp,habmer.no,haboro.hokkaido.jp,hachijo.tokyo.jp,hachinohe.aomori.jp,hachioji.tokyo.jp,hachirogata.akita.jp,hadano.kanagawa.jp,hadsel.no,haebaru.okinawa.jp,haga.tochigi.jp,hagebostad.no,hagi.yamaguchi.jp,haibara.shizuoka.jp,hair,hakata.fukuoka.jp,hakodate.hokkaido.jp,hakone.kanagawa.jp,hakuba.nagano.jp,hakui.ishikawa.jp,hakusan.ishikawa.jp,halden.no,half.host,halloffame.museum,halsa.no,ham-radio-op.net,hamada.shimane.jp,hamamatsu.shizuoka.jp,hamar.no,hamaroy.no,hamatama.saga.jp,hamatonbetsu.hokkaido.jp,hamburg,hamburg.museum,hammarfeasta.no,hammerfest.no,hamura.tokyo.jp,hanamaki.iwate.jp,hanamigawa.chiba.jp,hanawa.fukushima.jp,handa.aichi.jp,handson.museum,hanggliding.aero,hangout,hannan.osaka.jp,hanno.saitama.jp,hanyu.saitama.jp,hapmir.no,happou.akita.jp,hara.nagano.jp,haram.no,hareid.no,harima.hyogo.jp,harstad.no,harvestcelebration.museum,hasama.oita.jp,hasami.nagasaki.jp,hashbang.sh,hashikami.aomori.jp,hashima.gifu.jp,hashimoto.wakayama.jp,hasuda.saitama.jp,hasura-app.io,hasura.app,hasvik.no,hatogaya.saitama.jp,hatoyama.saitama.jp,hatsukaichi.hiroshima.jp,hattfjelldal.no,haugesund.no,haus,hawaii.museum,hayakawa.yamanashi.jp,hayashima.okayama.jp,hazu.aichi.jp,hb.cldmail.ru,hb.cn,hbo,hdfc,hdfcbank,he.cn,health,health-carereform.com,health.museum,health.nz,health.vn,healthcare,heguri.nara.jp,heimatunduhren.museum,hekinan.aichi.jp,hellas.museum,help,helsinki,helsinki.museum,hembygdsforbund.museum,hemne.no,hemnes.no,hemsedal.no,hepforge.org,herad.no,here,here-for-more.info,heritage.museum,hermes,herokuapp.com,herokussl.com,heroy.more-og-romsdal.no,heroy.nordland.no,herøy.møre-og-romsdal.no,herøy.nordland.no,hgtv,hi.cn,hi.us,hicam.net,hichiso.gifu.jp,hida.gifu.jp,hidaka.hokkaido.jp,hidaka.kochi.jp,hidaka.saitama.jp,hidaka.wakayama.jp,higashi.fukuoka.jp,higashi.fukushima.jp,higashi.okinawa.jp,higashiagatsuma.gunma.jp,higashichichibu.saitama.jp,higashihiroshima.hiroshima.jp,higashiizu.shizuoka.jp,higashiizumo.shimane.jp,higashikagawa.kagawa.jp,higashikagura.hokkaido.jp,higashikawa.hokkaido.jp,higashikurume.tokyo.jp,higashimatsushima.miyagi.jp,higashimatsuyama.saitama.jp,higashimurayama.tokyo.jp,higashinaruse.akita.jp,higashine.yamagata.jp,higashiomi.shiga.jp,higashiosaka.osaka.jp,higashishirakawa.gifu.jp,higashisumiyoshi.osaka.jp,higashitsuno.kochi.jp,higashiura.aichi.jp,higashiyama.kyoto.jp,higashiyamato.tokyo.jp,higashiyodogawa.osaka.jp,higashiyoshino.nara.jp,hiji.oita.jp,hikari.yamaguchi.jp,hikawa.shimane.jp,hikimi.shimane.jp,hikone.shiga.jp,himeji.hyogo.jp,himeshima.oita.jp,himi.toyama.jp,hino.tokyo.jp,hino.tottori.jp,hinode.tokyo.jp,hinohara.tokyo.jp,hioki.kagoshima.jp,hiphop,hirado.nagasaki.jp,hiraizumi.iwate.jp,hirakata.osaka.jp,hiranai.aomori.jp,hirara.okinawa.jp,hirata.fukushima.jp,hiratsuka.kanagawa.jp,hiraya.nagano.jp,hirogawa.wakayama.jp,hirokawa.fukuoka.jp,hirono.fukushima.jp,hirono.iwate.jp,hiroo.hokkaido.jp,hirosaki.aomori.jp,hiroshima.jp,hisamitsu,hisayama.fukuoka.jp,histoire.museum,historical.museum,historicalsociety.museum,historichouses.museum,historisch.museum,historisches.museum,history.museum,historyofscience.museum,hita.oita.jp,hitachi,hitachi.ibaraki.jp,hitachinaka.ibaraki.jp,hitachiomiya.ibaraki.jp,hitachiota.ibaraki.jp,hitra.no,hiv,hizen.saga.jp,hjartdal.no,hjelmeland.no,hk,hk.cn,hk.com,hk.org,hkt,hl.cn,hl.no,hm,hm.no,hn,hn.cn,hobby-site.com,hobby-site.org,hobol.no,hobøl.no,hockey,hof.no,hofu.yamaguchi.jp,hokkaido.jp,hokksund.no,hokuryu.hokkaido.jp,hokuto.hokkaido.jp,hokuto.yamanashi.jp,hol.no,holdings,hole.no,holiday,holmestrand.no,holtalen.no,holtålen.no,home-webserver.de,home.dyndns.org,homebuilt.aero,homedepot,homedns.org,homeftp.net,homeftp.org,homegoods,homeip.net,homelink.one,homelinux.com,homelinux.net,homelinux.org,homeoffice.gov.uk,homes,homesecuritymac.com,homesecuritypc.com,homesense,homeunix.com,homeunix.net,homeunix.org,honai.ehime.jp,honbetsu.hokkaido.jp,honda,honefoss.no,honeywell,hongo.hiroshima.jp,honjo.akita.jp,honjo.saitama.jp,honjyo.akita.jp,hopto.me,hopto.org,hornindal.no,horokanai.hokkaido.jp,horology.museum,horonobe.hokkaido.jp,horse,horten.no,hospital,host,hosting,hosting-cluster.nl,hosting.myjino.ru,hot,hotel.hu,hotel.lk,hotel.tz,hoteles,hotels,hotmail,house,house.museum,how,hoyanger.no,hoylandet.no,hr,hr.eu.org,hs.kr,hs.run,hs.zone,hsbc,ht,hu,hu.com,hu.eu.org,hu.net,hughes,huissier-justice.fr,humanities.museum,hurdal.no,hurum.no,hvaler.no,hyatt,hyllestad.no,hyogo.jp,hyuga.miyazaki.jp,hyundai,hzc.io,hábmer.no,hámmárfeasta.no,hápmir.no,häkkinen.fi,hå.no,hægebostad.no,hønefoss.no,høyanger.no,høylandet.no,i.bg,i.ng,i.ph,i.se,i234.me,ia.us,iamallama.com,ibara.okayama.jp,ibaraki.ibaraki.jp,ibaraki.jp,ibaraki.osaka.jp,ibestad.no,ibigawa.gifu.jp,ibm,ic.gov.pl,icbc,ice,ichiba.tokushima.jp,ichihara.chiba.jp,ichikai.tochigi.jp,ichikawa.chiba.jp,ichikawa.hyogo.jp,ichikawamisato.yamanashi.jp,ichinohe.iwate.jp,ichinomiya.aichi.jp,ichinomiya.chiba.jp,ichinoseki.iwate.jp,icu,id,id.au,id.ir,id.lv,id.ly,id.us,ide.kyoto.jp,idf.il,idrett.no,idv.hk,idv.tw,ie,ie.eu.org,ieee,if.ua,ifm,iglesias-carbonia.it,iglesiascarbonia.it,iheya.okinawa.jp,iida.nagano.jp,iide.yamagata.jp,iijima.nagano.jp,iitate.fukushima.jp,iiyama.nagano.jp,iizuka.fukuoka.jp,iizuna.nagano.jp,ikano,ikaruga.nara.jp,ikata.ehime.jp,ikawa.akita.jp,ikeda.fukui.jp,ikeda.gifu.jp,ikeda.hokkaido.jp,ikeda.nagano.jp,ikeda.osaka.jp,iki.fi,iki.nagasaki.jp,ikoma.nara.jp,ikusaka.nagano.jp,il,il.eu.org,il.us,ilawa.pl,illustration.museum,ilovecollege.info,im,im.it,imabari.ehime.jp,imageandsound.museum,imakane.hokkaido.jp,imamat,imari.saga.jp,imb.br,imdb,imizu.toyama.jp,immo,immobilien,imperia.it,in,in-addr.arpa,in-berlin.de,in-brb.de,in-butter.de,in-dsl.de,in-dsl.net,in-dsl.org,in-the-band.net,in-vpn.de,in-vpn.net,in-vpn.org,in.eu.org,in.futurecms.at,in.london,in.na,in.net,in.ni,in.rs,in.th,in.ua,in.us,ina.ibaraki.jp,ina.nagano.jp,ina.saitama.jp,inabe.mie.jp,inagawa.hyogo.jp,inagi.tokyo.jp,inami.toyama.jp,inami.wakayama.jp,inashiki.ibaraki.jp,inatsuki.fukuoka.jp,inawashiro.fukushima.jp,inazawa.aichi.jp,inc,inc.hk,incheon.kr,ind.br,ind.gt,ind.in,ind.kw,ind.tn,inderoy.no,inderøy.no,indian.museum,indiana.museum,indianapolis.museum,indianmarket.museum,indigena.bo,industria.bo,industries,ine.kyoto.jp,inf.br,inf.cu,inf.mk,inf.ua,infiniti,info,info.at,info.au,info.az,info.bb,info.bo,info.co,info.cx,info.ec,info.et,info.gu,info.ht,info.hu,info.ke,info.ki,info.la,info.ls,info.mv,info.na,info.nf,info.ni,info.nr,info.pk,info.pl,info.pr,info.ro,info.sd,info.tn,info.tr,info.tt,info.tz,info.ve,info.vn,info.zm,ing,ing.pa,ingatlan.hu,ink,ino.kochi.jp,instantcloud.cn,institute,insurance,insurance.aero,insure,int,int.ar,int.az,int.bo,int.ci,int.co,int.eu.org,int.is,int.la,int.lk,int.mv,int.mw,int.ni,int.pt,int.ru,int.tj,int.tt,int.ve,int.vn,intel,intelligence.museum,interactive.museum,international,internet-dns.de,intl.tn,intuit,inuyama.aichi.jp,investments,inzai.chiba.jp,io,iobb.net,ip6.arpa,ipifony.net,ipiranga,iq,ir,iraq.museum,iris.arpa,irish,iron.museum,iruma.saitama.jp,is,is-a-anarchist.com,is-a-blogger.com,is-a-bookkeeper.com,is-a-bruinsfan.org,is-a-bulls-fan.com,is-a-candidate.org,is-a-caterer.com,is-a-celticsfan.org,is-a-chef.com,is-a-chef.net,is-a-chef.org,is-a-conservative.com,is-a-cpa.com,is-a-cubicle-slave.com,is-a-democrat.com,is-a-designer.com,is-a-doctor.com,is-a-financialadvisor.com,is-a-geek.com,is-a-geek.net,is-a-geek.org,is-a-green.com,is-a-guru.com,is-a-hard-worker.com,is-a-hunter.com,is-a-knight.org,is-a-landscaper.com,is-a-lawyer.com,is-a-liberal.com,is-a-libertarian.com,is-a-linux-user.org,is-a-llama.com,is-a-musician.com,is-a-nascarfan.com,is-a-nurse.com,is-a-painter.com,is-a-patsfan.org,is-a-personaltrainer.com,is-a-photographer.com,is-a-player.com,is-a-republican.com,is-a-rockstar.com,is-a-socialist.com,is-a-soxfan.org,is-a-student.com,is-a-teacher.com,is-a-techie.com,is-a-therapist.com,is-an-accountant.com,is-an-actor.com,is-an-actress.com,is-an-anarchist.com,is-an-artist.com,is-an-engineer.com,is-an-entertainer.com,is-by.us,is-certified.com,is-found.org,is-gone.com,is-into-anime.com,is-into-cars.com,is-into-cartoons.com,is-into-games.com,is-leet.com,is-lost.org,is-not-certified.com,is-saved.org,is-slick.com,is-uberleet.com,is-very-bad.org,is-very-evil.org,is-very-good.org,is-very-nice.org,is-very-sweet.org,is-with-theband.com,is.eu.org,is.gov.pl,is.it,isa-geek.com,isa-geek.net,isa-geek.org,isa-hockeynut.com,isa.kagoshima.jp,isa.us,isahaya.nagasaki.jp,ise.mie.jp,isehara.kanagawa.jp,iselect,isen.kagoshima.jp,isernia.it,iserv.dev,isesaki.gunma.jp,ishigaki.okinawa.jp,ishikari.hokkaido.jp,ishikawa.fukushima.jp,ishikawa.jp,ishikawa.okinawa.jp,ishinomaki.miyagi.jp,isla.pr,isleofman.museum,ismaili,isshiki.aichi.jp,issmarterthanyou.com,ist,istanbul,isteingeek.de,istmein.de,isumi.chiba.jp,it,it.ao,it.eu.org,itabashi.tokyo.jp,itako.ibaraki.jp,itakura.gunma.jp,itami.hyogo.jp,itano.tokushima.jp,itau,itayanagi.aomori.jp,ito.shizuoka.jp,itoigawa.niigata.jp,itoman.okinawa.jp,its.me,itv,ivano-frankivsk.ua,ivanovo.su,iveco,iveland.no,ivgu.no,iwade.wakayama.jp,iwafune.tochigi.jp,iwaizumi.iwate.jp,iwaki.fukushima.jp,iwakuni.yamaguchi.jp,iwakura.aichi.jp,iwama.ibaraki.jp,iwamizawa.hokkaido.jp,iwanai.hokkaido.jp,iwanuma.miyagi.jp,iwata.shizuoka.jp,iwate.iwate.jp,iwate.jp,iwatsuki.saitama.jp,iwi.nz,iyo.ehime.jp,iz.hr,izena.okinawa.jp,izu.shizuoka.jp,izumi.kagoshima.jp,izumi.osaka.jp,izumiotsu.osaka.jp,izumisano.osaka.jp,izumizaki.fukushima.jp,izumo.shimane.jp,izumozaki.niigata.jp,izunokuni.shizuoka.jp,j.bg,jab.br,jaguar,jambyl.su,jamison.museum,jampa.br,jan-mayen.no,java,jaworzno.pl,jcb,jcp,jdevcloud.com,jdf.br,je,jeep,jefferson.museum,jeju.kr,jelenia-gora.pl,jeonbuk.kr,jeonnam.kr,jerusalem.museum,jessheim.no,jetzt,jevnaker.no,jewelry,jewelry.museum,jewish.museum,jewishart.museum,jfk.museum,jgora.pl,jinsekikogen.hiroshima.jp,jio,jl.cn,jll,jm,jmp,jnj,jo,joboji.iwate.jp,jobs,jobs.tt,joburg,joetsu.niigata.jp,jogasz.hu,johana.toyama.jp,joinville.br,jolster.no,jondal.no,jor.br,jorpeland.no,joso.ibaraki.jp,jot,journal.aero,journalism.museum,journalist.aero,joy,joyo.kyoto.jp,jp,jp.eu.org,jp.net,jpmorgan,jpn.com,jprs,js.cn,js.org,judaica.museum,judygarland.museum,juedisches.museum,juegos,juif.museum,juniper,jur.pro,jus.br,jx.cn,jølster.no,jørpeland.no,k.bg,k.se,k12.ak.us,k12.al.us,k12.ar.us,k12.as.us,k12.az.us,k12.ca.us,k12.co.us,k12.ct.us,k12.dc.us,k12.de.us,k12.ec,k12.fl.us,k12.ga.us,k12.gu.us,k12.ia.us,k12.id.us,k12.il,k12.il.us,k12.in.us,k12.ks.us,k12.ky.us,k12.la.us,k12.ma.us,k12.md.us,k12.me.us,k12.mi.us,k12.mn.us,k12.mo.us,k12.ms.us,k12.mt.us,k12.nc.us,k12.ne.us,k12.nh.us,k12.nj.us,k12.nm.us,k12.nv.us,k12.ny.us,k12.oh.us,k12.ok.us,k12.or.us,k12.pa.us,k12.pr.us,k12.ri.us,k12.sc.us,k12.tn.us,k12.tr,k12.tx.us,k12.ut.us,k12.va.us,k12.vi,k12.vi.us,k12.vt.us,k12.wa.us,k12.wi.us,k12.wy.us,kaas.gg,kadena.okinawa.jp,kadogawa.miyazaki.jp,kadoma.osaka.jp,kafjord.no,kaga.ishikawa.jp,kagami.kochi.jp,kagamiishi.fukushima.jp,kagamino.okayama.jp,kagawa.jp,kagoshima.jp,kagoshima.kagoshima.jp,kaho.fukuoka.jp,kahoku.ishikawa.jp,kahoku.yamagata.jp,kai.yamanashi.jp,kainan.tokushima.jp,kainan.wakayama.jp,kaisei.kanagawa.jp,kaita.hiroshima.jp,kaizuka.osaka.jp,kakamigahara.gifu.jp,kakegawa.shizuoka.jp,kakinoki.shimane.jp,kakogawa.hyogo.jp,kakuda.miyagi.jp,kalisz.pl,kalmykia.ru,kalmykia.su,kaluga.su,kamagaya.chiba.jp,kamaishi.iwate.jp,kamakura.kanagawa.jp,kameoka.kyoto.jp,kameyama.mie.jp,kami.kochi.jp,kami.miyagi.jp,kamiamakusa.kumamoto.jp,kamifurano.hokkaido.jp,kamigori.hyogo.jp,kamiichi.toyama.jp,kamiizumi.saitama.jp,kamijima.ehime.jp,kamikawa.hokkaido.jp,kamikawa.hyogo.jp,kamikawa.saitama.jp,kamikitayama.nara.jp,kamikoani.akita.jp,kamimine.saga.jp,kaminokawa.tochigi.jp,kaminoyama.yamagata.jp,kamioka.akita.jp,kamisato.saitama.jp,kamishihoro.hokkaido.jp,kamisu.ibaraki.jp,kamisunagawa.hokkaido.jp,kamitonda.wakayama.jp,kamitsue.oita.jp,kamo.kyoto.jp,kamo.niigata.jp,kamoenai.hokkaido.jp,kamogawa.chiba.jp,kanagawa.jp,kanan.osaka.jp,kanazawa.ishikawa.jp,kanegasaki.iwate.jp,kaneyama.fukushima.jp,kaneyama.yamagata.jp,kani.gifu.jp,kanie.aichi.jp,kanmaki.nara.jp,kanna.gunma.jp,kannami.shizuoka.jp,kanonji.kagawa.jp,kanoya.kagoshima.jp,kanra.gunma.jp,kanuma.tochigi.jp,kanzaki.saga.jp,karacol.su,karaganda.su,karasjohka.no,karasjok.no,karasuyama.tochigi.jp,karate.museum,karatsu.saga.jp,karelia.su,karikatur.museum,kariwa.niigata.jp,kariya.aichi.jp,karlsoy.no,karmoy.no,karmøy.no,karpacz.pl,kartuzy.pl,karuizawa.nagano.jp,karumai.iwate.jp,kasahara.gifu.jp,kasai.hyogo.jp,kasama.ibaraki.jp,kasamatsu.gifu.jp,kasaoka.okayama.jp,kashiba.nara.jp,kashihara.nara.jp,kashima.ibaraki.jp,kashima.saga.jp,kashiwa.chiba.jp,kashiwara.osaka.jp,kashiwazaki.niigata.jp,kasuga.fukuoka.jp,kasuga.hyogo.jp,kasugai.aichi.jp,kasukabe.saitama.jp,kasumigaura.ibaraki.jp,kasuya.fukuoka.jp,kaszuby.pl,katagami.akita.jp,katano.osaka.jp,katashina.gunma.jp,katori.chiba.jp,katowice.pl,katsuragi.nara.jp,katsuragi.wakayama.jp,katsushika.tokyo.jp,katsuura.chiba.jp,katsuyama.fukui.jp,kaufen,kautokeino.no,kawaba.gunma.jp,kawachinagano.osaka.jp,kawagoe.mie.jp,kawagoe.saitama.jp,kawaguchi.saitama.jp,kawahara.tottori.jp,kawai.iwate.jp,kawai.nara.jp,kawajima.saitama.jp,kawakami.nagano.jp,kawakami.nara.jp,kawakita.ishikawa.jp,kawamata.fukushima.jp,kawaminami.miyazaki.jp,kawanabe.kagoshima.jp,kawanehon.shizuoka.jp,kawanishi.hyogo.jp,kawanishi.nara.jp,kawanishi.yamagata.jp,kawara.fukuoka.jp,kawasaki.jp,kawasaki.miyagi.jp,kawatana.nagasaki.jp,kawaue.gifu.jp,kawazu.shizuoka.jp,kayabe.hokkaido.jp,kazimierz-dolny.pl,kazo.saitama.jp,kazuno.akita.jp,kddi,ke,keisen.fukuoka.jp,kembuchi.hokkaido.jp,kep.tr,kepno.pl,kerryhotels,kerrylogistics,kerryproperties,ketrzyn.pl,keymachine.de,kfh,kg,kg.kr,kh,kh.ua,khakassia.su,kharkiv.ua,kharkov.ua,kherson.ua,khmelnitskiy.ua,khmelnytskyi.ua,khplay.nl,ki,kia,kibichuo.okayama.jp,kicks-ass.net,kicks-ass.org,kids.museum,kids.us,kiev.ua,kiho.mie.jp,kihoku.ehime.jp,kijo.miyazaki.jp,kikonai.hokkaido.jp,kikuchi.kumamoto.jp,kikugawa.shizuoka.jp,kim,kimino.wakayama.jp,kimitsu.chiba.jp,kimobetsu.hokkaido.jp,kin.okinawa.jp,kinder,kindle,kinghost.net,kinko.kagoshima.jp,kinokawa.wakayama.jp,kira.aichi.jp,kirkenes.no,kirovograd.ua,kiryu.gunma.jp,kisarazu.chiba.jp,kishiwada.osaka.jp,kiso.nagano.jp,kisofukushima.nagano.jp,kisosaki.mie.jp,kita.kyoto.jp,kita.osaka.jp,kita.tokyo.jp,kitaaiki.nagano.jp,kitaakita.akita.jp,kitadaito.okinawa.jp,kitagata.gifu.jp,kitagata.saga.jp,kitagawa.kochi.jp,kitagawa.miyazaki.jp,kitahata.saga.jp,kitahiroshima.hokkaido.jp,kitakami.iwate.jp,kitakata.fukushima.jp,kitakata.miyazaki.jp,kitakyushu.jp,kitami.hokkaido.jp,kitamoto.saitama.jp,kitanakagusuku.okinawa.jp,kitashiobara.fukushima.jp,kitaura.miyazaki.jp,kitayama.wakayama.jp,kitchen,kiwa.mie.jp,kiwi,kiwi.nz,kiyama.saga.jp,kiyokawa.kanagawa.jp,kiyosato.hokkaido.jp,kiyose.tokyo.jp,kiyosu.aichi.jp,kizu.kyoto.jp,klabu.no,klepp.no,klodzko.pl,klæbu.no,km,km.ua,kmpsp.gov.pl,kn,knightpoint.systems,knowsitall.info,knx-server.net,kobayashi.miyazaki.jp,kobe.jp,kobierzyce.pl,kochi.jp,kochi.kochi.jp,kodaira.tokyo.jp,koebenhavn.museum,koeln,koeln.museum,kofu.yamanashi.jp,koga.fukuoka.jp,koga.ibaraki.jp,koganei.tokyo.jp,koge.tottori.jp,koka.shiga.jp,kokonoe.oita.jp,kokubunji.tokyo.jp,kolobrzeg.pl,komae.tokyo.jp,komagane.nagano.jp,komaki.aichi.jp,komatsu,komatsu.ishikawa.jp,komatsushima.tokushima.jp,komforb.se,kommunalforbund.se,kommune.no,komono.mie.jp,komoro.nagano.jp,komvux.se,konan.aichi.jp,konan.shiga.jp,kongsberg.no,kongsvinger.no,konin.pl,konskowola.pl,konsulat.gov.pl,konyvelo.hu,koori.fukushima.jp,kopervik.no,koriyama.fukushima.jp,koryo.nara.jp,kosai.shizuoka.jp,kosaka.akita.jp,kosei.shiga.jp,kosher,koshigaya.saitama.jp,koshimizu.hokkaido.jp,koshu.yamanashi.jp,kosuge.yamanashi.jp,kota.aichi.jp,koto.shiga.jp,koto.tokyo.jp,kotohira.kagawa.jp,kotoura.tottori.jp,kouhoku.saga.jp,kounosu.saitama.jp,kouyama.kagoshima.jp,kouzushima.tokyo.jp,koya.wakayama.jp,koza.wakayama.jp,kozagawa.wakayama.jp,kozaki.chiba.jp,kozow.com,kp,kpmg,kpn,kppsp.gov.pl,kr,kr.com,kr.eu.org,kr.it,kr.ua,kraanghke.no,kragero.no,kragerø.no,krakow.pl,krasnik.pl,krasnodar.su,krd,kred,kristiansand.no,kristiansund.no,krodsherad.no,krokstadelva.no,krym.ua,kråanghke.no,krødsherad.no,ks.ua,ks.us,kuchinotsu.nagasaki.jp,kudamatsu.yamaguchi.jp,kudoyama.wakayama.jp,kui.hiroshima.jp,kuji.iwate.jp,kuju.oita.jp,kujukuri.chiba.jp,kuki.saitama.jp,kumagaya.saitama.jp,kumakogen.ehime.jp,kumamoto.jp,kumamoto.kumamoto.jp,kumano.hiroshima.jp,kumano.mie.jp,kumatori.osaka.jp,kumejima.okinawa.jp,kumenan.okayama.jp,kumiyama.kyoto.jp,kunden.ortsinfo.at,kunigami.okinawa.jp,kunimi.fukushima.jp,kunisaki.oita.jp,kunitachi.tokyo.jp,kunitomi.miyazaki.jp,kunneppu.hokkaido.jp,kunohe.iwate.jp,kunst.museum,kunstsammlung.museum,kunstunddesign.museum,kuokgroup,kurashiki.okayama.jp,kurate.fukuoka.jp,kure.hiroshima.jp,kurgan.su,kuriyama.hokkaido.jp,kurobe.toyama.jp,kurogi.fukuoka.jp,kuroishi.aomori.jp,kuroiso.tochigi.jp,kuromatsunai.hokkaido.jp,kurotaki.nara.jp,kurume.fukuoka.jp,kusatsu.gunma.jp,kusatsu.shiga.jp,kushima.miyazaki.jp,kushimoto.wakayama.jp,kushiro.hokkaido.jp,kustanai.ru,kustanai.su,kusu.oita.jp,kutchan.hokkaido.jp,kutno.pl,kuwana.mie.jp,kuzumaki.iwate.jp,kv.ua,kvafjord.no,kvalsund.no,kvam.no,kvanangen.no,kvinesdal.no,kvinnherad.no,kviteseid.no,kvitsoy.no,kvitsøy.no,kvæfjord.no,kvænangen.no,kw,kwp.gov.pl,kwpsp.gov.pl,ky,ky.us,kyiv.ua,kyonan.chiba.jp,kyotamba.kyoto.jp,kyotanabe.kyoto.jp,kyotango.kyoto.jp,kyoto,kyoto.jp,kyowa.akita.jp,kyowa.hokkaido.jp,kyuragi.saga.jp,kz,kárášjohka.no,kåfjord.no,l-o-g-i-n.de,l.bg,l.se,la,la-spezia.it,la.us,laakesvuemie.no,lab.ms,labor.museum,labour.museum,lacaixa,ladbrokes,lahppi.no,lajolla.museum,lakas.hu,lamborghini,lamer,lanbib.se,lancashire.museum,lancaster,lancia,lancome,land,land-4-sale.us,landes.museum,landing.myjino.ru,landrover,langevag.no,langevåg.no,lans.museum,lanxess,lapy.pl,laquila.it,lardal.no,larsson.museum,larvik.no,lasalle,laspezia.it,lat,latina.it,latino,latrobe,lavagis.no,lavangen.no,law,law.pro,law.za,lawyer,laz.it,lazio.it,lb,lc,lc.it,lcl.dev,lcube-server.de,lds,le.it,leadpages.co,leangaviika.no,lease,leasing.aero,leaŋgaviika.no,lebesby.no,lebork.pl,lebtimnetz.de,lecce.it,lecco.it,leclerc,leczna.pl,lefrak,leg.br,legal,legnica.pl,lego,leikanger.no,leirfjord.no,leirvik.no,leitungsen.de,leka.no,leksvik.no,lel.br,lelux.site,lenug.su,lenvik.no,lerdal.no,lesja.no,levanger.no,lewismiller.museum,lexus,lezajsk.pl,lg.jp,lg.ua,lgbt,li,li.it,liaison,lib.ak.us,lib.al.us,lib.ar.us,lib.as.us,lib.az.us,lib.ca.us,lib.co.us,lib.ct.us,lib.dc.us,lib.de.us,lib.ee,lib.fl.us,lib.ga.us,lib.gu.us,lib.hi.us,lib.ia.us,lib.id.us,lib.il.us,lib.in.us,lib.ks.us,lib.ky.us,lib.la.us,lib.ma.us,lib.md.us,lib.me.us,lib.mi.us,lib.mn.us,lib.mo.us,lib.ms.us,lib.mt.us,lib.nc.us,lib.nd.us,lib.ne.us,lib.nh.us,lib.nj.us,lib.nm.us,lib.nv.us,lib.ny.us,lib.oh.us,lib.ok.us,lib.or.us,lib.pa.us,lib.pr.us,lib.ri.us,lib.sc.us,lib.sd.us,lib.tn.us,lib.tx.us,lib.ut.us,lib.va.us,lib.vi.us,lib.vt.us,lib.wa.us,lib.wi.us,lib.wy.us,lidl,lier.no,lierne.no,life,lifeinsurance,lifestyle,lig.it,lighting,liguria.it,like,likes-pie.com,likescandy.com,lillehammer.no,lillesand.no,lilly,lima-city.at,lima-city.ch,lima-city.de,lima-city.rocks,lima.zone,limanowa.pl,limited,limo,lincoln,lincoln.museum,lindas.no,linde,lindesnes.no,lindås.no,link,linkitools.space,linkyard-cloud.ch,linkyard.cloud,linz.museum,lipsy,live,living,living.museum,livinghistory.museum,livorno.it,lixil,lk,llc,ln.cn,lo.it,loabat.no,loabát.no,loan,loans,localhistory.museum,localhost.daplie.me,locker,locus,lodi.it,lodingen.no,loft,loginline.app,loginline.dev,loginline.io,loginline.services,loginline.site,loginto.me,logistics.aero,logoip.com,logoip.de,lol,lom.it,lom.no,lombardia.it,lombardy.it,lomza.pl,london,london.cloudapps.digital,london.museum,londrina.br,loppa.no,lorenskog.no,losangeles.museum,loseyourip.com,loten.no,lotte,lotto,louvre.museum,love,lowicz.pl,loyalist.museum,lpages.co,lpl,lplfinancial,lpusercontent.com,lr,ls,lt,lt.eu.org,lt.it,lt.ua,ltd,ltd.co.im,ltd.cy,ltd.gi,ltd.hk,ltd.lk,ltd.ng,ltd.ua,ltd.uk,ltda,lu,lu.eu.org,lu.it,lubartow.pl,lubin.pl,lublin.pl,lucania.it,lucca.it,lucerne.museum,lug.org.uk,lugansk.ua,lugs.org.uk,lukow.pl,lund.no,lundbeck,lunner.no,lupin,luroy.no,lurøy.no,luster.no,lutsk.ua,luxe,luxembourg.museum,luxury,luzern.museum,lv,lv.eu.org,lv.ua,lviv.ua,ly,lyngdal.no,lyngen.no,láhppi.no,läns.museum,lærdal.no,lødingen.no,lørenskog.no,løten.no,m.bg,m.se,ma,ma.gov.br,ma.leg.br,ma.us,macapa.br,maceio.br,macerata.it,machida.tokyo.jp,macys,mad.museum,madrid,madrid.museum,maebashi.gunma.jp,magazine.aero,magentosite.cloud,maibara.shiga.jp,maif,mail.pl,maintenance.aero,maison,maizuru.kyoto.jp,makeup,makinohara.shizuoka.jp,makurazaki.kagoshima.jp,malatvuopmi.no,malbork.pl,mallorca.museum,malopolska.pl,malselv.no,malvik.no,mamurogawa.yamagata.jp,man,management,manaus.br,manchester.museum,mandal.no,mango,mangyshlak.su,maniwa.okayama.jp,manno.kagawa.jp,mansion.museum,mansions.museum,mantova.it,manx.museum,maori.nz,map,map.fastly.net,map.fastlylb.net,mar.it,marburg.museum,marche.it,marine.ru,maringa.br,maritime.museum,maritimo.museum,marker.no,market,marketing,markets,marnardal.no,marriott,marshalls,marugame.kagawa.jp,marumori.miyagi.jp,maryland.museum,marylhurst.museum,masaki.ehime.jp,maserati,masfjorden.no,mashike.hokkaido.jp,mashiki.kumamoto.jp,mashiko.tochigi.jp,masoy.no,massa-carrara.it,massacarrara.it,masuda.shimane.jp,mat.br,matera.it,matsubara.osaka.jp,matsubushi.saitama.jp,matsuda.kanagawa.jp,matsudo.chiba.jp,matsue.shimane.jp,matsukawa.nagano.jp,matsumae.hokkaido.jp,matsumoto.kagoshima.jp,matsumoto.nagano.jp,matsuno.ehime.jp,matsusaka.mie.jp,matsushige.tokushima.jp,matsushima.miyagi.jp,matsuura.nagasaki.jp,matsuyama.ehime.jp,matsuzaki.shizuoka.jp,matta-varjjat.no,mattel,mayfirst.info,mayfirst.org,mazowsze.pl,mazury.pl,mb.ca,mb.it,mba,mc,mc.eu.org,mc.it,mckinsey,md,md.ci,md.us,me,me.eu.org,me.it,me.ke,me.tz,me.uk,me.us,med,med.br,med.ec,med.ee,med.ht,med.ly,med.om,med.pa,med.pl,med.pro,med.sa,med.sd,medecin.fr,medecin.km,media,media.aero,media.hu,media.museum,media.pl,medical.museum,medicina.bo,medio-campidano.it,mediocampidano.it,medizinhistorisches.museum,meeres.museum,meet,meguro.tokyo.jp,mein-iserv.de,mein-vigor.de,meiwa.gunma.jp,meiwa.mie.jp,meland.no,melbourne,meldal.no,melhus.no,meloy.no,meløy.no,members.linode.com,meme,memorial,memorial.museum,memset.net,men,menu,meraker.no,merckmsd,merseine.nu,meråker.no,mesaverde.museum,messina.it,meteorapp.com,metlife,mex.com,mg,mg.gov.br,mg.leg.br,mh,mi.it,mi.th,mi.us,miami,miasa.nagano.jp,miasta.pl,mibu.tochigi.jp,michigan.museum,microlight.aero,microsoft,midatlantic.museum,midori.chiba.jp,midori.gunma.jp,midsund.no,midtre-gauldal.no,mie.jp,mielec.pl,mielno.pl,mifune.kumamoto.jp,mihama.aichi.jp,mihama.chiba.jp,mihama.fukui.jp,mihama.mie.jp,mihama.wakayama.jp,mihara.hiroshima.jp,mihara.kochi.jp,miharu.fukushima.jp,miho.ibaraki.jp,mikasa.hokkaido.jp,mikawa.yamagata.jp,miki.hyogo.jp,mil,mil.ac,mil.ae,mil.al,mil.ar,mil.az,mil.ba,mil.bo,mil.br,mil.by,mil.cl,mil.cn,mil.co,mil.do,mil.ec,mil.eg,mil.ge,mil.gh,mil.gt,mil.hn,mil.id,mil.in,mil.iq,mil.jo,mil.kg,mil.km,mil.kr,mil.kz,mil.lv,mil.mg,mil.mv,mil.my,mil.mz,mil.ng,mil.ni,mil.no,mil.nz,mil.pe,mil.ph,mil.pl,mil.py,mil.qa,mil.ru,mil.rw,mil.sh,mil.st,mil.sy,mil.tj,mil.tm,mil.to,mil.tr,mil.tw,mil.tz,mil.uy,mil.vc,mil.ve,mil.za,mil.zm,mil.zw,milan.it,milano.it,military.museum,mill.museum,mima.tokushima.jp,mimata.miyazaki.jp,minakami.gunma.jp,minamata.kumamoto.jp,minami-alps.yamanashi.jp,minami.fukuoka.jp,minami.kyoto.jp,minami.tokushima.jp,minamiaiki.nagano.jp,minamiashigara.kanagawa.jp,minamiawaji.hyogo.jp,minamiboso.chiba.jp,minamidaito.okinawa.jp,minamiechizen.fukui.jp,minamifurano.hokkaido.jp,minamiise.mie.jp,minamiizu.shizuoka.jp,minamimaki.nagano.jp,minamiminowa.nagano.jp,minamioguni.kumamoto.jp,minamisanriku.miyagi.jp,minamitane.kagoshima.jp,minamiuonuma.niigata.jp,minamiyamashiro.kyoto.jp,minano.saitama.jp,minato.osaka.jp,minato.tokyo.jp,mincom.tn,mine.nu,miners.museum,mini,mining.museum,miniserver.com,minnesota.museum,mino.gifu.jp,minobu.yamanashi.jp,minoh.osaka.jp,minokamo.gifu.jp,minowa.nagano.jp,mint,misaki.okayama.jp,misaki.osaka.jp,misasa.tottori.jp,misato.akita.jp,misato.miyagi.jp,misato.saitama.jp,misato.shimane.jp,misato.wakayama.jp,misawa.aomori.jp,misconfused.org,mishima.fukushima.jp,mishima.shizuoka.jp,missile.museum,missoula.museum,misugi.mie.jp,mit,mitaka.tokyo.jp,mitake.gifu.jp,mitane.akita.jp,mito.ibaraki.jp,mitou.yamaguchi.jp,mitoyo.kagawa.jp,mitsubishi,mitsue.nara.jp,mitsuke.niigata.jp,miura.kanagawa.jp,miyada.nagano.jp,miyagi.jp,miyake.nara.jp,miyako.fukuoka.jp,miyako.iwate.jp,miyakonojo.miyazaki.jp,miyama.fukuoka.jp,miyama.mie.jp,miyashiro.saitama.jp,miyawaka.fukuoka.jp,miyazaki.jp,miyazaki.miyazaki.jp,miyazu.kyoto.jp,miyoshi.aichi.jp,miyoshi.hiroshima.jp,miyoshi.saitama.jp,miyoshi.tokushima.jp,miyota.nagano.jp,mizuho.tokyo.jp,mizumaki.fukuoka.jp,mizunami.gifu.jp,mizusawa.iwate.jp,mjondalen.no,mjøndalen.no,mk,mk.eu.org,mk.ua,ml,mlb,mlbfan.org,mls,mm,mma,mmafan.biz,mn,mn.it,mn.us,mo,mo-i-rana.no,mo-siemens.io,mo.cn,mo.it,mo.us,moareke.no,mobara.chiba.jp,mobi,mobi.gp,mobi.ke,mobi.na,mobi.ng,mobi.tt,mobi.tz,mobile,mobily,mochizuki.nagano.jp,mod.gi,moda,modalen.no,modelling.aero,modena.it,modern.museum,modum.no,moe,moi,moka.tochigi.jp,mol.it,molde.no,molise.it,mom,moma.museum,mombetsu.hokkaido.jp,monash,money,money.museum,monmouth.museum,monster,monticello.museum,montreal.museum,monza-brianza.it,monza-e-della-brianza.it,monza.it,monzabrianza.it,monzaebrianza.it,monzaedellabrianza.it,moonscale.io,moonscale.net,mopar,mordovia.ru,mordovia.su,morena.br,moriguchi.osaka.jp,morimachi.shizuoka.jp,morioka.iwate.jp,moriya.ibaraki.jp,moriyama.shiga.jp,moriyoshi.akita.jp,mormon,morotsuka.miyazaki.jp,moroyama.saitama.jp,mortgage,moscow,moscow.museum,moseushi.hokkaido.jp,mosjoen.no,mosjøen.no,moskenes.no,moss.no,mosvik.no,motegi.tochigi.jp,moto,motobu.okinawa.jp,motorcycle.museum,motorcycles,motosu.gifu.jp,motoyama.kochi.jp,mov,movie,movimiento.bo,movistar,mozilla-iot.org,moåreke.no,mp,mp.br,mq,mr,mr.no,mragowo.pl,ms,ms.gov.br,ms.it,ms.kr,ms.leg.br,ms.us,msd,msk.ru,msk.su,mt,mt.eu.org,mt.gov.br,mt.it,mt.leg.br,mt.us,mtn,mtr,mu,muenchen.museum,muenster.museum,mugi.tokushima.jp,muika.niigata.jp,mukawa.hokkaido.jp,muko.kyoto.jp,mulhouse.museum,munakata.fukuoka.jp,muncie.museum,muni.il,muosat.no,muosát.no,mup.gov.pl,murakami.niigata.jp,murata.miyagi.jp,murayama.yamagata.jp,murmansk.su,muroran.hokkaido.jp,muroto.kochi.jp,mus.br,mus.mi.us,musashimurayama.tokyo.jp,musashino.tokyo.jp,museet.museum,museum,museum.mv,museum.mw,museum.no,museum.om,museum.tt,museumcenter.museum,museumvereniging.museum,music.museum,musica.ar,musica.bo,mutsu.aomori.jp,mutsuzawa.chiba.jp,mutual,mv,mw,mw.gov.pl,mx,mx.na,my,my-firewall.org,my-gateway.de,my-router.de,my-vigor.de,my-wan.de,my.eu.org,my.id,myactivedirectory.com,myasustor.com,mycd.eu,mydatto.com,mydatto.net,myddns.rocks,mydissent.net,mydobiss.com,mydrobo.com,myds.me,myeffect.net,myfirewall.org,myfritz.net,myftp.biz,myftp.org,myhome-server.de,myiphost.com,myjino.ru,mykolaiv.ua,mymailer.com.tw,mymediapc.net,myoko.niigata.jp,mypep.link,mypets.ws,myphotos.cc,mypi.co,mypsx.net,myqnapcloud.com,myravendb.com,mysecuritycamera.com,mysecuritycamera.net,mysecuritycamera.org,myshopblocks.com,mytis.ru,mytuleap.com,myvnc.com,mywire.org,mz,málatvuopmi.no,mátta-várjjat.no,målselv.no,måsøy.no,māori.nz,n.bg,n.se,n4t.co,na,na.it,naamesjevuemie.no,nab,nabari.mie.jp,nachikatsuura.wakayama.jp,nadex,nagahama.shiga.jp,nagai.yamagata.jp,nagano.jp,nagano.nagano.jp,naganohara.gunma.jp,nagaoka.niigata.jp,nagaokakyo.kyoto.jp,nagara.chiba.jp,nagareyama.chiba.jp,nagasaki.jp,nagasaki.nagasaki.jp,nagasu.kumamoto.jp,nagato.yamaguchi.jp,nagatoro.saitama.jp,nagawa.nagano.jp,nagi.okayama.jp,nagiso.nagano.jp,nago.okinawa.jp,nagoya,nagoya.jp,naha.okinawa.jp,nahari.kochi.jp,naie.hokkaido.jp,naka.hiroshima.jp,naka.ibaraki.jp,nakadomari.aomori.jp,nakagawa.fukuoka.jp,nakagawa.hokkaido.jp,nakagawa.nagano.jp,nakagawa.tokushima.jp,nakagusuku.okinawa.jp,nakagyo.kyoto.jp,nakai.kanagawa.jp,nakama.fukuoka.jp,nakamichi.yamanashi.jp,nakamura.kochi.jp,nakaniikawa.toyama.jp,nakano.nagano.jp,nakano.tokyo.jp,nakanojo.gunma.jp,nakanoto.ishikawa.jp,nakasatsunai.hokkaido.jp,nakatane.kagoshima.jp,nakatombetsu.hokkaido.jp,nakatsugawa.gifu.jp,nakayama.yamagata.jp,nakijin.okinawa.jp,naklo.pl,nalchik.ru,nalchik.su,namdalseid.no,name,name.az,name.cy,name.eg,name.et,name.hr,name.jo,name.mk,name.mv,name.my,name.na,name.ng,name.pr,name.qa,name.tj,name.tr,name.tt,name.vn,namegata.ibaraki.jp,namegawa.saitama.jp,namerikawa.toyama.jp,namie.fukushima.jp,namikata.ehime.jp,namsos.no,namsskogan.no,nanae.hokkaido.jp,nanao.ishikawa.jp,nanbu.tottori.jp,nanbu.yamanashi.jp,nango.fukushima.jp,nanjo.okinawa.jp,nankoku.kochi.jp,nanmoku.gunma.jp,nannestad.no,nanporo.hokkaido.jp,nantan.kyoto.jp,nanto.toyama.jp,nanyo.yamagata.jp,naoshima.kagawa.jp,naples.it,napoli.it,nara.jp,nara.nara.jp,narashino.chiba.jp,narita.chiba.jp,naroy.no,narusawa.yamanashi.jp,naruto.tokushima.jp,narviika.no,narvik.no,nasu.tochigi.jp,nasushiobara.tochigi.jp,nat.tn,natal.br,national.museum,nationalfirearms.museum,nationalheritage.museum,nationwide,nativeamerican.museum,natori.miyagi.jp,natura,natural.bo,naturalhistory.museum,naturalhistorymuseum.museum,naturalsciences.museum,naturbruksgymn.se,nature.museum,naturhistorisches.museum,natuurwetenschappen.museum,naumburg.museum,naustdal.no,naval.museum,navigation.aero,navoi.su,navuotna.no,navy,nayoro.hokkaido.jp,nb.ca,nba,nc,nc.tr,nc.us,nctu.me,nd.us,ne,ne.jp,ne.ke,ne.kr,ne.pw,ne.tz,ne.ug,ne.us,neat-url.com,nebraska.museum,nec,nedre-eiker.no,nemuro.hokkaido.jp,nerdpol.ovh,nerima.tokyo.jp,nes.akershus.no,nes.buskerud.no,nesna.no,nesodden.no,nesoddtangen.no,nesseby.no,nesset.no,net,net-freaks.com,net.ac,net.ae,net.af,net.ag,net.ai,net.al,net.am,net.ar,net.au,net.az,net.ba,net.bb,net.bh,net.bm,net.bn,net.bo,net.br,net.bs,net.bt,net.bz,net.ci,net.cm,net.cn,net.co,net.cu,net.cw,net.cy,net.dm,net.do,net.dz,net.ec,net.eg,net.et,net.eu.org,net.ge,net.gg,net.gl,net.gn,net.gp,net.gr,net.gt,net.gu,net.gy,net.hk,net.hn,net.ht,net.id,net.il,net.im,net.in,net.iq,net.ir,net.is,net.je,net.jo,net.kg,net.ki,net.kn,net.kw,net.ky,net.kz,net.la,net.lb,net.lc,net.lk,net.lr,net.ls,net.lv,net.ly,net.ma,net.me,net.mk,net.ml,net.mo,net.ms,net.mt,net.mu,net.mv,net.mw,net.mx,net.my,net.mz,net.nf,net.ng,net.ni,net.nr,net.nz,net.om,net.pa,net.pe,net.ph,net.pk,net.pl,net.pn,net.pr,net.ps,net.pt,net.py,net.qa,net.ru,net.rw,net.sa,net.sb,net.sc,net.sd,net.sg,net.sh,net.sl,net.so,net.st,net.sy,net.th,net.tj,net.tm,net.tn,net.to,net.tr,net.tt,net.tw,net.ua,net.uk,net.uy,net.uz,net.vc,net.ve,net.vi,net.vn,net.vu,net.ws,net.za,net.zm,netbank,netflix,netlify.com,network,neues.museum,neustar,new,newhampshire.museum,newholland,newjersey.museum,newmexico.museum,newport.museum,news,news.hu,newspaper.museum,newyork.museum,next,nextdirect,nexus,neyagawa.osaka.jp,nf,nf.ca,nfl,nflfan.org,nfshost.com,ng,ng.city,ng.eu.org,ng.ink,ng.school,ngo,ngo.lk,ngo.ph,ngo.za,ngrok.io,nh-serv.co.uk,nh.us,nhk,nhlfan.net,nhs.uk,ni,nic.in,nic.tj,nic.za,nichinan.miyazaki.jp,nichinan.tottori.jp,nico,nid.io,niepce.museum,nieruchomosci.pl,niigata.jp,niigata.niigata.jp,niihama.ehime.jp,niikappu.hokkaido.jp,niimi.okayama.jp,niiza.saitama.jp,nikaho.akita.jp,nike,niki.hokkaido.jp,nikko.tochigi.jp,nikolaev.ua,nikon,ninja,ninohe.iwate.jp,ninomiya.kanagawa.jp,nirasaki.yamanashi.jp,nis.za,nishi.fukuoka.jp,nishi.osaka.jp,nishiaizu.fukushima.jp,nishiarita.saga.jp,nishiawakura.okayama.jp,nishiazai.shiga.jp,nishigo.fukushima.jp,nishihara.kumamoto.jp,nishihara.okinawa.jp,nishiizu.shizuoka.jp,nishikata.tochigi.jp,nishikatsura.yamanashi.jp,nishikawa.yamagata.jp,nishimera.miyazaki.jp,nishinomiya.hyogo.jp,nishinoomote.kagoshima.jp,nishinoshima.shimane.jp,nishio.aichi.jp,nishiokoppe.hokkaido.jp,nishitosa.kochi.jp,nishiwaki.hyogo.jp,nissan,nissay,nissedal.no,nisshin.aichi.jp,niteroi.br,nittedal.no,niyodogawa.kochi.jp,nj.us,nl,nl.ca,nl.eu.org,nl.no,nm.cn,nm.us,no,no-ip.biz,no-ip.ca,no-ip.co.uk,no-ip.info,no-ip.net,no-ip.org,no.com,no.eu.org,no.it,nobeoka.miyazaki.jp,noboribetsu.hokkaido.jp,noda.chiba.jp,noda.iwate.jp,nodebalancer.linode.com,nodum.co,nodum.io,nogata.fukuoka.jp,nogi.tochigi.jp,noheji.aomori.jp,noho.st,nohost.me,noip.me,noip.us,nokia,nom.ad,nom.ae,nom.af,nom.ag,nom.ai,nom.al,nom.br,nom.cl,nom.co,nom.es,nom.fr,nom.gd,nom.ge,nom.gl,nom.gt,nom.hn,nom.im,nom.ke,nom.km,nom.li,nom.mg,nom.mk,nom.nc,nom.ni,nom.nu,nom.pa,nom.pe,nom.pl,nom.pw,nom.qa,nom.re,nom.ro,nom.rs,nom.si,nom.st,nom.tj,nom.tm,nom.ug,nom.uy,nom.vc,nom.vg,nom.za,nombre.bo,nome.pt,nomi.ishikawa.jp,nonoichi.ishikawa.jp,nord-aurdal.no,nord-fron.no,nord-odal.no,norddal.no,nordkapp.no,nordre-land.no,nordreisa.no,nore-og-uvdal.no,norfolk.museum,north-kazakhstan.su,north.museum,northwesternmutual,norton,nose.osaka.jp,nosegawa.nara.jp,noshiro.akita.jp,not.br,notaires.fr,notaires.km,noticias.bo,noto.ishikawa.jp,notodden.no,notogawa.shiga.jp,notteroy.no,nov.ru,nov.su,novara.it,now,now-dns.net,now-dns.org,now-dns.top,now.sh,nowaruda.pl,nowruz,nowtv,nozawaonsen.nagano.jp,np,nr,nra,nrw,nrw.museum,ns.ca,nsn.us,nsupdate.info,nsw.au,nsw.edu.au,nt.au,nt.ca,nt.edu.au,nt.no,nt.ro,ntdll.top,ntr.br,ntt,nu,nu.ca,nu.it,nuernberg.museum,numata.gunma.jp,numata.hokkaido.jp,numazu.shizuoka.jp,nuoro.it,nuremberg.museum,nv.us,nx.cn,ny.us,nyc,nyc.mn,nyc.museum,nym.by,nym.bz,nym.ec,nym.gr,nym.gy,nym.hk,nym.ie,nym.kz,nym.la,nym.lc,nym.li,nym.lt,nym.lu,nym.me,nym.mn,nym.mx,nym.nz,nym.pe,nym.pt,nym.ro,nym.sk,nym.su,nym.sx,nym.tw,nyny.museum,nysa.pl,nyuzen.toyama.jp,nz,nz.eu.org,návuotna.no,nååmesjevuemie.no,nærøy.no,nøtterøy.no,o.bg,o.se,oamishirasato.chiba.jp,oarai.ibaraki.jp,obama.fukui.jp,obama.nagasaki.jp,obanazawa.yamagata.jp,obi,obihiro.hokkaido.jp,obira.hokkaido.jp,obninsk.su,observer,obu.aichi.jp,obuse.nagano.jp,oceanographic.museum,oceanographique.museum,ochi.kochi.jp,od.ua,odate.akita.jp,odawara.kanagawa.jp,odda.no,odesa.ua,odessa.ua,odo.br,oe.yamagata.jp,of.by,of.fashion,of.football,of.london,of.no,of.work,off,off.ai,office,office-on-the.net,official.academy,ofunato.iwate.jp,og.ao,og.it,oga.akita.jp,ogaki.gifu.jp,ogano.saitama.jp,ogasawara.tokyo.jp,ogata.akita.jp,ogawa.ibaraki.jp,ogawa.nagano.jp,ogawa.saitama.jp,ogawara.miyagi.jp,ogi.saga.jp,ogimi.okinawa.jp,ogliastra.it,ogori.fukuoka.jp,ogose.saitama.jp,oguchi.aichi.jp,oguni.kumamoto.jp,oguni.yamagata.jp,oh.us,oharu.aichi.jp,ohda.shimane.jp,ohi.fukui.jp,ohira.miyagi.jp,ohira.tochigi.jp,ohkura.yamagata.jp,ohtawara.tochigi.jp,oi.kanagawa.jp,oirase.aomori.jp,oirm.gov.pl,oishida.yamagata.jp,oiso.kanagawa.jp,oita.jp,oita.oita.jp,oizumi.gunma.jp,oji.nara.jp,ojiya.niigata.jp,ok.us,okagaki.fukuoka.jp,okawa.fukuoka.jp,okawa.kochi.jp,okaya.nagano.jp,okayama.jp,okayama.okayama.jp,okazaki.aichi.jp,okegawa.saitama.jp,oketo.hokkaido.jp,oki.fukuoka.jp,okinawa,okinawa.jp,okinawa.okinawa.jp,okinoshima.shimane.jp,okoppe.hokkaido.jp,oksnes.no,okuizumo.shimane.jp,okuma.fukushima.jp,okutama.tokyo.jp,ol.no,olawa.pl,olayan,olayangroup,olbia-tempio.it,olbiatempio.it,oldnavy,olecko.pl,olkusz.pl,ollo,olsztyn.pl,om,omachi.nagano.jp,omachi.saga.jp,omaezaki.shizuoka.jp,omaha.museum,omasvuotna.no,ome.tokyo.jp,omega,omi.nagano.jp,omi.niigata.jp,omigawa.chiba.jp,omihachiman.shiga.jp,omitama.ibaraki.jp,omiya.saitama.jp,omotego.fukushima.jp,omura.nagasaki.jp,omuta.fukuoka.jp,on-aptible.com,on-rancher.cloud,on-rio.io,on-the-web.tv,on-web.fr,on.ca,on.fashion,onagawa.miyagi.jp,one,ong,ong.br,onga.fukuoka.jp,onion,onjuku.chiba.jp,onl,online,online.museum,online.th,onna.okinawa.jp,ono.fukui.jp,ono.fukushima.jp,ono.hyogo.jp,onojo.fukuoka.jp,onomichi.hiroshima.jp,onred.one,onrender.com,ontario.museum,onthewifi.com,onyourside,ooguy.com,ookuwa.nagano.jp,ooo,ooshika.nagano.jp,open,openair.museum,opencraft.hosting,operaunite.com,opoczno.pl,opole.pl,oppdal.no,oppegard.no,oppegård.no,or.at,or.bi,or.ci,or.cr,or.id,or.it,or.jp,or.ke,or.kr,or.mu,or.na,or.pw,or.th,or.tz,or.ug,or.us,ora.gunma.jp,oracle,orange,oregon.museum,oregontrail.museum,org,org.ac,org.ae,org.af,org.ag,org.ai,org.al,org.am,org.ar,org.au,org.az,org.ba,org.bb,org.bh,org.bi,org.bm,org.bn,org.bo,org.br,org.bs,org.bt,org.bw,org.bz,org.ci,org.cn,org.co,org.cu,org.cw,org.cy,org.dm,org.do,org.dz,org.ec,org.ee,org.eg,org.es,org.et,org.ge,org.gg,org.gh,org.gi,org.gl,org.gn,org.gp,org.gr,org.gt,org.gu,org.gy,org.hk,org.hn,org.ht,org.hu,org.il,org.im,org.in,org.iq,org.ir,org.is,org.je,org.jo,org.kg,org.ki,org.km,org.kn,org.kp,org.kw,org.ky,org.kz,org.la,org.lb,org.lc,org.lk,org.lr,org.ls,org.lv,org.ly,org.ma,org.me,org.mg,org.mk,org.ml,org.mn,org.mo,org.ms,org.mt,org.mu,org.mv,org.mw,org.mx,org.my,org.mz,org.na,org.ng,org.ni,org.nr,org.nz,org.om,org.pa,org.pe,org.pf,org.ph,org.pk,org.pl,org.pn,org.pr,org.ps,org.pt,org.py,org.qa,org.ro,org.rs,org.ru,org.rw,org.sa,org.sb,org.sc,org.sd,org.se,org.sg,org.sh,org.sl,org.sn,org.so,org.st,org.sv,org.sy,org.sz,org.tj,org.tm,org.tn,org.to,org.tr,org.tt,org.tw,org.ua,org.ug,org.uk,org.uy,org.uz,org.vc,org.ve,org.vi,org.vn,org.vu,org.ws,org.za,org.zm,org.zw,organic,origins,oristano.it,orkanger.no,orkdal.no,orland.no,orskog.no,orsta.no,orx.biz,os.hedmark.no,os.hordaland.no,osaka,osaka.jp,osakasayama.osaka.jp,osaki.miyagi.jp,osakikamijima.hiroshima.jp,osasco.br,osen.no,oseto.nagasaki.jp,oshima.tokyo.jp,oshima.yamaguchi.jp,oshino.yamanashi.jp,oshu.iwate.jp,oslo.no,osoyro.no,osteroy.no,osterøy.no,ostre-toten.no,ostroda.pl,ostroleka.pl,ostrowiec.pl,ostrowwlkp.pl,osøyro.no,ot.it,ota.gunma.jp,ota.tokyo.jp,otago.museum,otake.hiroshima.jp,otaki.chiba.jp,otaki.nagano.jp,otaki.saitama.jp,otama.fukushima.jp,otap.co,otari.nagano.jp,otaru.hokkaido.jp,other.nf,oto.fukuoka.jp,otobe.hokkaido.jp,otofuke.hokkaido.jp,otoineppu.hokkaido.jp,otoyo.kochi.jp,otsu.shiga.jp,otsuchi.iwate.jp,otsuka,otsuki.kochi.jp,otsuki.yamanashi.jp,ott,ouchi.saga.jp,ouda.nara.jp,oum.gov.pl,oumu.hokkaido.jp,outsystemscloud.com,overhalla.no,ovh,ovre-eiker.no,owani.aomori.jp,owariasahi.aichi.jp,own.pm,ownip.net,ownprovider.com,ox.rs,oxford.museum,oy.lc,oyabe.toyama.jp,oyama.tochigi.jp,oyamazaki.kyoto.jp,oyer.no,oygarden.no,oyodo.nara.jp,oystre-slidre.no,oz.au,ozora.hokkaido.jp,ozu.ehime.jp,ozu.kumamoto.jp,p.bg,p.se,pa,pa.gov.br,pa.gov.pl,pa.it,pa.leg.br,pa.us,pacific.museum,paderborn.museum,padova.it,padua.it,page,pagefrontapp.com,pagespeedmobilizer.com,palace.museum,paleo.museum,palermo.it,palmas.br,palmsprings.museum,panama.museum,panasonic,pantheonsite.io,parachuting.aero,paragliding.aero,paris,paris.eu.org,paris.museum,parliament.cy,parliament.nz,parma.it,paroch.k12.ma.us,pars,parti.se,partners,parts,party,pasadena.museum,passagens,passenger-association.aero,patria.bo,pavia.it,pay,pb.ao,pb.gov.br,pb.leg.br,pc.it,pc.pl,pccw,pcloud.host,pd.it,pe,pe.ca,pe.gov.br,pe.it,pe.kr,pe.leg.br,penza.su,per.la,per.nf,per.sg,perso.ht,perso.sn,perso.tn,perugia.it,pesaro-urbino.it,pesarourbino.it,pescara.it,pet,pf,pfizer,pg,pg.it,pgafan.net,pgfog.com,ph,pharmacien.fr,pharmaciens.km,pharmacy,pharmacy.museum,phd,philadelphia.museum,philadelphiaarea.museum,philately.museum,philips,phoenix.museum,phone,photo,photography,photography.museum,photos,physio,pi.gov.br,pi.it,pi.leg.br,piacenza.it,piaget,pics,pictet,pictures,pid,piedmont.it,piemonte.it,pila.pl,pilot.aero,pilots.museum,pimienta.org,pin,pinb.gov.pl,ping,pink,pioneer,pippu.hokkaido.jp,pisa.it,pistoia.it,pisz.pl,pittsburgh.museum,piw.gov.pl,pixolino.com,pizza,pk,pl,pl.eu.org,pl.ua,place,planetarium.museum,plantation.museum,plants.museum,platform.sh,platformsh.site,play,playstation,plaza.museum,plc.co.im,plc.ly,plc.uk,plo.ps,plumbing,plurinacional.bo,plus,pm,pmn.it,pn,pn.it,pnc,po.gov.pl,po.it,poa.br,podhale.pl,podlasie.pl,podzone.net,podzone.org,pohl,point2this.com,pointto.us,poivron.org,poker,pokrovsk.su,pol.dz,pol.ht,pol.tr,police.uk,politica.bo,politie,polkowice.pl,poltava.ua,pomorskie.pl,pomorze.pl,poniatowa.pl,ponpes.id,pony.club,pordenone.it,porn,porsanger.no,porsangu.no,porsgrunn.no,porsáŋgu.no,port.fr,portal.museum,portland.museum,portlligat.museum,post,posts-and-telecommunications.museum,potager.org,potenza.it,powiat.pl,poznan.pl,pp.az,pp.ru,pp.se,pp.ua,ppg.br,pr,pr.gov.br,pr.it,pr.leg.br,pr.us,pramerica,prato.it,praxi,prd.fr,prd.km,prd.mg,preservation.museum,presidio.museum,press,press.aero,press.cy,press.ma,press.museum,press.se,presse.ci,presse.km,presse.ml,pri.ee,prime,principe.st,priv.at,priv.hu,priv.me,priv.no,priv.pl,privatizehealthinsurance.net,pro,pro.az,pro.br,pro.cy,pro.ec,pro.ht,pro.mv,pro.na,pro.om,pro.pr,pro.tt,pro.vn,prochowice.pl,prod,production.aero,productions,prof,prof.pr,profesional.bo,progressive,project.museum,promo,properties,property,protection,protonet.io,pru,prudential,pruszkow.pl,prvcy.page,przeworsk.pl,ps,psc.br,psi.br,psp.gov.pl,psse.gov.pl,pt,pt.eu.org,pt.it,ptplus.fit,pu.it,pub,pub.sa,publ.pt,public.museum,publishproxy.com,pubol.museum,pubtls.org,pueblo.bo,pug.it,puglia.it,pulawy.pl,pup.gov.pl,pv.it,pvh.br,pvt.ge,pvt.k12.ma.us,pw,pwc,py,pyatigorsk.ru,pz.it,q-a.eu.org,q.bg,qa,qa2.com,qc.ca,qc.com,qh.cn,qld.au,qld.edu.au,qld.gov.au,qpon,qsl.br,qualifioapp.com,quebec,quebec.museum,quest,quicksytes.com,quipelements.com,qvc,r.bg,r.cdn77.net,r.se,ra.it,racing,rackmaze.com,rackmaze.net,rade.no,radio,radio.br,radom.pl,radoy.no,radøy.no,ragusa.it,rahkkeravju.no,raholt.no,raid,railroad.museum,railway.museum,raisa.no,rakkestad.no,ralingen.no,rana.no,randaberg.no,rankoshi.hokkaido.jp,ranzan.saitama.jp,ras.ru,rauma.no,ravendb.community,ravendb.me,ravendb.run,ravenna.it,rawa-maz.pl,rc.it,re,re.it,re.kr,read,read-books.org,readmyblog.org,readthedocs.io,realestate,realestate.pl,realm.cz,realtor,realty,rebun.hokkaido.jp,rec.br,rec.co,rec.nf,rec.ro,rec.ve,recht.pro,recife.br,recipes,recreation.aero,red,red.sv,redirectme.net,redstone,redumbrella,reg.dk,reggio-calabria.it,reggio-emilia.it,reggiocalabria.it,reggioemilia.it,rehab,reise,reisen,reit,reklam.hu,rel.ht,rel.pl,reliance,remotewd.com,ren,rendalen.no,rennebu.no,rennesoy.no,rennesøy.no,rent,rentals,rep.kp,repair,repbody.aero,repl.co,repl.run,report,republican,res.aero,res.in,research.aero,research.museum,resindevice.io,resistance.museum,rest,restaurant,review,reviews,revista.bo,rexroth,rg.it,rhcloud.com,ri.it,ri.us,ribeirao.br,rich,richardli,ricoh,rieti.it,rifu.miyagi.jp,rightathome,riik.ee,rikubetsu.hokkaido.jp,rikuzentakata.iwate.jp,ril,rimini.it,rindal.no,ringebu.no,ringerike.no,ringsaker.no,rio,rio.br,riobranco.br,riodejaneiro.museum,riopreto.br,rip,rishiri.hokkaido.jp,rishirifuji.hokkaido.jp,risor.no,rissa.no,risør.no,ritto.shiga.jp,rivne.ua,rj.gov.br,rj.leg.br,rl.no,rm.it,rmit,rn.gov.br,rn.it,rn.leg.br,rnrt.tn,rns.tn,rnu.tn,ro,ro.eu.org,ro.gov.br,ro.im,ro.it,ro.leg.br,roan.no,rocher,rochester.museum,rockart.museum,rocks,rodeo,rodoy.no,rogers,rokunohe.aomori.jp,rollag.no,roma.it,roma.museum,rome.it,romsa.no,romskog.no,room,roros.no,rost.no,rotorcraft.aero,router.management,rovigo.it,rovno.ua,royken.no,royrvik.no,rr.gov.br,rr.leg.br,rs,rs.gov.br,rs.leg.br,rsc.cdn77.org,rsvp,ru,ru.com,ru.eu.org,ru.net,rugby,ruhr,run,run.app,ruovat.no,russia.museum,rv.ua,rw,rwe,rybnik.pl,rygge.no,ryokami.saitama.jp,ryugasaki.ibaraki.jp,ryukyu,ryuoh.shiga.jp,rzeszow.pl,rzgw.gov.pl,ráhkkerávju.no,ráisa.no,råde.no,råholt.no,rælingen.no,rødøy.no,rømskog.no,røros.no,røst.no,røyken.no,røyrvik.no,s.bg,s.se,s3-ap-northeast-1.amazonaws.com,s3-ap-northeast-2.amazonaws.com,s3-ap-south-1.amazonaws.com,s3-ap-southeast-1.amazonaws.com,s3-ap-southeast-2.amazonaws.com,s3-ca-central-1.amazonaws.com,s3-eu-central-1.amazonaws.com,s3-eu-west-1.amazonaws.com,s3-eu-west-2.amazonaws.com,s3-eu-west-3.amazonaws.com,s3-external-1.amazonaws.com,s3-fips-us-gov-west-1.amazonaws.com,s3-sa-east-1.amazonaws.com,s3-us-east-2.amazonaws.com,s3-us-gov-west-1.amazonaws.com,s3-us-west-1.amazonaws.com,s3-us-west-2.amazonaws.com,s3-website-ap-northeast-1.amazonaws.com,s3-website-ap-southeast-1.amazonaws.com,s3-website-ap-southeast-2.amazonaws.com,s3-website-eu-west-1.amazonaws.com,s3-website-sa-east-1.amazonaws.com,s3-website-us-east-1.amazonaws.com,s3-website-us-west-1.amazonaws.com,s3-website-us-west-2.amazonaws.com,s3-website.ap-northeast-2.amazonaws.com,s3-website.ap-south-1.amazonaws.com,s3-website.ca-central-1.amazonaws.com,s3-website.eu-central-1.amazonaws.com,s3-website.eu-west-2.amazonaws.com,s3-website.eu-west-3.amazonaws.com,s3-website.us-east-2.amazonaws.com,s3.amazonaws.com,s3.ap-northeast-2.amazonaws.com,s3.ap-south-1.amazonaws.com,s3.ca-central-1.amazonaws.com,s3.cn-north-1.amazonaws.com.cn,s3.dualstack.ap-northeast-1.amazonaws.com,s3.dualstack.ap-northeast-2.amazonaws.com,s3.dualstack.ap-south-1.amazonaws.com,s3.dualstack.ap-southeast-1.amazonaws.com,s3.dualstack.ap-southeast-2.amazonaws.com,s3.dualstack.ca-central-1.amazonaws.com,s3.dualstack.eu-central-1.amazonaws.com,s3.dualstack.eu-west-1.amazonaws.com,s3.dualstack.eu-west-2.amazonaws.com,s3.dualstack.eu-west-3.amazonaws.com,s3.dualstack.sa-east-1.amazonaws.com,s3.dualstack.us-east-1.amazonaws.com,s3.dualstack.us-east-2.amazonaws.com,s3.eu-central-1.amazonaws.com,s3.eu-west-2.amazonaws.com,s3.eu-west-3.amazonaws.com,s3.us-east-2.amazonaws.com,s5y.io,sa,sa-east-1.elasticbeanstalk.com,sa.au,sa.com,sa.cr,sa.edu.au,sa.gov.au,sa.gov.pl,sa.it,saarland,sabae.fukui.jp,sado.niigata.jp,safe,safety,safety.aero,saga.jp,saga.saga.jp,sagae.yamagata.jp,sagamihara.kanagawa.jp,saigawa.fukuoka.jp,saijo.ehime.jp,saikai.nagasaki.jp,saiki.oita.jp,saintlouis.museum,saitama.jp,saitama.saitama.jp,saito.miyazaki.jp,saka.hiroshima.jp,sakado.saitama.jp,sakae.chiba.jp,sakae.nagano.jp,sakahogi.gifu.jp,sakai.fukui.jp,sakai.ibaraki.jp,sakai.osaka.jp,sakaiminato.tottori.jp,sakaki.nagano.jp,sakata.yamagata.jp,sakawa.kochi.jp,sakegawa.yamagata.jp,saku.nagano.jp,sakuho.nagano.jp,sakura,sakura.chiba.jp,sakura.tochigi.jp,sakuragawa.ibaraki.jp,sakurai.nara.jp,sakyo.kyoto.jp,salangen.no,salat.no,sale,salem.museum,salerno.it,salon,saltdal.no,salud.bo,salvador.br,salvadordali.museum,salzburg.museum,samegawa.fukushima.jp,samnanger.no,sampa.br,samsclub,samsung,samukawa.kanagawa.jp,sanagochi.tokushima.jp,sanda.hyogo.jp,sandcats.io,sande.more-og-romsdal.no,sande.møre-og-romsdal.no,sande.vestfold.no,sandefjord.no,sandiego.museum,sandnes.no,sandnessjoen.no,sandnessjøen.no,sandoy.no,sandvik,sandvikcoromant,sandøy.no,sanfrancisco.museum,sango.nara.jp,sanjo.niigata.jp,sannan.hyogo.jp,sannohe.aomori.jp,sano.tochigi.jp,sanofi,sanok.pl,santabarbara.museum,santacruz.museum,santafe.museum,santamaria.br,santoandre.br,sanuki.kagawa.jp,saobernardo.br,saogonca.br,saotome.st,sap,sapporo.jp,sar.it,sardegna.it,sardinia.it,sarl,saroma.hokkaido.jp,sarpsborg.no,sarufutsu.hokkaido.jp,sas,sasaguri.fukuoka.jp,sasayama.hyogo.jp,sasebo.nagasaki.jp,saskatchewan.museum,sassari.it,satosho.okayama.jp,satsumasendai.kagoshima.jp,satte.saitama.jp,satx.museum,sauda.no,sauherad.no,savannahga.museum,save,saves-the-whales.com,savona.it,saxo,sayama.osaka.jp,sayama.saitama.jp,sayo.hyogo.jp,sb,sb.ua,sbi,sbs,sc,sc.cn,sc.gov.br,sc.ke,sc.kr,sc.leg.br,sc.ls,sc.tz,sc.ug,sc.us,sca,scapp.io,scb,sch.ae,sch.id,sch.ir,sch.jo,sch.lk,sch.ly,sch.ng,sch.qa,sch.sa,sch.so,sch.uk,sch.zm,schaeffler,schlesisches.museum,schmidt,schoenbrunn.museum,schokokeks.net,schokoladen.museum,scholarships,school,school.museum,school.na,school.nz,school.za,schule,schwarz,schweiz.museum,sci.eg,science,science-fiction.museum,science.museum,scienceandhistory.museum,scienceandindustry.museum,sciencecenter.museum,sciencecenters.museum,sciencehistory.museum,sciences.museum,sciencesnaturelles.museum,scientist.aero,scjohnson,scor,scot,scotland.museum,scrapper-site.net,scrapping.cc,scrysec.com,sd,sd.cn,sd.us,sdn.gov.pl,se,se.eu.org,se.gov.br,se.leg.br,se.net,seaport.museum,search,seat,sebastopol.ua,sec.ps,secure,security,securitytactics.com,seek,seihi.nagasaki.jp,seika.kyoto.jp,seiro.niigata.jp,seirou.niigata.jp,seiyo.ehime.jp,sejny.pl,seki.gifu.jp,sekigahara.gifu.jp,sekikawa.niigata.jp,sel.no,selbu.no,select,selfip.biz,selfip.com,selfip.info,selfip.net,selfip.org,selje.no,seljord.no,sells-for-less.com,sells-for-u.com,sells-it.net,sellsyourhome.org,semboku.akita.jp,semine.miyagi.jp,sendai.jp,sener,sennan.osaka.jp,sensiosite.cloud,seoul.kr,sera.hiroshima.jp,seranishi.hiroshima.jp,servebbs.com,servebbs.net,servebbs.org,servebeer.com,serveblog.net,servecounterstrike.com,serveexchange.com,serveftp.com,serveftp.net,serveftp.org,servegame.com,servegame.org,servehalflife.com,servehttp.com,servehumour.com,serveirc.com,serveminecraft.net,servemp3.com,servep2p.com,servepics.com,servequake.com,servesarcasm.com,service.gov.uk,services,services.aero,ses,setagaya.tokyo.jp,seto.aichi.jp,setouchi.okayama.jp,settlement.museum,settlers.museum,settsu.osaka.jp,sevastopol.ua,seven,sew,sex,sex.hu,sex.pl,sexy,sf.no,sfr,sg,sh,sh.cn,shacknet.nu,shakotan.hokkaido.jp,shangrila,shari.hokkaido.jp,sharp,shaw,shell,shell.museum,sherbrooke.museum,shia,shibata.miyagi.jp,shibata.niigata.jp,shibecha.hokkaido.jp,shibetsu.hokkaido.jp,shibukawa.gunma.jp,shibuya.tokyo.jp,shichikashuku.miyagi.jp,shichinohe.aomori.jp,shiftedit.io,shiga.jp,shiiba.miyazaki.jp,shijonawate.osaka.jp,shika.ishikawa.jp,shikabe.hokkaido.jp,shikama.miyagi.jp,shikaoi.hokkaido.jp,shikatsu.aichi.jp,shiki.saitama.jp,shikokuchuo.ehime.jp,shiksha,shima.mie.jp,shimabara.nagasaki.jp,shimada.shizuoka.jp,shimamaki.hokkaido.jp,shimamoto.osaka.jp,shimane.jp,shimane.shimane.jp,shimizu.hokkaido.jp,shimizu.shizuoka.jp,shimoda.shizuoka.jp,shimodate.ibaraki.jp,shimofusa.chiba.jp,shimogo.fukushima.jp,shimoichi.nara.jp,shimoji.okinawa.jp,shimokawa.hokkaido.jp,shimokitayama.nara.jp,shimonita.gunma.jp,shimonoseki.yamaguchi.jp,shimosuwa.nagano.jp,shimotsuke.tochigi.jp,shimotsuma.ibaraki.jp,shinagawa.tokyo.jp,shinanomachi.nagano.jp,shingo.aomori.jp,shingu.fukuoka.jp,shingu.hyogo.jp,shingu.wakayama.jp,shinichi.hiroshima.jp,shinjo.nara.jp,shinjo.okayama.jp,shinjo.yamagata.jp,shinjuku.tokyo.jp,shinkamigoto.nagasaki.jp,shinonsen.hyogo.jp,shinshinotsu.hokkaido.jp,shinshiro.aichi.jp,shinto.gunma.jp,shintoku.hokkaido.jp,shintomi.miyazaki.jp,shinyoshitomi.fukuoka.jp,shiogama.miyagi.jp,shiojiri.nagano.jp,shioya.tochigi.jp,shirahama.wakayama.jp,shirakawa.fukushima.jp,shirakawa.gifu.jp,shirako.chiba.jp,shiranuka.hokkaido.jp,shiraoi.hokkaido.jp,shiraoka.saitama.jp,shirataka.yamagata.jp,shiriuchi.hokkaido.jp,shiroi.chiba.jp,shiroishi.miyagi.jp,shiroishi.saga.jp,shirosato.ibaraki.jp,shishikui.tokushima.jp,shiso.hyogo.jp,shisui.chiba.jp,shitara.aichi.jp,shiwa.iwate.jp,shizukuishi.iwate.jp,shizuoka.jp,shizuoka.shizuoka.jp,shobara.hiroshima.jp,shoes,shonai.fukuoka.jp,shonai.yamagata.jp,shoo.okayama.jp,shop,shop.ht,shop.hu,shop.pl,shop.ro,shop.th,shopitsite.com,shopping,shouji,show,show.aero,showa.fukushima.jp,showa.gunma.jp,showa.yamanashi.jp,showtime,shriram,shunan.yamaguchi.jp,si,si.eu.org,si.it,sibenik.museum,sic.it,sicilia.it,sicily.it,siellak.no,siena.it,sigdal.no,siljan.no,silk,silk.museum,simple-url.com,sina,sinaapp.com,singles,siracusa.it,sirdal.no,site,site.builder.nu,siteleaf.net,sites.static.land,sj,sjc.br,sk,sk.ca,sk.eu.org,skanit.no,skanland.no,skaun.no,skedsmo.no,skedsmokorset.no,ski,ski.museum,ski.no,skien.no,skierva.no,skiervá.no,skin,skiptvet.no,skjak.no,skjervoy.no,skjervøy.no,skjåk.no,sklep.pl,sko.gov.pl,skoczow.pl,skodje.no,skole.museum,sky,skydiving.aero,skype,skánit.no,skånland.no,sl,slask.pl,slattum.no,sld.do,sld.pa,slg.br,sling,slupsk.pl,slz.br,sm,sm.ua,smart,smile,smola.no,smøla.no,sn,sn.cn,snaase.no,snasa.no,sncf,snillfjord.no,snoasa.no,snåase.no,snåsa.no,so,so.gov.pl,so.it,sobetsu.hokkaido.jp,soc.lk,soc.srcf.net,soccer,sochi.su,social,society.museum,sodegaura.chiba.jp,soeda.fukuoka.jp,softbank,software,software.aero,sogndal.no,sogne.no,sohu,soja.okayama.jp,soka.saitama.jp,sokndal.no,sola.no,solar,sologne.museum,solund.no,solutions,soma.fukushima.jp,somna.no,sondre-land.no,sondrio.it,song,songdalen.no,soni.nara.jp,sony,soo.kagoshima.jp,sopot.pl,sor-aurdal.no,sor-fron.no,sor-odal.no,sor-varanger.no,sorfold.no,sorocaba.br,sorreisa.no,sortland.no,sorum.no,sos.pl,sosa.chiba.jp,sosnowiec.pl,soundandvision.museum,soundcast.me,southcarolina.museum,southwest.museum,sowa.ibaraki.jp,soy,sp.gov.br,sp.it,sp.leg.br,space,space-to-rent.com,space.museum,spacekit.io,spb.ru,spb.su,spdns.de,spdns.eu,spdns.org,spectrum.myjino.ru,spjelkavik.no,sport,sport.hu,spot,spreadbetting,spy.museum,spydeberg.no,square.museum,square7.ch,square7.de,square7.net,sr,sr.gov.pl,sr.it,srl,srt,srv.br,ss.it,ssl.origin.cdn77-secure.org,st,st.no,stackhero-network.com,stada,stadt.museum,stage.nodeart.io,staging.onred.one,stalbans.museum,stalowa-wola.pl,stange.no,staples,star,starachowice.pl,stargard.pl,starhub,starnberg.museum,starostwo.gov.pl,stat.no,state.museum,statebank,statefarm,stateofdelaware.museum,stathelle.no,static-access.net,static.land,statics.cloud,station.museum,stavanger.no,stavern.no,stc,stcgroup,steam.museum,steiermark.museum,steigen.no,steinkjer.no,stg.dev,stjohn.museum,stjordal.no,stjordalshalsen.no,stjørdal.no,stjørdalshalsen.no,stockholm,stockholm.museum,stokke.no,stolos.io,stor-elvdal.no,storage,storage.yandexcloud.net,stord.no,stordal.no,store,store.bb,store.dk,store.nf,store.ro,store.st,store.ve,storfjord.no,storj.farm,stpetersburg.museum,strand.no,stranda.no,stream,stryn.no,student.aero,studio,study,stuff-4-sale.org,stuff-4-sale.us,stufftoread.com,stuttgart.museum,style,su,sucks,sue.fukuoka.jp,suedtirol.it,suginami.tokyo.jp,sugito.saitama.jp,suifu.ibaraki.jp,suisse.museum,suita.osaka.jp,sukagawa.fukushima.jp,sukumo.kochi.jp,sula.no,suldal.no,suli.hu,sumida.tokyo.jp,sumita.iwate.jp,sumoto.hyogo.jp,sumoto.kumamoto.jp,sumy.ua,sunagawa.hokkaido.jp,sund.no,sunndal.no,supplies,supply,support,surf,surgeonshall.museum,surgery,surnadal.no,surrey.museum,susaki.kochi.jp,susono.shizuoka.jp,suwa.nagano.jp,suwalki.pl,suzaka.nagano.jp,suzu.ishikawa.jp,suzuka.mie.jp,suzuki,sv,sv.it,svalbard.no,sveio.no,svelvik.no,svizzera.museum,svn-repos.de,swatch,sweden.museum,sweetpepper.org,swidnica.pl,swidnik.pl,swiebodzin.pl,swiftcover,swinoujscie.pl,swiss,sx,sx.cn,sy,sydney,sydney.museum,sykkylven.no,symantec,syncloud.it,syno-ds.de,synology-diskstation.de,synology-ds.de,synology.me,systems,sytes.net,sz,szczecin.pl,szczytno.pl,szex.hu,szkola.pl,sálat.no,sálát.no,søgne.no,sømna.no,søndre-land.no,sør-aurdal.no,sør-fron.no,sør-odal.no,sør-varanger.no,sørfold.no,sørreisa.no,sørum.no,südtirol.it,t.bg,t.se,t3l3p0rt.net,ta.it,taa.it,tab,tabayama.yamanashi.jp,tabuse.yamaguchi.jp,tachiarai.fukuoka.jp,tachikawa.tokyo.jp,tadaoka.osaka.jp,tado.mie.jp,tadotsu.kagawa.jp,tagajo.miyagi.jp,tagami.niigata.jp,tagawa.fukuoka.jp,tahara.aichi.jp,taifun-dns.de,taiji.wakayama.jp,taiki.hokkaido.jp,taiki.mie.jp,tainai.niigata.jp,taipei,taira.toyama.jp,taishi.hyogo.jp,taishi.osaka.jp,taishin.fukushima.jp,taito.tokyo.jp,taiwa.miyagi.jp,tajimi.gifu.jp,tajiri.osaka.jp,taka.hyogo.jp,takagi.nagano.jp,takahagi.ibaraki.jp,takahama.aichi.jp,takahama.fukui.jp,takaharu.miyazaki.jp,takahashi.okayama.jp,takahata.yamagata.jp,takaishi.osaka.jp,takamatsu.kagawa.jp,takamori.kumamoto.jp,takamori.nagano.jp,takanabe.miyazaki.jp,takanezawa.tochigi.jp,takaoka.toyama.jp,takarazuka.hyogo.jp,takasago.hyogo.jp,takasaki.gunma.jp,takashima.shiga.jp,takasu.hokkaido.jp,takata.fukuoka.jp,takatori.nara.jp,takatsuki.osaka.jp,takatsuki.shiga.jp,takayama.gifu.jp,takayama.gunma.jp,takayama.nagano.jp,takazaki.miyazaki.jp,takehara.hiroshima.jp,taketa.oita.jp,taketomi.okinawa.jp,taki.mie.jp,takikawa.hokkaido.jp,takino.hyogo.jp,takinoue.hokkaido.jp,takko.aomori.jp,tako.chiba.jp,taku.saga.jp,talk,tama.tokyo.jp,tamakawa.fukushima.jp,tamaki.mie.jp,tamamura.gunma.jp,tamano.okayama.jp,tamatsukuri.ibaraki.jp,tamayu.shimane.jp,tamba.hyogo.jp,tana.no,tanabe.kyoto.jp,tanabe.wakayama.jp,tanagura.fukushima.jp,tananger.no,tank.museum,tanohata.iwate.jp,taobao,tara.saga.jp,tarama.okinawa.jp,taranto.it,target,targi.pl,tarnobrzeg.pl,tarui.gifu.jp,tarumizu.kagoshima.jp,tas.au,tas.edu.au,tas.gov.au,tashkent.su,tatamotors,tatar,tatebayashi.gunma.jp,tateshina.nagano.jp,tateyama.chiba.jp,tateyama.toyama.jp,tatsuno.hyogo.jp,tatsuno.nagano.jp,tattoo,tawaramoto.nara.jp,tax,taxi,taxi.br,tc,tc.br,tci,tcm.museum,tcp4.me,td,tdk,te.it,te.ua,teaches-yoga.com,team,tec.mi.us,tec.ve,tech,technology,technology.museum,tecnologia.bo,tel,tel.tr,tele.amune.org,telebit.app,telebit.io,telebit.xyz,telefonica,telekommunikation.museum,television.museum,temasek,temp-dns.com,tempio-olbia.it,tempioolbia.it,tendo.yamagata.jp,tenei.fukushima.jp,tenkawa.nara.jp,tennis,tenri.nara.jp,teo.br,teramo.it,termez.su,terni.it,ternopil.ua,teshikaga.hokkaido.jp,test-iserv.de,test.ru,test.tj,teva,texas.museum,textile.museum,tf,tg,tgory.pl,th,thd,the.br,theater,theater.museum,theatre,theworkpc.com,thingdustdata.com,thruhere.net,tiaa,tickets,tienda,tiffany,time.museum,time.no,timekeeping.museum,tingvoll.no,tinn.no,tips,tires,tirol,tj,tj.cn,tjeldsund.no,tjmaxx,tjome.no,tjx,tjøme.no,tk,tkmaxx,tksat.bo,tl,tm,tm.cy,tm.fr,tm.hu,tm.km,tm.mc,tm.mg,tm.no,tm.pl,tm.ro,tm.se,tm.za,tmall,tmp.br,tn,tn.it,tn.us,to,to.gov.br,to.it,to.leg.br,to.work,toba.mie.jp,tobe.ehime.jp,tobetsu.hokkaido.jp,tobishima.aichi.jp,tochigi.jp,tochigi.tochigi.jp,tochio.niigata.jp,toda.saitama.jp,today,toei.aichi.jp,toga.toyama.jp,togakushi.nagano.jp,togane.chiba.jp,togitsu.nagasaki.jp,togliatti.su,togo.aichi.jp,togura.nagano.jp,tohma.hokkaido.jp,tohnosho.chiba.jp,toho.fukuoka.jp,tokai.aichi.jp,tokai.ibaraki.jp,tokamachi.niigata.jp,tokashiki.okinawa.jp,toki.gifu.jp,tokigawa.saitama.jp,tokke.no,tokoname.aichi.jp,tokorozawa.saitama.jp,tokushima.jp,tokushima.tokushima.jp,tokuyama.yamaguchi.jp,tokyo,tokyo.jp,tolga.no,tomakomai.hokkaido.jp,tomari.hokkaido.jp,tome.miyagi.jp,tomi.nagano.jp,tomigusuku.okinawa.jp,tomika.gifu.jp,tomioka.gunma.jp,tomisato.chiba.jp,tomiya.miyagi.jp,tomobe.ibaraki.jp,tonaki.okinawa.jp,tonami.toyama.jp,tondabayashi.osaka.jp,tone.ibaraki.jp,tono.iwate.jp,tonosho.kagawa.jp,tonsberg.no,tools,toon.ehime.jp,top,topology.museum,torahime.shiga.jp,toray,toride.ibaraki.jp,torino.it,torino.museum,torsken.no,tos.it,tosa.kochi.jp,tosashimizu.kochi.jp,toscana.it,toshiba,toshima.tokyo.jp,tosu.saga.jp,total,tottori.jp,tottori.tottori.jp,touch.museum,tourism.pl,tourism.tn,tours,towada.aomori.jp,town,town.museum,townnews-staging.com,toya.hokkaido.jp,toyako.hokkaido.jp,toyama.jp,toyama.toyama.jp,toyo.kochi.jp,toyoake.aichi.jp,toyohashi.aichi.jp,toyokawa.aichi.jp,toyonaka.osaka.jp,toyone.aichi.jp,toyono.osaka.jp,toyooka.hyogo.jp,toyosato.shiga.jp,toyota,toyota.aichi.jp,toyota.yamaguchi.jp,toyotomi.hokkaido.jp,toyotsu.fukuoka.jp,toyoura.hokkaido.jp,toys,tozawa.yamagata.jp,tozsde.hu,tp.it,tr,tr.eu.org,tr.it,tr.no,tra.kp,trade,trader.aero,trading,trading.aero,traeumtgerade.de,trafficplex.cloud,trainer.aero,training,trana.no,tranby.no,trani-andria-barletta.it,trani-barletta-andria.it,traniandriabarletta.it,tranibarlettaandria.it,tranoy.no,transport.museum,transporte.bo,transurl.be,transurl.eu,transurl.nl,tranøy.no,trapani.it,travel,travel.pl,travel.tt,travelchannel,travelers,travelersinsurance,trd.br,tree.museum,trentin-sud-tirol.it,trentin-sudtirol.it,trentin-sued-tirol.it,trentin-suedtirol.it,trentin-süd-tirol.it,trentin-südtirol.it,trentino-a-adige.it,trentino-aadige.it,trentino-alto-adige.it,trentino-altoadige.it,trentino-s-tirol.it,trentino-stirol.it,trentino-sud-tirol.it,trentino-sudtirol.it,trentino-sued-tirol.it,trentino-suedtirol.it,trentino-süd-tirol.it,trentino-südtirol.it,trentino.it,trentinoa-adige.it,trentinoaadige.it,trentinoalto-adige.it,trentinoaltoadige.it,trentinos-tirol.it,trentinostirol.it,trentinosud-tirol.it,trentinosudtirol.it,trentinosued-tirol.it,trentinosuedtirol.it,trentinosüd-tirol.it,trentinosüdtirol.it,trentinsud-tirol.it,trentinsudtirol.it,trentinsued-tirol.it,trentinsuedtirol.it,trentinsüd-tirol.it,trentinsüdtirol.it,trento.it,treviso.it,trieste.it,triton.zone,troandin.no,trogstad.no,troitsk.su,trolley.museum,tromsa.no,tromso.no,tromsø.no,trondheim.no,trust,trust.museum,trustee.museum,trv,trycloudflare.com,trysil.no,træna.no,trøgstad.no,ts.it,tselinograd.su,tsk.tr,tsu.mie.jp,tsubame.niigata.jp,tsubata.ishikawa.jp,tsubetsu.hokkaido.jp,tsuchiura.ibaraki.jp,tsuga.tochigi.jp,tsugaru.aomori.jp,tsuiki.fukuoka.jp,tsukigata.hokkaido.jp,tsukiyono.gunma.jp,tsukuba.ibaraki.jp,tsukui.kanagawa.jp,tsukumi.oita.jp,tsumagoi.gunma.jp,tsunan.niigata.jp,tsuno.kochi.jp,tsuno.miyazaki.jp,tsuru.yamanashi.jp,tsuruga.fukui.jp,tsurugashima.saitama.jp,tsurugi.ishikawa.jp,tsuruoka.yamagata.jp,tsuruta.aomori.jp,tsushima.aichi.jp,tsushima.nagasaki.jp,tsuwano.shimane.jp,tsuyama.okayama.jp,tt,tt.im,tube,tui,tula.su,tunes,tunk.org,tur.ar,tur.br,turek.pl,turen.tn,turin.it,turystyka.pl,tuscany.it,tushu,tuva.su,tuxfamily.org,tv,tv.bb,tv.bo,tv.br,tv.im,tv.it,tv.na,tv.sd,tv.tr,tv.tz,tvedestrand.no,tvs,tw,tw.cn,twmail.cc,twmail.net,twmail.org,tx.us,tychy.pl,tydal.no,tynset.no,tysfjord.no,tysnes.no,tysvar.no,tysvær.no,tz,tønsberg.no,u.bg,u.se,u2-local.xnbay.com,u2.xnbay.com,ua,ua.rs,ubank,ube.yamaguchi.jp,uber.space,uberspace.de,ubs,uchihara.ibaraki.jp,uchiko.ehime.jp,uchinada.ishikawa.jp,uchinomi.kagawa.jp,uconnect,ud.it,uda.nara.jp,udi.br,udine.it,udono.mie.jp,ueda.nagano.jp,ueno.gunma.jp,uenohara.yamanashi.jp,ufcfan.org,ug,ug.gov.pl,ugim.gov.pl,uhren.museum,ui.nabu.casa,uji.kyoto.jp,ujiie.tochigi.jp,ujitawara.kyoto.jp,uk,uk.com,uk.eu.org,uk.net,uk0.bigv.io,uki.kumamoto.jp,ukiha.fukuoka.jp,uklugs.org,ullensaker.no,ullensvang.no,ulm.museum,ulsan.kr,ulvik.no,um.gov.pl,umaji.kochi.jp,umb.it,umbria.it,umi.fukuoka.jp,umig.gov.pl,unazuki.toyama.jp,undersea.museum,uni5.net,unicom,union.aero,univ.sn,university,university.museum,unjarga.no,unjárga.no,unnan.shimane.jp,uno,unusualperson.com,unzen.nagasaki.jp,uol,uonuma.niigata.jp,uozu.toyama.jp,upow.gov.pl,uppo.gov.pl,ups,urakawa.hokkaido.jp,urasoe.okinawa.jp,urausu.hokkaido.jp,urawa.saitama.jp,urayasu.chiba.jp,urbino-pesaro.it,urbinopesaro.it,ureshino.mie.jp,uri.arpa,url.tw,urn.arpa,uruma.okinawa.jp,uryu.hokkaido.jp,us,us-1.evennode.com,us-2.evennode.com,us-3.evennode.com,us-4.evennode.com,us-east-1.amazonaws.com,us-east-1.elasticbeanstalk.com,us-east-2.elasticbeanstalk.com,us-gov-west-1.elasticbeanstalk.com,us-west-1.elasticbeanstalk.com,us-west-2.elasticbeanstalk.com,us.com,us.eu.org,us.gov.pl,us.na,us.org,usa.museum,usa.oita.jp,usantiques.museum,usarts.museum,uscountryestate.museum,usculture.museum,usdecorativearts.museum,user.aseinet.ne.jp,user.party.eus,user.srcf.net,usercontent.jp,usgarden.museum,ushiku.ibaraki.jp,ushistory.museum,ushuaia.museum,uslivinghistory.museum,usr.cloud.muni.cz,ustka.pl,usui.fukuoka.jp,usuki.oita.jp,ut.us,utah.museum,utashinai.hokkaido.jp,utazas.hu,utazu.kagawa.jp,uto.kumamoto.jp,utsira.no,utsunomiya.tochigi.jp,utwente.io,uvic.museum,uw.gov.pl,uwajima.ehime.jp,uwu.ai,uy,uy.com,uz,uz.ua,uzhgorod.ua,uzs.gov.pl,v-info.info,v.bg,va,va.it,va.no,va.us,vaapste.no,vacations,vadso.no,vadsø.no,vaga.no,vagan.no,vagsoy.no,vaksdal.no,val-d-aosta.it,val-daosta.it,vald-aosta.it,valdaosta.it,valer.hedmark.no,valer.ostfold.no,valle-aosta.it,valle-d-aosta.it,valle-daosta.it,valle.no,valleaosta.it,valled-aosta.it,valledaosta.it,vallee-aoste.it,vallee-d-aoste.it,valleeaoste.it,valleedaoste.it,valley.museum,vallée-aoste.it,vallée-d-aoste.it,valléeaoste.it,valléedaoste.it,vana,vang.no,vanguard,vantaa.museum,vanylven.no,vao.it,vapor.cloud,vaporcloud.io,vardo.no,vardø.no,varese.it,varggat.no,varoy.no,vb.it,vc,vc.it,vda.it,ve,ve.it,vefsn.no,vega.no,vegarshei.no,vegas,vegårshei.no,ven.it,veneto.it,venezia.it,venice.it,vennesla.no,ventures,verbania.it,vercelli.it,verdal.no,verisign,vermögensberater,vermögensberatung,verona.it,verran.no,versailles.museum,versicherung,vestby.no,vestnes.no,vestre-slidre.no,vestre-toten.no,vestvagoy.no,vestvågøy.no,vet,vet.br,veterinaire.fr,veterinaire.km,vevelstad.no,vf.no,vg,vgs.no,vi,vi.it,vi.us,viajes,vibo-valentia.it,vibovalentia.it,vic.au,vic.edu.au,vic.gov.au,vicenza.it,video,video.hu,vig,vik.no,viking,viking.museum,vikna.no,village.museum,villas,vin,vindafjord.no,vinnica.ua,vinnytsia.ua,vip,vipsinaapp.com,virgin,virginia.museum,virtual-user.de,virtual.museum,virtualserver.io,virtualuser.de,virtueeldomein.nl,virtuel.museum,visa,vision,vistaprint,viterbo.it,viva,vivo,vix.br,vlaanderen,vlaanderen.museum,vladikavkaz.ru,vladikavkaz.su,vladimir.ru,vladimir.su,vlog.br,vm.bytemark.co.uk,vn,vn.ua,voagat.no,vodka,volda.no,volkenkunde.museum,volkswagen,vologda.su,volvo,volyn.ua,voorloper.cloud,voss.no,vossevangen.no,vote,voting,voto,voyage,vpndns.net,vpnplus.to,vps.myjino.ru,vr.it,vs.it,vt.it,vt.us,vu,vuelos,vv.it,várggát.no,vågan.no,vågsøy.no,vågå.no,våler.hedmark.no,våler.østfold.no,værøy.no,w.bg,w.se,wa.au,wa.edu.au,wa.gov.au,wa.us,wada.nagano.jp,wafflecell.com,wajiki.tokushima.jp,wajima.ishikawa.jp,wakasa.fukui.jp,wakasa.tottori.jp,wakayama.jp,wakayama.wakayama.jp,wake.okayama.jp,wakkanai.hokkaido.jp,wakuya.miyagi.jp,walbrzych.pl,wales,wales.museum,wallonie.museum,walmart,walter,wang,wanggou,wanouchi.gifu.jp,war.museum,warabi.saitama.jp,warman,warmia.pl,warszawa.pl,washingtondc.museum,washtenaw.mi.us,wassamu.hokkaido.jp,watarai.mie.jp,watari.miyagi.jp,watch,watch-and-clock.museum,watchandclock.museum,watches,waw.pl,wazuka.kyoto.jp,we.bs,weather,weatherchannel,web.app,web.bo,web.co,web.do,web.gu,web.id,web.lk,web.nf,web.ni,web.pk,web.tj,web.tr,web.ve,web.za,webcam,weber,webhare.dev,webhop.biz,webhop.info,webhop.me,webhop.net,webhop.org,webhosting.be,webredirect.org,website,website.yandexcloud.net,webspace.rocks,wed,wedding,wedeploy.io,wedeploy.me,wedeploy.sh,wegrow.pl,weibo,weir,wellbeingzone.co.uk,wellbeingzone.eu,western.museum,westfalen.museum,wf,whaling.museum,whoswho,wi.us,wielun.pl,wien,wif.gov.pl,wiih.gov.pl,wiki,wiki.bo,wiki.br,wildlife.museum,williamhill,williamsburg.museum,win,winb.gov.pl,windmill.museum,windows,wine,winners,wios.gov.pl,witd.gov.pl,withgoogle.com,withyoutube.com,wiw.gov.pl,wlocl.pl,wloclawek.pl,wme,wmflabs.org,wnext.app,wodzislaw.pl,wolomin.pl,wolterskluwer,woodside,work,workers.dev,workinggroup.aero,workisboring.com,works,works.aero,workshop.museum,world,worse-than.tv,wow,wpcomstaging.com,wpdevcloud.com,writesthisblog.com,wroc.pl,wroclaw.pl,ws,ws.na,wsa.gov.pl,wskr.gov.pl,wtc,wtf,wuoz.gov.pl,wv.us,www.ro,wy.us,wzmiuw.gov.pl,x.bg,x.se,x443.pw,xbox,xen.prgmr.com,xenapponazure.com,xerox,xfinity,xihuan,xin,xj.cn,xnbay.com,xs4all.space,xxx,xyz,xz.cn,y.bg,y.se,yabu.hyogo.jp,yabuki.fukushima.jp,yachimata.chiba.jp,yachiyo.chiba.jp,yachiyo.ibaraki.jp,yachts,yaese.okinawa.jp,yahaba.iwate.jp,yahiko.niigata.jp,yahoo,yaita.tochigi.jp,yaizu.shizuoka.jp,yakage.okayama.jp,yakumo.hokkaido.jp,yakumo.shimane.jp,yalta.ua,yamada.fukuoka.jp,yamada.iwate.jp,yamada.toyama.jp,yamaga.kumamoto.jp,yamagata.gifu.jp,yamagata.ibaraki.jp,yamagata.jp,yamagata.nagano.jp,yamagata.yamagata.jp,yamaguchi.jp,yamakita.kanagawa.jp,yamamoto.miyagi.jp,yamanakako.yamanashi.jp,yamanashi.jp,yamanashi.yamanashi.jp,yamanobe.yamagata.jp,yamanouchi.nagano.jp,yamashina.kyoto.jp,yamato.fukushima.jp,yamato.kanagawa.jp,yamato.kumamoto.jp,yamatokoriyama.nara.jp,yamatotakada.nara.jp,yamatsuri.fukushima.jp,yamaxun,yamazoe.nara.jp,yame.fukuoka.jp,yanagawa.fukuoka.jp,yanaizu.fukushima.jp,yandex,yandexcloud.net,yao.osaka.jp,yaotsu.gifu.jp,yasaka.nagano.jp,yashio.saitama.jp,yashiro.hyogo.jp,yasu.shiga.jp,yasuda.kochi.jp,yasugi.shimane.jp,yasuoka.nagano.jp,yatomi.aichi.jp,yatsuka.shimane.jp,yatsushiro.kumamoto.jp,yawara.ibaraki.jp,yawata.kyoto.jp,yawatahama.ehime.jp,yazu.tottori.jp,ybo.faith,ybo.party,ybo.review,ybo.science,ybo.trade,ye,yk.ca,yn.cn,yodobashi,yoga,yoichi.hokkaido.jp,yoita.niigata.jp,yoka.hyogo.jp,yokaichiba.chiba.jp,yokawa.hyogo.jp,yokkaichi.mie.jp,yokohama,yokohama.jp,yokoshibahikari.chiba.jp,yokosuka.kanagawa.jp,yokote.akita.jp,yokoze.saitama.jp,yolasite.com,yombo.me,yomitan.okinawa.jp,yonabaru.okinawa.jp,yonago.tottori.jp,yonaguni.okinawa.jp,yonezawa.yamagata.jp,yono.saitama.jp,yorii.saitama.jp,york.museum,yorkshire.museum,yoro.gifu.jp,yosemite.museum,yoshida.saitama.jp,yoshida.shizuoka.jp,yoshikawa.saitama.jp,yoshimi.saitama.jp,yoshino.nara.jp,yoshinogari.saga.jp,yoshioka.gunma.jp,yotsukaido.chiba.jp,you,youth.museum,youtube,yt,yuasa.wakayama.jp,yufu.oita.jp,yugawa.fukushima.jp,yugawara.kanagawa.jp,yuki.ibaraki.jp,yukuhashi.fukuoka.jp,yun,yura.wakayama.jp,yurihonjo.akita.jp,yusuhara.kochi.jp,yusui.kagoshima.jp,yuu.yamaguchi.jp,yuza.yamagata.jp,yuzawa.niigata.jp,z.bg,z.se,za.bz,za.com,za.net,za.org,zachpomor.pl,zagan.pl,zakopane.pl,zama.kanagawa.jp,zamami.okinawa.jp,zao.miyagi.jp,zaporizhzhe.ua,zaporizhzhia.ua,zappos,zapto.org,zapto.xyz,zara,zarow.pl,zentsuji.kagawa.jp,zero,zgora.pl,zgorzelec.pl,zhitomir.ua,zhytomyr.ua,zip,zj.cn,zlg.br,zm,zone,zone.id,zoological.museum,zoology.museum,zp.gov.pl,zp.ua,zt.ua,zuerich,zushi.kanagawa.jp,zw,ákŋoluokta.no,álaheadju.no,áltá.no,åfjord.no,åkrehamn.no,ål.no,ålesund.no,ålgård.no,åmli.no,åmot.no,årdal.no,ås.no,åseral.no,åsnes.no,øksnes.no,ørland.no,ørskog.no,ørsta.no,østre-toten.no,øvre-eiker.no,øyer.no,øygarden.no,øystre-slidre.no,čáhcesuolo.no,ελ,ак.срб,бг,бел,дети,ею,иком.museum,католик,ком,мкд,мон,москва,обр.срб,од.срб,онлайн,орг,орг.срб,пр.срб,рус,рф,сайт,срб,укр,упр.срб,қаз,հայ,ירושלים.museum,קום,ابوظبي,اتصالات,ارامكو,الاردن,الجزائر,السعودية,السعوديه,السعودیة,السعودیۃ,العليان,المغرب,اليمن,امارات,ايران,ايران.ir,ایران,ایران.ir,بارت,بازار,بيتك,بھارت,تونس,سودان,سوريا,سورية,شبكة,عراق,عرب,عمان,فلسطين,قطر,كاثوليك,كوم,مصر,مليسيا,موبايلي,موقع,همراه,پاكستان,پاکستان,ڀارت,कॉम,नेट,भारत,भारतम्,भारोत,संगठन,বাংলা,ভারত,ভাৰত,ਭਾਰਤ,ભારત,ଭାରତ,இந்தியா,இலங்கை,சிங்கப்பூர்,భారత్,ಭಾರತ,ഭാരതം,ලංකා,คอม,ทหาร.ไทย,ธุรกิจ.ไทย,รัฐบาล.ไทย,ศึกษา.ไทย,องค์กร.ไทย,เน็ต.ไทย,ไทย,გე,みんな,クラウド,グーグル,コム,ストア,セール,ファッション,ポイント,三重.jp,世界,个人.hk,中信,中国,中國,中文网,京都.jp,企业,佐賀.jp,佛山,信息,個人.hk,個人.香港,健康,八卦,公司,公司.cn,公司.hk,公司.香港,公益,兵庫.jp,北海道.jp,千葉.jp,台湾,台灣,和歌山.jp,商城,商店,商标,商業.tw,嘉里,嘉里大酒店,在线,埼玉.jp,大众汽车,大分.jp,大拿,大阪.jp,天主教,奈良.jp,娱乐,宮城.jp,宮崎.jp,家電,富山.jp,山口.jp,山形.jp,山梨.jp,岐阜.jp,岡山.jp,岩手.jp,島根.jp,工行,广东,広島.jp,微博,徳島.jp,愛媛.jp,愛知.jp,慈善,我爱你,手机,手表,招聘,政务,政府,政府.hk,政府.香港,敎育.hk,教育.hk,教育.香港,新加坡,新潟.jp,新闻,时尚,書籍,机构,東京.jp,栃木.jp,沖縄.jp,淡马锡,游戏,滋賀.jp,澳門,澳门,点看,熊本.jp,珠宝,石川.jp,神奈川.jp,福井.jp,福岡.jp,福島.jp,秋田.jp,移动,箇人.hk,組織.hk,組織.tw,組織.香港,組织.hk,網絡.cn,網絡.hk,網絡.香港,網络.hk,網路.tw,组織.hk,组织.hk,组织机构,网址,网店,网站,网絡.hk,网络,网络.cn,网络.hk,群馬.jp,联通,臺灣,茨城.jp,诺基亚,谷歌,购物,通販,長崎.jp,長野.jp,集团,電訊盈科,青森.jp,静岡.jp,飞利浦,食品,餐厅,香川.jp,香格里拉,香港,高知.jp,鳥取.jp,鹿児島.jp,닷넷,닷컴,삼성,한국'

// ========================================================================
// tld.js  (webpack module 9)
// ========================================================================
// https://publicsuffix.org/list/effective_tld_names.dat
import tldData from './tld-data.js'
import {isIPv4} from './util.js'


/** @type {Map<string, string>} */
const mTldCache = new Map()
const mTldSet = new Set(tldData.split(','))

/**
 * @param {string} domain 
 */
function getDomainTld(domain) {
  if (isTld(domain)) {
    return domain
  }
  let pos = 0
  for (;;) {
    // a.b.c -> b.c
    pos = domain.indexOf('.', pos + 1)
    if (pos === -1) {
      return ''
    }
    const str = domain.substr(pos + 1)
    if (isTld(str)) {
      return str
    }
  }
}

/**
 * @param {string} domain 
 */
export function getTld(domain) {
  let ret = mTldCache.get(domain)
  if (ret !== undefined) {
    return ret
  }

  if (isIPv4(domain)) {
    ret = domain
  } else {
    ret = getDomainTld(domain)
  }

  mTldCache.set(domain, ret)
  return ret
}


/**
 * @param {string} domain 
 */
export function isTld(domain) {
  return mTldSet.has(domain)
}

// ========================================================================
// hook.js  (webpack module 1)
// ========================================================================
const {
  getOwnPropertyDescriptor,
  defineProperty,
  apply,
} = Reflect


export const DROP = {}

/**
 * hook function
 * 
 * @param {object} obj 
 * @param {string} key 
 * @param {(oldFn: Function) => Function} factory
 */
export function func(obj, key, factory) {
  /** @type {Function} */
  const oldFn = obj[key]
  if (!oldFn) {
    return false
  }

  const newFn = factory(oldFn)

  Object.keys(oldFn).forEach(k => {
    newFn[k] = oldFn[k]
  })

  const proto = oldFn.prototype
  if (proto) {
    newFn.prototype = proto
  }

  obj[key] = newFn
  return true
}

/**
 * hook property
 * 
 * @param {object} obj 
 * @param {string} key 
 * @param {(oldFn: () => any) => Function=} g 
 * @param {(oldFn: () => void) => Function=} s 
 */
export function prop(obj, key, g, s) {
  const desc = getOwnPropertyDescriptor(obj, key)
  if (!desc) {
    return false
  }
  if (g) {
    func(desc, 'get', g)
  }
  if (s) {
    func(desc, 'set', s)
  }
  defineProperty(obj, key, desc)
  return true
}


/**
 * @param {Window} win WindowOrWorkerGlobalScope
 */
export function createDomHook(win) {
  /**
   * @param {object} proto 
   * @param {string} name 
   * @param {Function} onget 
   * @param {Function} onset 
   */
  function hookElemProp(proto, name, onget, onset) {
    prop(proto, name,
      getter => function() {
        const val = getter.call(this)
        return onget.call(this, val)
      },
      setter => function(val) {
        val = onset.call(this, val)
        if (val === DROP) {
          return
        }
        setter.call(this, val)
      }
    )
  }

  const elemProto = win['Element'].prototype
  const rawGetAttr = elemProto.getAttribute
  const rawSetAttr = elemProto.setAttribute

  const tagAttrHandlersMap = {}
  const tagTextHandlerMap = {}
  const tagKeySetMap = {}
  const tagKeyGetMap = {}

  /**
   * @param {string} tag 
   * @param {object} proto 
   * @param  {...any} handlers 
   */
  function attr(tag, proto, ...handlers) {
    /** @type {boolean} */
    let hasBind

    /** @type {boolean} */
    let hasAttr
    
    let keySetMap
    let keyGetMap

    // TODO: 未考虑上下文
  
    handlers.forEach(v => {
      // 带划线的 attr 属性名，转换成驼峰形式的 prop 属性名。
      // 例如 `http-equiv` -> `httpEquiv`
      const prop = v.name.replace(/-(\w)/g,
        (_, char) => char.toUpperCase()
      )
      hookElemProp(proto, prop, v.onget, v.onset)

      // #text
      if (prop === 'innerText') {
        tagTextHandlerMap[tag] = v
        return
      }

      // attribute
      if (tagAttrHandlersMap[tag]) {
        tagAttrHandlersMap[tag].push(v)
        hasBind = true
      } else {
        tagAttrHandlersMap[tag] = [v]
        tagKeySetMap[tag] = {}
        tagKeyGetMap[tag] = {}
      }

      if (!keySetMap) {
        keySetMap = tagKeySetMap[tag]
        keyGetMap = tagKeyGetMap[tag]
      }
      const key = v.name.toLocaleLowerCase()
      keySetMap[key] = v.onset
      keyGetMap[key] = v.onget
      hasAttr = true
    })

    if (hasBind || !hasAttr) {
      return
    }

    // 如果之前调用过 setAttribute，直接返回上次设置的值；
    // 如果没有调用过，则返回 onget 的回调值。
    func(proto, 'getAttribute', oldFn => function(name) {
      const key = (name + '').toLocaleLowerCase()

      const onget = keyGetMap[key]
      if (!onget) {
        return apply(oldFn, this, arguments)
      }

      const lastVal = this['_k' + key]
      if (lastVal !== undefined) {
        return lastVal
      }
      const val = apply(oldFn, this, arguments)
      return onget.call(this, val)
    })

    func(proto, 'setAttribute', oldFn => function(name, val) {
      const key = (name + '').toLocaleLowerCase()
      const onset = keySetMap[key]
      if (onset) {
        this['_k' + key] = val

        const ret = onset.call(this, val)
        if (ret === DROP) {
          return
        }
        arguments[1] = ret
      }
      return apply(oldFn, this, arguments)
    })

    func(proto, 'setAttributeNode', oldFn => function(node) {
      console.warn('setAttributeNode:', node, this)
      // TODO:
      return apply(oldFn, this, arguments)
    })

    // ...
  }

  /**
   * @param {Node} node
   * @param {object} handler
   * @param {Element} elem 
   */
  function parseNewTextNode(node, handler, elem) {
// console.log('parseTextNode')
    const val = node.nodeValue
    const ret = handler.onset.call(elem, val, true)
    if (ret === DROP) {
      return
    }
    node.nodeValue = ret
  }

  /**
   * @param {Element} elem 
   * @param {object} handler
   */
  function parseNewElemNode(elem, handler) {
    const name = handler.name
    if (!elem.hasAttribute(name)) {
      return
    }
    const val = rawGetAttr.call(elem, name)
    const ret = handler.onset.call(elem, val, true)
    if (ret === DROP) {
      return
    }
    rawSetAttr.call(elem, name, ret)
  }

  
  /**
   * @param {Node} node 
   */
  function addNode(node) {
    const type = node.nodeType
    if (type === 1) {
      /** @type {Element} */
      // @ts-ignore
      const elem = node
      const handlers = tagAttrHandlersMap[elem.tagName]
      handlers && handlers.forEach(v => {
        parseNewElemNode(elem, v)
      })
    }
    else if (type === 3) {
      // TEXT_NODE
      const parent = node.parentElement
      if (parent) {
        const handler = tagTextHandlerMap[parent.tagName]
        if (handler) {
          parseNewTextNode(node, handler, parent)
        }
      }
    }
  }

  /**
   * @param {Node} node 
   */
  function delNode(node) {
    // TODO: 增加节点删除后的回调
  }

  return {
    attr,
    addNode,
    delNode,
  }
}

// ========================================================================
// urlx.js  (webpack module 0)
// ========================================================================
import * as util from './util.js'
import * as env from './env.js'
import * as path from './path.js'
import * as tld from './tld.js'


const PREFIX = path.PREFIX
const PREFIX_LEN = PREFIX.length
const ROOT_LEN = path.ROOT.length

/**
 * @param {string} url 
 */
export function isHttpProto(url) {
  return /^https?:/.test(url)
}


/**
 * @param {string} url 
 */
function isInternalUrl(url) {
  return !isHttpProto(url) || url.startsWith(PREFIX)
}


/**
 * @param {string} url 
 * @param {string | URL=} baseUrl 
 */
export function newUrl(url, baseUrl) {
  try {
    // [safari] baseUrl 不能为空
    return baseUrl
      ? new URL(url, baseUrl)
      : new URL(url)
  } catch (err) {
  }
}


/**
 * @param {URL | Location} urlObj 
 */
export function encUrlObj(urlObj) {
  const fullUrl = urlObj.href
  if (isInternalUrl(fullUrl)) {
    return fullUrl
  }
  return PREFIX + fullUrl
}

const IS_SW = env.isSwEnv()
const IS_WORKER = env.isWorkerEnv()
const WORKER_URL = IS_WORKER && decUrlStrAbs(location.href)

/**
 * @param {string} url 
 * @param {*} relObj 
 */
export function encUrlStrRel(url, relObj) {
  let baseUrl

  if (IS_SW) {
    baseUrl = relObj
  } else if (IS_WORKER) {
    baseUrl = WORKER_URL
  } else {
    const {doc} = env.get(relObj)
    baseUrl = doc.baseURI
  }

  const urlObj = newUrl(url, baseUrl)
  if (!urlObj) {
    return url
  }
  return encUrlObj(urlObj)
}


/**
 * @param {string} url 
 */
export function encUrlStrAbs(url) {
  const urlObj = newUrl(url)
  if (!urlObj) {
    return url
  }
  return encUrlObj(urlObj)
}


/**
 * @param {URL | Location} urlObj 
 */
export function decUrlObj(urlObj) {
  const fullUrl = urlObj.href
  if (!fullUrl.startsWith(PREFIX)) {
    return fullUrl
  }
  return fullUrl.substr(PREFIX_LEN)
}


/**
 * @param {string} url 
 * @param {*} relObj 
 */
export function decUrlStrRel(url, relObj) {
  let baseUrl

  if (IS_WORKER) {
    baseUrl = WORKER_URL
  } else {
    const {doc} = env.get(relObj)
    baseUrl = doc.baseURI
  }

  const urlObj = newUrl(url, baseUrl)
  if (!urlObj) {
    return url
  }
  return decUrlObj(urlObj)
}


/**
 * @param {string} url 
 */
export function decUrlStrAbs(url) {
  const urlObj = newUrl(url)
  if (!urlObj) {
    return url
  }
  return decUrlObj(urlObj)
}



/**
 * @param {string} url 
 */
export function delHash(url) {
  const p = url.indexOf('#')
  return (p === -1) ? url : url.substr(0, p)
}


/**
 * @param {string} url 
 */
export function delScheme(url) {
  const p = url.indexOf('://')
  return (p === -1) ? url : url.substr(p + 3)
}


/**
 * @param {string} val 
 */
export function replaceHttpRefresh(val, relObj) {
  return val.replace(/(;\s*url=)(.+)/i, (_, $1, url) => {
    return $1 + encUrlStrRel(url, relObj)
  })
}


/**
 * URL 导航调整
 * 
 * 标准
 *  https://example.com/-----https://www.google.com/
 * 
 * 无路径
 *  https://example.com/-----https://www.google.com
 * 
 * 无协议
 *  https://example.com/-----www.google.com
 * 
 * 任意数量的分隔符
 *  https://example.com/---https://www.google.com
 *  https://example.com/---------https://www.google.com
 *  https://example.com/https://www.google.com
 * 
 * 重复
 *  https://example.com/-----https://example.com/-----https://www.google.com
 * 
 * 别名
 *  https://example.com/google
 * 
 * 
 * 搜索
 *  https://example.com/-----xxx
 *  ->
 *  https://www.google.com/search?q=xxx
 */
const DEFAULT_ALIAS = {
  'www.google.com': ['google', 'gg', 'g'],
  'www.youtube.com': ['youtube', 'yt', 'y'],
  'www.wikipedia.org': ['wikipedia', 'wiki', 'wk', 'w'],
  'www.facebook.com': ['facebook', 'fb', 'f'],
  'twitter.com': ['twitter', 'tw', 't'],
}

const DEFAULT_SEARCH = 'https://www.google.com/search?q=%s'

/** @type {Map<string, string>} */
let aliasDomainMap

/**
 * @param {string} alias 
 */
function getAliasUrl(alias) {
  if (!aliasDomainMap) {
    aliasDomainMap = new Map()
    for (const [domain, aliasArr] of Object.entries(DEFAULT_ALIAS)) {
      for (const v of aliasArr) {
        aliasDomainMap.set(v, domain)
      }
    }
  }
  
  const domain = aliasDomainMap.get(alias)
  if (domain) {
    return 'https://' + domain + '/'
  }
}


/**
 * @param {string} part 
 */
function padUrl(part) {
  // TODO: HSTS
  const urlStr = isHttpProto(part) ? part : `http://${part}`
  const urlObj = newUrl(urlStr)
  if (!urlObj) {
    return
  }
  const {hostname} = urlObj

  // http://localhost
  if (!hostname.includes('.')) {
    return
  }

  // http://a.b
  if (!tld.getTld(hostname)) {
    return
  }

  // 数字会被当做 IP 地址:
  // new URL('http://1024').href == 'http://0.0.4.0'
  // 这种情况应该搜索，而不是访问
  // 只有出现完整的 IP 才访问
  if (util.isIPv4(hostname) && !urlStr.includes(hostname)) {
    return
  }

  return urlObj.href
}


/**
 * @param {string} urlStr
 */
export function adjustNav(urlStr) {
  // 分隔符 `-----` 之后的部分
  const rawUrlStr = urlStr.substr(PREFIX_LEN)
  const rawUrlObj = newUrl(rawUrlStr)

  if (rawUrlObj) {
    // 循环引用
    const m = rawUrlStr.match(/\/-----(https?:\/\/.+)$/)
    if (m) {
      return PREFIX + m[1]
    }
    // 标准格式（大概率）
    if (isHttpProto(rawUrlObj.protocol) &&
        PREFIX + rawUrlObj.href === urlStr
    ) {
      return
    }
  }

  // 任意数量 `-` 之后的部分
  const part = urlStr.substr(ROOT_LEN).replace(/^-*/, '')

  const ret = getAliasUrl(part) || padUrl(part)
  if (ret) {
    return PREFIX + ret
  }

  const keyword = part.replace(/&/g, '%26')
  return PREFIX + DEFAULT_SEARCH.replace('%s', keyword)
}

// ========================================================================
// cookie.js  (webpack module 6)
// ========================================================================
import {Database} from './database.js'

/** @type {Set<Cookie>} */
let mDirtySet = new Set()


function Cookie() {
  this.id = ''
  this.name = ''
  this.value = ''
  this.domain = ''
  this.hostOnly = false
  this.path = ''
  this.expires = NaN
  this.isExpired = false
  this.secure = false
  this.httpOnly = false
  this.sameSite = ''
}

/**
 * @param {Cookie} src 
 * @param {Cookie} dst 
 */
function copy(dst, src) {
  dst.id = src.id
  dst.name = src.name
  dst.value = src.value
  dst.domain = src.domain
  dst.hostOnly = src.hostOnly
  dst.path = src.path
  dst.expires = src.expires
  dst.isExpired = src.isExpired
  dst.secure = src.secure
  dst.httpOnly = src.httpOnly
  dst.sameSite = src.sameSite
}


/**
 * @param {string} cookiePath 
 * @param {string} urlPath 
 */
function isSubPath(cookiePath, urlPath) {
  if (urlPath === cookiePath) {
    return true
  }
  if (!cookiePath.endsWith('/')) {
    cookiePath += '/'
  }
  return urlPath.startsWith(cookiePath)
}


/**
 * @param {string} cookieDomain 
 * @param {string} urlDomain 
 */
function isSubDomain(cookieDomain, urlDomain) {
  return urlDomain === cookieDomain ||
    urlDomain.endsWith('.' + cookieDomain)
}


/**
 * @param {Cookie} item 
 * @param {number} now
 */
function isExpire(item, now) {
  const v = item.expires
  return !isNaN(v) && v < now
}


class CookieDomainNode {
  constructor() {
    /** @type {Cookie[]} */
    this.items = null

    /** @type {Object<string, CookieDomainNode>} */
    this.children = {}
  }

  /**
   * @param {string} name 
   */
  nextChild(name) {
    return this.children[name] || (
      this.children[name] = new CookieDomainNode
    )
  }

  /**
   * @param {string} name 
   */
  getChild(name) {
    return this.children[name]
  }

  /**
   * @param {Cookie} cookie 
   */
  addCookie(cookie) {
    if (this.items) {
      this.items.push(cookie)
    } else {
      this.items = [cookie]
    }
  }
}

/** @type {Map<string, Cookie>} */
const mIdCookieMap = new Map()

const mCookieNodeRoot = new CookieDomainNode()



export function getNonHttpOnlyItems() {
  const ret = []
  for (const item of mIdCookieMap.values()) {
    if (!item.httpOnly) {
      ret.push(item)
    }
  }
  return ret
}


/**
 * @param {string} str 
 * @param {URL} urlObj 
 * @param {number} now 
 */
export function parse(str, urlObj, now) {
  const item = new Cookie()
  const arr = str.split(';')

  for (let i = 0; i < arr.length; i++) {
    let key, val
    const s = arr[i].trim()
    const p = s.indexOf('=')

    if (p !== -1) {
      key = s.substr(0, p)
      val = s.substr(p + 1)
    } else {
      //
      // cookie = 's; secure; httponly'
      //  0: { key: '', val: 's' }
      //  1: { key: 'secure', val: '' }
      //  2: { key: 'httponly', val: '' }
      //
      key = (i === 0) ? '' : s
      val = (i === 0) ? s : ''
    }

    if (i === 0) {
      item.name = key
      item.value = val
      continue
    }

    switch (key.toLocaleLowerCase()) {
    case 'expires':
      if (isNaN(item.expires)) {
        item.expires = Date.parse(val)
      }
      break
    case 'domain':
      if (val[0] === '.') {
        val = val.substr(1)
      }
      item.domain = val
      break
    case 'path':
      item.path = val
      break
    case 'httponly':
      item.httpOnly = true
      break
    case 'secure':
      item.secure = true
      break
    case 'max-age':
      item.expires = now + (+val) * 1000
      break
    case 'samesite':
      item.sameSite = val
      break
    }
  }

  if (isExpire(item, now)) {
    item.isExpired = true
  }

  // https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Set-Cookie
  if (item.name.startsWith('__Secure-')) {
    if (!(
      urlObj.protocol === 'https:' &&
      item.secure
    )) {
      return
    }
  }
  if (item.name.startsWith('__Host-')) {
    if (!(
      urlObj.protocol === 'https:' &&
      item.secure &&
      item.domain === '' &&
      item.path === '/'
    )) {
      return
    }
  }

  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#Compatibility_notes
  if (item.secure && urlObj.protocol === 'http:') {
    return
  }

  // check hostname
  const domain = urlObj.hostname

  if (item.domain) {
    if (!isSubDomain(item.domain, domain)) {
      console.warn('[jsproxy] invalid cookie domain! `%s` ⊄ `%s`',
        item.domain, domain)
      return
    }
  } else {
    item.domain = domain
    item.hostOnly = true
  }

  // check pathname
  const path = urlObj.pathname

  if (item.path) {
    if (!isSubPath(item.path, path)) {
      console.warn('[jsproxy] invalid cookie path! `%s` ⊄ `%s`',
        item.path, path)
      return
    }
  } else {
    item.path = path
  }

  item.id = (item.secure ? ';' : '') +
    item.name + ';' +
    item.domain +
    item.path

  return item
}


/**
 * @param {Cookie} item
 */
export function set(item) {
  // console.log('set:', item)
  const id = item.id
  const matched = mIdCookieMap.get(id)

  if (matched) {
    if (item.isExpired) {
      // delete
      mIdCookieMap.delete(id)
      matched.isExpired = true
      // TODO: remove node
    } else {
      // update
      copy(matched, item)
    }
    mDirtySet.add(matched)
  } else {
    // create
    const labels = item.domain.split('.')
    let labelPos = labels.length
    let node = mCookieNodeRoot
    do {
      node = node.nextChild(labels[--labelPos])
    } while (labelPos !== 0)
  
    node.addCookie(item)
    mIdCookieMap.set(id, item)

    mDirtySet.add(item)
  }
}


/**
 * @param {URL} urlObj 
 */
export function query(urlObj) {
  const ret = []
  const now = Date.now()
  const domain = urlObj.hostname
  const path = urlObj.pathname
  const isHttps = (urlObj.protocol === 'https:')

  const labels = domain.split('.')
  let labelPos = labels.length
  let node = mCookieNodeRoot

  do {
    node = node.getChild(labels[--labelPos])
    if (!node) {
      break
    }
    const items = node.items
    if (!items) {
      continue
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      // https url | secure flag | carry
      //   ✔       |   ✔         |   ✔
      //   ✔       |   ✘         |   ✔
      //   ✘       |   ✘         |   ✔
      //   ✘       |   ✔         |   ✘
      if (!isHttps && item.secure) {
        continue
      }
      // HostOnly Cookie 需匹配完整域名
      if (item.hostOnly && labelPos !== 0) {
        continue
      }
      if (!isSubPath(item.path, path)) {
        continue
      }
      if (item.isExpired) {
        continue
      }
      if (isExpire(item, now)) {
        item.isExpired = true
        continue
      }
      // TODO: same site

      let str = item.value
      if (item.name) {
        str = item.name + '=' + str
      }
      ret.push(str)
    }
  } while (labelPos !== 0)

  return ret.join('; ')
}


/** @type {Database} */
let mDB

export async function setDB(db) {
  mDB = db

  const now = Date.now()
  await mDB.enum('cookie', v => {
    if (isExpire(v, now)) {
      mDB.delete('cookie', v.id)
    } else {
      set(v)
    }
    return true
  })

  setInterval(save, 1000 * 3)
}


export async function save() {
  if (mDirtySet.size === 0) {
    return
  }

  const tmp = mDirtySet
  mDirtySet = new Set()

  for (const item of tmp) {
    if (item.isExpired) {
      await mDB.delete('cookie', item.id)
    } else if (!isNaN(item.expires)) {
      // 不保存 session cookie
      await mDB.put('cookie', item)
    }
  }
}

// ========================================================================
// database.js  (webpack module 11)
// ========================================================================
import {Signal} from './signal.js'


export class Database {
  /**
   * @param {string} name 
   */
  constructor(name) {
    this._name = name

    /** @type {IDBDatabase} */
    this._db = null
  }

  /**
   * @param {string} table 
   * @param {IDBTransactionMode} mode 
   */
  _getStore(table, mode) {
    return this._db
      .transaction(table, mode)
      .objectStore(table)
  }

  /**
   * @param {Object<string, IDBObjectStoreParameters>} opts 
   */
  open(opts) {
    const s = new Signal()
    const req = indexedDB.open(this._name)

    req.onsuccess = (e) => {
      const idb = req.result
      this._db = idb

      idb.onclose = (e) => {
        console.warn('[jsproxy] indexedDB disconnected, reopen...')
        this.open(opts)
      }
      s.notify()
    }
    req.onerror = (e) => {
      console.warn('req.onerror:', e)
      s.abort(req.error)
    }
    req.onupgradeneeded = (e) => {
      const idb = req.result
      for (const [k, v] of Object.entries(opts)) {
        idb.createObjectStore(k, v)
      }
    }
    return s.wait()
  }


  close() {
    this._db.close()
  }

  /**
   * @param {string} table 
   * @param {any} key 
   */
  get(table, key) {
    const s = new Signal()
    const obj = this._getStore(table, 'readonly')
    const req = obj.get(key)

    req.onsuccess = (e) => {
      s.notify(req.result)
    }
    req.onerror = (e) => {
      s.abort(req.error)
    }
    return s.wait()
  }

  /**
   * @param {string} table 
   * @param {any} record 
   */
  put(table, record) {
    const s = new Signal()
    const obj = this._getStore(table, 'readwrite')
    const req = obj.put(record)

    req.onsuccess = (e) => {
      s.notify()
    }
    req.onerror = (e) => {
      s.abort(req.error)
    }
    return s.wait()
  }

  /**
   * @param {string} table 
   * @param {any} key 
   */
  delete(table, key) {
    const s = new Signal()
    const obj = this._getStore(table, 'readwrite')
    const req = obj.delete(key)

    req.onsuccess = (e) => {
      s.notify()
    }
    req.onerror = (e) => {
      s.abort(req.error)
    }
    return s.wait()
  }

  /**
   * @param {string} table 
   * @param {(any) => boolean} callback 
   */
  enum(table, callback, ...args) {
    const s = new Signal()
    const obj = this._getStore(table, 'readonly')
    const req = obj.openCursor(...args)

    req.onsuccess = (e) => {
      const {result} = req
      if (result) {
        if (callback(result.value) !== false) {
          result.continue()
        }
      } else {
        s.notify()
      }
    }
    req.onerror = (e) => {
      s.abort(req.error)
    }
    return s.wait()
  }
}

// ========================================================================
// route.js  (webpack module 7)
// ========================================================================
import * as urlx from './urlx.js'
import * as util from './util'


let mConf
let mNodeLinesMap

/**
 * @param {number} urlHash 
 * @param {string} id 
 * @returns {string}
 */
function getHostByNodeId(urlHash, id) {
  let a = 0
  for (const {weight, host} of mNodeLinesMap[id]) {
    if ((a += weight) > urlHash) {
      return host
    }
  }
}


/**
 * @param {string} host 
 */
function isLocalhost(host) {
  return /^(localhost|127\.\d+\.\d+\.\d+)([:/]|$)/.test(host)
}


/**
 * @param {string} host 
 * @param {string} scheme 
 */
export function genUrl(host, scheme) {
  const s = isLocalhost(host) ? '' : 's'
  return `${scheme}${s}://${host}/${scheme}`
}


/**
 * @param {number} urlHash 
 * @param {number} level 
 */
export function getHost(urlHash, level) {
  let node = mConf.node_default

  // 实验中...
  if (level === 2) {
    node = mConf.node_acc
  }

  return getHostByNodeId(urlHash, node)
}


// export function setFailHost(host) {

// }


/**
 * @param {URL} urlObj 
 * @param {Object<string, string>} args 
 */
export function genWsUrl(urlObj, args) {
  let scheme = 'https'

  switch (urlObj.protocol) {
  case 'wss:':
    break
  case 'ws:':
    scheme = 'http'
    break
  default:
    return null
  }

  const t = urlx.delScheme(urlx.delHash(urlObj.href))

  args['url__'] = scheme + '://' + t
  args['ver__'] = mConf.ver

  const urlHash = util.strHash(urlObj.href)
  const host = getHostByNodeId(urlHash, mConf.node_default)
  return genUrl(host, 'ws') + '?' + new URLSearchParams(args)
}


/**
 * @param {object} conf 
 */
export function setConf(conf) {
  mConf = conf
  mNodeLinesMap = {}

  for (const [id, info] of Object.entries(conf.node_map)) {
    const lines = []
    let weightSum = 0

    for (const [host, weight] of Object.entries(info.lines)) { 
      weightSum += weight
      lines.push({host, weight})
    }

    // 权重值按比例转换成 0 ~ 2^32 之间的整数，方便后续计算
    for (const v of lines) {
      v.weight = (v.weight / weightSum * 0xFFFFFFFF) >>> 0
    }
    lines.sort((a, b) => b.weight - a.weight)

    mNodeLinesMap[id] = lines
  }
}

// ========================================================================
// jsfilter.js  (webpack module 10)
// ========================================================================
import * as util from './util.js'


/**
 * @param {string} code 
 */
export function parseStr(code) {
  // TODO: parse js ast
  let match = false

  code = code.replace(/(\b)location(\b)/g, (_, $1, $2) => {
    match = true
    return $1 + '__location' + $2
  })
  code = code.replace(/postMessage\s*\(/g, s => {
    match = true
    return s + `...(self.__set_srcWin?__set_srcWin():[]), `
  })
  if (match) {
    return code
  }
  return null
}

/**
 * @param {Uint8Array} buf
 * @param {string} charset
 */
export function parseBin(buf, charset) {
  const str = util.bytesToStr(buf, charset)
  const ret = parseStr(str)
  if (ret !== null) {
    return util.strToBytes(ret)
  }
  if (charset && !util.isUtf8(charset)) {
    return util.strToBytes(str)
  }
  return null
}

// ========================================================================
// storage.js  (webpack module 12)
// 与 client.js、fakeloc.js 合并为 module 12
// ========================================================================
import * as hook from './hook.js'
import * as urlx from './urlx.js'


const {
  apply,
  defineProperty,
  ownKeys,
  getOwnPropertyDescriptor,
} = Reflect

const undefined = void 0


/**
 * @param {WindowOrWorkerGlobalScope} win 
 * @param {string} name 
 * @param {string} prefix 
 */
function setup(win, name, prefix) {
  /** @type {Storage} */
  const raw = win[name]
  if (!raw) {
    return
  }
  const prefixLen = prefix.length

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
  
  /**
   * @param {*} key 
   */
  function getItem(key) {
    return raw.getItem(prefix + key)
  }

  /**
   * @param {*} key 
   * @param {string} val 
   */
  function setItem(key, val) {
    // TODO: 同步到 indexedDB
    raw.setItem(prefix + key, val)
  }

  /**
   * @param {*} key 
   */
  function removeItem(key) {
    return raw.removeItem(prefix + key)
  }

  function clear() {
    getAllKeys().forEach(removeItem)
  }

  /**
   * @param {*} val
   */
  function key(val) {
    // TODO: 无需遍历所有
    const arr = getAllKeys()
    const ret = arr[val | 0]
    if (ret === undefined) {
      return null
    }
    return ret
  }


  /**
   * @returns {string[]}
   */
  function getAllKeys() {
    const ret = []
    const keys = ownKeys(raw)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      if (typeof key !== 'string') {
        continue
      }
      if (!key.startsWith(prefix)) {
        continue
      }
      ret.push(key.substr(prefixLen))
    }
    return ret
  }

  const storage = new Proxy(raw, {
    get(obj, key) {
      const val = nativeMap[key]
      if (val !== undefined) {
        return val
      }
      console.log('[jsproxy] %s get: %s', name, key)
      const ret = getItem(key)
      if (ret === null) {
        return undefined
      }
      return ret
    },
    set(obj, key, val) {
      if (key in nativeMap) {
        nativeMap[key] = val
        return
      }
      console.log('[jsproxy] %s set: %s = %s', name, key, val)
      setItem(key, val)
      return true
    },
    deleteProperty(obj, key) {
      console.log('[jsproxy] %s del: %s', name, key)
      removeItem(key)
      return true
    },
    has(obj, key) {
      console.log('[jsproxy] %s has: %s', name, key)
      if (typeof key === 'string') {
        return (prefix + key) in obj
      }
      return false
    },
    // enumerate(obj) {
    //   console.log('[jsproxy] %s enumerate: %s', name)
    //   // TODO:
    // },
    ownKeys(obj) {
      // console.log('[jsproxy] %s ownKeys', name)
      return getAllKeys()
    },
    // defineProperty(obj, key, desc) {
    //   // console.log('[jsproxy] %s defineProperty: %s', name, key)
    //   // TODO:
    // },
    getOwnPropertyDescriptor(obj, key) {
      // console.log('[jsproxy] %s getOwnPropertyDescriptor: %s', name, key)
      if (typeof key === 'string') {
        return getOwnPropertyDescriptor(raw, prefix + key)
      }
    }
  })

  defineProperty(win, name, {value: storage})
}


/**
 * @param {WindowOrWorkerGlobalScope} global 
 * @param {string} origin 
 */
export function createStorage(global, origin) {
  const prefixStr = origin + '$'
  const prefixLen = prefixStr.length


  function delPrefix(str) {
    return str.substr(prefixLen)
  }

  function delPrefixGetter(oldFn) {
    return function() {
      const val = oldFn.call(this)
      return val && delPrefix(val)
    }
  }

  //
  // Web Storage
  //
  setup(global, 'localStorage', prefixStr)
  setup(global, 'sessionStorage', prefixStr)

  const StorageEventProto = global['StorageEvent'].prototype

  hook.prop(StorageEventProto, 'key', delPrefixGetter)
  hook.prop(StorageEventProto, 'url',
    getter => function() {
      const val = getter.call(this)
      return urlx.decUrlStrAbs(val)
    }
  )
  // TODO: StorageEventProto.storageArea

  //
  // Storage API
  //
  function addPrefixHook(oldFn) {
    return function(name) {
      if (arguments.length > 0) {
        arguments[0] = prefixStr + name
      }
      return apply(oldFn, this, arguments)
    }
  }

  // indexedDB
  const IDBFactoryProto = global['IDBFactory'].prototype
  hook.func(IDBFactoryProto, 'open', addPrefixHook)

  hook.func(IDBFactoryProto, 'databases', oldFn => async function() {
    /** @type { {name: string, version: number}[] } */
    const arr = await apply(oldFn, this, arguments)
    const ret = []
    for (const v of arr) {
      if (v.name[0] !== '.') {
        v.name = delPrefix(v.name)
        ret.push(v)
      }
    }
    return ret
  })

  // delete
  hook.func(IDBFactoryProto, 'deleteDatabase', addPrefixHook)

  const IDBDatabaseProto = global['IDBDatabase'].prototype
  hook.prop(IDBDatabaseProto, 'name', delPrefixGetter)


  // Cache Storage
  const cacheStorageProto = global['CacheStorage'].prototype
  hook.func(cacheStorageProto, 'open', addPrefixHook)

  hook.func(cacheStorageProto, 'keys', oldFn => async function() {
    /** @type {string[]} */
    const arr = await apply(oldFn, this, arguments)
    const ret = []
    for (const v of arr) {
      if (v[0] !== '.') {
        ret.push(delPrefix(v))
      }
    }
    return ret
  })

  hook.func(cacheStorageProto, 'delete', addPrefixHook)

  // WebSQL
  hook.func(global, 'openDatabase', addPrefixHook)
}

// ========================================================================
// fakeloc.js  (webpack module 12)
// ========================================================================
import * as urlx from "./urlx";

const {
  defineProperty,
  setPrototypeOf,
} = Object


function setup(obj, fakeLoc) {
  defineProperty(obj, '__location', {
    get() {
      return fakeLoc
    },
    set(val) {
      console.log('[jsproxy] %s set location: %s', obj, val)
      fakeLoc.href = val
    }
  })
}


/**
 * @param {Window} global  WindowOrWorkerGlobalScope
 */
export function createFakeLoc(global) {
  const location = global.location
  let ancestorOrigins

  /**
   * @param {Location | URL} loc 
   */
  function getPageUrlObj(loc) {
    return new URL(urlx.decUrlObj(loc))
  }


  // 不缓存 location 属性，因为 beforeunload 事件会影响赋值
  const locObj = {
    get href() {
      // console.log('[jsproxy] get location.href')
      return getPageUrlObj(location).href
    },

    // TODO: 精简合并
    get protocol() {
      return getPageUrlObj(location).protocol
    },

    get host() {
      return getPageUrlObj(location).host
    },

    get hostname() {
      return getPageUrlObj(location).hostname
    },

    get port() {
      return getPageUrlObj(location).port
    },

    get pathname() {
      return getPageUrlObj(location).pathname
    },

    get search() {
      return getPageUrlObj(location).search
    },

    get hash() {
      return getPageUrlObj(location).hash
    },

    get origin() {
      return getPageUrlObj(location).origin
    },

    toString() {
      return this.href
    },

    toLocaleString() {
      return this.href
    },

    // TODO: Worker 中没有以下属性
    get ancestorOrigins() {
      if (!ancestorOrigins) {
        // TODO: DOMStringList[]
        ancestorOrigins = []

        let p = global
        while ((p = p.parent) !== top) {
          const u = getPageUrlObj(p.location)
          ancestorOrigins.unshift(u.origin)
        }
      }
      return ancestorOrigins
    },

    set href(val) {
      console.log('[jsproxy] set location.href:', val)
      location.href = urlx.encUrlStrRel(val, this)
    },

    set protocol(val) {
      console.log('[jsproxy] set location.protocol:', val)
      const urlObj = getPageUrlObj(location)
      urlObj.href = val
      location.href = urlx.encUrlObj(urlObj)
    },

    set host(val) {
      console.log('[jsproxy] set location.host:', val)
      const urlObj = getPageUrlObj(location)
      urlObj.host = val
      location.href = urlx.encUrlObj(urlObj)
    },

    set hostname(val) {
      console.log('[jsproxy] set location.hostname:', val)
      const urlObj = getPageUrlObj(location)
      urlObj.hostname = val
      location.href = urlx.encUrlObj(urlObj)
    },

    set port(val) {
      console.log('[jsproxy] set location.port:', val)
      const urlObj = getPageUrlObj(location)
      urlObj.port = val
      location.href = urlx.encUrlObj(urlObj)
    },

    set pathname(val) {
      console.log('[jsproxy] set location.pathname:', val)
      const urlObj = getPageUrlObj(location)
      urlObj.pathname = val
      location.href = urlx.encUrlObj(urlObj)
    },

    set search(val) {
      location.search = val
    },

    set hash(val) {
      location.hash = val
    },

    reload() {
      console.warn('[jsproxy] location.reload')
      // @ts-ignore
      return location.reload(...arguments)
    },

    replace(val) {
      if (val) {
        console.warn('[jsproxy] location.replace:', val)
        arguments[0] = urlx.encUrlStrRel(val, this)
      }
      // @ts-ignore
      return location.replace(...arguments)
    },

    assign(val) {
      if (val) {
        console.warn('[jsproxy] location.assign:', val)
        arguments[0] = urlx.encUrlStrRel(val, this)
      }
      // @ts-ignore
      return location.assign(...arguments)
    },
  }

  const locProto = location.constructor.prototype
  const fakeLoc = setPrototypeOf(locObj, locProto)
  setup(global, fakeLoc)

  // 非 Worker 环境
  const Document = global['Document']
  if (Document) {
    // TODO: document.hasOwnProperty('location') 原本是 true
    setup(Document.prototype, fakeLoc)
  }

  return fakeLoc
}

// ========================================================================
// client.js  (webpack module 12)
// ========================================================================
import * as urlx from './urlx.js'
import * as route from './route.js'
import * as env from './env.js'
import * as hook from './hook.js'
import {createFakeLoc} from './fakeloc.js'
import {createStorage} from './storage.js'


const {
  apply,
  construct,
} = Reflect


/**
 * Hook 页面和 Worker 相同的 API
 * 
 * @param {Window} global WindowOrWorkerGlobalScope
 * @param {string} origin 
 */
export function init(global, origin) {
  // lockNative(win)

  // hook Storage API
  createStorage(global, origin)

  // hook Location API
  const fakeLoc = createFakeLoc(global)

  // hook Performance API
  const perfProto = global['PerformanceEntry'].prototype
  hook.prop(perfProto, 'name',
    getter => function() {
      const val = getter.call(this)
      if (/^https?:/.test(val)) {
        return urlx.decUrlStrAbs(val)
      }
      return val
    }
  )


  // hook AJAX API
  const xhrProto = global['XMLHttpRequest'].prototype
  hook.func(xhrProto, 'open', oldFn => function(_0, url) {
    if (url) {
      arguments[1] = urlx.encUrlStrRel(url, this)
    }
    return apply(oldFn, this, arguments)
  })

  hook.prop(xhrProto, 'responseURL',
    getter => function(oldFn) {
      const val = getter.call(this)
      return urlx.decUrlStrRel(val, this)
    }
  )


  hook.func(global, 'fetch', oldFn => function(v) {
    if (v) {
      if (v.url) {
        // v is Request
        const newUrl = urlx.encUrlStrAbs(v.url)
        arguments[0] = new Request(newUrl, v)
      } else {
        // v is string
        // TODO: 字符串不传引用，无法获取创建时的 constructor
        arguments[0] = urlx.encUrlStrRel(v, v)
      }
    }
    return apply(oldFn, this, arguments)
  })


  hook.func(global, 'WebSocket', oldFn => function(url) {
    const urlObj = urlx.newUrl(url)
    if (urlObj) {
      const {ori} = env.get(this)
      if (ori) {
        const args = {
          'origin': ori.origin,
        }
        arguments[0] = route.genWsUrl(urlObj, args)
      }
    }
    return construct(oldFn, arguments)
  })

  /**
   * @param {string} type 
   */
  function hookWorker(type) {
    hook.func(global, type, oldFn => function(url) {
      if (url) {
        console.log('[jsproxy] new %s: %s', type, url)
        arguments[0] = urlx.encUrlStrRel(url, this)
      }
      return construct(oldFn, arguments)
    })
  }
  
  hookWorker('Worker')
  hookWorker('SharedWorker')


  hook.func(global, 'importScripts', oldFn => function(...args) {
    const urls = args.map(urlx.encUrlStrRel)
    console.log('[jsproxy] importScripts:', urls)
    return apply(oldFn, this, urls)
  })
}

// ========================================================================
// page.js  (webpack module 14)
// ========================================================================
import * as MSG from './msg.js'
import * as route from './route.js'
import * as util from './util.js'
import * as urlx from './urlx.js'
import * as hook from './hook.js'
import * as cookie from './cookie.js'
import * as jsfilter from './jsfilter.js'
import * as env from './env.js'
import * as client from './client.js'


const {
  apply,
} = Reflect


function initDoc(win, domHook) {
  const document = win.document

  const headElem = document.head
  const baseElemList = document.getElementsByTagName('base')
  const baseElem = baseElemList[0]
  
  document.__baseElem = baseElem

  //
  // 监控元素创建和删除
  //
  const nodeSet = new WeakSet()

  function onNodeAdd(node) {
    if (nodeSet.has(node)) {
      return
    }
    nodeSet.add(node)
    
    const nodes = node.childNodes
    for (let i = 0, n = nodes.length; i < n; i++) {
      onNodeAdd(nodes[i])
    }
    domHook.addNode(node)
  }


  function onNodeDel(node) {
    nodeSet.delete(node)

    const nodes = node.childNodes
    for (let i = 0, n = nodes.length; i < n; i++) {
      onNodeDel(nodes[i])
    }
    domHook.delNode(node)

    // TODO: 逻辑优化
    if (node === baseElem) {
      // 默认的 <base> 元素可能会被删除，需要及时补上
      headElem.insertBefore(baseElem, headElem.firstChild)
      console.warn('[jsproxy] base elem restored')
    }
  }

  /**
   * @param {MutationRecord[]} mutations 
   */
  function parseMutations(mutations) {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(onNodeAdd)
      mutation.removedNodes.forEach(onNodeDel)
    })
  }

  const observer = new win.MutationObserver(parseMutations)
  observer.observe(document, {
    childList: true,
    subtree: true,
  })
}


/**
 * Hook 页面 API
 * 
 * @param {Window} win 
 */
export function init(win) {
  if (!win) {
    return
  }
  try {
    win['x']
  } catch (err) {
    // TODO: 不应该出现
    console.warn('not same origin')
    return
  }

  const document = win.document

  // 该 window 之前已初始化过，现在只需更新 document。
  // 例如 iframe 加载完成之前，读取 contentWindow 得到的是空白页，
  // 加载完成后，document 对象会变化，但 window 上的属性仍保留。
  const info = env.get(win['Math'])
  if (info) {
    const {doc, domHook} = info
    if (doc !== document) {
      // 加载完成后，初始化实际页面的 document
      initDoc(win, domHook)
      info[1] = document
    }
    return
  }


  const {
    location,
    navigator,
  } = win


  // 源路径（空白页继承上级页面）
  const oriUrlObj = new URL(document.baseURI)

  const domHook = hook.createDomHook(win)

  // 关联当前页面上下文信息
  env.add(win, {
    loc: location,
    doc: document,
    ori: oriUrlObj,
    domHook,
  })

  // hook 页面和 Worker 相同的 API
  client.init(win, oriUrlObj.origin)

  // 首次安装 document
  // 如果访问加载中的页面，返回 about:blank 空白页
  initDoc(win, domHook)


  const sw = navigator.serviceWorker
  const swCtl = sw.controller

  function sendMsgToSw(cmd, val) {
    swCtl && swCtl.postMessage([cmd, val])
  }


  // TODO: 这部分逻辑需要优化
  let readyCallback

  function pageAsyncInit() {
    const curScript = document.currentScript
    if (!curScript) {
      return
    }
    // curScript.remove()

    const pageId = +curScript.dataset['id']
    // console.log('PAGE wait id:', pageId)

    if (!pageId) {
      console.warn('[jsproxy] missing page id')
      return
    }

    readyCallback = function() {
      sendMsgToSw(MSG.PAGE_INIT_END, pageId)
    }

    sendMsgToSw(MSG.PAGE_INIT_BEG, pageId)

    // do async init
    // if (win === top) {
      sendMsgToSw(MSG.PAGE_INFO_PULL)
    // } else {
    //   readyCallback()
    // }
  }
  pageAsyncInit()


  sw.addEventListener('message', e => {
    const [cmd, val] = e.data
    switch (cmd) {
    case MSG.SW_COOKIE_PUSH:
      // console.log('PAGE MSG.SW_COOKIE_PUSH:', val)
      val.forEach(cookie.set)
      break

    case MSG.SW_INFO_PUSH:
      // console.log('PAGE MSG.SW_INFO_PUSH:', val)
      val.cookies.forEach(cookie.set)
      route.setConf(val.conf)
      readyCallback()
      break

    case MSG.SW_CONF_CHANGE:
      route.setConf(val)
      break
    }
    e.stopImmediatePropagation()
  }, true)

  sw.startMessages && sw.startMessages()

  //
  // hook ServiceWorker
  //
  const swProto = win['ServiceWorkerContainer'].prototype
  if (swProto) {
    hook.func(swProto, 'register', oldFn => function() {
      console.warn('access serviceWorker.register blocked')
      return new Promise(function() {})
    })
    hook.func(swProto, 'getRegistration', oldFn => function() {
      console.warn('access serviceWorker.getRegistration blocked')
      return new Promise(function() {})
    })
    hook.func(swProto, 'getRegistrations', oldFn => function() {
      console.warn('access serviceWorker.getRegistrations blocked')
      return new Promise(function() {})
    })
  }

  /**
   * History API
   * @param {string} name 
   */
  function hookHistory(name) {
    const proto = win['History'].prototype

    hook.func(proto, name, oldFn =>
    /**
     * @param {*} data 
     * @param {string} title 
     * @param {string} url 相对或绝对路径
     */
    function(data, title, url) {
      console.log('[jsproxy] history.%s: %s', name, url)

      const {loc, doc} = env.get(this)
      if (doc && url) {
        const dstUrlObj = urlx.newUrl(url, doc.baseURI)
        if (dstUrlObj) {
          // 当前页面 URL
          const srcUrlStr = urlx.decUrlObj(loc)
          const srcUrlObj = new URL(srcUrlStr)

          if (srcUrlObj.origin !== dstUrlObj.origin) {
            throw Error(`\
Failed to execute '${name}' on 'History': \
A history state object with URL '${url}' \
cannot be created in a document with \
origin '${srcUrlObj.origin}' and URL '${srcUrlStr}'.`
            )
          }
          arguments[2] = urlx.encUrlObj(dstUrlObj)
        }
      }
      return apply(oldFn, this, arguments)
    })
  }
  hookHistory('pushState')
  hookHistory('replaceState')

  //
  // hook window.open()
  //
  hook.func(win, 'open', oldFn => function(url) {
    if (url) {
      arguments[0] = urlx.encUrlStrRel(url, url)
    }
    return apply(oldFn, this, arguments)
  })

  //
  // hook window.frames[...]
  //
  const frames = win.frames

  // @ts-ignore
  win.frames = new Proxy(frames, {
    get(_, key) {
      if (typeof key === 'number') {
        console.log('get frames index:', key)
        const win = frames[key]
        init(win)
        return win
      } else {
        return frames[key]
      }
    }
  })

  //
  hook.func(navigator, 'registerProtocolHandler', oldFn => function(_0, url, _1) {
    console.log('registerProtocolHandler:', arguments)
    return apply(oldFn, this, arguments)
  })


  //
  // hook document.domain
  //
  const docProto = win['Document'].prototype
  let domain = oriUrlObj.hostname

  hook.prop(docProto, 'domain',
    getter => function() {
      return domain
    },
    setter => function(val) {
      console.log('[jsproxy] set document.domain:', val)
      domain = val
      // TODO:
      setter.call(this, location.hostname)
    }
  )

  //
  // hook document.cookie
  //
  hook.prop(docProto, 'cookie',
    getter => function() {
      // console.log('[jsproxy] get document.cookie')
      const {ori} = env.get(this)
      return cookie.query(ori)
    },
    setter => function(val) {
      // console.log('[jsproxy] set document.cookie:', val)
      const {ori} = env.get(this)
      const item = cookie.parse(val, ori, Date.now())
      if (item) {
        cookie.set(item)
        sendMsgToSw(MSG.PAGE_COOKIE_PUSH, item)
      }
    }
  )

  // hook uri api
  function getUriHook(getter) {
    return function() {
      const val = getter.call(this)
      return val && urlx.decUrlStrAbs(val)
    }
  }

  hook.prop(docProto, 'referrer', getUriHook)
  hook.prop(docProto, 'URL', getUriHook)
  hook.prop(docProto, 'documentURI', getUriHook)

  const nodeProto = win['Node'].prototype
  hook.prop(nodeProto, 'baseURI', getUriHook)


  // hook Message API
  const msgEventProto = win['MessageEvent'].prototype
  hook.prop(msgEventProto, 'origin',
    getter => function() {
      const {ori} = env.get(this)
      return ori.origin
    }
  )


  hook.func(win, 'postMessage', oldFn => function(msg, origin) {
    const srcWin = top['__get_srcWin']() || this
    // console.log(srcWin)
    if (origin && origin !== '*') {
      arguments[1] = '*'
    }
    return apply(oldFn, srcWin, arguments)
  })


  //
  // hook <meta>
  //
  const metaProto = win['HTMLMetaElement'].prototype

  domHook.attr('META', metaProto,
  {
    name: 'http-equiv',
    onget(val) {
      // TODO: 
      return val
    },
    onset(val) {
      let newVal

      switch (val.toLowerCase()) {
      case 'refresh':
        newVal = urlx.replaceHttpRefresh(this.content, this)
        if (newVal !== val) {
          console.warn('[jsproxy] meta redir')
          this.content = newVal
        }
        break
      case 'content-security-policy':
        console.warn('[jsproxy] meta csp removed')
        this.remove()
        break
      case 'content-type':
        this.remove()
        break
      }
      return val
    }
  },
  {
    name: 'charset',
    onget(val) {
      return val
    },
    onset(val) {
      return 'utf-8'
    }
  }
  )

  //
  // hook 元素的 URL 属性，JS 读取时伪装成原始值
  //
  function hookAttr(tag, proto, name) {
    domHook.attr(tag, proto, {
      name,
      onget(val) {
        if (val === null) {
          return ''
        }
        return urlx.decUrlStrRel(val, this)
      },
      onset(val) {
        if (val === '') {
          return val
        }
        return urlx.encUrlStrRel(val, this)
      }
    })
  }

  const anchorProto = win['HTMLAnchorElement'].prototype
  hookAttr('A', anchorProto, 'href')

  const areaProto = win['HTMLAreaElement'].prototype
  hookAttr('AREA', areaProto, 'href')

  const formProto = win['HTMLFormElement'].prototype
  hookAttr('FORM', formProto, 'action')

  const scriptProto = win['HTMLScriptElement'].prototype
  const linkProto = win['HTMLLinkElement'].prototype

  // 防止混合内容
  if (oriUrlObj.protocol === 'http:') {
    hookAttr('SCRIPT', scriptProto, 'src')
    hookAttr('LINK', linkProto, 'href')
  }

  // const imgProto = win.HTMLImageElement.prototype
  // hookAttr('IMG', imgProto, 'src')

  const embedProto = win['HTMLEmbedElement'].prototype
  hookAttr('EMBED', embedProto, 'src')

  const objectProto = win['HTMLObjectElement'].prototype
  hookAttr('OBJECT', objectProto, 'data')

  const iframeProto = win['HTMLIFrameElement'].prototype
  hookAttr('IFRAME', iframeProto, 'src')

  const frameProto = win['HTMLFrameElement'].prototype
  hookAttr('FRAME', frameProto, 'src')


  // 更新默认的 baseURI
  // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/base#Usage_notes
  const baseProto = win['HTMLBaseElement'].prototype
  domHook.attr('BASE', baseProto,
  {
    name: 'href',
    onget(val) {
      return this.__href || val
    },
    onset(val) {
      // TODO: 逻辑优化
      const baseElem = this.ownerDocument.__baseElem
      if (!baseElem || baseElem === this) {
        return val
      }
      console.log('[jsproxy] baseURI updated:', val)
      const urlObj = urlx.newUrl(val, baseElem.href)
      baseElem.href = urlObj.href
      this.__href = val
      return ''
    }
  })


  //
  // hook frame
  //
  hook.prop(iframeProto, 'contentWindow',
    getter => function() {
      // TODO: origin check
      const win = getter.call(this)
      init(win)
      return win
    }
  )

  hook.prop(iframeProto, 'contentDocument',
    getter => function() {
      // TODO: origin check
      const doc = getter.call(this)
      if (doc) {
        init(doc.defaultView)
      }
      return doc
    }
  )

  //
  // hook 超链接的 host、pathname 等属性
  // 这类属性只有 property 没有 attribute
  //
  function hookAnchorUrlProp(proto) {
    /**
     * @param {string} key 
     */
    function setupProp(key) {
      hook.prop(proto, key,
        getter => function() {
          // 读取 href 时会经过 hook 处理，得到的已是原始 URL
          const urlObj = new URL(this.href)
          return urlObj[key]
        },
        setter => function(val) {
          // console.log('[jsproxy] set link %s: %s', key, val)
          const urlObj = new URL(this.href)
          urlObj[key] = val
          this.href = urlObj.href
        }
      )
    }
    setupProp('protocol')
    setupProp('hostname')
    setupProp('host')
    setupProp('port')
    setupProp('pathname')
    setupProp('origin')
  }
  hookAnchorUrlProp(anchorProto)
  hookAnchorUrlProp(areaProto)


  // 该 form 可能没有经过 MutationObserver 处理
  hook.func(formProto, 'submit', oldFn => function() {
    this.action = this.action
    return apply(oldFn, this, arguments)
  })
  

  //
  // 监控 离屏元素.click() 方式打开页面
  // 例如：
  //  var s = document.createElement('div')
  //  s.innerHTML = '<a href="https://google.com"><img></a>'
  //  s.getElementsByTagName('img')[0].click()
  //
  const htmlProto = win['HTMLElement'].prototype

  hook.func(htmlProto, 'click', oldFn => function() {
    /** @type {HTMLAnchorElement} */
    let el = this

    // 添加到文档时已经过 MutationObserver 处理
    // 无需调整 href 属性
    if (el.isConnected) {
      return
    }
    while (el) {
      const tag = el.tagName
      if (tag === 'A' || tag === 'AREA') {
        // eslint-disable-next-line no-self-assign
        el.href = el.href
        break
      }
      // @ts-ignore
      el = el.parentNode
    }
    return apply(oldFn, this, arguments)
  })


  //
  // 脚本元素处理
  //
  /** @type {WeakMap<HTMLElement, string>} */
  const integrityMap = new WeakMap()

  /** @type {WeakMap<HTMLElement, string>} */
  const charsetMap = new WeakMap()


  domHook.attr('SCRIPT', scriptProto,
  // 统一使用 UTF-8 编码
  // JS 未提供 UTF-8 转非 UTF-8 的 API，导致编码转换比较麻烦，
  // 因此 SW 将所有 JS 资源都转换成 UTF-8 编码。
  {
    name: 'charset',
    onget(val) {
      return charsetMap.get(this) || val
    },
    onset(val) {
      if (!util.isUtf8(val)) {
        val = 'utf-8'
      }
      charsetMap.set(this, val)
      return val
    }
  },
  // 禁止设置内容校验
  //（调整静态 HTML 时控制台会有告警，但不会阻止运行）
  {
    name: 'integrity',
    onget(val) {
      return integrityMap.get(this) || ''
    },
    onset(val) {
      integrityMap.set(this, val)
      return ''
    }
  },
  // 监控动态创建的脚本
  //（设置 innerHTML 时同样会触发）
  {
    name: 'innerText',
    onget(val) {
      return val
    },
    onset(val, isInit) {
      const ret = updateScriptText(this, val)
      if (ret === null) {
        return isInit ? hook.DROP : val
      }
      return ret
    }
  })

  // text 属性只有 prop 没有 attr
  hook.prop(scriptProto, 'text',
    getter => function() {
      return getter.call(this)
    },
    setter => function(val) {
      const ret = updateScriptText(this, val)
      if (ret === null) {
        setter.call(this, val)
      }
      setter.call(this, ret)
    }
  )

  
  /** @type {WeakSet<HTMLScriptElement>} */
  const parsedSet = new WeakSet()

  /**
   * @param {HTMLScriptElement} elem 
   */
  function updateScriptText(elem, code) {
    // 有些脚本仅用于存储数据（例如模块字符串），无需处理
    const type = elem.type
    if (type && !util.isJsMime(type)) {
      return null
    }
    if (parsedSet.has(elem)) {
      return null
    }
    parsedSet.add(elem)

    return jsfilter.parseStr(code)
  }

  
  /**
   * 处理 <tag onevent=""> 形式的脚本
   * @param {string} eventName 
   */
  function hookEvent(eventName) {
    const scanedSet = new WeakSet()

    function scanElement(el) {
      if (scanedSet.has(el)) {
        return
      }
      scanedSet.add(el)

      // 非元素节点
      if (el.nodeType != 1 /*Node.ELEMENT_NODE*/) {
        return
      }
      // 扫描内联代码
      if (el[eventName]) {
        const code = el.getAttribute(eventName)
        if (code) {
          const ret = jsfilter.parseStr(code)
          if (ret) {
            el[eventName] = ret
            console.log('[jsproxy] jsfilter onevent:', eventName)
          }
        }
      }
      // 扫描上级元素
      scanElement(el.parentNode)
    }

    document.addEventListener(eventName.substr(2), e => {
      scanElement(e.target)
    }, true)
  }

  hookEvent('onerror')
  hookEvent('onload')
  hookEvent('onclick')
  // Object.keys(htmlProto).forEach(v => {
  //   if (v.startsWith('on')) {
  //     hookEvent(v)
  //   }
  // })
}

// ========================================================================
// cdn.js  (webpack module 15)
// 与 sw.js、network.js、inject.js 合并为 module 15
// ========================================================================
import * as util from './util'

// 暂时先用 jsdelivr 试验。之后换成速度很快、容量更大的免费图床
const CDN = 'https://cdn.jsdelivr.net/npm/jsproxy-cache-01@0.0.'

let mCurVer = -1

/** @type {Map<number, number>} */
let mUrlHashVerMap = new Map()

/** @type {Set<string>} */
let mDirectHostSet = new Set()


async function loadDirectList(conf) {
  const url = conf.assets_cdn + conf.direct_host_list
  const res = await fetch(url)
  const txt = await res.text()

  for (const host of txt.split('\n')) {
    if (host && host[0] !== '#') {
      mDirectHostSet.add(host)
    }
  }
}

async function loadStaticList(conf) {
  const info = conf.static_boost
  if (!info || !info.enable) {
    return
  }
  const latest = info.ver
  if (mCurVer >= latest) {
    return
  }
  mCurVer = latest
  console.log('[jsproxy] cdn cache ver:', latest)

  const res = await fetch(CDN + latest + '/full')
  const buf = await res.arrayBuffer()
  const u32 = new Uint32Array(buf)

  let p = 0
  for (let ver = 0; ver <= latest; ver++) {
    const num = u32[p++]

    for (let i = 0; i < num; i++) {
      const urlHash = u32[p++]
      mUrlHashVerMap.set(urlHash, ver)
    }
  }
}


export function setConf(conf) {
  return Promise.all([
    loadStaticList(conf),
    loadDirectList(conf),
  ])
}

/**
 * @param {string} host 
 */
export function isDirectHost(host) {
  return mDirectHostSet.has(host)
}


/**
 * @param {string} url 
 */
export async function proxyDirect(url) {
  try {
    const res = await fetch(url, {
      referrerPolicy: 'no-referrer',
    })
    const {status} = res
    if (status === 200 || status === 206) {
      return res
    }
    console.warn('direct status:', status, url)
  } catch (err) {
    console.warn('direct fail:', url)
  }
}


/**
 * @param {number} urlHash 
 */
export function getFileVer(urlHash) {
  return mUrlHashVerMap.get(urlHash)
}


/**
 * @param {number} urlHash 
 * @param {number} urlVer 
 */
async function proxyStaticMain(urlHash, urlVer) {
  const hashHex = util.numToHex(urlHash, 8)
  const res = await fetch(CDN + urlVer + '/' + hashHex + '.txt')
  if (res.status !== 200) {
    throw 'bad status: ' + res.status
  }
  const buf = await res.arrayBuffer()
  const b = new Uint8Array(buf)

  const hdrLen = b[0] << 8 | b[1]
  const hdrBuf = b.subarray(2, 2 + hdrLen)
  const hdrStr = util.bytesToStr(hdrBuf)
  const hdrObj = JSON.parse(hdrStr)

  const body = b.subarray(2 + hdrLen)
  hdrObj['date'] = new Date().toUTCString()

  return new Response(body, {
    headers: hdrObj
  })
}


/**
 * @param {number} urlHash 
 * @param {number} urlVer 
 */
export async function proxyStatic(urlHash, urlVer) {
  // TODO: 使用多个 CDN
  try {
    return await proxyStaticMain(urlHash, urlVer)
  } catch(err) {
    console.warn('cdn fail:', err)
  }
}

// ========================================================================
// network.js  (webpack module 15)
// ========================================================================
import * as route from './route.js'
import * as cookie from './cookie.js'
import * as urlx from './urlx.js'
import * as util from './util'
import * as tld from './tld.js'
import * as cdn from './cdn.js'
import {Database} from './database.js'


const REFER_ORIGIN = location.origin + '/'
const ENABLE_3RD_COOKIE = true

/** @type {Database} */
let mDB


// 部分浏览器不支持 access-control-expose-headers: *
// https://developer.mz.jsproxy.tk/en-US/docs/Web/HTTP/Headers/Access-Control-Expose-Headers#Compatibility_notes
//
// 如果返回所有字段名，长度会很大。
// 因此请求头中设置 aceh__ 标记，告知服务器是否要返回所有字段名。
let mIsAcehOld = true

// TODO:
let mConf


export function setConf(conf) {
  mConf = conf
  cdn.setConf(conf)
}


export async function setDB(db) {
  mDB = db
  // clear expires
}


/**
 * @param {string} url 
 */
function getUrlCache(url) {
  return mDB.get('url-cache', url)
}


/**
 * @param {string} url 
 * @param {string} host 
 * @param {string} info 
 * @param {number} expires 
 */
async function setUrlCache(url, host, info, expires) {
  await mDB.put('url-cache', {url, host, info, expires})
}


/**
 * @param {string} url 
 */
async function delUrlCache(url) {
  await mDB.delete('url-cache', url)
}


/**
 * @param {URL} targetUrlObj 
 * @param {URL} clientUrlObj 
 * @param {Request} req 
 */
function getReqCookie(targetUrlObj, clientUrlObj, req) {
  const cred = req.credentials
  if (cred === 'omit') {
    return ''
  }
  if (cred === 'same-origin') {
    // TODO:
    const targetTld = tld.getTld(targetUrlObj.hostname)
    const clientTld = tld.getTld(clientUrlObj.hostname)
    if (targetTld !== clientTld) {
      return ''
    }
  }
  return cookie.query(targetUrlObj)
}


/**
 * @param {Headers} header 
 */
function parseResCache(header) {
  const cacheStr = header.get('cache-control')
  if (cacheStr) {
    if (/no-cache/i.test(cacheStr)) {
      return -1
    }
    const m = cacheStr.match(/(?:^|,\s*)max-age=["]?(\d+)/i)
    if (m) {
      const sec = +m[1]
      if (sec > 0) {
        return sec
      }
    }
  }
  const expires = header.get('expires')
  if (expires) {
    const ts = Date.parse(expires)
    if (ts > 0) {
      return (ts - Date.now()) / 1000 | 0
    }
  }
  return 0
}


/**
 * @param {string[]} cookieStrArr 
 * @param {URL} urlObj 
 * @param {URL} cliUrlObj
 */
function procResCookie(cookieStrArr, urlObj, cliUrlObj) {
  if (!ENABLE_3RD_COOKIE) {
    const urlTld = tld.getTld(urlObj.hostname)
    const cliTld = tld.getTld(cliUrlObj.hostname)
    if (cliTld !== urlTld) {
      return
    }
  }

  const ret = []
  const now = Date.now()

  for (const str of cookieStrArr) {
    const item = cookie.parse(str, urlObj, now)
    if (!item) {
      continue
    }
    cookie.set(item)
    if (!item.httpOnly) {
      ret.push(item)
    }
  }
  return ret
}


/**
 * @param {Response} res 
 */
function getResInfo(res) {
  const rawHeaders = res.headers
  let status = res.status

  /** @type {string[]} */
  const cookieStrArr = []
  const headers = new Headers()

  rawHeaders.forEach((val, key) => {
    if (key === 'access-control-allow-origin' ||
        key === 'access-control-expose-headers') {
      return
    }
    if (key === '--s') {
      status = +val
      return
    }
    if (key === '--t') {
      return
    }
    // 还原重名字段
    //  0-key: v1
    //  1-key: v2
    // =>
    //  key: v1, v2
    //
    // 对于 set-cookie 单独存储，因为合并会破坏 cookie 格式：
    //  var h = new Headers()
    //  h.append('set-cookie', 'hello')
    //  h.append('set-cookie', 'world')
    //  h.get('set-cookie')  // "hello, world"
    //
    const m = key.match(/^\d+-(.+)/)
    if (m) {
      key = m[1]
      if (key === 'set-cookie') {
        cookieStrArr.push(val)
      } else {
        headers.append(key, val)
      }
      return
    }

    // 还原转义字段（`--key` => `key`）
    if (key.startsWith('--')) {
      key = key.substr(2)
    }

    // 单个 set-cookie 返回头
    if (key === 'set-cookie') {
      cookieStrArr.push(val)
      return
    }

    headers.set(key, val)
  })

  return {status, headers, cookieStrArr}
}


// https://fetch.spec.whatwg.org/#cors-unsafe-request-header-byte
const R_UNSAFE_REQ_HDR_CHAR =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x08\x0a-\x1f\x22\x28\x29\x3a\x3c\x3e\x3f\x40\x5b\x5c\x5d\x7b\x7d\x7f]/

/**
 * @param {string} key 
 * @param {string} val 
 */
function isSimpleReqHdr(key, val) {
  if (key === 'content-type') {
    return (
      val === 'application/x-www-form-urlencoded' ||
      val === 'multipart/form-data' ||
      val === 'text/plain'
    )
  }
  if (key === 'accept' ||
      key === 'accept-language' ||
      key === 'content-language'
  ) {
    // 标准是总和小于 1024，这里保守一些
    return val.length < 256 &&
      !R_UNSAFE_REQ_HDR_CHAR.test(val)
  }
}


/**
 * @param {Request} req 
 * @param {URL} urlObj 
 * @param {URL} cliUrlObj 
 */
function initReqHdr(req, urlObj, cliUrlObj) {
  const reqHdr = new Headers()
  const reqMap = {
    '--ver': mConf.ver,
    '--mode': req.mode,
    '--type': req.destination || '',
    'origin': '',
  }
  if (mIsAcehOld) {
    reqMap['--aceh'] = '1'
  }

  req.headers.forEach((val, key) => {
    if (key === 'user-agent') {
      return
    }
    if (isSimpleReqHdr(key, val)) {
      reqHdr.set(key, val)
    } else {
      reqMap[key] = val
    }
  })

  if (reqMap['origin']) {
    reqMap['origin'] = cliUrlObj.origin
  }

  const referer = req.referrer
  if (referer) {
    // TODO: CSS 引用图片的 referer 不是页面 URL，而是 CSS URL
    if (referer === REFER_ORIGIN) {
      // Referrer Policy: origin
      reqMap['referer'] = cliUrlObj.origin + '/'
    } else {
      reqMap['referer'] = urlx.decUrlStrAbs(referer)
    }
  }

  reqMap['cookie'] = getReqCookie(urlObj, cliUrlObj, req)

  return {reqHdr, reqMap}
}

/**
 * @param {RequestInit} reqOpt 
 * @param {Object<string, string>} info 
 */
function updateReqHeaders(reqOpt, info) {
  reqOpt.referrer = '/?' + new URLSearchParams(info)
}


const MAX_RETRY = 5

/**
 * @param {Request} req 
 * @param {URL} urlObj 
 * @param {URL} cliUrlObj 
 */
export async function launch(req, urlObj, cliUrlObj) {
  const {method} = req

  /** @type {RequestInit} */
  const reqOpt = {
    mode: 'cors',
    method,
  }

  if (method === 'POST' && !req.bodyUsed) {
    if (req.body) {
      reqOpt.body = req.body
    } else {
      const buf = await req.arrayBuffer()
      if (buf.byteLength > 0) {
        reqOpt.body = buf
      }
    }
  }

  if (req.signal) {
    reqOpt.signal = req.signal
  }

  if (!urlx.isHttpProto(urlObj.protocol)) {
    // 非 HTTP 协议的资源，直接访问
    // 例如 youtube 引用了 chrome-extension: 协议的脚本
    const res = await fetch(req)
    return {res}
  }

  const url = urlObj.href
  const urlHash = util.strHash(url)
  let host = ''
  let rawInfo = ''

  const {reqHdr, reqMap} = initReqHdr(req, urlObj, cliUrlObj)
  reqOpt.headers = reqHdr

  while (method === 'GET') {
    // 该资源是否加载过？
    const r = await getUrlCache(url)
    if (r && r.host) {
      const now = util.getTimeSeconds()
      if (now < r.expires) {
        // 使用之前的节点，提高缓存命中率
        host = r.host
        rawInfo = r.info
        break
      }
    }

    // 支持 CORS 的站点，可直连
    if (cdn.isDirectHost(urlObj.host)) {
      console.log('direct hit:', url)
      const res = await cdn.proxyDirect(url)
      if (res) {
        setUrlCache(url, '', '', 0)
        return {res}
      }
    }

    // 常用静态资源 CDN 加速
    const ver = cdn.getFileVer(urlHash)
    if (ver >= 0) {
      console.log('cdn hit:', url)
      const res = await cdn.proxyStatic(urlHash, ver)
      if (res) {
        setUrlCache(url, '', '', 0)
        return {res}
      }
    }

    break
  }

  // TODO: 此处逻辑需要优化
  let level = 1

  // 如果缓存未命中产生请求，服务器不做节点切换
  if (host) {
    level = 0
  }

  /** @type {Response} */
  let res

  /** @type {Headers} */
  let resHdr


  for (let i = 0; i < MAX_RETRY; i++) {
    if (i === 0 && host) {
      // 使用缓存的主机
    } else {
      host = route.getHost(urlHash, level)
    }
    
    const rawUrl = urlx.delHash(urlObj.href)
    let proxyUrl = route.genUrl(host, 'http') + '/' + rawUrl

    // 即使未命中缓存，在请求“加速节点”时也能带上文件信息
    if (rawInfo) {
      reqMap['--raw-info'] = rawInfo
    } else {
      delete reqMap['--raw-info']
    }

    res = null
    try {
      reqMap['--level'] = level
      updateReqHeaders(reqOpt, reqMap)
      res = await fetch(proxyUrl, reqOpt)
    } catch (err) {
      console.warn('fetch fail:', proxyUrl)
      break
      // TODO: 重试其他线路
      // route.setFailHost(host)
    }
    resHdr = res.headers

    // 检测浏览器是否支持 aceh: *
    if (mIsAcehOld && resHdr.has('--t')) {
      mIsAcehOld = false
      delete reqMap['--aceh']
    }

    // 是否切换节点
    if (resHdr.has('--switched')) {
      rawInfo = resHdr.get('--raw-info')
      level++
      continue
    }

    // 目前只有加速节点会返回该信息
    const resErr = resHdr.get('--error')
    if (resErr) {
      console.warn('[jsproxy] cfworker fail:', resErr)
      rawInfo = ''
      level = 0
      continue
    }

    break
  }

  if (!res) {
    return
  }

  const {
    status, headers, cookieStrArr
  } = getResInfo(res)


  if (method === 'GET' && status === 200) {
    const cacheSec = parseResCache(headers)
    if (cacheSec >= 0) {
      const expires = util.getTimeSeconds() + cacheSec + 1000
      setUrlCache(url, host, rawInfo, expires)
    }
  }

  // 处理 HTTP 返回头的 refresh 字段
  // http://www.otsukare.info/2015/03/26/refresh-http-header
  const refresh = headers.get('refresh')
  if (refresh) {
    const newVal = urlx.replaceHttpRefresh(refresh, url)
    if (newVal !== refresh) {
      console.log('[jsproxy] http refresh:', refresh)
      headers.set('refresh', newVal)
    }
  }

  let cookies
  if (cookieStrArr.length) {
    const items = procResCookie(cookieStrArr, urlObj, cliUrlObj)
    if (items.length) {
      cookies = items
    }
  }

  return {res, status, headers, cookies}
}

// ========================================================================
// inject.js  (webpack module 15)
// ========================================================================
import * as path from './path.js'
import * as util from "./util"
// import * as jsfilter from './jsfilter.js'

let mConf


const WORKER_INJECT = util.strToBytes(`\
if (typeof importScripts === 'function' && !self.window && !self.__PATH__) {
  self.__PATH__ = '${path.ROOT}';
  importScripts('${path.HELPER}');
}
`)


export function getWorkerCode() {
  return WORKER_INJECT
}


export function setConf(conf) {
  mConf = conf
}


const PADDING = ' '.repeat(500)

const CSP = `\
'self' \
'unsafe-inline' \
file: \
data: \
blob: \
mediastream: \
filesystem: \
chrome-extension-resource: \
`

/**
 * @param {URL} urlObj 
 * @param {number} pageId 
 */
export function getHtmlCode(urlObj, pageId) {
  const icoUrl = path.PREFIX + urlObj.origin + '/favicon.ico'
  const custom = mConf.inject_html || ''

  return util.strToBytes(`\
<!-- JS PROXY HELPER -->
<!doctype html>
<link rel="icon" href="${icoUrl}" type="image/x-icon">
<meta http-equiv="content-security-policy" content="frame-src ${CSP}; object-src ${CSP}">
<base href="${urlObj.href}">
<script data-id="${pageId}" src="${path.HELPER}"></script>
${custom}
<!-- PADDING ${PADDING} -->

`)
}

// ========================================================================
// sw.js  (webpack module 15)
// ========================================================================
import * as path from './path.js'
import * as route from './route.js'
import * as urlx from './urlx.js'
import * as util from './util.js'
import * as cookie from './cookie.js'
import * as network from './network.js'
import * as MSG from './msg.js'
import * as jsfilter from './jsfilter.js'
import * as inject from './inject.js'
import {Signal} from './signal.js'
import {Database} from './database.js'


const CONF_UPDATE_TIMER = 1000 * 60 * 5

let mConf
const MAX_REDIR = 5

/** @type {ServiceWorkerGlobalScope} */
// @ts-ignore
const global = self
const clients = global.clients

let mUrlHandler


/**
 * @param {*} target 
 * @param {number} cmd 
 * @param {*=} val 
 */
function sendMsg(target, cmd, val) {
  if (target) {
    target.postMessage([cmd, val])
  } else {
    console.warn('invalid target', cmd, val)
  }
}


// 也可以用 clientId 关联，但兼容性不高
let pageCounter = 0

/** @type {Map<number, [Signal, number]>} */
const pageWaitMap = new Map()

function genPageId() {
  return ++pageCounter
}

/**
 * @param {number} pageId 
 */
function pageWait(pageId) {
  const s = new Signal()
  // 设置最大等待时间
  // 有些页面不会执行 JS（例如查看源文件），导致永久等待
  const timer = setTimeout(_ => {
    pageWaitMap.delete(pageId)
    s.notify(false)
  }, 2000)

  pageWaitMap.set(pageId, [s, timer])
  return s.wait()
}

/**
 * @param {number} id 
 * @param {boolean} isDone 
 */
function pageNotify(id, isDone) {
  const arr = pageWaitMap.get(id)
  if (!arr) {
    console.warn('[jsproxy] unknown page id:', id)
    return
  }
  const [s, timer] = arr
  if (isDone) {
    pageWaitMap.delete(id)
    s.notify(true)
  } else {
    // 页面已开始初始化，关闭定时器
    clearTimeout(timer)
  }
}


function makeHtmlRes(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
    }
  })
}


/**
 * @param {Response} res 
 * @param {ResponseInit} resOpt 
 * @param {URL} urlObj 
 */
function processHtml(res, resOpt, urlObj) {
  const reader = res.body.getReader()
  let injected = false

  const stream = new ReadableStream({
    async pull(controller) {
      if (!injected) {
        injected = true

        // 注入页面顶部的代码
        const pageId = genPageId()
        const buf = inject.getHtmlCode(urlObj, pageId)
        controller.enqueue(buf)

        // 留一些时间给页面做异步初始化
        const done = await pageWait(pageId)
        if (!done) {
          console.warn('[jsproxy] page wait timeout. id: %d url: %s',
            pageId, urlObj.href)
        }
      }
      const r = await reader.read()
      if (r.done) {
        controller.close()
      } else {
        controller.enqueue(r.value)
      }
    }
  })
  return new Response(stream, resOpt)
}


/**
 * @param {ArrayBuffer} buf 
 * @param {string} charset 
 */
function processJs(buf, charset) {
  const u8 = new Uint8Array(buf)
  const ret = jsfilter.parseBin(u8, charset) || u8
  return util.concatBufs([inject.getWorkerCode(), ret])
}


/**
 * @param {*} cmd 
 * @param {*} msg 
 * @param {string=} srcId
 */
async function sendMsgToPages(cmd, msg, srcId) {
  // 通知页面更新 Cookie
  const pages = await clients.matchAll({type: 'window'})

  for (const page of pages) {
    if (page.frameType !== 'top-level') {
      continue
    }
    if (srcId && page.id === srcId) {
      continue
    }
    sendMsg(page, cmd, msg)
  }
}


/** @type Map<string, string> */
const mIdUrlMap = new Map()

/**
 * @param {string} id 
 */
async function getUrlByClientId(id) {
  const client = await clients.get(id)
  if (!client) {
    return
  }
  const urlStr = urlx.decUrlStrAbs(client.url)
  mIdUrlMap.set(id, urlStr)
  return urlStr
}


/**
 * @param {string} jsonStr 
 * @param {number} status 
 * @param {URL} urlObj 
 */
function parseGatewayError(jsonStr, status, urlObj) {
  let ret = ''
  const {
    msg, addr, url
  } = JSON.parse(jsonStr)

  switch (status) {
  case 204:
    switch (msg) {
    case 'ORIGIN_NOT_ALLOWED':
      ret = '当前域名不在服务器外链白名单'
      break
    case 'CIRCULAR_DEPENDENCY':
      ret = '当前请求出现循环代理'
      break
    case 'SITE_MOVE':
      ret = `当前站点移动到: <a href="${url}">${url}</a>`
      break
    }
    break
  case 500:
    ret = '代理服务器内部错误'
    break
  case 502:
    if (addr) {
      ret = `代理服务器无法连接网站 ${urlObj.origin} (${addr})`
    } else {
      ret = `代理服务器无法解析域名 ${urlObj.host}`
    }
    break
  case 504:
    ret = `代理服务器连接网站超时 ${urlObj.origin}`
    if (addr) {
      ret += ` (${addr})`
    }
    break
  }
  return makeHtmlRes(ret)
}


/**
 * @param {Request} req 
 * @param {URL} urlObj
 * @param {URL} cliUrlObj 
 * @param {number} redirNum
 * @returns {Promise<Response>}
 */
async function forward(req, urlObj, cliUrlObj, redirNum) {
  const r = await network.launch(req, urlObj, cliUrlObj)
  if (!r) {
    return makeHtmlRes('load fail')
  }
  let {
    res, status, headers, cookies
  } = r

  if (cookies) {
    sendMsgToPages(MSG.SW_COOKIE_PUSH, cookies)
  }

  if (!status) {
    status = res.status || 200
  }

  let headersMutable = true
  if (!headers) {
    headers = res.headers
    headersMutable = false
  }

  /**
   * @param {string} k 
   * @param {string} v 
   */
  const setHeader = (k, v) => {
    if (!headersMutable) {
      headers = new Headers(headers)
      headersMutable = true
    }
    headers.set(k, v)
  }

  // 网关错误
  const gwErr = headers.get('gateway-err--')
  if (gwErr) {
    return parseGatewayError(gwErr, status, urlObj)
  }

  /** @type {ResponseInit} */
  const resOpt = {status, headers}

  // 空响应
  // https://fetch.spec.whatwg.org/#statuses
  if (status === 101 ||
      status === 204 ||
      status === 205 ||
      status === 304
  ) {
    return new Response(null, resOpt)
  }

  // 处理重定向
  if (status === 301 ||
      status === 302 ||
      status === 303 ||
      status === 307 ||
      status === 308
  ) {
    const locStr = headers.get('location')
    const locObj = locStr && urlx.newUrl(locStr, urlObj)
    if (locObj) {
      // 跟随模式，返回最终数据
      if (req.redirect === 'follow') {
        if (++redirNum === MAX_REDIR) {
          return makeHtmlRes('重定向过多', 500)
        }
        return forward(req, locObj, cliUrlObj, redirNum)
      }
      // 不跟随模式（例如页面跳转），返回 30X 状态
      setHeader('location', urlx.encUrlObj(locObj))
    }

    // firefox, safari 保留内容会提示页面损坏
    return new Response(null, resOpt)
  }

  //
  // 提取 mime 和 charset（不存在则为 undefined）
  // 可能存在多个段，并且值可能包含引号。例如：
  // content-type: text/html; ...; charset="gbk"
  //
  const ctVal = headers.get('content-type') || ''
  const [, mime, charset] = ctVal
    .toLocaleLowerCase()
    .match(/([^;]*)(?:.*?charset=['"]?([^'"]+))?/)


  const type = req.destination
  if (type === 'script' ||
      type === 'worker' ||
      type === 'sharedworker'
  ) {
    const buf = await res.arrayBuffer()
    const ret = processJs(buf, charset)

    setHeader('content-type', 'text/javascript')
    return new Response(ret, resOpt)
  }

  if (req.mode === 'navigate' && mime === 'text/html') {
    return processHtml(res, resOpt, urlObj)
  }

  return new Response(res.body, resOpt)
}


async function proxy(e, urlObj) {
  // 使用 e.resultingClientId 有问题
  const id = e.clientId
  let cliUrlStr
  if (id) {
    cliUrlStr = mIdUrlMap.get(id) || await getUrlByClientId(id)
  }
  if (!cliUrlStr) {
    cliUrlStr = urlObj.href
  }
  const cliUrlObj = new URL(cliUrlStr)

  try {
    return await forward(e.request, urlObj, cliUrlObj, 0)
  } catch (err) {
    console.error(err)
    return makeHtmlRes('前端脚本错误<br><pre>' + err.stack + '</pre>', 500)
  }
}

/** @type {Database} */
let mDB

async function initDB() {
  mDB = new Database('.sys')
  await mDB.open({
    'url-cache': {
      keyPath: 'url'
    },
    'cookie': {
      keyPath: 'id'
    }
  })

  await network.setDB(mDB)
  await cookie.setDB(mDB)
}


/**
 * @param {FetchEvent} e 
 */
async function onFetch(e) {
  if (!mConf) {
    await initConf()
  }
  // TODO: 逻辑优化
  if (!mDB) {
    await initDB()
  }
  const req = e.request
  const urlStr = urlx.delHash(req.url)

  // 首页（例如 https://zjcqoo.github.io/）
  if (urlStr === path.ROOT || urlStr === path.HOME) {
    let indexPath = mConf.assets_cdn + mConf.index_path
    if (!mConf.index_path) {
      // 临时代码。防止配置文件未更新的情况下首页无法加载
      indexPath = mConf.assets_cdn + 'index_v3.html'
    }
    const res = await fetch(indexPath)
    return makeHtmlRes(res.body)
  }

  // 图标、配置（例如 https://zjcqoo.github.io/conf.js）
  if (urlStr === path.CONF || urlStr === path.ICON) {
    return fetch(urlStr)
  }

  // 注入页面的脚本（例如 https://zjcqoo.github.io/__sys__/helper.js）
  if (urlStr === path.HELPER) {
    return fetch(self['__FILE__'])
  }

  // 静态资源（例如 https://zjcqoo.github.io/__sys__/assets/ico/google.png）
  if (urlStr.startsWith(path.ASSETS)) {
    const filePath = urlStr.substr(path.ASSETS.length)
    return fetch(mConf.assets_cdn + filePath)
  }

  if (req.mode === 'navigate') {
    const newUrl = urlx.adjustNav(urlStr)
    if (newUrl) {
      return Response.redirect(newUrl, 301)
    }
  }

  let targetUrlStr = urlx.decUrlStrAbs(urlStr)
  
  const handler = mUrlHandler[targetUrlStr]
  if (handler) {
    const {
      redir,
      content,
      replace,
    } = handler

    if (redir) {
      return Response.redirect('/-----' + redir)
    }
    if (content) {
      return makeHtmlRes(content)
    }
    if (replace) {
      targetUrlStr = replace
    }
  }

  const targetUrlObj = urlx.newUrl(targetUrlStr)

  if (targetUrlObj) {
    return proxy(e, targetUrlObj)
  }
  return makeHtmlRes('invalid url: ' + targetUrlStr, 500)
}


function parseUrlHandler(handler) {
  const map = {}
  if (!handler) {
    return map
  }
  for (const [match, rule] of Object.entries(handler)) {
    // TODO: 支持通配符和正则
    map[match] = rule
  }
  return map
}

// TODO: 逻辑优化
function updateConf(conf, force) {
  if (!force && mConf) {
    if (conf.ver <= mConf.ver) {
      return
    }
    if (conf.node_map[mConf.node_default]) {
      conf.node_default = mConf.node_default
    } else {
      console.warn('default node %s -> %s',
        mConf.node_default, conf.node_default)
    }
    sendMsgToPages(MSG.SW_CONF_CHANGE, mConf)
  }
  inject.setConf(conf)
  route.setConf(conf)
  network.setConf(conf)

  mUrlHandler = parseUrlHandler(conf.url_handler)
  /*await*/ saveConf(conf)

  mConf = conf
}


async function readConf() {
  const cache = await caches.open('.sys')
  const req = new Request('/conf.json')
  const res = await cache.match(req)
  if (res) {
    return res.json()
  }
}

async function saveConf(conf) {
  const json = JSON.stringify(conf)
  const cache = await caches.open('.sys')
  const req = new Request('/conf.json')
  const res = new Response(json);
  return cache.put(req, res)
}

async function loadConf() {
  const res = await fetch('conf.js')
  const txt = await res.text()
  self['jsproxy_config'] = updateConf
  Function(txt)()
}


/** @type {Signal[]} */
let mConfInitQueue

async function initConf() {
  if (mConfInitQueue) {
    const s = new Signal()
    mConfInitQueue.push(s)
    return s.wait()
  }
  mConfInitQueue = []

  let conf
  try {
    conf = await readConf()
  } catch (err) {
    console.warn('load conf fail:', err)
  }
  if (!conf) {
    conf = self['__CONF__']
  }
  if (conf) {
    updateConf(conf)
  } else {
    conf = await loadConf()
  }

  // 定期更新配置
  setInterval(loadConf, CONF_UPDATE_TIMER)

  mConfInitQueue.forEach(s => s.notify())
  mConfInitQueue = null
}


global.addEventListener('fetch', e => {
  e.respondWith(onFetch(e))
})


global.addEventListener('message', e => {
  // console.log('sw msg:', e.data)
  const [cmd, val] = e.data
  const src = e.source

  switch (cmd) {
  case MSG.PAGE_COOKIE_PUSH:
    cookie.set(val)
    // @ts-ignore
    sendMsgToPages(MSG.SW_COOKIE_PUSH, [val], src.id)
    break

  case MSG.PAGE_INFO_PULL:
    // console.log('SW MSG.COOKIE_PULL:', src.id)
    sendMsg(src, MSG.SW_INFO_PUSH, {
      cookies: cookie.getNonHttpOnlyItems(),
      conf: mConf,
    })
    break

  case MSG.PAGE_INIT_BEG:
    // console.log('SW MSG.PAGE_INIT_BEG:', val)
    pageNotify(val, false)
    break

  case MSG.PAGE_INIT_END:
    // console.log('SW MSG.PAGE_INIT_END:', val)
    pageNotify(val, true)
    break

  case MSG.PAGE_CONF_GET:
    if (mConf) {
      sendMsg(src, MSG.SW_CONF_RETURN, mConf)
    } else {
      initConf().then(_ => {
        sendMsg(src, MSG.SW_CONF_RETURN, mConf)
      })
    }
    break

  case MSG.PAGE_CONF_SET:
    updateConf(val, true)
    sendMsgToPages(MSG.SW_CONF_CHANGE, mConf)
    break

  case MSG.PAGE_RELOAD_CONF:
    /*await*/ loadConf()
    break

  case MSG.PAGE_READY_CHECK:
    sendMsg(src, MSG.SW_READY)
    /*await*/ loadConf()
    break
  }
})


global.addEventListener('install', e => {
  console.log('oninstall:', e)
  e.waitUntil(global.skipWaiting())
})


global.addEventListener('activate', e => {
  console.log('onactivate:', e)
  sendMsgToPages(MSG.SW_READY, 1)

  e.waitUntil(clients.claim())
})


console.log('[jsproxy] sw inited')

// ========================================================================
// index.vc.js  (webpack module 13)
// virtual-chromo 入口（上游见 index.js）
// ========================================================================
/**
 * virtual-chromo 定制版 index.js（对应 bundle webpack module 13）
 *
 * 与上游 jsproxy-browser index.js 的差异：
 * - 顶层判定：允许 viewer 外壳 iframe（parent 无 __init__ 时也视为 shell 页）
 * - 子 frame 初始化：调用 parent.__init__ 而非 top.__init__
 * - 日志：[jsproxy] shell page inited（非 top page inited）
 */
import * as env from './env.js'

function isShellPage(win) {
  try {
    if (win === top) return true
  } catch (_) {}
  try {
    if (win !== win.parent && typeof win.parent.__init__ === 'function') return false
  } catch (_) {}
  return true
}

function pageEnv(win) {
  env.setEnvType(env.ENV_PAGE)

  if (isShellPage(win)) {
    win.__init__ = function (childWin) {
      page.init(childWin)
      console.log('[jsproxy] child page inited.', childWin.location.href)
    }

    let lastSrcWin
    win.__set_srcWin = function (obj) {
      lastSrcWin = obj || win
      return []
    }
    win.__get_srcWin = function () {
      const ret = lastSrcWin
      lastSrcWin = null
      return ret
    }

    const page = require('./page.js')
    page.init(win)

    console.log('[jsproxy] shell page inited')
  } else {
    const parent = win.parent
    parent.__init__(win)
    win.__set_srcWin = function () {
      return parent.__set_srcWin(win)
    }
  }
}

function swEnv() {
  env.setEnvType(env.ENV_SW)
  require('./sw.js')
}

function workerEnv(global) {
  env.setEnvType(env.ENV_WORKER)
  require('./client.js').init(global, location.origin)
  global.__set_srcWin = function () {
    return []
  }
}

function main(global) {
  if ('onclick' in global) {
    pageEnv(global)
  } else if ('onfetch' in global) {
    swEnv()
  } else {
    workerEnv(global)
  }
}

main(self)
