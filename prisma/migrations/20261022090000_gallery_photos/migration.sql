-- CreateTable
CREATE TABLE "GalleryPhoto" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "productId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GalleryPhoto_sortOrder_idx" ON "GalleryPhoto"("sortOrder");

-- AddForeignKey
ALTER TABLE "GalleryPhoto" ADD CONSTRAINT "GalleryPhoto_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The photos already on the wall, so they can be reordered or removed from the admin too.
INSERT INTO "GalleryPhoto" ("id", "url", "caption", "sortOrder") VALUES
  ('gal_coral_white_gele',  'coral-red-worn-white-gele', 'Coral red set',  0),
  ('gal_blush_portrait',    'blush-worn-portrait',       'Blush coral set', 1),
  ('gal_emerald_portrait',  'emerald-worn-portrait',     'Emerald set',     2),
  ('gal_coral_gown',        'coral-red-worn-gown',       'Coral red set',   3),
  ('gal_pearl_portrait',    'pearl-worn-portrait',       'Pearl set',       4),
  ('gal_amethyst_gold',     'amethyst-worn-gold',        'Amethyst set',    5),
  ('gal_emerald_full',      'emerald-worn-full',         'Emerald set',     6),
  ('gal_pearl_choker',      'pearl-worn-choker',         'Pearl choker',    7),
  ('gal_amethyst_portrait', 'amethyst-worn-portrait',    'Amethyst set',    8)
ON CONFLICT DO NOTHING;
