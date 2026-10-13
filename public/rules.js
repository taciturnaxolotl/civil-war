// @ts-check
// Game rules shared by the worker (which enforces them) and the browser (which
// previews them). Kept dependency-free so both can import it as-is.

/**
 * @typedef {"cap" | "stark"} Team
 * @typedef {{
 *   id: string, hero: string, player: string, team: Team, target: string | null,
 *   special: string, bonus: string | null, knocksOut: boolean, cooldown: number,
 *   sort: number, active: boolean
 * }} Character
 * @typedef {{
 *   id: number, day: string, at: string, killer: string, victim: string,
 *   killerPlayer: string, killerHero: string, killerTeam: Team,
 *   victimPlayer: string, victimHero: string, victimTeam: Team,
 *   rps: boolean, special: boolean, bonus: boolean, note: string,
 *   specialDesc: string, knockout: boolean, points: number
 * }} Kill
 * @typedef {{ killer: string, victim: string, day: string, rps?: boolean, special?: boolean, bonus?: boolean }} Draft
 */

/** @type {Record<Team, string>} */
export const TEAMS = { cap: "Team Cap", stark: "Team Stark" };

export const EXTRA = "Extra special (+1)";

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
	return usesSpecial(killer, draft) ? 2 + (draft.bonus ? 1 : 0) : 1;
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
	if (k.team === v.team)
		return no("teammate", `${k.player} and ${v.player} are on the same team.`);
	// Points reset every week, and so do the once-only limits.
	const week = weekStart(draft.day);
	kills = kills.filter((x) => weekStart(x.day) === week);
	if (kills.some((x) => x.killer === k.id && x.victim === v.id))
		return no(
			"repeat",
			`${k.hero} already killed ${v.hero} this week. Each person can only be killed once a week.`,
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
			`${k.hero} and ${v.hero} already settled it with rock paper scissors this week, so neither can kill the other until next week.`,
		);
	if (kills.some((x) => x.rps && x.victim === v.id && x.day === draft.day))
		return no(
			"rps-day",
			`${v.player} lost a rock paper scissors fight on this day, so nobody else can kill them until the next day.`,
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
