-- Migratie 0092: herstel de begrensde search_path van de herbewerkingsfunctie (D100).
ALTER FUNCTION fabriek.maak_herbewerking(text,text,text,uuid,uuid) SET search_path = pg_catalog,fabriek,pg_temp;
