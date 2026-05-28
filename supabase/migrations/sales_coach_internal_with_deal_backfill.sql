-- Backfill : un meeting rattaché à un deal HubSpot n'est plus "interne".
-- Aligne l'historique sur la nouvelle règle (resolve-deal / run-analysis /
-- backfill repassent meeting_type internal -> external dès qu'un deal existe).
-- Sans ça, les meetings dont le deal a été associé manuellement restaient
-- masqués dans la liste Coaching (qui filtre meeting_type = 'internal').

UPDATE sales_coach_analyses
  SET meeting_type = 'external',
      updated_at = now()
  WHERE meeting_type = 'internal'
    AND hubspot_deal_id IS NOT NULL;
