-- Complete the Karaage spelling normalization for the Curry variant.
UPDATE recipes
SET name = 'Curry Karaage Don', status = 'Active', updated_at = now()
WHERE code = 'REC-007';
