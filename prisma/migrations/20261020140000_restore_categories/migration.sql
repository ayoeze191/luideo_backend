-- The shop's original categories, back after the data was cleared. The home
-- page slides and the top menu link to these. Any that already exist are left alone.
INSERT INTO "Category" ("slug", "name", "blurb", "photo", "sortOrder") VALUES
  ('coral', 'Coral', 'Natural coral branch, cast in gold and strung by hand.', 'coral-red-set', 0),
  ('pearl', 'Pearl', 'Baroque and freshwater pearl, no two the same shape.', 'pearl-set', 1),
  ('stones', 'Stone & gold', 'Emerald, amethyst and cabochon stones set in cast gold.', 'emerald-set', 2),
  ('bridal', 'Bridal sets', 'The complete four-piece, made to your day.', 'blush-worn-portrait', 3),
  ('earrings', 'Earrings', 'Statement drops and gold-set studs, sold on their own.', 'pearl-earrings', 4),
  ('wrist', 'Bracelets & rings', 'Cuffs, wrist beads and cast stone rings.', 'amethyst-set', 5),
  ('men', 'For the groom', 'Cap chains, wrist beads and lapel pieces.', 'coral-red-worn-gown', 6)
ON CONFLICT ("slug") DO NOTHING;

-- The default collections and materials too, in case they were cleared. New
-- ones can still be added from the product form ("+ Add new…").
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
