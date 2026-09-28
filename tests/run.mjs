// GitHub Actions'da çalışır: node tests/run.mjs  (hata varsa çıkış kodu 1, yayın durur)
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await import("./checks.js");
const R = await globalThis.runAllChecks(p => readFile(path.join(root, p), "utf8"));
for (const line of R.lines) console.log(line);
console.log(`\n${R.pass} kontrol geçti, ${R.fail} kontrol başarısız.`);
process.exit(R.fail ? 1 : 0);
