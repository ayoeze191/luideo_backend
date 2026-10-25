-- The "Earrings" category is now called "Dainty Coral". Only renames it if the
-- studio hasn't already given it another name; the slug (and links) stay "earrings".
UPDATE "Category" SET "name" = 'Dainty Coral' WHERE "slug" = 'earrings' AND "name" = 'Earrings';
