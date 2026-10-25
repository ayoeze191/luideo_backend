-- The new names (Antique, Dainty Coral, The Icons) are only for the home hero
-- slider; the categories themselves keep their original names.
UPDATE "Category" SET "name" = 'Stone & gold' WHERE "slug" = 'stones' AND "name" = 'Antique';
UPDATE "Category" SET "name" = 'Earrings' WHERE "slug" = 'earrings' AND "name" = 'Dainty Coral';
UPDATE "Category" SET "name" = 'Bracelets & rings' WHERE "slug" = 'wrist' AND "name" = 'The Icons';
