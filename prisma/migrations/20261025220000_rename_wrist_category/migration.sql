-- The "Bracelets & rings" category is now called "The Icons". Only renames it if the
-- studio hasn't already given it another name; the slug (and links) stay "wrist".
UPDATE "Category" SET "name" = 'The Icons' WHERE "slug" = 'wrist' AND "name" = 'Bracelets & rings';
