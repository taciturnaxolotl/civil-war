-- Points and the once-only limits reset every week, so the same pair can meet
-- again next week. The worker now checks repeats within the week itself.
DROP INDEX kills_pair;
CREATE INDEX kills_pair ON kills (killer, victim);
