// scripts/fetchData.mjs
import { writeFile, mkdir } from "node:fs/promises";

/** =======================
 *  Konfiguration
 *  ======================= */
const TICKERS = ["AAPL", "MSFT", "NVDA"];      // -> deine Watchlist
const FINNHUB_KEY = process.env.FINNHUB_KEY;   // Realtime-Quote
const ALPHA_KEY   = process.env.ALPHA_KEY;     // Fundamentals (optional, limitiert)

// Alpha Vantage: 5 req/min => konservativ drosseln
const ALPHA_DELAY_MS = 12500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!FINNHUB_KEY) {
  console.error("❌ FINNHUB_KEY fehlt (.env.local)");
  process.exit(1);
}
if (!ALPHA_KEY) {
  console.warn("⚠ ALPHA_KEY fehlt – Fundamentals evtl. leer.");
}

/** =======================
 *  HTTP Helpers
 *  ======================= */
async function getText(url, { retries = 1, delay = 1500 } = {}) {
  for (let i = 0; i <= retries; i++) {
    const r = await fetch(url);
    if (r.ok) return r.text();
    if (r.status === 429 || (r.status >= 500 && r.status <= 599)) {
      if (i < retries) {
        const backoff = delay * (i + 1);
        console.warn(`⏳ ${r.status} für ${url} – retry in ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
    }
    const body = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText} for ${url}${body ? " – " + body : ""}`);
  }
}
async function getJSON(url, opts) {
  const txt = await getText(url, opts);
  try { return JSON.parse(txt); } catch { throw new Error(`Invalid JSON from ${url}`); }
}

/** =======================
 *  Mathe
 *  ======================= */
function sma(arr, period) {
  if (!Array.isArray(arr) || arr.length < period) return null;
  let sum = 0;
  for (let i = arr.length - period; i < arr.length; i++) sum += arr[i];
  return sum / period;
}

/** =======================
 *  Datenquellen
 *  ======================= */

// 1) Realtime-Quote (Finnhub)
async function finnhubQuote(symbol) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`;
  return getJSON(url);
}

// 2) Historische Tagesdaten – Stooq (kostenlos, kein Key)
async function stooqDailyCloses(symbol) {
  const s = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${s}&i=d`;
  const csv = await getText(url);
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  const header = (lines[0] || "").toLowerCase().replace(/\s+/g, "");
  if (!header.includes("date") || !header.includes("close")) {
    throw new Error("Stooq CSV-Header unerwartet");
  }
  const closes = lines
    .slice(1)
    .map((ln) => {
      const parts = ln.split(/[;,]/); // Komma oder Semikolon
      const v = Number(parts[4]);     // Close
      return Number.isFinite(v) ? v : null;
    })
    .filter((v) => v != null);
  if (!closes.length) throw new Error("keine Close-Werte");
  return closes; // älteste -> neueste
}

// 3) Fundamentals (Alpha Vantage Overview) – optional
async function alphaOverview(symbol) {
  const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${ALPHA_KEY}`;
  try {
    const j = await getJSON(url);
    if (j && typeof j === "object" && "PERatio" in j) return j;
  } catch {/* noop */}
  return undefined;
}

/** =======================
 *  FX USD→EUR – robuste Mehrquellen-Strategie
 *  ======================= */

// (a) exchangerate.host – JSON, kein Key
async function fxViaExchangerateHost() {
  const url = "https://api.exchangerate.host/latest?base=USD&symbols=EUR";
  const j = await getJSON(url);
  const v = j?.rates?.EUR;
  if (!Number.isFinite(v) || v <= 0) throw new Error("exchangerate.host EUR fehlend");
  return v; // already USD->EUR
}

// (b) ECB (EZB) – XML, Basis EUR -> wir invertieren zu USD->EUR
async function fxViaECB() {
  const url = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
  const xml = await getText(url);
  // Suche <Cube currency="USD" rate="1.0xxx"/>
  const m = xml.match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/i);
  if (!m) throw new Error("ECB USD-Rate nicht gefunden");
  const eurToUsd = Number(m[1]); // 1 EUR = eurToUsd USD
  if (!Number.isFinite(eurToUsd) || eurToUsd <= 0) throw new Error("ECB Rate ungültig");
  const usdToEur = 1 / eurToUsd; // 1 USD in EUR
  return usdToEur;
}

// (c) Stooq – CSV EURUSD -> invertieren
async function fxViaStooq() {
  const url = "https://stooq.com/q/d/l/?s=eurusd.fx&i=d";
  const csv = await getText(url);
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  const header = (lines[0] || "").toLowerCase().replace(/\s+/g, "");
  if (!header.includes("date") || !header.includes("close")) throw new Error("FX-CSV-Header unerwartet");
  const last = lines[lines.length - 1];
  const parts = last.split(/[;,]/);
  const eurusd = Number(parts[4]); // USD pro 1 EUR
  if (!Number.isFinite(eurusd) || eurusd <= 0) throw new Error("EURUSD ungültig");
  return 1 / eurusd; // 1 USD in EUR
}

// Master: probiere A -> B -> C
async function getUsdToEur() {
  const errors = [];
  try { const v = await fxViaExchangerateHost(); console.log(`✔ FX via exchangerate.host: 1 USD = ${v.toFixed(4)} €`); return v; }
  catch (e) { errors.push(e.message); }
  try { const v = await fxViaECB(); console.log(`✔ FX via ECB: 1 USD = ${v.toFixed(4)} €`); return v; }
  catch (e) { errors.push(e.message); }
  try { const v = await fxViaStooq(); console.log(`✔ FX via Stooq: 1 USD = ${v.toFixed(4)} €`); return v; }
  catch (e) { errors.push(e.message); }
  throw new Error(`Alle FX-Quellen fehlgeschlagen: ${errors.join(" | ")}`);
}

/** =======================
 *  Orchestrierung pro Ticker
 *  ======================= */
async function fetchOne(symbol, i, usdToEur) {
  // 1) Realtime-Quote in USD
  const quote = await finnhubQuote(symbol); // { c, dp, ... } – c in USD

  // 2) Stooq-Historie (USD) & SMAs (USD)
  const closesUsd = await stooqDailyCloses(symbol);
  const sma100Usd = sma(closesUsd, 100);
  const sma200Usd = sma(closesUsd, 200);

  // 3) Fundamentals (Alpha) – optional & gedrosselt
  let fundamentals;
  if (ALPHA_KEY) {
    if (i > 0) await sleep(ALPHA_DELAY_MS);
    fundamentals = await alphaOverview(symbol);
  }

  // 4) Umrechnung USD → EUR
  const priceEur = Number.isFinite(quote?.c) ? quote.c * usdToEur : null;
  const sma100Eur = Number.isFinite(sma100Usd) ? sma100Usd * usdToEur : null;
  const sma200Eur = Number.isFinite(sma200Usd) ? sma200Usd * usdToEur : null;

  return {
    quote,                       // Original-Quote von Finnhub (USD)
    priceEur,                    // EUR umgerechnet
    sma100: { value: sma100Eur },
    sma200: { value: sma200Eur },
    fundamentals,                // KGV etc. (einheitenlos)
    currencyOriginal: "USD",
    fx: { usdToEur }             // Transparenz
  };
}

/** =======================
 *  main
 *  ======================= */
async function main() {
  console.log("⏳ Lade USD→EUR-Kurs …");
  const usdToEur = await getUsdToEur();

  console.log(`⏳ Lade Daten für ${TICKERS.length} Ticker ...`);
  const out = {};
  for (let i = 0; i < TICKERS.length; i++) {
    const t = TICKERS[i];
    try {
      out[t] = await fetchOne(t, i, usdToEur);
      console.log(`✔ ${t}`);
    } catch (e) {
      console.warn(`⚠ Fehler bei ${t}: ${e.message}`);
    }
  }

  await mkdir("public/data", { recursive: true });
  await writeFile("public/data/latest.json", JSON.stringify(out, null, 2), "utf8");
  console.log("✅ Daten aktualisiert: public/data/latest.json");
}

main().catch((e) => {
  console.error("❌ Fetch fehlgeschlagen:", e);
  process.exit(1);
});
