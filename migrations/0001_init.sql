-- Characters are the stable thing. The player behind one can change, and so
-- can its team, nemesis and special; kills copy all of that at the moment they
-- are logged, so later edits never move points that were already scored.
CREATE TABLE characters (
	id TEXT PRIMARY KEY,
	hero TEXT NOT NULL,
	player TEXT NOT NULL DEFAULT '',
	team TEXT NOT NULL CHECK (team IN ('cap', 'stark')),
	target TEXT,
	special TEXT NOT NULL DEFAULT '',
	bonus TEXT,
	knocks_out INTEGER NOT NULL DEFAULT 0,
	cooldown INTEGER NOT NULL DEFAULT 0,
	sort INTEGER NOT NULL DEFAULT 0,
	active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE kills (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	day TEXT NOT NULL,
	at TEXT NOT NULL,
	killer TEXT NOT NULL,
	victim TEXT NOT NULL,
	killer_player TEXT NOT NULL,
	killer_hero TEXT NOT NULL,
	killer_team TEXT NOT NULL,
	victim_player TEXT NOT NULL,
	victim_hero TEXT NOT NULL,
	victim_team TEXT NOT NULL,
	rps INTEGER NOT NULL DEFAULT 0,
	special INTEGER NOT NULL DEFAULT 0,
	bonus INTEGER NOT NULL DEFAULT 0,
	note TEXT NOT NULL DEFAULT '',
	special_desc TEXT NOT NULL DEFAULT '',
	knockout INTEGER NOT NULL DEFAULT 0,
	points INTEGER NOT NULL
);

-- Each character can only take down a given character once.
CREATE UNIQUE INDEX kills_pair ON kills (killer, victim);
CREATE INDEX kills_day ON kills (day);

INSERT INTO characters (id, hero, player, team, target, special, bonus, knocks_out, cooldown, sort) VALUES
	('cap',        'Captain America', 'Sophia Bell',         'cap',   'ironman',    'Frisbee at Iron Man, not caught',                  NULL,                                        1, 0, 1),
	('bucky',      'Bucky',           'Hailey Cullip',       'cap',   'panther',    'Plastic knife to a vital spot, unnoticed',         NULL,                                        1, 0, 2),
	('falcon',     'Falcon',          'Zoe Hungerford',      'cap',   'warmachine', 'Rubber duck hit',                                  'Hit a vital spot (+1, 3 total)',            0, 0, 3),
	('wanda',      'Scarlet Witch',   'Ana Jodon',           'cap',   'vision',     'Stuffed animal toss, not caught',                  NULL,                                        0, 0, 4),
	('hawkeye',    'Hawkeye',         'Michaela O’Holloran', 'cap',   'widow',      'Nerf hit (not from too close)',                    'Hit in the back (+1)',                      0, 0, 5),
	('antman',     'Ant-Man',         'Amelia Hawk',         'cap',   'spidey',     'Perfume spray',                                    NULL,                                        0, 0, 6),
	('ironman',    'Iron Man',        'Josiah Porter',       'stark', 'bucky',      'Cypher code words said before she ran',            NULL,                                        1, 2, 7),
	('warmachine', 'War Machine',     'Kieran Klukas',       'stark', 'wanda',      'Nerf hit (gently)',                                'Target didn''t see where he shot from (+1)', 0, 0, 8),
	('widow',      'Black Widow',     'Kyla Stewart',        'stark', 'antman',     'Finger guns + “We have unfinished business.”',     'Not noticed until she got her (+1)',        0, 0, 9),
	('vision',     'Vision',          'Ethan Peterson',      'stark', 'falcon',     '5-second video',                                   'Video 10 s or longer (+1)',                 0, 0, 10),
	('panther',    'Black Panther',   'Selah Yingling',      'stark', 'hawkeye',    'Turkey throw',                                     'Turkey placed on head (+1)',                0, 0, 11),
	('spidey',     'Spider-Man',      'Agnès Soundron',      'stark', 'cap',        'Hairband shot',                                    NULL,                                        0, 0, 12);
