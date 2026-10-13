-- Some specials are worth a variable amount, entered when the kill is logged
-- (from 1 up to scale_max). Falcon's chicken is the first: a point for every
-- 10 minutes it rides in War Machine's bag, up to 3.
ALTER TABLE characters ADD COLUMN scale_max INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN scale_label TEXT NOT NULL DEFAULT '';
UPDATE characters
SET special = 'Sneaks a crochet chicken into War Machine''s bag',
	bonus = NULL,
	scale_max = 3,
	scale_label = 'Points (1 per 10 minutes in the bag)'
WHERE id = 'falcon';
