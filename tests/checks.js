/* Satış Akademisi otomatik testleri.
   Hem GitHub Actions'da Node ile (tests/run.mjs) hem tarayıcıda (tests/run.html) çalışır.
   read(yol) → dosya metni döndüren Promise. Sonuç: { pass, fail, lines }. */
globalThis.runAllChecks = async function(read){
  const R = { pass:0, fail:0, lines:[] };
  const ok = (c, m) => { if(c) R.pass++; else R.fail++; R.lines.push((c ? "PASS " : "FAIL ") + m); return !!c; };
  const info = m => R.lines.push("INFO " + m);
  const txt = async p => { try{ return String(await read(p)).replace(/^﻿/, ""); }catch(e){ ok(false, p + " okunamadı: " + e.message); return null; } };
  const J = async p => { const s = await txt(p); if(s == null) return null; try{ return JSON.parse(s); }catch(e){ ok(false, p + " geçersiz JSON: " + e.message); return null; } };
  const first = (arr, n = 5) => arr.slice(0, n).join(" | ");

  /* ---------- data.json ---------- */
  const data = await J("data.json");
  const topicIds = new Set();
  if(data){
    const T = data.topics || [];
    ok(T.length === 124, "data.json: 124 konu (" + T.length + ")");
    T.forEach(t => topicIds.add(t.id));
    ok(topicIds.size === T.length, "data.json: konu kimlikleri benzersiz");
    const phases = new Set((data.phases || []).map(p => p.kod));
    ok(phases.size === 10, "data.json: 10 faz");
    const bad = T.filter(t => !t.id || !t.konu || !phases.has(t.faz) || !(t.saat > 0) || !["Kritik", "Önemli", "Destek"].includes(t.oncelik)).map(t => t.id);
    ok(!bad.length, "data.json: konu alanları (faz, saat, öncelik) " + first(bad));
    const noLesson = T.filter(t => !Array.isArray(t.anlatim) || !t.anlatim.length || !t.ornek).map(t => t.id);
    ok(!noLesson.length, "data.json: her konunun anlatımı ve örneği var " + first(noLesson));
    const weekRefs = (data.weeks || []).flatMap(w => w.konular).filter(id => !topicIds.has(id));
    ok(!weekRefs.length, "data.json: haftalık plandaki konular mevcut " + first(weekRefs));
    ok((data.methods || []).length >= 20 && data.methods.every(m => m.ad && m.ozet && Array.isArray(m.bilesenler)), "data.json: metodolojiler ve bileşenleri");
    ok((data.metrics || []).length > 0 && data.metrics.every(m => m.ad && m.formul), "data.json: metrikler");
    const badLinks = (data.resources || []).filter(r => r.link && !/^https:\/\//.test(r.link)).map(r => r.ad);
    ok(!badLinks.length, "data.json: kaynak linkleri https " + first(badLinks));
  }

  /* ---------- quiz.json ---------- */
  const quiz = await J("quiz.json");
  if(quiz && data){
    const missing = [...topicIds].filter(id => !Array.isArray(quiz[id]) || quiz[id].length !== 15);
    ok(!missing.length, "quiz.json: her konuda 15 soru " + first(missing));
    const extra = Object.keys(quiz).filter(id => !topicIds.has(id));
    ok(!extra.length, "quiz.json: fazladan konu yok " + first(extra));
    const probs = []; let longest = 0, total = 0;
    for(const [id, qs] of Object.entries(quiz)) (qs || []).forEach((q, i) => {
      total++;
      const o = q.o || [];
      if(!q.q || !q.e) probs.push(id + "#" + i + " soru/açıklama boş");
      if(o.length !== 4 || new Set(o).size !== 4 || o.some(x => !String(x).trim())) probs.push(id + "#" + i + " şıklar");
      if(!Number.isInteger(q.a) || q.a < 0 || q.a > 3) probs.push(id + "#" + i + " cevap indeksi");
      else if(o.length === 4 && o.every((x, j) => j === q.a || String(x).length < String(o[q.a]).length)) longest++;
    });
    ok(!probs.length, "quiz.json: soru yapısı (" + total + " soru) " + first(probs));
    const ratio = total ? longest / total : 0;
    ok(ratio < 0.35, `quiz.json: doğru şık en uzun şık olma oranı %${Math.round(ratio * 100)} (sınır %35, rastgele ≈%25)`);
  }

  /* ---------- templates.json ---------- */
  const tpl = await J("templates.json");
  if(tpl){
    ok(Array.isArray(tpl) && tpl.length >= 10, "templates.json: en az 10 şablon (" + (tpl.length || 0) + ")");
    ok(new Set(tpl.map(t => t.id)).size === tpl.length, "templates.json: kimlikler benzersiz");
    const bad = tpl.filter(t => !t.ad || !t.kat || !t.metin || !t.ipucu || !t.ne_zaman || (t.konular || []).some(id => data && !topicIds.has(id))).map(t => t.id);
    ok(!bad.length, "templates.json: alanlar ve konu bağlantıları " + first(bad));
  }

  /* ---------- simülasyon içeriği ---------- */
  const [cfg, sectors, na, nb] = await Promise.all(["config", "sectors", "nodes_a", "nodes_b"].map(f => J("sim/" + f + ".json")));
  if(cfg && sectors && na && nb){
    const nodes = [...na, ...nb, ...Object.values(sectors).flatMap(s => s.teknik || [])];
    const ids = new Set(nodes.map(n => n.id));
    ok(ids.size === nodes.length, "sim: düğüm kimlikleri benzersiz (" + nodes.length + " düğüm)");
    const keys = new Set(["satici", "firma", "kisi", "kisiAd", "rol", "gm", "urun", "deger", "kanit", "pilot", "rakip", "metrik", "musteri", "tetik", "kriter", "sektor", "calisan", "bulunan"]);
    const varOk = k => keys.has(k) || /^aci[123]\.(ad|soru|acilis|etkiSoru|etki)$/.test(k) || /^gizli\.(ad|soru|acilis)$/.test(k);
    const probs = []; let opts = 0;
    for(const n of nodes){
      if(!cfg.slotSkill[n.slot]) probs.push(n.id + " bilinmeyen slot " + n.slot);
      if(!Array.isArray(n.o) || n.o.length < 5) probs.push(n.id + " 5'ten az şık");
      else {
        if(!n.o.some(o => o.s >= 2)) probs.push(n.id + " iyi şık yok");
        if(!n.o.some(o => o.s < 0)) probs.push(n.id + " zayıf şık yok");
      }
      const texts = [n.q, ...Object.values(n.qp || {})];
      for(const o of n.o || []){
        opts++;
        texts.push(o.t, o.r, o.rf || "", o.fb);
        if(!Number.isInteger(o.s) || o.s < -3 || o.s > 3 || !o.t || !o.r || !o.fb) probs.push(n.id + " eksik/yanlış şık alanı");
        if(o.go && !ids.has(o.go)) probs.push(n.id + " dallanma hedefi yok: " + o.go);
        for(const k of o.k || []) if(!/^[a-z_]+$/.test(k)) probs.push(n.id + " etiket: " + k);
      }
      if(["sonraki", "sonraki_soguk", "kapanis"].includes(n.slot) && (n.o || []).some(o => !o.end)) probs.push(n.id + " kapanış şıkkında end yok");
      for(const t of texts) for(const m of String(t || "").matchAll(/\{([^}]+)\}/g)) if(!varOk(m[1])) probs.push(n.id + " bilinmeyen değişken {" + m[1] + "}");
    }
    ok(!probs.length, "sim: içerik doğrulama (" + opts + " cevap kartı) " + first(probs, 8));
    const secBad = Object.entries(sectors).filter(([, s]) => (s.acilar || []).length !== 3 || !s.gizli || (s.teknik || []).length < 2 || !(s.urunler || []).length || !(s.firmalar || []).length).map(([k]) => k);
    ok(!secBad.length, "sim: sektör profilleri eksiksiz " + first(secBad));
    const planBad = Object.entries(cfg.stages).flatMap(([st, s]) => s.plan.filter(slot => slot !== "rakip" && !nodes.some(n => n.slot === slot)).map(slot => st + ":" + slot));
    ok(!planBad.length, "sim: aşama planlarındaki her adım için soru var " + first(planBad));
    if(data){
      const skBad = Object.values(cfg.skills).flatMap(s => s.konular).filter(id => !topicIds.has(id));
      ok(!skBad.length, "sim: beceri → konu eşlemeleri geçerli " + first(skBad));
    }
  }

  /* ---------- simülasyon motoru: 400 otomatik görüşme ---------- */
  const simSrc = await txt("sim.js");
  if(simSrc && cfg && sectors && na && nb){
    let E = null;
    try{
      const state = {};
      const pad = n => String(n).padStart(2, "0"), ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n); return ds(x); };
      const stubs = { document:{ addEventListener(){} }, state, persist(){}, esc:s => String(s), $:() => null, $$:() => [], todayStr:() => ds(new Date()), addDays, fmtDate:s => s,
        TOP:{}, openTopic(){}, show(){}, sb:null, user:null, window:{ scrollTo(){} }, confirm:() => true };
      const make = new Function(...Object.keys(stubs), simSrc + "\n;return { simSetData, simStart, simAdvance, simAnswer, simDailyCfg, simWeakSkills, simFill, getSim: () => sim };");
      E = make(...Object.values(stubs));
      E.simSetData(cfg, sectors, na, nb);
      E.state = state;
      ok(true, "sim.js: motor yüklendi");
    }catch(e){ ok(false, "sim.js: motor yüklenemedi: " + e.message); }
    if(E){
      const pickKey = o => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
      const strat = {
        best:o => o.reduce((b, x, i) => x.s > o[b].s ? i : b, 0),
        random:o => Math.floor(Math.random() * o.length),
        worst:o => o.reduce((b, x, i) => x.s < o[b].s ? i : b, 0)
      };
      const agg = {}, bad = [];
      // Kart uzunluğu yanlılığı: ekranda görünen (şablonu doldurulmuş) metinlerle ölçülür
      const lenStat = { shown:0, bestLongest:0, bestShortest:0, ratios:[] };
      const measure = s => {
        const texts = s.node.o.map(o => E.simFill(o.t, s.ctx)), max = Math.max(...s.node.o.map(o => o.s));
        const bi = s.node.o.findIndex(o => o.s === max), bl = texts[bi].length, others = texts.filter((_, i) => i !== bi).map(t => t.length);
        lenStat.shown++; if(others.every(l => bl > l)) lenStat.bestLongest++; if(others.every(l => bl < l)) lenStat.bestShortest++;
        lenStat.ratios.push(bl / (others.reduce((a, b) => a + b, 0) / others.length));
      };
      for(let run = 0; run < 400; run++){
        const sname = ["best", "random", "worst", "best"][run % 4];
        const c = { sector:pickKey(sectors), role:pickKey(cfg.roles), persona:pickKey(cfg.personas), stage:pickKey(cfg.stages), size:pickKey(cfg.sizes), comp:pickKey(cfg.comps),
          diff:"orta", product:"0", customAd:"", customDeger:"", koc:true, mode:"kart", ozel:run % 10 === 0 ? { on:true, firma:"Test Firma", acilar:["kalıp değişim süresi", "", ""], itiraz:"önceki tedarikçi geç teslim etti" } : { on:false } };
        try{
          E.simStart(c); E.simAdvance();
          let guard = 0, s = E.getSim();
          while(!s.ended && guard++ < 60){ measure(s); E.simAnswer(strat[sname](s.node.o)); s = E.getSim(); }
          if(guard >= 60) bad.push("sonsuz döngü " + JSON.stringify(c));
          const A = agg[sname] = agg[sname] || { n:0, basari:0, bekle:0, kayip:0, turns:[] };
          A.n++; A[s.outcome.k]++; A.turns.push(s.turn);
          const t = s.chat.map(m => m.t).join(" ");
          const m = t.match(/.{0,30}(\{|undefined|NaN|\bnull\b).{0,30}/);
          if(m) bad.push("şablon hatası: " + m[0]);
        }catch(e){ bad.push("hata: " + e.message + " " + JSON.stringify(c)); }
      }
      ok(!bad.length, "sim: 400 görüşmede hata, döngü ya da boş şablon yok " + first(bad, 3));
      const rate = (k, o) => agg[k] ? agg[k][o] / agg[k].n : 0, avg = a => a.reduce((x, y) => x + y, 0) / a.length;
      for(const [k, A] of Object.entries(agg)) info(`sim ${k}: ${A.n} görüşme, başarı ${A.basari}, beklemede ${A.bekle}, kayıp ${A.kayip}, ortalama ${avg(A.turns).toFixed(1)} tur`);
      ok(rate("best", "basari") >= 0.9, `sim: en iyi cevaplarla başarı ≥ %90 (%${Math.round(rate("best", "basari") * 100)})`);
      ok(rate("worst", "kayip") === 1, `sim: en kötü cevaplarla hep kayıp (%${Math.round(rate("worst", "kayip") * 100)})`);
      ok(rate("random", "basari") <= 0.3, `sim: rastgele cevaplarla başarı ≤ %30 (%${Math.round(rate("random", "basari") * 100)})`);
      const blRate = lenStat.bestLongest / Math.max(1, lenStat.shown), blRatio = avg(lenStat.ratios);
      const bsRate = lenStat.bestShortest / Math.max(1, lenStat.shown);
      info(`sim kart uzunluğu: ${lenStat.shown} gösterimde en iyi kart en uzun %${Math.round(blRate * 100)}, en kısa %${Math.round(bsRate * 100)} (5 kartta rastgele ≈ %20), en iyi / diğerleri ortalama oran ${blRatio.toFixed(2)} (dengeli ≈ 1.0)`);
      ok(blRate <= 0.4 && bsRate <= 0.4 && blRatio >= 0.85 && blRatio <= 1.2, `sim: en iyi cevap uzunluğundan belli olmuyor (en uzun %${Math.round(blRate * 100)}, en kısa %${Math.round(bsRate * 100)}, ikisi de ≤ %40; oran ${blRatio.toFixed(2)}, 0.85-1.20 arası)`);
      const bt = agg.best ? avg(agg.best.turns) : 0;
      ok(bt >= 8 && bt <= 16, `sim: iyi oynanan görüşme 8-16 tur sürüyor (ortalama ${bt.toFixed(1)})`);
      // Günün görüşmesi: aynı gün herkese aynı senaryo
      try{
        const day = "2026-10-01", c1 = E.simDailyCfg(day), c2 = E.simDailyCfg(day);
        E.simStart(c1, { daily:day }); E.simAdvance(); const s1 = E.getSim(), f1 = [s1.ctx.firma, s1.ctx.kisiAd, s1.node.id, s1.order.join("")].join("|");
        E.simStart(c2, { daily:day }); E.simAdvance(); const s2 = E.getSim(), f2 = [s2.ctx.firma, s2.ctx.kisiAd, s2.node.id, s2.order.join("")].join("|");
        ok(JSON.stringify(c1) === JSON.stringify(c2) && f1 === f2, "sim: günün görüşmesi aynı gün için aynı senaryo");
        const other = E.simDailyCfg("2026-10-02");
        ok(JSON.stringify(other) !== JSON.stringify(c1), "sim: farklı günlerde farklı senaryo");
      }catch(e){ ok(false, "sim: günün görüşmesi testi hata verdi: " + e.message); }
    }
  }

  /* ---------- index.html ---------- */
  const html = await txt("index.html");
  if(html){
    const views = [...html.matchAll(/data-view="([a-z]+)"/g)].map(m => m[1]);
    const missing = views.filter(v => !html.includes(`id="v-${v}"`));
    ok(views.length >= 10 && !missing.length, "index.html: her sekmenin bölümü var (" + views.length + " sekme) " + first(missing));
    ok(/<script src="sim\.js"><\/script>/.test(html), "index.html: sim.js yükleniyor");
    const icons = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g)].map(m => m[1]);
    const iconMissing = [];
    for(const f of icons){ try{ const c = await read(f); if(!c || !String(c).length) iconMissing.push(f); }catch(e){ iconMissing.push(f); } }
    ok(icons.length >= 3 && !iconMissing.length, "index.html: favikon, Apple ikonu ve manifest dosyaları mevcut (" + icons.join(", ") + ") " + iconMissing.join(", "));
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    let syntax = "";
    for(const s of inline){ try{ new Function(s); }catch(e){ syntax = e.message; } }
    ok(inline.length && !syntax, "index.html: ana betikte sözdizimi hatası yok " + syntax);
    ok(!/sb_secret_|service_role/i.test(html + (simSrc || "")), "index.html / sim.js: gizli anahtar sızmamış");
  }
  return R;
};
