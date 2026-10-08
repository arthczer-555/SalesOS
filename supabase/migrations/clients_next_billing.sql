-- Vue portefeuille (/clients) : date de prochaine facturation d'un compte.
-- Aucune source fiable n'existe (l'onglet "Factures" du sheet revenue ne
-- contient que des factures émises), donc saisie manuelle par l'AM/CS, depuis
-- la liste ou la carte Key dates de la fiche. On garde qui et quand pour que
-- la date reste vérifiable.

alter table clients
  add column if not exists next_billing_date date,
  add column if not exists next_billing_set_by text,
  add column if not exists next_billing_set_at timestamptz;
