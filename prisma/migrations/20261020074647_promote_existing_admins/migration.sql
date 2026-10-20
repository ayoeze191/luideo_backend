-- Whoever is an admin today set the shop up: make them super admins.
-- (A separate migration: a new enum value can't be used in the transaction that adds it.)
UPDATE "User" SET "role" = 'SUPER_ADMIN' WHERE "role" = 'ADMIN';
