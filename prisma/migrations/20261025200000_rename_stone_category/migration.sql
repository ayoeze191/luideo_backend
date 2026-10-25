-- The "Stone & gold" category is now called "Antique". Only renames it if the
-- studio hasn't already given it another name; the slug (and links) stay "stones".
UPDATE "Category" SET "name" = 'Antique' WHERE "slug" = 'stones' AND "name" = 'Stone & gold';
