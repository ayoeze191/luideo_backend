/* ------------------------------------------------------------------ *
 * A product's versions — "Red coral", "Pink coral" — kept in its
 * `finishes` list. Every version costs the product's price. When the
 * admin gives versions their own stock, the product's stock is the sum,
 * so the shop's badges and "sold out" keep working unchanged.
 * ------------------------------------------------------------------ */

export type Variant = {
  id: string;
  label: string;
  swatch?: string;
  inStock: boolean;
  /** This version's own photo, shown when a customer picks it. */
  photo?: string;
  /** This version's own count. Absent on a product without versions. */
  stock?: number;
};

export const hasVariantStock = (finishes: Variant[]) => finishes.some((f) => typeof f.stock === "number");

/** Versions with stock get `inStock` from it, and the product's total. */
export function normaliseFinishes(finishes: Variant[]): { finishes: Variant[]; stock: number | null } {
  if (!hasVariantStock(finishes)) return { finishes, stock: null };
  const next = finishes.map((f) => {
    const stock = Math.max(0, Math.floor(f.stock ?? 0));
    return { ...f, stock, inStock: stock > 0 };
  });
  return { finishes: next, stock: next.reduce((n, f) => n + (f.stock ?? 0), 0) };
}

/** After a sale: take `quantity` off one version, floored at zero. */
export function takeFromVariant(finishes: Variant[], finishId: string, quantity: number) {
  return normaliseFinishes(
    finishes.map((f) => (f.id === finishId ? { ...f, stock: Math.max(0, (f.stock ?? 0) - quantity) } : f)),
  );
}
