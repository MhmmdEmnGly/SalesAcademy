// Satış simülasyonu, yapay zekâ modu: müşteriyi Claude canlandırır.
// Gerekli secret: ANTHROPIC_API_KEY. İsteğe bağlı: SIM_MODEL (varsayılan claude-sonnet-5), SIM_DAILY_LIMIT (varsayılan 5 görüşme/gün).
// SUPABASE_URL, SUPABASE_ANON_KEY ve SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik sağlanır.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("SIM_MODEL") ?? "claude-sonnet-5";
const DAILY_LIMIT = Number(Deno.env.get("SIM_DAILY_LIMIT") ?? "5");
const MAX_TURNS = 24;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Model her turda bu aracı çağırmak zorunda; böylece cevap her zaman yapılandırılmış gelir
const TOOL = {
  name: "musteri_turu",
  description: "Müşterinin bu turdaki cevabını ve satıcının son cevabının değerlendirmesini döndürür.",
  input_schema: {
    type: "object",
    properties: {
      musteri: { type: "string", description: "Müşterinin söylediği, karakterde kalarak, Türkçe, 1-4 cümle." },
      puan: { type: "integer", minimum: -3, maximum: 3, description: "Satıcının son cevabının kalitesi: 3 mükemmel, 0 nötr/etkisiz, -3 ilişkiye zarar veren. Açılış turunda 0." },
      beceri: { type: "string", enum: ["acilis", "kesif", "deger", "itiraz", "paydas", "kapanis"], description: "Son cevabın ağırlıklı olarak hangi beceriyi sınadığı." },
      ortaya_cikan: { type: "array", items: { type: "string", enum: ["aci1", "aci2", "aci3", "gizli"] }, description: "Bu turda müşterinin açıkça paylaştığı gizli bilgiler." },
      meddpicc: { type: "array", items: { type: "string", enum: ["M", "E", "D1", "D2", "P", "I", "C1", "C2"] }, description: "Satıcının bu turda öğrendiği MEDDPICC unsurları." },
      ipucu: { type: "string", description: "Koç notu: son cevabın neden iyi ya da zayıf olduğu, tek cümle." },
      daha_iyi: { type: "string", description: "Puan 2'nin altındaysa, aynı anda söylenebilecek daha güçlü bir cevap örneği." },
      bitti: { type: "boolean", description: "Görüşme doğal olarak sona erdiyse true." },
      sonuc: { type: "string", enum: ["basari", "adim", "belirsiz", "kayip"], description: "Bitti ise: basari (satış), adim (net sonraki adım), belirsiz, kayip." },
    },
    required: ["musteri", "puan", "beceri", "ortaya_cikan", "meddpicc", "ipucu", "bitti"],
  },
};

function systemPrompt(p: any) {
  const s = p.senaryo, g = p.gizli;
  return `Bir B2B satış eğitim simülasyonunda MÜŞTERİYİ canlandırıyorsun. Kullanıcı satıcıdır; sen asla satıcı gibi konuşmazsın.

Rolün: ${s.kisi} (${s.rol}), ${s.firma}. Firma ${s.calisan} bir ${s.musteri}, sektör: ${s.sektor}. Hitap: ${s.hitap}.
Odak noktan: ${s.odak}. Kişiliğin: ${s.kisilik}. Genel müdürünüz: ${s.genelMudur}.
Görüşme aşaması: ${s.asama}. Satıcının hedefi: ${s.hedef}. Rekabet: ${s.rekabet} Rakip firma: ${s.rakip}.
Satıcı ${s.satici} firmasından ve "${s.urun}" satıyor (${s.deger}). Zorluk: ${s.zorluk}.

GİZLİ PROFİLİN (kendiliğinden söyleme; satıcı doğru, açık uçlu ve ilgili bir soru sorarsa ve güven oluştuysa paylaş):
${g.acilar.map((a: any, i: number) => `- aci${i + 1}: ${a.ad}. Detay: ${a.detay} Etki (sadece etkiyi soran soruya): ${a.etki}`).join("\n")}
- gizli: ${g.itiraz.ad}. Detay: ${g.itiraz.detay} (bunu ancak güven yüksekse ve satıcı geçmiş deneyimi ya da çekinceni sorarsa söylersin)
- Karar kriterin: ${g.kriter}

KURALLAR:
- Gerçekçi bir Türk iş insanı gibi konuş; kısa, doğal, kişiliğine uygun. Tek seferde tek bir soru ya da tepki.
- Satıcının cevabına göre tepki ver: abartı ve kanıtsız iddiaya şüpheyle, erken ürün anlatımına sabırsızlıkla, iyi sorulara açılarak, baskıya geri çekilerek.
- Zorluk "Zor" ise daha az hoşgörülü ol. Kişiliğin gereği olan tepkileri tutarlı sürdür.
- Satıcı net bir sonraki adım isterse ve yeterince ikna olduysan kabul et; olmadıysan kibarca ertele. Görüşme 10-16 turda doğal olarak kapanmalı.
- Değerlendirmede satış metodolojilerini (SPIN, MEDDPICC, Challenger, Sandler, taktiksel empati) ölçüt al; puanı dürüst ver.
- Yalnızca musteri_turu aracını çağırarak cevap ver.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST bekleniyor" }, 405);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Yapay zekâ modu henüz etkin değil (API anahtarı eklenmemiş)." }, 503);

  // Yalnızca giriş yapmış kullanıcılar
  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Giriş yapmalısın." }, 401);

  let p: any;
  try { p = await req.json(); } catch { return json({ error: "Geçersiz istek" }, 400); }
  if (!p?.senaryo || !p?.gizli || !Array.isArray(p?.gecmis)) return json({ error: "Eksik senaryo" }, 400);
  if (p.gecmis.length > MAX_TURNS * 2 + 2) return json({ error: "Görüşme çok uzadı; yeni bir görüşme başlat." }, 400);

  // Günlük sınır: her yeni görüşme (islem=baslat) bir hak kullanır
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = await admin.from("sim_usage").select("sims, turns").eq("user_id", user.id).eq("day", day).maybeSingle();
  const sims = usage?.sims ?? 0, turns = usage?.turns ?? 0;
  if (p.islem === "baslat" && sims >= DAILY_LIMIT) return json({ error: `Bugünkü ${DAILY_LIMIT} yapay zekâ görüşmesi hakkını kullandın. Kart modunda sınırsız oynayabilirsin.` }, 429);
  if (turns >= DAILY_LIMIT * MAX_TURNS) return json({ error: "Bugünkü kullanım sınırına ulaşıldı." }, 429);

  // Geçmişi Claude mesajlarına çevir: müşteri = assistant, satıcı = user
  const messages: any[] = [];
  for (const m of p.gecmis.slice(-MAX_TURNS * 2)) {
    const role = m.rol === "musteri" ? "assistant" : "user";
    const text = String(m.metin ?? "").slice(0, 1500);
    if (messages.length && messages[messages.length - 1].role === role) messages[messages.length - 1].content += "\n" + text;
    else messages.push({ role, content: text });
  }
  if (!messages.length || messages[0].role !== "user") messages.unshift({ role: "user", content: "(Görüşme başlıyor. Müşteri olarak ilk sen konuş.)" });
  if (messages[messages.length - 1].role !== "user") messages.push({ role: "user", content: "(Devam et.)" });

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 800, system: systemPrompt(p), messages,
      tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name },
    }),
  });
  if (!r.ok) { console.error("Anthropic hata", r.status, await r.text()); return json({ error: "Yapay zekâ servisine ulaşılamadı." }, 502); }
  const out = await r.json();
  const tool = (out.content ?? []).find((c: any) => c.type === "tool_use");
  if (!tool) return json({ error: "Yapay zekâ beklenen biçimde cevap vermedi." }, 502);

  await admin.from("sim_usage").upsert({ user_id: user.id, day, sims: sims + (p.islem === "baslat" ? 1 : 0), turns: turns + 1 });
  return json(tool.input);
});
