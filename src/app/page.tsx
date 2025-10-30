"use client";
import { useEffect, useState } from "react";

type Fundamentals = { PERatio?: string; Name?: string; Currency?: string };

type StockData = {
  quote?: { c?: number; dp?: number };        // Finnhub (USD)
  priceEur?: number | null;                   // EUR (umgerechnet)
  sma100?: { value?: number | null };         // EUR
  sma200?: { value?: number | null };         // EUR
  fundamentals?: Fundamentals;
  currencyOriginal?: string;                  // "USD" etc.
  fx?: { usdToEur?: number };
};

type DataMap = Record<string, StockData>;

const fmtEUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export default function Dashboard() {
  const [data, setData] = useState<DataMap>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/latest.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setData(j))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="p-4">Lade Daten …</p>;
  if (err) return <p className="p-4 text-red-600">Fehler: {err}</p>;

  const entries = Object.entries(data);
  if (entries.length === 0) {
    return (
      <main className="p-6 max-w-xl">
        <h1 className="text-xl font-semibold mb-2">Noch keine Daten</h1>
        <p>Bitte führe im Terminal aus: <code>npm run fetch</code></p>
      </main>
    );
  }

  return (
    <main className="p-4 grid gap-4 grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
      {entries.map(([sym, d]) => {
        const eur = d.priceEur ?? null;
        const delta = d.quote?.dp ?? 0;
        const pe =
          d.fundamentals?.PERatio !== undefined
            ? Number(d.fundamentals.PERatio)
            : undefined;

        const sma100 =
          d.sma100?.value != null ? fmtEUR.format(d.sma100.value) : "—";
        const sma200 =
          d.sma200?.value != null ? fmtEUR.format(d.sma200.value) : "—";

        return (
          <article
            key={sym}
            className="rounded-2xl bg-white dark:bg-zinc-900 shadow p-4"
          >
            <header className="mb-2">
              <h2 className="text-base font-semibold">{sym}</h2>
              <p className="text-xs text-zinc-500">
                {d.fundamentals?.Name ?? "—"}
              </p>
            </header>

            <div className="space-y-1">
              <p>
                <span className="text-xs text-zinc-500">Kurs (€):</span>{" "}
                <strong>{eur != null ? fmtEUR.format(eur) : "—"}</strong>
              </p>
              <p>
                <span className="text-xs text-zinc-500">Δ Tag:</span>{" "}
                <span
                  className={delta >= 0 ? "text-emerald-600" : "text-red-600"}
                >
                  {Number.isFinite(delta) ? delta.toFixed(2) : "—"}%
                </span>
              </p>
              <p>
                <span className="text-xs text-zinc-500">KGV:</span>{" "}
                {pe !== undefined && !Number.isNaN(pe) ? pe.toFixed(1) : "—"}
              </p>
              <p>
                <span className="text-xs text-zinc-500">SMA 100 (€):</span>{" "}
                {sma100}
              </p>
              <p>
                <span className="text-xs text-zinc-500">SMA 200 (€):</span>{" "}
                {sma200}
              </p>

              {d.currencyOriginal && d.currencyOriginal !== "EUR" && (
                <p className="text-[11px] text-zinc-500 mt-2">
                  Originalwährung: {d.currencyOriginal} • Umrechnung: 1 USD ={" "}
                  {d.fx?.usdToEur ? fmtEUR.format(d.fx.usdToEur).replace("€", "€ ") : "—"}
                </p>
              )}
            </div>
          </article>
        );
      })}
    </main>
  );
}
