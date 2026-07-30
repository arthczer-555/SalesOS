-- Rôles sales d'un utilisateur, cumulables.
--
-- `is_sales` reste la porte d'entrée (roster des dashboards AE) ; `sales_roles`
-- décide de ce qu'un sales voit sur sa page d'accueil : New pour un AE, Renew
-- pour un AM, Renew CSM pour un CSM. Cumulables parce que le Sheet revenue les
-- cumule déjà (Baptiste et Magdalena y sont à la fois AE et AM).
--
-- Valeurs attendues : 'ae', 'am', 'csm'.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sales_roles TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN users.sales_roles IS
  'Rôles sales cumulables : ae (New), am (Renew), csm (Renew delivery). Pilote les blocs de /dashboard.';

-- Amorce : tout sales existant est au moins AE, à ajuster ensuite dans /admin.
UPDATE users
   SET sales_roles = ARRAY['ae']
 WHERE is_sales = true
   AND (sales_roles IS NULL OR cardinality(sales_roles) = 0);
