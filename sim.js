/* Satış simülasyonu: müşteri tipi ve senaryo seçilir, kartlarla (ücretsiz) ya da serbest metinle (yapay zekâ, şimdilik kapalı) görüşme yapılır.
   İçerik sim/ klasöründeki JSON dosyalarından gelir. index.html'deki ortak yardımcıları ($, esc, state, persist, openTopic, show, sb, user) kullanır. */

// Yapay zekâ modu: Supabase Edge Function "sim-ai" kurulup ANTHROPIC_API_KEY secret'ı eklenince enabled:true yapılır (bkz. supabase/functions/sim-ai/README.md)
const SIM_AI = { enabled:false, fn:"sim-ai" };
let SIMD = null, simLoading = null, sim = null, simView = "setup";
// Rastgelelik tek kaynaktan: günün görüşmesinde tarihe göre tohumlanır, böylece o gün herkes aynı senaryoyu oynar
let simRng = Math.random;
const simSeeded = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const simHash = s => { let h = 2166136261; for(const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const simPick = a => a[Math.floor(simRng() * a.length)];
const simShuffle = a => { const b = a.slice(); for(let i = b.length - 1; i > 0; i--){ const j = Math.floor(simRng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const simClamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Beceri → konu eşlemesi (config.json ile aynı; içerik yüklenmeden Planım'ın da kullanabilmesi için)
const SIM_SKILLS = {
  acilis:{ ad:"Açılış ve ilk izlenim", konular:["F2.12", "F1.07"], stage:"soguk" },
  kesif:{ ad:"İhtiyaç keşfi", konular:["F4.01", "F3.04", "F1.06"], stage:"kesif" },
  deger:{ ad:"Değer anlatımı ve uzmanlık", konular:["F1.05", "F4.02", "F4.03"], stage:"demo" },
  itiraz:{ ad:"İtiraz ve müzakere", konular:["F4.06", "F4.07", "F4.08"], stage:"teklif" },
  paydas:{ ad:"Paydaş ve karar süreci", konular:["F3.02", "F8.02", "F8.03"], stage:"kesif" },
  kapanis:{ ad:"Kapanış ve sonraki adım", konular:["F1.12", "F4.09"], stage:"muzakere" }
};

function simSetData(cfg, sectors, a, b){
  SIMD = { cfg, sectors, nodes:[...a, ...b] };
  SIMD.byId = Object.fromEntries(SIMD.nodes.map(n => [n.id, n]));
  for(const s of Object.values(sectors)) for(const n of s.teknik) SIMD.byId[n.id] = n;
  return SIMD;
}
function loadSimData(){
  if(SIMD) return Promise.resolve(SIMD);
  if(!simLoading){
    const get = f => fetch("sim/" + f, { cache:"no-cache" }).then(r => { if(!r.ok) throw new Error(f + " HTTP " + r.status); return r.json(); });
    simLoading = Promise.all([get("config.json"), get("sectors.json"), get("nodes_a.json"), get("nodes_b.json")])
      .then(([cfg, sectors, a, b]) => simSetData(cfg, sectors, a, b))
      .catch(e => { simLoading = null; throw e; });
  }
  return simLoading;
}
const simCfgDefault = () => ({ sector:"muhendislik", role:"TM", persona:"zorlu", stage:"kesif", size:"orta", comp:"mevcut", diff:"orta", product:"0", customAd:"", customDeger:"", koc:null, mode:"kart", ses:false,
  ozel:{ on:false, firma:"", acilar:["", "", ""], itiraz:"" } });

/* ---------- günün görüşmesi ---------- */
function simDailyCfg(day){
  const r = simSeeded(simHash("gun-" + day)), pick = o => { const k = Object.keys(o); return k[Math.floor(r() * k.length)]; };
  const C = SIMD.cfg, sector = pick(SIMD.sectors);
  return { sector, role:pick(C.roles), persona:pick(C.personas), stage:pick(C.stages), size:pick(C.sizes), comp:pick(C.comps), diff:"orta",
    product:String(Math.floor(r() * SIMD.sectors[sector].urunler.length)), customAd:"", customDeger:"", koc:false, mode:"kart", ses:!!simCfg().ses, ozel:{ on:false } };
}
const simDailyDone = day => !!(state.daily && state.daily[day || todayStr()]);
function simStreak(){
  const d = state.daily || {}; let day = todayStr(), n = 0;
  if(!d[day]) day = addDays(day, -1);   // bugün henüz oynanmadıysa seri dünden sayılır
  while(d[day]){ n++; day = addDays(day, -1); }
  return n;
}
async function simOpenDaily(){
  show("sim"); $("#v-sim").innerHTML = `<h2>Günün görüşmesi</h2><p class="lede">Senaryo hazırlanıyor…</p>`;
  try{ await loadSimData(); }catch(e){ renderSim(); return; }
  const day = todayStr();
  simStart(simDailyCfg(day), { daily:day });
  renderSim(); window.scrollTo({ top:0 });
}
function simCfg(){
  // Son seçimler hesapla senkronlanır (state.simCfg)
  state.simCfg = Object.assign(simCfgDefault(), state.simCfg || {});
  return state.simCfg;
}

/* ---------- şablon ---------- */
function simFill(str, ctx){
  if(!str) return "";
  const out = String(str).replace(/\{([a-zA-Z0-9_.]+)\}/g, (m, key) => {
    if(key === "bulunan") return simFound(ctx);
    const v = key.split(".").reduce((o, k) => o == null ? o : o[k], ctx);
    return v == null ? "" : String(v);
  });
  // Cümle başlarını büyük harfle başlat (şablondan küçük harfle gelen parçalar için)
  return out.replace(/(^|[.!?]\s+|\(\s*)([a-zçğıöşü])/g, (m, p, c) => p + c.toLocaleUpperCase("tr"));
}
function simFound(ctx){
  const r = sim && sim.revealed;
  for(const k of ["aci1", "aci2", "aci3"]) if(r && r.has(k)) return ctx[k].ad;
  return ctx.metrik;
}

/* ---------- senaryo kurulumu ---------- */
function simBuildCtx(c){
  const C = SIMD.cfg, S = SIMD.sectors[c.sector], R = C.roles[c.role];
  const kisi = simPick(R.kisiler);
  const gm = c.role === "GM" ? ["Yönetim kurulu", "yönetim kurulu"] : simPick(C.roles.GM.kisiler.filter(k => k[1] !== kisi[1]));
  const prod = c.product === "custom"
    ? { ad:c.customAd.trim() || "çözümümüz", deger:c.customDeger.trim() || "müşterilerimizin en önemli operasyonel sorununu çözüyor", kanit:"benzer ölçekte bir müşterimizde ilk üç ayda ölçülebilir sonuç aldık", pilot:"sınırlı kapsamlı 30 günlük pilot" }
    : S.urunler[+c.product] || S.urunler[0];
  let acilar = simShuffle(S.acilar), gizli = S.gizli, firma = simPick(S.firmalar);
  // Kendi müşterine prova: kullanıcının yazdığı firma, sorunlar ve çekince sektör profilinin yerine geçer
  const oz = c.ozel || {};
  if(oz.on){
    const own = (oz.acilar || []).map(s => String(s || "").trim()).filter(Boolean);
    const mk = ad => ({ ad, soru:`${ad} konusunda son dönemde neler yaşadınız, en son ne oldu?`, acilis:`Evet, bu bizim için gerçek bir konu: ${ad}. Son dönemde birkaç kez yaşadık, ekip de yönetim de rahatsız.`,
      etkiSoru:`Bu durum size zaman, para ya da müşteri açısından neye mal oluyor?`, etki:`Tam hesaplamadık ama küçük değil; hem maliyet hem ekip açısından yönetimin gündeminde.` });
    acilar = own.map(mk).concat(acilar).slice(0, 3);
    if(String(oz.itiraz || "").trim()) gizli = { ad:oz.itiraz.trim(), soru:"Bu konuda sizi tereddüde düşüren, daha önce yaşadığınız bir şey var mı?", acilis:`Açık konuşayım: ${oz.itiraz.trim()}. O yüzden temkinliyim.` };
    if(String(oz.firma || "").trim()) firma = oz.firma.trim();
  }
  return {
    satici:C.satici, firma, kisi:kisi[1], kisiAd:kisi[0], rol:R.ad.toLocaleLowerCase("tr"), rolAd:R.ad, gm:gm[1],
    urun:prod.ad, deger:prod.deger, kanit:prod.kanit, pilot:prod.pilot,
    rakip:S.rakip, metrik:S.metrik, musteri:S.musteri, tetik:S.tetik, kriter:S.kriter, sektor:S.ad,
    calisan:C.sizes[c.size].calisan, aci1:acilar[0], aci2:acilar[1], aci3:acilar[2], gizli
  };
}
function simStart(c, opt){
  opt = opt || {};
  simRng = opt.daily ? simSeeded(simHash("oyun-" + opt.daily)) : Math.random;
  const C = SIMD.cfg, D = C.diffs[c.diff], P = C.personas[c.persona];
  const start = simClamp(35 + D.base + P.base + C.comps[c.comp].base, 20, 60);
  const plan = C.stages[c.stage].plan.map(s => s === "rakip" && c.comp === "yok" ? "itiraz" : s);
  sim = {
    cfg:JSON.parse(JSON.stringify(c)), ctx:simBuildCtx(c), mode:c.mode,
    koc:c.koc == null ? D.koc : !!c.koc, gauge:D.gauge,
    ikna:start, guven:0, sabir:D.sabir, sabirMax:D.sabir, turn:0,
    queue:plan, forced:[], seen:new Set(), revealed:new Set(), med:new Set(),
    log:[], curve:[start], chat:[], node:null, order:null, events:{ gm:false, saat:false },
    lastEnd:null, lastTags:[], ended:false, outcome:null, startedAt:Date.now(), daily:opt.daily || null, spoken:0
  };
  simView = "brief";
}

/* ---------- akış ---------- */
const simRoleOk = n => !n.roles || n.roles.includes("*") || n.roles.includes(sim.cfg.role);
function simNeedOk(n){
  const q = n.need; if(!q) return true;
  if(q.comp && !q.comp.includes(sim.cfg.comp)) return false;
  if(q.reveal && !sim.revealed.has(q.reveal)) return false;
  if(q.notReveal && sim.revealed.has(q.notReveal)) return false;
  return true;
}
function simCandidates(slot){
  const sector = SIMD.sectors[sim.cfg.sector].teknik.filter(n => n.slot === slot);
  const generic = SIMD.nodes.filter(n => n.slot === slot);
  const ok = n => !sim.seen.has(n.id) && simRoleOk(n) && simNeedOk(n);
  // Teknik sorularda sektöre özel olanlar önce gelir
  const sec = sector.filter(ok);
  return sec.length ? sec : generic.filter(ok);
}
function simNextNode(){
  while(sim.forced.length){ const n = SIMD.byId[sim.forced.shift()]; if(n && !sim.seen.has(n.id)) return n; }
  const stg = sim.cfg.stage;
  // Olay: görüşme iyi gidiyorsa genel müdür katılır
  if(!sim.events.gm && sim.cfg.role !== "GM" && ["kesif", "demo", "teklif"].includes(stg) && sim.turn >= 4 && sim.ikna >= 45 && sim.queue.length >= 2){
    sim.events.gm = true; return SIMD.byId.E_GM;
  }
  // Olay: sabır bitmek üzereyse müşteri toparlamak ister, doğrudan kapanışa geçilir
  if(!sim.events.saat && sim.sabir === 1 && sim.queue.length >= 2){
    sim.events.saat = true; sim.queue = sim.queue.slice(-1); return SIMD.byId.E_SAAT;
  }
  while(sim.queue.length){
    const slot = sim.queue.shift();
    let c = simCandidates(slot);
    if(!c.length && slot === "rakip") c = simCandidates("itiraz");
    if(!c.length && slot === "sorun") c = simCandidates("etki");
    if(c.length) return simPick(c);
  }
  return null;
}
function simAdvance(){
  const n = simNextNode();
  if(!n){ simFinish("plan"); return; }
  sim.node = n; sim.seen.add(n.id);
  sim.order = simShuffle(n.o.map((_, i) => i));
  const q = (n.qp && n.qp[sim.cfg.persona]) || n.q;
  if(n.slot === "olay" && /^\(/.test(q)){
    const m = q.match(/^\(([^)]*)\)\s*(.*)$/);
    if(m){ sim.chat.push({ w:"n", t:simFill(m[1], sim.ctx) }); sim.chat.push({ w:"m", t:simFill(m[2], sim.ctx), who:n.id === "E_GM" ? sim.ctx.gm : null }); return; }
  }
  sim.chat.push({ w:"m", t:simFill(q, sim.ctx) });
}
function simAnswer(oi){
  if(!sim || sim.ended || !sim.node) return;
  const C = SIMD.cfg, D = C.diffs[sim.cfg.diff], P = C.personas[sim.cfg.persona];
  const n = sim.node, o = n.o[oi], s = o.s;
  const pm = (o.k || []).reduce((a, k) => a + (P.mods[k] || 0), 0);
  let delta = s > 0 ? s * D.pos * 0.6 : s === 0 ? -1 : s * 5 * D.neg;
  delta += pm * 1.5;
  delta = Math.round(delta);
  const before = sim.ikna;
  sim.ikna = simClamp(sim.ikna + delta, 0, 100);
  sim.guven += o.g != null ? o.g : s >= 2 ? 1 : s <= -2 ? -1 : 0;
  if(s <= -2 || (sim.cfg.diff === "zor" && s === -1)) sim.sabir -= s <= -3 ? 2 : 1;
  // Gizli bilgi, ancak yeterli güven varsa açılır
  let reaction = o.r;
  const blocked = o.need && o.need.guven != null && sim.guven < o.need.guven;
  if(blocked && o.rf) reaction = o.rf;
  if(!blocked) for(const r of o.rv || []){ sim.revealed.add(r); if(/^aci/.test(r)) sim.med.add("I"); }
  for(const m of o.m || []) sim.med.add(m);
  if(o.go && !sim.seen.has(o.go)) sim.forced.push(o.go);
  if(o.end){ sim.lastEnd = o.end; sim.lastTags = o.k || []; }
  const best = n.o.reduce((b, x) => x.s > b.s ? x : b, n.o[0]);
  sim.turn++;
  sim.log.push({ id:n.id, slot:n.slot, skill:C.slotSkill[n.slot] || "deger", k:o.k || [], q:sim.chat[sim.chat.length - 1].t, a:simFill(o.t, sim.ctx), s, delta:sim.ikna - before,
    best:best === o ? null : simFill(best.t, sim.ctx), fb:o.fb, bestFb:best.fb, ikna:sim.ikna });
  sim.curve.push(sim.ikna);
  sim.chat.push({ w:"s", t:simFill(o.t, sim.ctx) });
  if(sim.koc) sim.chat.push({ w:"k", s, t:o.fb, d:sim.ikna - before });
  // Takip sorusuna dallanan cevaplarda ara tepki gösterilmez; takip sorusu tepkinin kendisidir
  if(!(o.go && sim.forced.includes(o.go))) sim.chat.push({ w:"m", t:simFill(reaction, sim.ctx) });
  sim.node = null;
  if(sim.ikna <= 5 && sim.turn >= 3) return simFinish("erken");
  if(sim.sabir <= 0) return simFinish("sabir");
  simAdvance();
}
function simFinish(reason){
  const C = SIMD.cfg, D = C.diffs[sim.cfg.diff], stg = C.stages[sim.cfg.stage];
  const okEnd = ["adim", "kapanis"].includes(sim.lastEnd);
  const decisive = sim.cfg.persona !== "kararsiz" || sim.lastTags.includes("net_adim");
  let out;
  if(reason === "terk") out = { k:"kayip", ad:"Görüşme yarıda kaldı", d:"Görüşmeyi sen bitirdin.", m:"" };
  else if(reason === "sabir") out = { k:"kayip", ad:"Kaybedildi", d:"Müşterinin sabrı tükendi ve görüşmeyi kısa kesti.", m:"Kusura bakmayın, bu görüşmeden bir sonuç çıkacağını düşünmüyorum. İyi günler." };
  else if(reason === "erken") out = { k:"kayip", ad:"Kaybedildi", d:"Müşteri ikna olmak bir yana, güvenini tamamen kaybetti.", m:"Sanırım birbirimizin vaktini almayalım. Teşekkürler." };
  else if(okEnd && sim.ikna >= D.esik && decisive) out = { k:"basari", ad:stg.basari, d:"Müşteriyi ikna ettin ve net bir taahhüt aldın.", m:"" };
  else if((okEnd && sim.ikna >= D.esik - 15) || (sim.lastEnd === "zayif" && sim.ikna >= D.esik)) out = { k:"bekle", ad:"Beklemede", d:okEnd ? "Müşteri olumlu ama henüz tam ikna olmadı." : "İlgi var ama net bir taahhüt alamadın.", m:"Güzel bir görüşmeydi. Biz içeride bir değerlendirip size döneriz." };
  else out = { k:"kayip", ad:"Kaybedildi", d:okEnd ? "Doğru adımı istedin ama müşteri yeterince ikna olmamıştı." : "Görüşme net bir sonraki adım olmadan kapandı.", m:"Teşekkürler, şimdilik bu konuda ilerlemeyi düşünmüyoruz." };
  if(out.m) sim.chat.push({ w:"m", t:out.m });
  sim.ended = true; sim.outcome = out; sim.node = null; simView = "result";
  simSave();
}

/* ---------- analiz ---------- */
function simSkills(){
  const C = SIMD.cfg, acc = {};
  for(const l of sim.log){ (acc[l.skill] = acc[l.skill] || []).push((l.s + 3) / 6 * 100); }
  return Object.fromEntries(Object.keys(C.skills).filter(k => acc[k]).map(k => [k, Math.round(acc[k].reduce((a, b) => a + b, 0) / acc[k].length)]));
}
function simSave(){
  const sk = simSkills();
  state.sims = state.sims || {};
  state.sims[sim.startedAt] = { at:todayStr(), cfg:{ sector:sim.cfg.sector, role:sim.cfg.role, persona:sim.cfg.persona, stage:sim.cfg.stage, size:sim.cfg.size, comp:sim.cfg.comp, diff:sim.cfg.diff, product:sim.cfg.product }, mode:sim.mode,
    out:sim.outcome.k, ad:sim.outcome.ad, ikna:sim.ikna, turns:sim.turn, skills:sk, med:[...sim.med], found:[...sim.revealed].length, firma:sim.ctx.firma, daily:sim.daily || undefined };
  const keys = Object.keys(state.sims).sort();
  while(keys.length > 30) delete state.sims[keys.shift()];
  // Günün görüşmesinde yalnızca günün ilk denemesi sayılır; tekrarlar pratik olarak geçmişe girer
  if(sim.daily && !(state.daily && state.daily[sim.daily])){
    state.daily = state.daily || {};
    state.daily[sim.daily] = { ikna:sim.ikna, out:sim.outcome.k, ad:sim.outcome.ad };
  }
  persist();
  if(typeof updateDailyBtn === "function") updateDailyBtn();
}
// Son görüşmelerde ortalaması %60'ın altında kalan beceriler (Planım ve "Bugün ne çalışayım?" kullanır)
function simWeakSkills(){
  const recent = Object.entries(state.sims || {}).sort((a, b) => b[0] - a[0]).slice(0, 5).map(([, v]) => v.skills || {});
  if(!recent.length) return [];
  const acc = {};
  for(const s of recent) for(const [k, v] of Object.entries(s)) (acc[k] = acc[k] || []).push(v);
  return Object.entries(acc).map(([k, a]) => ({ k, avg:Math.round(a.reduce((x, y) => x + y, 0) / a.length) }))
    .filter(x => x.avg < 60 && SIM_SKILLS[x.k]).sort((a, b) => a.avg - b.avg).map(x => Object.assign({}, SIM_SKILLS[x.k], x));
}
// Zayıf becerisi için hazır ayarlanmış bir pratik görüşmesi aç
async function simOpenPractice(skill){
  show("sim"); try{ await loadSimData(); }catch(e){ renderSim(); return; }
  const c = simCfg(); const s = SIM_SKILLS[skill];
  if(s){ c.stage = s.stage; c.ozel = Object.assign({}, c.ozel, { on:false }); persist(); }
  sim = null; simView = "setup"; simStart(c); renderSim(); window.scrollTo({ top:0 });
}
function simCurveSVG(pts, thr){
  const W = 560, H = 140, px = i => 10 + i * (W - 20) / Math.max(1, pts.length - 1), py = v => H - 10 - v * (H - 20) / 100;
  const path = pts.map((v, i) => (i ? "L" : "M") + px(i).toFixed(1) + " " + py(v).toFixed(1)).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" class="simcurve" role="img" aria-label="Tur tur ikna eğrisi">
    <line x1="10" x2="${W - 10}" y1="${py(thr)}" y2="${py(thr)}" class="thr"/><text x="${W - 12}" y="${py(thr) - 4}" text-anchor="end" class="lbl">başarı eşiği %${thr}</text>
    <path d="${path}" class="ln"/>${pts.map((v, i) => `<circle cx="${px(i)}" cy="${py(v)}" r="3.5" class="pt"><title>${i ? i + ". tur" : "Başlangıç"}: %${v}</title></circle>`).join("")}</svg>`;
}

/* ---------- gelişim: son görüşmelerde ikna oranı ve beceri eğrileri ---------- */
function simSpark(vals, labels, W, H, withAxis){
  const n = vals.length, pad = 6, px = i => pad + (n < 2 ? (W - 2 * pad) / 2 : i * (W - 2 * pad) / (n - 1)), py = v => H - pad - v * (H - 2 * pad) / 100;
  const path = vals.map((v, i) => (i ? "L" : "M") + px(i).toFixed(1) + " " + py(v).toFixed(1)).join(" ");
  const grid = withAxis ? [0, 50, 100].map(g => `<line x1="${pad}" x2="${W - pad}" y1="${py(g)}" y2="${py(g)}" class="gr"/><text x="${W - pad}" y="${py(g) - 3}" text-anchor="end" class="ax">${g}</text>`).join("") : "";
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none" role="img" aria-label="${esc(labels.map((l, i) => l + ": %" + vals[i]).join(", "))}">${grid}
    <path d="${path}" class="ln"/>${vals.map((v, i) => `<circle cx="${px(i)}" cy="${py(v)}" r="${i === n - 1 ? 4 : 3}" class="pt${i === n - 1 ? " last" : ""}"><title>${esc(labels[i])}: %${v}</title></circle>`).join("")}</svg>`;
}
function simProgressHTML(){
  const list = Object.entries(state.sims || {}).sort((a, b) => a[0] - b[0]).slice(-20).map(([, v]) => v);
  if(list.length < 2) return "";
  const lbl = list.map((s, i) => `${i + 1}. görüşme (${fmtDate(s.at)})`);
  const rows = Object.entries(SIM_SKILLS).map(([k, s]) => {
    const pts = list.map((x, i) => [x.skills && x.skills[k], lbl[i]]).filter(p => p[0] != null);
    if(!pts.length) return "";
    const vals = pts.map(p => p[0]), first = vals[0], last = vals[vals.length - 1], d = last - first;
    return `<div class="sprow"><span class="nm">${esc(s.ad)}</span>${simSpark(vals, pts.map(p => p[1]), 220, 36, false)}
      <span class="v">%${last}</span><span class="d ${d > 0 ? "up" : d < 0 ? "down" : ""}">${vals.length > 1 ? (d > 0 ? "▲ " : d < 0 ? "▼ " : "") + (d > 0 ? "+" : "") + d : "–"}</span></div>`;
  }).join("");
  const ik = list.map(s => s.ikna), avg = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  const half = Math.floor(ik.length / 2), trend = ik.length >= 4 ? avg(ik.slice(half)) - avg(ik.slice(0, half)) : null;
  return `<div class="section"><h2>Gelişimin</h2>
    <p class="lede">Son ${list.length} görüşmende ikna oranı${trend != null ? `: son yarıdaki ortalaman ilk yarıya göre <b style="color:var(--ink)">${trend >= 0 ? "+" : ""}${trend} puan</b>` : ""}. Noktaların üzerine gelince detay görünür.</p>
    <div class="spbig">${simSpark(ik, lbl, 640, 150, true)}</div>
    <h3 style="margin-top:22px">Beceri bazında</h3><p class="simhint">İlk ölçümden son ölçüme değişim. %60'ın altındaki beceriler Planım'da öne çekilir.</p>
    <div class="sprows">${rows}</div></div>`;
}

/* ---------- sesli mod ---------- */
function simSpeak(){
  if(!sim || !sim.cfg.ses || typeof speechSynthesis === "undefined") return;
  const news = []; for(let i = sim.spoken; i < sim.chat.length; i++) if(sim.chat[i].w === "m") news.push(sim.chat[i].t);
  sim.spoken = sim.chat.length;
  if(!news.length) return;
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(news.join(" ")); u.lang = "tr-TR"; u.rate = 1.02;
    const tr = speechSynthesis.getVoices().find(v => /^tr/i.test(v.lang)); if(tr) u.voice = tr;
    speechSynthesis.speak(u);
  }catch(e){}
}

/* ---------- görünüm ---------- */
function simChips(group, items, cur){
  return `<div class="chips" role="group">${items.map(([k, l, t]) => `<button class="chip sm" type="button" data-sc="${group}" data-v="${esc(k)}" aria-pressed="${String(cur) === String(k)}"${t ? ` title="${esc(t)}"` : ""}>${esc(l)}</button>`).join("")}</div>`;
}
function renderSim(){
  const v = $("#v-sim"); if(!v) return;
  if(!SIMD){
    v.innerHTML = `<h2>Satış simülasyonu</h2><p class="lede">Senaryolar yükleniyor…</p>`;
    loadSimData().then(renderSim).catch(e => { console.error(e); v.innerHTML = `<h2>Satış simülasyonu</h2><p class="empty">Senaryolar yüklenemedi. İnternet bağlantını kontrol edip sayfayı yenile.</p>`; });
    return;
  }
  if(simView === "brief" && sim) return simRenderBrief(v);
  if(simView === "play" && sim) return simRenderPlay(v);
  if(simView === "result" && sim) return simRenderResult(v);
  simRenderSetup(v);
}
function simRenderSetup(v){
  const C = SIMD.cfg, c = simCfg(), S = SIMD.sectors[c.sector] || SIMD.sectors.muhendislik;
  const past = Object.entries(state.sims || {}).sort((a, b) => b[0] - a[0]).slice(0, 8);
  const outLbl = { basari:"good", bekle:"", kayip:"low" };
  const day = todayStr(), done = state.daily && state.daily[day], streak = simStreak();
  const oz = c.ozel = Object.assign({ on:false, firma:"", acilar:["", "", ""], itiraz:"" }, c.ozel);
  const canSpeak = typeof speechSynthesis !== "undefined";
  v.innerHTML = `<h2>Satış simülasyonu</h2>
    <p class="lede">Müşteri tipini ve senaryoyu seç, gerçek bir satış görüşmesini baştan sona yönet. Müşteri cevaplarına göre farklı sorular sorar, gizli ihtiyaçlarını ancak doğru sorularla açar. Sonunda ikna oranı, sonuç ve detaylı görüşme analizi çıkar.</p>
    <div class="dailycard ${done ? "done" : ""}">
      <div><div class="k">Günün görüşmesi · ${fmtDate(day)}</div>
        <h3>${done ? `Bugünkü görüşmeyi tamamladın: ${esc(done.ad)}, %${done.ikna}` : "Bugünün senaryosu seni bekliyor"}</h3>
        <p>Her gün herkese aynı senaryo, orta zorlukta. Yalnızca günün ilk denemesi sayılır. ${streak ? `Serin: <b>${streak} gün</b>.` : "İlk gününle bir seri başlat."}</p></div>
      <button class="btn ${done ? "" : "danger"}" type="button" id="simDaily">${done ? "Tekrar oyna (pratik)" : "Günün görüşmesine başla"}</button>
    </div>
    <div class="section" style="margin-top:22px"><h3>Nasıl oynamak istersin?</h3>
      <div class="simmodes">
        <button type="button" class="simmode" data-sc="mode" data-v="kart" aria-pressed="${c.mode === "kart"}"><b>Cevap kartlarıyla</b><span>Her turda birbirine yakın 5-6 cevap kartından birini seçersin. Ücretsiz.</span></button>
        <button type="button" class="simmode" data-sc="mode" data-v="serbest" aria-pressed="${c.mode === "serbest"}" ${SIM_AI.enabled ? "" : `disabled aria-disabled="true" title="Bu mod henüz aktif değil"`}><b>Serbest cevapla (yapay zekâ)${SIM_AI.enabled ? "" : ` <em class="soon">Yakında</em>`}</b><span>${SIM_AI.enabled ? "Cevabını kendin yazarsın; müşteriyi yapay zekâ canlandırır. Giriş yapmış olman gerekir." : "Cevabını kendin yazarsın, müşteriyi yapay zekâ canlandırır. Henüz aktif değil."}</span></button>
      </div>
      ${SIM_AI.enabled ? "" : `<p class="simnote" role="note"><b>Yapay zekâ modu yakında.</b> Serbest cevapla oynama ve yapay zekâ müşteri, ilerleyen bir sürümde gelecek. Şimdilik aşağıdaki seçeneklerle senaryonu kurup cevap kartlarıyla oynayabilirsin.</p>`}</div>
    <div class="simform">
      <div><h4>Sektör</h4>${simChips("sector", Object.entries(SIMD.sectors).map(([k, s]) => [k, s.ad]), c.sector)}</div>
      <div><h4>Sattığın ürün</h4><select id="simProduct" aria-label="Sattığın ürün" style="width:100%">${S.urunler.map((u, i) => `<option value="${i}" ${c.product === String(i) ? "selected" : ""}>${esc(u.ad)}</option>`).join("")}<option value="custom" ${c.product === "custom" ? "selected" : ""}>Kendi ürünüm…</option></select>
        ${c.product === "custom" ? `<div class="outbox" style="margin-top:8px"><input id="simCustomAd" placeholder="Ürünün adı (ör. kalite kontrol yazılımı)" value="${esc(c.customAd)}"><input id="simCustomDeger" placeholder="Ne sağlıyor? (ör. hatalı ürünleri sevkiyattan önce yakalıyor)" value="${esc(c.customDeger)}"></div>` : `<p class="simhint">${esc(S.urunler[+c.product] ? S.urunler[+c.product].deger : "")}</p>`}</div>
      <div><h4>Karşındaki kişi</h4>${simChips("role", Object.entries(C.roles).map(([k, r]) => [k, r.ad, r.odak]), c.role)}</div>
      <div><h4>Müşteri tipi</h4>${simChips("persona", Object.entries(C.personas).map(([k, p]) => [k, p.ad, p.d]), c.persona)}<p class="simhint">${esc(C.personas[c.persona].d)}</p></div>
      <div><h4>Satış aşaması</h4>${simChips("stage", Object.entries(C.stages).map(([k, s]) => [k, s.ad, s.hedef]), c.stage)}<p class="simhint">${esc(C.stages[c.stage].hedef)}</p></div>
      <div><h4>Şirket büyüklüğü</h4>${simChips("size", Object.entries(C.sizes).map(([k, s]) => [k, s.ad]), c.size)}</div>
      <div><h4>Rekabet durumu</h4>${simChips("comp", Object.entries(C.comps).map(([k, s]) => [k, s.ad, s.d]), c.comp)}</div>
      <div><h4>Zorluk</h4>${simChips("diff", Object.entries(C.diffs).map(([k, s]) => [k, s.ad, s.d]), c.diff)}<p class="simhint">${esc(C.diffs[c.diff].d)}</p></div>
      <details class="simown" ${oz.on ? "open" : ""}><summary>Kendi müşterine prova (isteğe bağlı)</summary>
        <p class="simhint">Gerçek bir görüşmeden önce müşterini tanımla; firma adı, bildiğin sorunları ve çekincesi senaryoda kullanılır. Sektör, rol ve müşteri tipi yukarıdaki seçimlerden gelir.</p>
        <label class="simcheck"><input type="checkbox" id="ozOn" ${oz.on ? "checked" : ""}> Bu bilgileri senaryoda kullan</label>
        <div class="outbox">
          <input data-oz="firma" placeholder="Firma adı (ör. Yıldız Kalıp)" value="${esc(oz.firma)}">
          ${[0, 1, 2].map(i => `<input data-oz="aci${i}" placeholder="Bildiğin sorun ${i + 1} (ör. kalıp değişim süresi çok uzun)" value="${esc(oz.acilar[i] || "")}">`).join("")}
          <input data-oz="itiraz" placeholder="Bildiğin çekince (ör. önceki tedarikçi teslim tarihini kaçırdı)" value="${esc(oz.itiraz)}">
        </div></details>
      <label class="simcheck"><input type="checkbox" id="simKoc" ${(c.koc == null ? C.diffs[c.diff].koc : c.koc) ? "checked" : ""}> Koç modu: her cevaptan sonra kısa geri bildirim göster</label>
      ${canSpeak ? `<label class="simcheck"><input type="checkbox" id="simSes" ${c.ses ? "checked" : ""}> Sesli mod: müşterinin söylediklerini sesli oku (telefon görüşmesi hissi için)</label>` : ""}
    </div>
    <div class="controls"><button class="btn" type="button" id="simRandom">Rastgele senaryo</button><button class="btn primary" type="button" id="simGo">Senaryoyu oluştur</button></div>
    ${simProgressHTML()}
    ${past.length ? `<div class="section"><h2>Geçmiş görüşmelerin</h2><div class="res">${past.map(([k, p]) => `<div class="rrow" style="grid-template-columns:110px 1fr auto;align-items:center"><div class="t">${fmtDate(p.at)}</div>
      <div><h4>${esc(p.firma || "")}: ${esc((SIMD.sectors[p.cfg.sector] || {}).ad || "")}</h4><div class="by">${esc(C.roles[p.cfg.role].ad)}, ${esc(C.personas[p.cfg.persona].ad.toLocaleLowerCase("tr"))}, ${esc(C.stages[p.cfg.stage].ad.toLocaleLowerCase("tr"))}, ${esc(C.diffs[p.cfg.diff].ad.toLocaleLowerCase("tr"))}</div></div>
      <div style="display:flex;gap:8px;align-items:center"><span class="qbadge ${outLbl[p.out]}">${esc(p.ad)}, %${p.ikna}</span><button class="btn sm" type="button" data-simagain="${k}">Tekrar oyna</button></div></div>`).join("")}</div></div>` : ""}`;
  $$("#v-sim [data-sc]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.sc, val = b.dataset.v; c[k] = val;
    if(k === "sector") c.product = "0";
    if(k === "diff") c.koc = null;
    persist(); renderSim();
  }));
  $("#simProduct").addEventListener("change", e => { c.product = e.target.value; persist(); renderSim(); });
  const ca = $("#simCustomAd"), cd = $("#simCustomDeger");
  if(ca) ca.addEventListener("input", e => { c.customAd = e.target.value; persist(); });
  if(cd) cd.addEventListener("input", e => { c.customDeger = e.target.value; persist(); });
  $("#simKoc").addEventListener("change", e => { c.koc = e.target.checked; persist(); });
  const ses = $("#simSes"); if(ses) ses.addEventListener("change", e => { c.ses = e.target.checked; persist(); });
  $("#ozOn").addEventListener("change", e => { oz.on = e.target.checked; persist(); });
  $$("#v-sim [data-oz]").forEach(i => i.addEventListener("input", e => {
    const k = e.target.dataset.oz; if(/^aci\d$/.test(k)) oz.acilar[+k.slice(3)] = e.target.value; else oz[k] = e.target.value;
    persist();
  }));
  $("#simDaily").addEventListener("click", simOpenDaily);
  $("#simRandom").addEventListener("click", () => {
    const r = o => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
    Object.assign(c, { sector:r(SIMD.sectors), role:r(C.roles), persona:r(C.personas), stage:r(C.stages), size:r(C.sizes), comp:r(C.comps), product:"0", koc:null });
    c.product = String(Math.floor(Math.random() * SIMD.sectors[c.sector].urunler.length));
    persist(); renderSim();
  });
  $("#simGo").addEventListener("click", () => { if(c.mode === "serbest" && !SIM_AI.enabled) c.mode = "kart"; simStart(c); renderSim(); window.scrollTo({ top:0 }); });
  $$("#v-sim [data-simagain]").forEach(b => b.addEventListener("click", () => {
    const p = state.sims[b.dataset.simagain]; Object.assign(c, p.cfg, { mode:"kart" }); persist(); simStart(c); renderSim(); window.scrollTo({ top:0 });
  }));
}
function simRenderBrief(v){
  const C = SIMD.cfg, c = sim.cfg, x = sim.ctx, stg = C.stages[c.stage], P = C.personas[c.persona], D = C.diffs[c.diff];
  v.innerHTML = `${sim.daily ? `<div class="dailytag">Günün görüşmesi · ${fmtDate(sim.daily)}${simDailyDone(sim.daily) ? " · pratik (bugünkü sonucun zaten kaydedildi)" : ""}</div>` : ""}<h2>Görüşme öncesi bilgi notu</h2><p class="lede">${esc(stg.ad)} · ${esc(stg.kanal)}</p>
    <ul class="onbsum simbrief">
      <li><span>Firma</span><div><b>${esc(x.firma)}</b>, ${esc(x.calisan)} bir ${esc(x.musteri)} (${esc(x.sektor)})</div></li>
      <li><span>Görüşeceğin kişi</span><div>${esc(x.kisiAd)}, ${esc(x.rol)}. Odak noktası: ${esc(C.roles[c.role].odak.toLocaleLowerCase("tr"))}</div></li>
      <li><span>Bildiklerin</span><div>${esc(simFill("{tetik} yakın zamanda basında çıktı.", x))} ${esc(C.comps[c.comp].d)}</div></li>
      <li><span>Kişilik ipucu</span><div>${esc(P.ipucu)}${c.diff === "kolay" ? ` (${esc(P.ad)})` : ""}</div></li>
      <li><span>Sattığın</span><div>${esc(simFill("{satici}: {urun}. Çözümümüz {deger}.", x))}</div></li>
      <li><span>Kanıtın</span><div>${esc(simFill("{kanit}.", x))}</div></li>
      <li><span>Hedefin</span><div><b>${esc(stg.hedef)}</b></div></li>
      <li><span>Kurallar</span><div>Müşterinin ${sim.sabirMax} hata hakkı (sabrı) var. ${D.gauge ? "İkna göstergesi açık." : "İkna göstergesi gizli; müşterinin tepkilerinden anlaman gerekiyor."} Müşterinin söylemediği ihtiyaçları ve itirazları ancak doğru sorularla ortaya çıkarabilirsin.</div></li>
    </ul>
    <div class="controls"><button class="btn" type="button" id="simBack">Senaryoyu değiştir</button><button class="btn primary" type="button" id="simBegin">Görüşmeyi başlat</button></div>`;
  $("#simBack").addEventListener("click", () => { sim = null; simView = "setup"; renderSim(); });
  $("#simBegin").addEventListener("click", () => {
    simView = "play";
    sim.chat.push({ w:"n", t:`${stg.kanal}. Karşında ${x.firma} firmasından ${x.kisiAd} (${x.rol}).` });
    if(sim.mode === "serbest") simAiBegin(); else simAdvance();
    renderSim();
  });
}
function simGaugeHTML(){
  const lvl = sim.ikna >= 70 ? "good" : sim.ikna < 40 ? "low" : "";
  return `<div class="simstat">
    <div class="simg"><span>İkna olma ihtimali</span>${sim.gauge ? `<div class="meter"><i class="${lvl}" style="width:${sim.ikna}%"></i></div><b>%${sim.ikna}</b>` : `<div class="meter"><i style="width:0"></i></div><b>?</b>`}</div>
    <div class="simg"><span>Müşterinin sabrı</span><b class="hearts" aria-label="${sim.sabir} / ${sim.sabirMax}">${"●".repeat(Math.max(0, sim.sabir))}${"○".repeat(Math.max(0, sim.sabirMax - Math.max(0, sim.sabir)))}</b></div>
    <div class="simg"><span>Tur</span><b>${sim.turn + (sim.node ? 1 : 0)}</b></div>
  </div>`;
}
function simChatHTML(){
  const nm = sim.ctx.kisi;
  return sim.chat.map(m => m.w === "m" ? `<div class="bub m"><span class="who">${esc(m.who || nm)}</span>${esc(m.t)}</div>`
    : m.w === "s" ? `<div class="bub s"><span class="who">Sen</span>${esc(m.t)}</div>`
    : m.w === "k" ? `<div class="coach ${m.s >= 2 ? "good" : m.s < 0 ? "low" : ""}"><b>${m.s >= 2 ? "İyi hamle" : m.s < 0 ? "Zayıf hamle" : "İdare eder"}${sim.gauge ? ` (${m.d >= 0 ? "+" : ""}${m.d})` : ""}</b> ${esc(m.t)}</div>`
    : `<div class="bub n">${esc(m.t)}</div>`).join("");
}
function simRenderPlay(v){
  const n = sim.node;
  const opts = n ? sim.order.map((oi, k) => `<button class="qzopt" type="button" data-simo="${oi}"><span class="L">${"ABCDEF"[k]}</span><span>${esc(simFill(n.o[oi].t, sim.ctx))}</span></button>`).join("") : "";
  const free = sim.mode === "serbest";
  v.innerHTML = `<div class="plhead"><div><h2>${esc(sim.ctx.firma)}</h2><p class="lede">${esc(sim.ctx.kisiAd)}, ${esc(sim.ctx.rol)} · ${esc(SIMD.cfg.stages[sim.cfg.stage].ad)}</p></div>
      <div class="act"><button class="btn sm" type="button" id="simQuit">Görüşmeyi bitir</button></div></div>
    <div class="simchat" id="simChat">${simChatHTML()}</div>
    ${simGaugeHTML()}
    ${free ? `<div class="simfree"><textarea id="simText" placeholder="Cevabını yaz…" ${sim.busy ? "disabled" : ""}></textarea><button class="btn primary" type="button" id="simSend" ${sim.busy ? "disabled" : ""}>${sim.busy ? "Müşteri düşünüyor…" : "Gönder"}</button></div>`
      : `<p class="simhint" style="margin:14px 0 8px">Cevabını seç (1-${n ? n.o.length : 6} tuşları da çalışır):</p><div class="qzopts" id="simOpts">${opts}</div>`}`;
  const ch = $("#simChat"); ch.scrollTop = ch.scrollHeight;
  simSpeak();
  $("#simQuit").addEventListener("click", () => { if(confirm("Görüşmeyi bitirmek istediğine emin misin? Sonuç 'yarıda kaldı' olarak kaydedilir.")){ simFinish("terk"); renderSim(); } });
  if(free){
    const send = () => { const t = $("#simText").value.trim(); if(t) simAiTurn(t); };
    $("#simSend").addEventListener("click", send);
    $("#simText").addEventListener("keydown", e => { if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); send(); } });
    if(!sim.busy) $("#simText").focus();
  } else {
    $$("#simOpts [data-simo]").forEach(b => b.addEventListener("click", () => {
      simAnswer(+b.dataset.simo); renderSim();
      const o = $("#simOpts .qzopt"); if(o) o.focus({ preventScroll:true });
      const last = $("#simOpts"); if(last) last.scrollIntoView({ block:"nearest" });
    }));
  }
}
function simRenderResult(v){
  const C = SIMD.cfg, D = C.diffs[sim.cfg.diff], out = sim.outcome, sk = simSkills(), x = sim.ctx;
  const cls = { basari:"", bekle:"warn", kayip:"bad" }[out.k];
  const sorted = sim.log.map((l, i) => Object.assign({ i }, l)).sort((a, b) => b.delta - a.delta);
  const topUp = sorted.filter(l => l.delta > 0).slice(0, 3), topDown = sorted.filter(l => l.delta < 0).reverse().slice(0, 3);
  const hidden = ["aci1", "aci2", "aci3", "gizli"].map(k => ({ k, ad:x[k].ad, soru:x[k].soru, ok:sim.revealed.has(k) }));
  const weak = Object.entries(sk).filter(([, v]) => v < 60).sort((a, b) => a[1] - b[1]);
  const asked = sim.log.filter(l => (l.k || []).includes("soru")).length;
  const mark = s => s >= 2 ? `<span class="mk good">✓</span>` : s < 0 ? `<span class="mk low">✗</span>` : `<span class="mk">~</span>`;
  v.innerHTML = `<h2>Görüşme analizi</h2><p class="lede">${esc(x.firma)} · ${esc(x.kisiAd)}, ${esc(x.rol)} · ${esc(C.personas[sim.cfg.persona].ad)} · ${esc(C.stages[sim.cfg.stage].ad)} · ${esc(D.ad)}</p>
    <div class="verdict ${cls}"><b>Sonuç: ${esc(out.ad)}</b>${esc(out.d)} Son ikna oranı %${sim.ikna} (başarı eşiği %${D.esik}), ${sim.turn} tur.</div>
    ${sim.daily ? `<p class="dailytag" style="margin-top:12px">Günün görüşmesi · ${state.daily && state.daily[sim.daily] ? `Bugünkü sonucun: ${esc(state.daily[sim.daily].ad)}, %${state.daily[sim.daily].ikna}. Serin: ${simStreak()} gün. Yarın yeni senaryo!` : ""}</p>` : ""}
    <div class="section"><h2>İkna eğrisi</h2>${simCurveSVG(sim.curve, D.esik)}</div>
    <div class="section"><h2>Beceri karnen</h2><div class="phases">${Object.entries(C.skills).filter(([k]) => sk[k] != null).map(([k, s]) => `<div class="prow" style="cursor:default;grid-template-columns:1.2fr 2fr 60px"><span class="nm">${esc(s.ad)}</span><span class="m"><span class="meter"><i style="width:${sk[k]}%;${sk[k] < 50 ? "background:var(--crit)" : sk[k] < 70 ? "background:var(--amber)" : ""}"></i></span></span><span class="nm" style="text-align:right">%${sk[k]}</span></div>`).join("")}</div>
      <p class="simhint" style="margin-top:8px">Sorduğun soru sayısı: ${asked} / ${sim.turn} tur. İyi bir keşif görüşmesinde turların yarısından fazlası soru içerir.</p></div>
    <div class="two" style="margin-top:28px">
      <div class="g"><h4>İkna oranını en çok artıran hamlelerin</h4>${topUp.length ? topUp.map(l => `<p style="margin:8px 0 0">"${esc(l.a)}" <b style="color:var(--accent)">+${l.delta}</b></p>`).join("") : "<p>Belirgin bir artış yok.</p>"}</div>
      <div class="z"><h4>En çok düşüren hamlelerin</h4>${topDown.length ? topDown.map(l => `<p style="margin:8px 0 0">"${esc(l.a)}" <b style="color:var(--crit)">${l.delta}</b><br><small>${esc(l.fb)}</small></p>`).join("") : "<p>İkna oranını düşüren bir hamle yapmadın.</p>"}</div>
    </div>
    <div class="section"><h2>Gizli ihtiyaçlar ve itirazlar</h2><div class="cards">${hidden.map(h => `<div class="card"><div class="k">${h.k === "gizli" ? "Gizli itiraz" : "Acı noktası"}: ${h.ok ? "ortaya çıkardın ✓" : "kaçırdın"}</div><h4>${esc(h.ad)}</h4>${h.ok ? "" : `<p class="simhint">Bu soru ortaya çıkarırdı: "${esc(simFill(h.soru, x))}"</p>`}</div>`).join("")}</div></div>
    <div class="section"><h2>MEDDPICC karnesi</h2><div class="cards">${Object.entries(C.med).map(([k, d]) => `<div class="card"><div class="k">${sim.med.has(k) ? "Öğrendin ✓" : "Öğrenmedin"}</div><h4 style="${sim.med.has(k) ? "" : "color:var(--muted)"}">${esc(d)}</h4></div>`).join("")}</div></div>
    <div class="section"><h2>Tur tur görüşme</h2><div class="res">${sim.log.map((l, i) => `<div class="rrow simturn"><div class="t">${i + 1}. tur ${mark(l.s)}<br><small>${l.delta >= 0 ? "+" : ""}${l.delta}</small></div>
      <div><p class="simq">${esc(l.q)}</p><p><b>Sen:</b> ${esc(l.a)}</p><p class="simhint">${esc(l.fb)}</p>${l.best && l.s < 2 ? `<p class="simbest"><b>Daha güçlü cevap:</b> ${esc(l.best)}</p>` : ""}</div></div>`).join("")}</div></div>
    ${weak.length ? `<div class="section"><h2>Önerilen çalışma</h2><p class="lede">Bu görüşmede zayıf kalan becerilerin için ilgili konular:</p><div class="cards">${weak.flatMap(([k]) => C.skills[k].konular.map(id => [k, id])).filter(([, id]) => TOP[id]).map(([k, id]) => `<div class="card"><div class="k">${esc(C.skills[k].ad)}, ${id}</div><h4>${esc(TOP[id].konu)}</h4><div class="act"><button class="btn sm primary" type="button" data-topic="${id}">Konuyu aç</button><button class="btn sm" type="button" data-quiz="${id}">Quiz</button></div></div>`).join("")}</div></div>` : ""}
    <div class="controls" style="margin-top:28px"><button class="btn primary" type="button" id="simAgain">Aynı senaryoyu tekrar oyna</button><button class="btn" type="button" id="simNew">Yeni senaryo</button><button class="btn" type="button" id="simChatShow">Görüşme dökümünü gör</button></div>
    <div id="simLogBox" hidden><div class="simchat" style="max-height:none">${simChatHTML()}</div></div>`;
  $$("#v-sim [data-topic]").forEach(b => b.addEventListener("click", () => openTopic(b.dataset.topic)));
  $("#simAgain").addEventListener("click", () => { simStart(sim.cfg, { daily:sim.daily }); renderSim(); window.scrollTo({ top:0 }); });
  $("#simNew").addEventListener("click", () => { sim = null; simView = "setup"; renderSim(); window.scrollTo({ top:0 }); });
  $("#simChatShow").addEventListener("click", () => { const b = $("#simLogBox"); b.hidden = !b.hidden; });
}
// Klavye: 1-6 ile kart seç
document.addEventListener("keydown", e => {
  if(!sim || simView !== "play" || !sim.node || sim.mode !== "kart" || e.ctrlKey || e.metaKey || e.altKey) return;
  if($("#v-sim").hidden || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "")) return;
  const k = "123456".indexOf(e.key); if(k < 0) return;
  const b = $$("#simOpts .qzopt")[k]; if(b){ e.preventDefault(); b.click(); }
});

/* ---------- yapay zekâ modu (SIM_AI.enabled false iken kullanılmaz) ---------- */
// Senaryo ve gizli profil tarayıcıda üretilir, Edge Function'a gönderilir; fonksiyon Claude ile müşteriyi canlandırıp
// her tur için { musteri, puan (-3..3), beceri, ortaya_cikan[], meddpicc[], ipucu, bitti, sonuc } döndürür.
function simAiPayload(extra){
  const C = SIMD.cfg, c = sim.cfg, x = sim.ctx;
  return Object.assign({
    senaryo:{ sektor:x.sektor, firma:x.firma, calisan:x.calisan, musteri:x.musteri, kisi:x.kisiAd, hitap:x.kisi, rol:C.roles[c.role].ad, odak:C.roles[c.role].odak,
      kisilik:C.personas[c.persona].ad + ": " + C.personas[c.persona].d, asama:C.stages[c.stage].ad, hedef:C.stages[c.stage].hedef, rekabet:C.comps[c.comp].d, rakip:x.rakip,
      zorluk:C.diffs[c.diff].ad, urun:x.urun, deger:x.deger, satici:x.satici, genelMudur:x.gm },
    gizli:{ acilar:[x.aci1, x.aci2, x.aci3].map(a => ({ ad:a.ad, detay:a.acilis, etki:a.etki })), itiraz:{ ad:x.gizli.ad, detay:x.gizli.acilis }, kriter:x.kriter },
    durum:{ ikna:sim.ikna, tur:sim.turn, ortaya_cikan:[...sim.revealed], meddpicc:[...sim.med] },
    gecmis:sim.chat.filter(m => m.w === "m" || m.w === "s").map(m => ({ rol:m.w === "m" ? "musteri" : "satici", metin:m.t }))
  }, extra || {});
}
async function simAiCall(body){
  if(!sb || !user) throw new Error("Yapay zekâ modu için giriş yapmalısın.");
  const { data, error } = await sb.functions.invoke(SIM_AI.fn, { body });
  if(error) throw error;
  if(data && data.error) throw new Error(data.error);
  return data;
}
async function simAiBegin(){
  sim.busy = true; renderSim();
  try{
    const r = await simAiCall(simAiPayload({ islem:"baslat" }));
    sim.chat.push({ w:"m", t:r.musteri });
  }catch(e){ sim.chat.push({ w:"n", t:"Yapay zekâya ulaşılamadı: " + (e.message || e) }); }
  sim.busy = false; renderSim();
}
async function simAiTurn(text){
  const C = SIMD.cfg, D = C.diffs[sim.cfg.diff];
  const lastQ = (sim.chat.filter(m => m.w === "m").pop() || {}).t || "";
  sim.chat.push({ w:"s", t:text }); sim.busy = true; renderSim();
  try{
    const r = await simAiCall(simAiPayload({ islem:"tur" }));
    const s = simClamp(Math.round(+r.puan || 0), -3, 3), before = sim.ikna;
    const delta = Math.round(s > 0 ? s * D.pos * 0.6 : s === 0 ? -1 : s * 5 * D.neg);
    sim.ikna = simClamp(sim.ikna + delta, 0, 100);
    if(s <= -2) sim.sabir -= 1;
    for(const k of r.ortaya_cikan || []) sim.revealed.add(k);
    for(const k of r.meddpicc || []) sim.med.add(k);
    sim.turn++; sim.curve.push(sim.ikna);
    sim.log.push({ id:"AI", slot:"ai", skill:C.skills[r.beceri] ? r.beceri : "deger", q:lastQ, a:text, s, delta:sim.ikna - before, best:r.daha_iyi || null, fb:r.ipucu || "", ikna:sim.ikna });
    if(sim.koc && r.ipucu) sim.chat.push({ w:"k", s, t:r.ipucu, d:sim.ikna - before });
    sim.chat.push({ w:"m", t:r.musteri });
    if(r.bitti){ sim.lastEnd = r.sonuc === "basari" ? "kapanis" : r.sonuc === "adim" ? "adim" : "zayif"; sim.lastTags = ["net_adim"]; }
    sim.busy = false;
    if(r.bitti || sim.turn >= 20) simFinish("plan");
    else if(sim.sabir <= 0) simFinish("sabir");
  }catch(e){ sim.busy = false; sim.chat.push({ w:"n", t:"Yapay zekâya ulaşılamadı: " + (e.message || e) }); }
  renderSim();
}
