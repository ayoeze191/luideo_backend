import type { CatalogOptionKind } from "../generated/prisma/client.ts";
import { badRequest } from "./http-error.ts";
import { prisma } from "./prisma.ts";

/* Collections and materials live in the database so the admin can add to
 * them while creating a piece. Products store the option's name. */

export async function listOptions(kind: CatalogOptionKind) {
  return prisma.catalogOption.findMany({ where: { kind }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true, blurb: true, photo: true } });
}

export async function optionNames(kind: CatalogOptionKind) {
  return (await listOptions(kind)).map((o) => o.name);
}

const LABEL: Record<CatalogOptionKind, string> = { COLLECTION: "collection", MATERIAL: "material" };

export async function assertOption(kind: CatalogOptionKind, name?: string) {
  if (name && !(await prisma.catalogOption.findUnique({ where: { kind_name: { kind, name } } }))) {
    throw badRequest(`Unknown ${LABEL[kind]} "${name}". Add it first.`, kind);
  }
}

/** Adds one, or returns the existing one if the name is already there (ignoring case). */
export async function addOption(kind: CatalogOptionKind, rawName: string, blurb = "") {
  const name = rawName.trim().replace(/\s+/g, " ");
  const existing = await prisma.catalogOption.findFirst({ where: { kind, name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing;
  const last = await prisma.catalogOption.aggregate({ where: { kind }, _max: { sortOrder: true } });
  return prisma.catalogOption.create({ data: { kind, name, blurb: blurb.trim(), sortOrder: (last._max.sortOrder ?? 0) + 1 } });
}
