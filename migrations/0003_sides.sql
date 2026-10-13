-- Two characters bend the team lines. Black Widow is a free agent: she can kill
-- (and be killed by) either side, and her kills count for the team her victim
-- isn't on. Iron Man's code words turn Bucky for the rest of that day instead
-- of knocking her out, so her kills after that count for Team Stark.
ALTER TABLE characters ADD COLUMN free_agent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN converts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kills ADD COLUMN converts INTEGER NOT NULL DEFAULT 0;
UPDATE characters SET free_agent = 1 WHERE id = 'widow';
UPDATE characters SET converts = 1, knocks_out = 0 WHERE id = 'ironman';
