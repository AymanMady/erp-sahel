-- Every company gets the places where a Mauritanian shop receives money: a bank account
-- and the Bankily, Masrvi and Sedad phone payment services (the register already exists).
-- A company that already has a bank account keeps it and gets no second one.
INSERT INTO "bank_accounts" ("company_id", "code", "name", "account_type", "currency", "is_default")
SELECT c."id", 'BANQUE',
  CASE c."language" WHEN 'ar' THEN 'الحساب البنكي' WHEN 'en' THEN 'Bank account' ELSE 'Compte bancaire' END,
  'BANK', c."currency", true
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "bank_accounts" b WHERE b."company_id" = c."id" AND b."account_type" = 'BANK'
)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Bankily becomes the default phone payment account unless the company already has one.
INSERT INTO "bank_accounts" ("company_id", "code", "name", "account_type", "currency", "is_default")
SELECT c."id", 'BANKILY', 'Bankily', 'MOBILE_MONEY', c."currency",
  NOT EXISTS (
    SELECT 1 FROM "bank_accounts" b
    WHERE b."company_id" = c."id" AND b."account_type" = 'MOBILE_MONEY' AND b."is_default"
  )
FROM "companies" c
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "bank_accounts" ("company_id", "code", "name", "account_type", "currency", "is_default")
SELECT c."id", 'MASRVI', 'Masrvi', 'MOBILE_MONEY', c."currency", false
FROM "companies" c
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "bank_accounts" ("company_id", "code", "name", "account_type", "currency", "is_default")
SELECT c."id", 'SEDAD', 'Sedad', 'MOBILE_MONEY', c."currency", false
FROM "companies" c
ON CONFLICT DO NOTHING;
