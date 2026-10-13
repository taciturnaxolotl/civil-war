import {
	addDays,
	blocker,
	creditTeam,
	hasBonus,
	isDay,
	points,
	TEAMS,
	teamOn,
	usesSpecial,
	weekStart,
	type Character,
	type Kill,
} from "../public/rules.js";

export interface Env {
	DB: D1Database;
	ASSETS: Fetcher;
	/** When set, logging kills needs this. Everything else, admin included, is open. */
	PLAYER_PASSWORD?: string;
}

type Role = "player";

class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

const COOKIE = "cw_session";
const SESSION_DAYS = 60;
const enc = new TextEncoder();

export default {
	async fetch(req, env): Promise<Response> {
		const url = new URL(req.url);
		if (url.pathname === "/") return withAbsoluteMeta(await env.ASSETS.fetch(req), url.origin);
		if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
		try {
			if (
				req.method !== "GET" &&
				req.method !== "HEAD" &&
				req.method !== "DELETE"
			) {
				// A JSON body can't be sent cross-site without a preflight, which
				// together with SameSite cookies keeps other sites from posting here.
				if (!req.headers.get("content-type")?.includes("application/json"))
					throw new HttpError(415, "Send JSON.");
			}
			return await route(req, env, url);
		} catch (err) {
			if (err instanceof HttpError)
				return json({ error: err.message }, err.status);
			console.error(err);
			return json({ error: "Something went wrong on our end." }, 500);
		}
	},
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, url: URL): Promise<Response> {
	const path = url.pathname.replace(/\/+$/, "");
	const m = req.method;
	const parts = path.split("/").slice(2); // drop "", "api"

	if (path === "/api/state" && m === "GET") return state(req, env);

	if (path === "/api/session") {
		if (m === "GET") return json(await sessionInfo(req, env));
		if (m === "POST") return login(req, env);
		if (m === "DELETE")
			return json({ ok: true }, 200, { "set-cookie": cookie("", 0, url) });
	}

	if (parts[0] === "kills") {
		if (parts.length === 1 && m === "POST") {
			await need(req, env, "player");
			return logKill(req, env);
		}
		const id = Number(parts[1]);
		if (parts.length === 2 && Number.isInteger(id)) {
			if (m === "DELETE") {
				await env.DB.prepare("DELETE FROM kills WHERE id = ?").bind(id).run();
				return json({ ok: true });
			}
			if (m === "PATCH") return editKill(req, env, id);
		}
	}

	if (parts[0] === "characters") {
		if (parts.length === 1 && m === "POST") return createCharacter(req, env);
		if (parts.length === 2 && parts[1] === "swap" && m === "POST")
			return swapPlayers(req, env);
		if (parts.length === 2 && m === "PATCH")
			return editCharacter(req, env, parts[1]);
		if (parts.length === 2 && m === "DELETE")
			return removeCharacter(env, parts[1]);
	}

	throw new HttpError(404, "Not found.");
}

/**
 * Link previews want absolute URLs, and the page doesn't know its own domain,
 * so fill it in on the way out.
 */
function withAbsoluteMeta(res: Response, origin: string) {
	if (!res.headers.get("content-type")?.includes("text/html")) return res;
	return new HTMLRewriter()
		.on('meta[content^="/"]', {
			element(el) {
				el.setAttribute("content", origin + el.getAttribute("content"));
			},
		})
		.transform(res);
}

/* ---------- reads ---------- */

async function loadCharacters(env: Env): Promise<Character[]> {
	const { results } = await env.DB.prepare(
		"SELECT * FROM characters ORDER BY sort, hero",
	).all();
	return results.map((r) => ({
		id: String(r.id),
		hero: String(r.hero),
		player: String(r.player),
		team: r.team as Character["team"],
		target: (r.target as string | null) ?? null,
		special: String(r.special),
		bonus: (r.bonus as string | null) ?? null,
		knocksOut: !!r.knocks_out,
		freeAgent: !!r.free_agent,
		converts: !!r.converts,
		cooldown: Number(r.cooldown),
		sort: Number(r.sort),
		active: !!r.active,
	}));
}

async function loadKills(env: Env): Promise<Kill[]> {
	const { results } = await env.DB.prepare(
		"SELECT * FROM kills ORDER BY day, at, id",
	).all();
	return results.map((r) => ({
		id: Number(r.id),
		day: String(r.day),
		at: String(r.at),
		killer: String(r.killer),
		victim: String(r.victim),
		killerPlayer: String(r.killer_player),
		killerHero: String(r.killer_hero),
		killerTeam: r.killer_team as Kill["killerTeam"],
		victimPlayer: String(r.victim_player),
		victimHero: String(r.victim_hero),
		victimTeam: r.victim_team as Kill["victimTeam"],
		rps: !!r.rps,
		special: !!r.special,
		bonus: !!r.bonus,
		note: String(r.note),
		specialDesc: String(r.special_desc),
		knockout: !!r.knockout,
		converts: !!r.converts,
		points: Number(r.points),
	}));
}

async function state(req: Request, env: Env): Promise<Response> {
	const [characters, kills] = await Promise.all([
		loadCharacters(env),
		loadKills(env),
	]);
	const body = JSON.stringify({ characters, kills });
	// The page polls this, so let unchanged state come back as an empty 304.
	const digest = await crypto.subtle.digest("SHA-256", enc.encode(body));
	const etag = `"${hex(digest).slice(0, 32)}"`;
	const headers = { etag, "cache-control": "no-cache" };
	if (req.headers.get("if-none-match") === etag)
		return new Response(null, { status: 304, headers });
	return new Response(body, {
		headers: { ...headers, "content-type": "application/json" },
	});
}

/* ---------- kills ---------- */

async function logKill(req: Request, env: Env): Promise<Response> {
	const body = await readJson(req);
	const draft = {
		killer: str(body.killer, 40),
		victim: str(body.victim, 40),
		day: str(body.day, 10),
		rps: !!body.rps,
		special: !!body.special,
		bonus: !!body.bonus,
	};
	if (!isDay(draft.day)) throw new HttpError(400, "Pick a valid day.");

	const [characters, kills] = await Promise.all([
		loadCharacters(env),
		loadKills(env),
	]);
	const chars = Object.fromEntries(characters.map((c) => [c.id, c]));
	const why = blocker(draft, kills, chars);
	if (why) throw new HttpError(409, why);

	// Freeze everything about who these two are right now, so remapping players
	// or teams later can't move these points.
	const k = chars[draft.killer];
	const v = chars[draft.victim];
	const special = usesSpecial(k, draft);
	const bonus = hasBonus(k, draft);
	const note = bonus ? str(body.note, 140).trim() : "";
	const pts = points(k, { ...draft, special, bonus });
	// Which side each was on at this moment: conversions and free agents mean
	// that isn't always the team on their card.
	const killerTeam = creditTeam(k, v, draft.day, kills);
	const victimTeam = teamOn(v, draft.day, kills);

	// The check above ran on a snapshot; repeat the once-a-week test inside the
	// insert so a double tap can't sneak a second copy in.
	const week = weekStart(draft.day);
	const row = await env.DB.prepare(
		`INSERT INTO kills (day, at, killer, victim, killer_player, killer_hero, killer_team,
			victim_player, victim_hero, victim_team, rps, special, bonus, note, special_desc, knockout, points, converts)
		SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?20
		WHERE NOT EXISTS (
			SELECT 1 FROM kills WHERE killer = ?3 AND victim = ?4 AND day BETWEEN ?18 AND ?19
		)
		RETURNING id`,
	)
		.bind(
			draft.day,
			new Date().toISOString(),
			k.id,
			v.id,
			k.player,
			k.hero,
			killerTeam,
			v.player,
			v.hero,
			victimTeam,
			+draft.rps,
			+special,
			+bonus,
			note,
			special ? k.special : "",
			+(special && k.knocksOut),
			pts,
			week,
			addDays(week, 6),
			+(special && k.converts),
		)
		.first<{ id: number }>();
	if (!row)
		throw new HttpError(
			409,
			`${k.hero} already killed ${v.hero} this week. Each person can only be killed once a week.`,
		);
	return json({ ok: true, id: row.id, points: pts }, 201);
}

async function editKill(req: Request, env: Env, id: number): Promise<Response> {
	const body = await readJson(req);
	const sets: string[] = [];
	const args: unknown[] = [];
	if (body.points !== undefined) {
		const p = Number(body.points);
		if (!Number.isInteger(p) || p < -10 || p > 10)
			throw new HttpError(400, "Points must be a whole number.");
		sets.push("points = ?");
		args.push(p);
	}
	if (body.day !== undefined) {
		const day = str(body.day, 10);
		if (!isDay(day)) throw new HttpError(400, "Pick a valid day.");
		sets.push("day = ?");
		args.push(day);
	}
	if (body.note !== undefined) {
		sets.push("note = ?");
		args.push(str(body.note, 140).trim());
	}
	if (!sets.length) throw new HttpError(400, "Nothing to change.");
	const res = await env.DB.prepare(
		`UPDATE kills SET ${sets.join(", ")} WHERE id = ?`,
	)
		.bind(...args, id)
		.run();
	if (!res.meta.changes) throw new HttpError(404, "No such kill.");
	return json({ ok: true });
}

/* ---------- characters ---------- */

async function characterValues(
	env: Env,
	body: Record<string, unknown>,
	self: string | null,
) {
	const out: Record<string, unknown> = {};
	if (body.hero !== undefined) {
		const hero = str(body.hero, 60).trim();
		if (!hero) throw new HttpError(400, "Characters need a name.");
		out.hero = hero;
	}
	if (body.player !== undefined) out.player = str(body.player, 80).trim();
	if (body.team !== undefined) {
		if (!(String(body.team) in TEAMS))
			throw new HttpError(400, "Team must be cap or stark.");
		out.team = String(body.team);
	}
	if (body.target !== undefined) {
		const target = body.target ? str(body.target, 40) : null;
		if (target) {
			if (target === self)
				throw new HttpError(400, "A character can't be their own nemesis.");
			const exists = await env.DB.prepare(
				"SELECT 1 FROM characters WHERE id = ?",
			)
				.bind(target)
				.first();
			if (!exists) throw new HttpError(400, "That nemesis doesn't exist.");
		}
		out.target = target;
	}
	if (body.special !== undefined) out.special = str(body.special, 200).trim();
	if (body.bonus !== undefined) out.bonus = str(body.bonus, 200).trim() || null;
	if (body.knocksOut !== undefined) out.knocks_out = +!!body.knocksOut;
	if (body.freeAgent !== undefined) out.free_agent = +!!body.freeAgent;
	if (body.converts !== undefined) out.converts = +!!body.converts;
	if (body.active !== undefined) out.active = +!!body.active;
	for (const key of ["cooldown", "sort"] as const) {
		if (body[key] === undefined) continue;
		const n = Number(body[key]);
		if (!Number.isInteger(n) || n < 0 || n > 999)
			throw new HttpError(400, `${key} must be a whole number.`);
		out[key] = n;
	}
	return out;
}

async function createCharacter(req: Request, env: Env): Promise<Response> {
	const body = await readJson(req);
	const values = await characterValues(env, body, null);
	if (!values.hero) throw new HttpError(400, "Characters need a name.");
	if (!values.team) throw new HttpError(400, "Pick a team.");
	const base = slug(String(values.hero)) || "hero";
	let id = base;
	for (
		let i = 2;
		await env.DB.prepare("SELECT 1 FROM characters WHERE id = ?")
			.bind(id)
			.first();
		i++
	)
		id = `${base}${i}`;
	if (values.sort === undefined) {
		const max = await env.DB.prepare(
			"SELECT COALESCE(MAX(sort), 0) AS s FROM characters",
		).first<{ s: number }>();
		values.sort = (max?.s ?? 0) + 1;
	}
	const cols = Object.keys(values);
	await env.DB.prepare(
		`INSERT INTO characters (id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`,
	)
		.bind(id, ...Object.values(values))
		.run();
	return json({ ok: true, id }, 201);
}

async function editCharacter(
	req: Request,
	env: Env,
	id: string,
): Promise<Response> {
	const body = await readJson(req);
	const values = await characterValues(env, body, id);
	const cols = Object.keys(values);
	if (!cols.length) throw new HttpError(400, "Nothing to change.");
	const res = await env.DB.prepare(
		`UPDATE characters SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
	)
		.bind(...Object.values(values), id)
		.run();
	if (!res.meta.changes) throw new HttpError(404, "No such character.");
	return json({ ok: true });
}

async function swapPlayers(req: Request, env: Env): Promise<Response> {
	const body = await readJson(req);
	const a = str(body.a, 40);
	const b = str(body.b, 40);
	if (!a || !b || a === b)
		throw new HttpError(400, "Pick two different characters.");
	const rows = await env.DB.prepare(
		"SELECT id, player FROM characters WHERE id IN (?, ?)",
	)
		.bind(a, b)
		.all<{ id: string; player: string }>();
	const pa = rows.results.find((r) => r.id === a);
	const pb = rows.results.find((r) => r.id === b);
	if (!pa || !pb) throw new HttpError(404, "No such character.");
	await env.DB.batch([
		env.DB.prepare("UPDATE characters SET player = ? WHERE id = ?").bind(
			pb.player,
			a,
		),
		env.DB.prepare("UPDATE characters SET player = ? WHERE id = ?").bind(
			pa.player,
			b,
		),
	]);
	return json({ ok: true });
}

async function removeCharacter(env: Env, id: string): Promise<Response> {
	// Characters with history stay around (retired) so their points still count.
	const used = await env.DB.prepare(
		"SELECT 1 FROM kills WHERE killer = ?1 OR victim = ?1 LIMIT 1",
	)
		.bind(id)
		.first();
	const [, res] = await env.DB.batch([
		env.DB.prepare("UPDATE characters SET target = NULL WHERE target = ?").bind(
			id,
		),
		used
			? env.DB.prepare("UPDATE characters SET active = 0 WHERE id = ?").bind(id)
			: env.DB.prepare("DELETE FROM characters WHERE id = ?").bind(id),
	]);
	if (!res.meta.changes) throw new HttpError(404, "No such character.");
	return json({ ok: true, retired: !!used });
}

/* ---------- sessions ---------- */

async function sessionInfo(req: Request, env: Env) {
	return {
		role: await currentRole(req, env),
		playerPasswordRequired: !!env.PLAYER_PASSWORD,
	};
}

async function login(req: Request, env: Env): Promise<Response> {
	const body = await readJson(req);
	const password = str(body.password, 200);
	let role: Role | null = null;
	if (env.PLAYER_PASSWORD && (await same(password, env.PLAYER_PASSWORD)))
		role = "player";
	if (!role) throw new HttpError(401, "That password isn't right.");
	const exp = Date.now() + SESSION_DAYS * 864e5;
	const payload = `${role}.${exp}`;
	const value = `${payload}.${await sign(env, payload)}`;
	return json({ ...(await sessionInfo(req, env)), role }, 200, {
		"set-cookie": cookie(value, SESSION_DAYS * 86400, new URL(req.url)),
	});
}

async function currentRole(req: Request, env: Env): Promise<Role | null> {
	const raw = req.headers
		.get("cookie")
		?.split(/;\s*/)
		.find((c) => c.startsWith(`${COOKIE}=`))
		?.slice(COOKIE.length + 1);
	if (!raw) return null;
	const [role, exp, sig] = raw.split(".");
	if (role !== "player") return null;
	if (!(Number(exp) > Date.now())) return null;
	if (!(await same(sig ?? "", await sign(env, `${role}.${exp}`)))) return null;
	return role;
}

async function need(req: Request, env: Env, want: Role) {
	if (!env.PLAYER_PASSWORD || (await currentRole(req, env)) === want) return;
	throw new HttpError(401, "Sign in first.");
}

/** Sessions are keyed off the password, so changing it signs everyone out. */
async function sign(env: Env, payload: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(`civil-war\0${env.PLAYER_PASSWORD ?? ""}`),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/** Compares digests rather than the strings so timing says nothing about them. */
async function same(a: string, b: string) {
	const [x, y] = await Promise.all(
		[a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))),
	);
	const ua = new Uint8Array(x);
	const ub = new Uint8Array(y);
	let diff = 0;
	for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
	return diff === 0;
}

function cookie(value: string, maxAge: number, url: URL) {
	const secure = url.protocol === "https:" ? "; Secure" : "";
	return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}

/* ---------- helpers ---------- */

function json(
	data: unknown,
	status = 200,
	headers: Record<string, string> = {},
) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
			...headers,
		},
	});
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
	try {
		const body = await req.json();
		if (body && typeof body === "object" && !Array.isArray(body))
			return body as Record<string, unknown>;
	} catch {}
	throw new HttpError(400, "Couldn't read that request.");
}

function str(v: unknown, max: number) {
	return typeof v === "string" ? v.slice(0, max) : "";
}

function slug(s: string) {
	return s
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "")
		.slice(0, 30);
}

function hex(buf: ArrayBuffer) {
	return [...new Uint8Array(buf)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
