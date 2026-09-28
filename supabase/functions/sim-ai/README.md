# Simülasyon: yapay zekâ modunu açma

Kod hazır ama kapalı. Açmak için 4 adım:

1. **Tabloyu oluştur.** Supabase → SQL Editor → `supabase/sim_ai.sql` içeriğini yapıştır → Run.
2. **Fonksiyonu yükle.** Supabase → Edge Functions → Deploy a new function → "Via Editor" → adı `sim-ai` → `index.ts` içeriğini yapıştır → Deploy.
   (Supabase CLI varsa: `supabase functions deploy sim-ai`.)
3. **API anahtarını ekle.** console.anthropic.com → API Keys → yeni anahtar. Supabase → Edge Functions → Secrets → `ANTHROPIC_API_KEY` = anahtar.
   Anahtarı koda, sohbete ya da GitHub'a asla yazma; sadece bu Secrets ekranına.
   İsteğe bağlı secret'lar: `SIM_MODEL` (varsayılan `claude-sonnet-5`), `SIM_DAILY_LIMIT` (kişi başı günlük görüşme, varsayılan 5).
4. **Sitede aç.** `sim.js` içinde `const SIM_AI = { enabled:false, ... }` satırını `enabled:true` yap.

Güvenlik: fonksiyon sadece giriş yapmış kullanıcılara cevap verir, günlük sınır `sim_usage` tablosunda tutulur, bu tabloya tarayıcıdan erişim yoktur.
Maliyet: her tur bir Claude API çağrısıdır; faturayı Anthropic konsolundaki Usage ekranından izleyebilirsin.
