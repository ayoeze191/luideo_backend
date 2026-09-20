/** The frontend's Money shape: major units in both currencies. */
export type Money = { ngn: number; usd: number };

export const toMinor = (major: number) => Math.round(major * 100);
export const toMajor = (minor: number) => minor / 100;

export function money(kobo: number, cents: number): Money {
  return { ngn: toMajor(kobo), usd: toMajor(cents) };
}

export function optionalMoney(kobo: number | null, cents: number | null): Money | undefined {
  return kobo == null || cents == null ? undefined : money(kobo, cents);
}
