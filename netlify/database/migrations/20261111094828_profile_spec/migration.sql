ALTER TABLE "quotes" ADD COLUMN "profile_spec" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Envcheck Core / standard — parametry z karty katalogowej (8.03.2024): przestrzeń robocza 510 × 510 × 510 mm (132,7 l),
-- wymiary zewnętrzne 720 (szer.) × 1520 (wys.) × 1080 (gł.) mm, −40…+180 °C (wersja z chłodzeniem), 15…98 %RH (moduł wilgotności).
-- Dynamika zmian nie jest podana w karcie — pole puste. Bez nadpisywania, jeśli ktoś już wpisał parametry.
UPDATE quotes SET profile_spec = '{"innerWidth": 510, "innerHeight": 510, "innerDepth": 510, "outerWidth": 720, "outerHeight": 1520, "outerDepth": 1080, "volume": 132.7, "tempMin": -40, "tempMax": 180, "humidityMin": 15, "humidityMax": 98, "rate": null}'::jsonb
WHERE id = 'bda20b1a-312a-54d7-ae29-0672a7d2ffab' AND profile_spec = '{}'::jsonb;
