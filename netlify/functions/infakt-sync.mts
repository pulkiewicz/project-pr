import type { Config } from "@netlify/functions";
import {
  isSyncHour,
  syncFromInfakt,
} from "../../server/modules/invoices/sync.ts";
import { runtimeDeps } from "../../server/runtime.ts";

/**
 * Automatyczna aktualizacja z inFakt o 8:00 i 14:00 (oprócz przycisku „Synchronizuj”): faktury kosztowe,
 * sprzedażowe i Rozliczenia (dopasowanie operacji z wyciągów do faktur).
 */
export default async () => {
  const now = new Date();
  // Harmonogram Netlify jest w UTC — uruchamiamy co godzinę z zakresu czasu letniego i zimowego, wykonujemy tylko o 8:00 i 14:00 w Warszawie.
  if (!isSyncHour(now)) return;
  const deps = runtimeDeps();
  if (!deps.infakt) {
    console.log("[pmo] infakt sync: INFAKT_API_KEY nie ustawiony — pomijam");
    return;
  }
  const result = await syncFromInfakt(deps.db, deps.infakt, null, now);
  console.log(`[pmo] infakt sync: ${JSON.stringify(result)}`);
};

// 6/7 UTC = 8:00 w Warszawie (lato/zima), 12/13 UTC = 14:00.
export const config: Config = { schedule: "0 6,7,12,13 * * *" };
