// @ts-check
// Game rules shared by the worker (which enforces them) and the browser (which
// previews them). Kept dependency-free so both can import it as-is.

/**
 * @typedef {"cap" | "stark"} Team
 * @typedef {{
 *   id: string, hero: string, player: string, team: Team, target: string | null,
 *   special: string, bonus: string | null, knocksOut: boolean, cooldown: number,
 *   freeAgent: boolean, converts: boolean, scaleMax: number, scaleLabel: string,
 *   sort: number, active: boolean
 * }} Character
 * @typedef {{
 *   id: number, day: string, at: string, killer: string, victim: string,
 *   killerPlayer: string, killerHero: string, killerTeam: Team,
 *   victimPlayer: string, victimHero: string, victimTeam: Team,
 *   rps: boolean, special: boolean, bonus: boolean, note: string,
 *   specialDesc: string, knockout: boolean, converts: boolean, points: number
 * }} Kill
 * @typedef {{ killer: string, victim: string, day: string, rps?: boolean, special?: boolean, bonus?: boolean, scale?: number }} Draft
 */

/** @type {Record<Team, string>} */
export const TEAMS = { cap: "Team Cap", stark: "Team Stark" };

/** @param {Team} t @returns {Team} */
export const other = (t) => (t === "cap" ? "stark" : "cap");

/**
 * The team a character fights for on a day. A converting special flips its
 * target to the killer's team for the rest of that day, counting only kills
 * logged after it (pass `at` to ask about a moment; omit it for now).
 * @param {Character} c
 * @param {string} day
 * @param {Kill[]} kills
 * @param {string} [at]
 * @returns {Team}
 */
export function teamOn(c, day, kills, at) {
	const flip = kills
		.filter((x) => x.converts && x.victim === c.id && x.day === day && (!at || x.at < at))
		.sort((a, b) => a.at.localeCompare(b.at))
		.pop();
	return flip ? flip.killerTeam : c.team;
}

/**
 * Whether two characters are on opposite sides. A free agent is on nobody's
 * side, so they can fight anyone and anyone can fight them.
 * @param {Character} k
 * @param {Character} v
 * @param {string} day
 * @param {Kill[]} kills
 */
export function canFight(k, v, day, kills) {
	if (k.id === v.id) return false;
	if (k.freeAgent || v.freeAgent) return true;
	return teamOn(k, day, kills) !== teamOn(v, day, kills);
}

/**
 * The team a kill's points go to. A free agent's kills count for whichever
 * team the victim isn't on.
 * @param {Character} k
 * @param {Character} v
 * @param {string} day
 * @param {Kill[]} kills
 * @returns {Team}
 */
export function creditTeam(k, v, day, kills) {
	return k.freeAgent ? other(teamOn(v, day, kills)) : teamOn(k, day, kills);
}

/**
 * The +1 only exists for characters whose rules give them one, and only on top
 * of a special.
 * @param {Character} killer
 * @param {Draft} draft
 */
export function hasBonus(killer, draft) {
	return usesSpecial(killer, draft) && !!draft.bonus && !!killer.bonus;
}

/**
 * A special only counts against the character's current nemesis, and never
 * on a rock paper scissors win.
 * @param {Character} killer
 * @param {Draft} draft
 */
export function usesSpecial(killer, draft) {
	return !draft.rps && !!draft.special && killer.target === draft.victim;
}

/**
 * @param {Character} killer
 * @param {Draft} draft
 */
export function points(killer, draft) {
	if (!usesSpecial(killer, draft)) return 1;
	const base = killer.scaleMax ? scaleOf(killer, draft) : 2;
	return base + (hasBonus(killer, draft) ? 1 : 0);
}

/**
 * For a special worth a variable amount (say a point per 10 minutes), the
 * amount the logger entered, kept between 1 and the character's max.
 * @param {Character} killer
 * @param {Draft} draft
 */
export function scaleOf(killer, draft) {
	const n = Math.round(Number(draft.scale) || 1);
	return Math.min(Math.max(n, 1), killer.scaleMax);
}

/**
 * Why a kill isn't allowed, as a short code plus a sentence, or null if it is.
 * @param {Draft} draft
 * @param {Kill[]} kills
 * @param {Record<string, Character>} chars
 * @returns {{ code: string, message: string } | null}
 */
export function check(draft, kills, chars) {
	const k = chars[draft.killer];
	const v = chars[draft.victim];
	const no = (/** @type {string} */ code, /** @type {string} */ message) => ({
		code,
		message,
	});
	if (!k || !v)
		return no("missing", "Pick who got the kill and who went down.");
	if (!k.active || !v.active)
		return no("retired", "That character isn't in the game anymore.");
	if (k.id === v.id) return no("self", "Nobody can kill themselves.");
	if (!canFight(k, v, draft.day, kills))
		return no(
			"teammate",
			`${k.player} and ${v.player} are on the same team${teamOn(k, draft.day, kills) !== k.team || teamOn(v, draft.day, kills) !== v.team ? " today" : ""}.`,
		);
	// Knocked out of commission by a special: no more kills for them today.
	if (kills.some((x) => x.knockout && x.victim === k.id && x.day === draft.day))
		return no("out", `${k.player} is out of commission today, so they can't get anyone until tomorrow.`);
	// A free agent has everyone hunting them, so they only go down once a day.
	if (v.freeAgent && kills.some((x) => x.victim === v.id && x.day === draft.day))
		return no("free-agent-day", `${v.player} has already been killed today. Free agents can only go down once a day.`);
	// The once-only limits reset every day.
	kills = kills.filter((x) => x.day === draft.day);
	if (kills.some((x) => x.killer === k.id && x.victim === v.id))
		return no(
			"repeat",
			`${k.hero} already killed ${v.hero} today. Each person can only be killed once a day.`,
		);
	if (
		kills.some(
			(x) =>
				x.rps &&
				((x.killer === k.id && x.victim === v.id) ||
					(x.killer === v.id && x.victim === k.id)),
		)
	)
		return no(
			"rps-pair",
			`${k.hero} and ${v.hero} already settled it with rock paper scissors today, so neither can kill the other until tomorrow.`,
		);
	return null;
}

/**
 * Why a kill isn't allowed, or null if it is.
 * @param {Draft} draft
 * @param {Kill[]} kills
 * @param {Record<string, Character>} chars
 */
export function blocker(draft, kills, chars) {
	return check(draft, kills, chars)?.message ?? null;
}

/**
 * Characters knocked out of commission on a given day by a special.
 * @param {string} day
 * @param {Kill[]} kills
 */
export function outOn(day, kills) {
	return new Set(
		kills.filter((x) => x.knockout && x.day === day).map((x) => x.victim),
	);
}

/**
 * The last day a character's special is still cooling down, or null.
 * @param {Character} c
 * @param {Kill[]} kills
 * @param {string} day
 */
export function cooldownThrough(c, kills, day) {
	if (!c.cooldown) return null;
	const last = kills
		.filter((x) => x.killer === c.id && x.special)
		.map((x) => x.day)
		.sort()
		.pop();
	if (!last) return null;
	const end = addDays(last, c.cooldown);
	return day > last && day <= end ? end : null;
}

/** @param {string} day */
export function isDay(day) {
	return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day));
}

/** @param {Date} d */
function ymd(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function today() {
	return ymd(new Date());
}

/**
 * @param {string} day
 * @param {number} n
 */
export function addDays(day, n) {
	const [y, m, d] = day.split("-").map(Number);
	return ymd(new Date(y, m - 1, d + n));
}

/**
 * The Monday that starts the week a day falls in. Weeks run Monday to Sunday.
 * @param {string} day
 */
export function weekStart(day) {
	const [y, m, d] = day.split("-").map(Number);
	const back = (new Date(y, m - 1, d).getDay() + 6) % 7;
	return addDays(day, -back);
}

/**
 * Team totals for every week with kills, oldest first. Points count for the
 * team the killer was on when they scored.
 * @param {Kill[]} kills
 */
export function weeks(kills) {
	/** @type {Map<string, { start: string, end: string, cap: number, stark: number, winner: Team | null }>} */
	const by = new Map();
	for (const k of kills) {
		const start = weekStart(k.day);
		let w = by.get(start);
		if (!w) by.set(start, (w = { start, end: addDays(start, 6), cap: 0, stark: 0, winner: null }));
		w[k.killerTeam] += k.points;
	}
	const list = [...by.values()].sort((a, b) => a.start.localeCompare(b.start));
	for (const w of list) w.winner = w.cap > w.stark ? "cap" : w.stark > w.cap ? "stark" : null;
	return list;
}
