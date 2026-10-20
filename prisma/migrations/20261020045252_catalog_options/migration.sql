-- CreateEnum
CREATE TYPE "CatalogOptionKind" AS ENUM ('COLLECTION', 'MATERIAL');

-- CreateTable
CREATE TABLE "CatalogOption" (
    "id" TEXT NOT NULL,
    "kind" "CatalogOptionKind" NOT NULL,
    "name" TEXT NOT NULL,
    "blurb" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogOption_kind_name_key" ON "CatalogOption"("kind", "name");

-- Start with the collections and materials the shop already uses.
INSERT INTO "CatalogOption" ("id", "kind", "name", "blurb", "sortOrder") VALUES
  ('opt_col_iyawo',    'COLLECTION', 'Ìyàwó',    'For the bride — the full set, made to the outfit.', 0),
  ('opt_col_olori',    'COLLECTION', 'Olóri',    'Statement pieces with weight and presence.', 1),
  ('opt_col_heritage', 'COLLECTION', 'Heritage', 'Traditional coral, strung the way it has always been.', 2),
  ('opt_col_everyday', 'COLLECTION', 'Everyday', 'Lighter pieces for owambe and Sunday best.', 3),
  ('opt_mat_coral',    'MATERIAL',   'Natural coral', '', 0),
  ('opt_mat_baroque',  'MATERIAL',   'Baroque pearl', '', 1),
  ('opt_mat_fresh',    'MATERIAL',   'Freshwater pearl', '', 2),
  ('opt_mat_brass18',  'MATERIAL',   '18k gold-plated brass', '', 3),
  ('opt_mat_crystal',  'MATERIAL',   'Crystal & rhinestone', '', 4),
  ('opt_mat_bead',     'MATERIAL',   'Brass & bead', '', 5)
ON CONFLICT DO NOTHING;

-- Any collection or material already on a product, but not listed above, joins the list too.
INSERT INTO "CatalogOption" ("id", "kind", "name", "sortOrder")
SELECT 'opt_col_' || md5("collection"), 'COLLECTION', "collection", 100 FROM (SELECT DISTINCT "collection" FROM "Product") p
ON CONFLICT DO NOTHING;
INSERT INTO "CatalogOption" ("id", "kind", "name", "sortOrder")
SELECT 'opt_mat_' || md5("material"), 'MATERIAL', "material", 100 FROM (SELECT DISTINCT "material" FROM "Product") p
ON CONFLICT DO NOTHING;
