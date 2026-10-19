import { env } from "../config/env.ts";

/* ------------------------------------------------------------------ *
 * Naira per US dollar, for suggesting a $ price when the admin types a ₦
 * one. Only ever a suggestion — prices are still set per currency.
 * Fetched from a free, keyless rate service and kept for six hours; if it's
 * unreachable we keep the last good rate, then fall back to NGN_PER_USD.
 * ------------------------------------------------------------------ */

const SOURCE = "https://open.er-api.com/v6/latest/USD";
const KEEP_FOR_MS = 6 * 60 * 60 * 1000;

let cached: { ngnPerUsd: number; updatedAt: string; fetchedAt: number } | null = null;

export async function ngnPerUsd() {
  if (cached && Date.now() - cached.fetchedAt < KEEP_FOR_MS) return { ngnPerUsd: cached.ngnPerUsd, updatedAt: cached.updatedAt };
  try {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { result?: string; rates?: { NGN?: number }; time_last_update_utc?: string };
    const rate = data.rates?.NGN;
    if (data.result !== "success" || !rate || rate < 100) throw new Error("No NGN rate in the response");
    cached = { ngnPerUsd: Math.round(rate * 100) / 100, updatedAt: new Date(data.time_last_update_utc ?? Date.now()).toISOString(), fetchedAt: Date.now() };
  } catch (err) {
    console.warn("Exchange rate unavailable:", err instanceof Error ? err.message : err);
    if (cached) return { ngnPerUsd: cached.ngnPerUsd, updatedAt: cached.updatedAt };
    return { ngnPerUsd: env.NGN_PER_USD, updatedAt: null };
  }
  return { ngnPerUsd: cached.ngnPerUsd, updatedAt: cached.updatedAt };
}
