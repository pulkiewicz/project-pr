import type { InvoiceSyncResult } from "#shared";
import { invoiceSettings } from "../../auth/access.ts";
import type { Database } from "../../db/client.ts";
import type { InfaktClient } from "../../integrations/infakt/types.ts";
import { runMatching } from "../bank/reconcile.ts";
import { syncSalesSafe } from "../finance/service.ts";
import { syncInvoices } from "./service.ts";

/** Godziny (czas warszawski) automatycznej aktualizacji z inFakt. */
export const SYNC_HOURS_WARSAW = [8, 14];

/** Czy to godzina automatycznej aktualizacji — harmonogram Netlify jest w UTC, więc sprawdzamy czas warszawski (lato/zima). */
export const isSyncHour = (d: Date) =>
  SYNC_HOURS_WARSAW.includes(
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Warsaw",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(d),
    ),
  );

/**
 * Pełna aktualizacja z inFakt (przycisk „Synchronizuj” i harmonogram): faktury kosztowe, sprzedażowe
 * (Plan finansowy), a na końcu Rozliczenia — dopasowanie operacji z wyciągów do nowych / zmienionych faktur
 * i reguły kontrahentów. Błąd faktur sprzedażowych ani dopasowania nie przerywa synchronizacji kosztów.
 * `userId` null = harmonogram.
 */
export async function syncFromInfakt(
  db: Database,
  client: InfaktClient,
  userId: string | null,
  now: Date,
): Promise<InvoiceSyncResult> {
  const settings = await invoiceSettings(db);
  const result = await syncInvoices(db, client, settings, userId, now);
  Object.assign(
    result,
    await syncSalesSafe(db, client, settings.syncFrom, userId, now),
  );
  try {
    result.match = await runMatching(db, userId);
  } catch (e) {
    console.warn(
      `[pmo] infakt sync: dopasowanie rozliczeń nie powiodło się: ${String(e).slice(0, 200)}`,
    );
    result.match = null;
  }
  return result;
}
