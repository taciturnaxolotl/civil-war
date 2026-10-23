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
 * Whether a character is under control on a day: a controlling special hit
 * them that day. They still fight for their own team, but every kill they make
 * that day, before or after, scores for the other side.
 * @param {Character} c
 * @param {string} day
 * @param {Kill[]} kills
 */
export function controlled(c, day, kills) {
	return kills.some((x) => x.converts && x.victim === c.id && x.day === day);
}

/**
 * Whether a special on this target would control them. It can't the day after
 * they were controlled; the special still lands as a normal 2-point kill.
 * @param {Character} k
 * @param {Character} v
 * @param {string} day
 * @param {Kill[]} kills
 */
export function canControl(k, v, day, kills) {
	return k.converts && !controlled(v, addDays(day, -1), kills);
}

/**
 * Whether two characters are on opposite sides. A free agent is on nobody's
 * side, so they can fight anyone and anyone can fight them.
 * @param {Character} k
 * @param {Character} v
 */
export function canFight(k, v) {
	if (k.id === v.id) return false;
	if (k.freeAgent || v.freeAgent) return true;
	return k.team !== v.team;
}

/**
 * The team a kill's points go to. A free agent's kills count for whichever
 * team the victim isn't on; a controlled character's for the other side.
 * @param {Character} k
 * @param {Character} v
 * @param {string} day
 * @param {Kill[]} kills
 * @returns {Team}
 */
export function creditTeam(k, v, day, kills) {
	if (k.freeAgent) return other(v.team);
	return controlled(k, day, kills) ? other(k.team) : k.team;
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
	if (!canFight(k, v))
		return no("teammate", `${k.player} and ${v.player} are on the same team.`);
	// Knocked out of commission by a special: no more kills for them today.
	// A controller (Iron Man) can still go after the one they control.
	if (
		kills.some((x) => x.knockout && x.victim === k.id && x.day === draft.day) &&
		!(k.converts && k.target === v.id)
	)
		return no(
			"out",
			k.converts && k.target && chars[k.target]
				? `${k.player} is disabled today, so ${chars[k.target].player} is the only one they can get.`
				: `${k.player} is out of commission today, so they can't get anyone until tomorrow.`,
		);
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
