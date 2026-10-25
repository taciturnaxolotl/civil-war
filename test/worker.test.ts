import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import worker, { type Env } from "../src/index";

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let env: Env;

const dir = `${import.meta.dir}/../migrations`;
const schema = readdirSync(dir)
	.filter((f) => f.endsWith(".sql"))
	.sort()
	.map((f) => readFileSync(`${dir}/${f}`, "utf8"))
	.join("\n")
	.split(/;\s*\n/)
	.map((s: string) => s.replace(/^\s*--.*$/gm, "").trim())
	.filter(Boolean);

beforeAll(async () => {
	proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: false });
});
afterAll(() => proxy?.dispose());

beforeEach(async () => {
	const db = proxy.env.DB;
	await db.batch(
		["DROP TABLE IF EXISTS kills", "DROP TABLE IF EXISTS characters"].map((s) =>
			db.prepare(s),
		),
	);
	await db.batch(schema.map((s) => db.prepare(s)));
	env = { DB: db, ASSETS: {} as Fetcher, PLAYER_PASSWORD: "player-pw" };
});

async function call(
	path: string,
	init: { method?: string; body?: unknown; cookie?: string } = {},
) {
	const headers: Record<string, string> = {};
	if (init.body !== undefined) headers["content-type"] = "application/json";
	if (init.cookie) headers.cookie = init.cookie;
	const req = new Request(`https://cw.test${path}`, {
		method: init.method ?? "GET",
		headers,
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
	const res = await worker.fetch(req as any, env);
	const text = await res.text();
	return { res, data: text ? JSON.parse(text) : null };
}

async function login(password: string) {
	const { res } = await call("/api/session", {
		method: "POST",
		body: { password },
	});
	expect(res.status).toBe(200);
	return res.headers.get("set-cookie")!.split(";")[0];
}

const kill = (cookie: string, body: Record<string, unknown>) =>
	call("/api/kills", {
		method: "POST",
		cookie,
		body: { day: "2026-10-12", ...body },
	});

describe("kills", () => {
	test("need the player password when one is set", async () => {
		const { res } = await kill("", { killer: "warmachine", victim: "wanda" });
		expect(res.status).toBe(401);
	});

	test("are open when no player password is set", async () => {
		env.PLAYER_PASSWORD = undefined;
		const { res } = await kill("", { killer: "warmachine", victim: "falcon" });
		expect(res.status).toBe(201);
	});

	test("score a nemesis special with bonus as 3 and snapshot who did it", async () => {
		const player = await login("player-pw");
		const { res, data } = await kill(player, {
			killer: "warmachine",
			victim: "wanda",
			special: true,
			bonus: true,
			note: "never saw it",
		});
		expect(res.status).toBe(201);
		expect(data.points).toBe(3);
		const { data: s } = await call("/api/state");
		expect(s.kills[0]).toMatchObject({
			killerPlayer: "Kieran Klukas",
			killerHero: "War Machine",
			killerTeam: "stark",
			victimPlayer: "Ana Jodon",
			special: true,
			bonus: true,
			note: "never saw it",
			specialDesc: "Nerf hit (gently)",
			points: 3,
		});
	});

	test("ignore the bonus for characters whose rules don't have one", async () => {
		const player = await login("player-pw");
		const { data } = await kill(player, { killer: "cap", victim: "ironman", special: true, bonus: true, note: "x" });
		expect(data.points).toBe(2);
		const last = (await call("/api/state")).data.kills.at(-1);
		expect(last).toMatchObject({ bonus: false, note: "" });
	});

	test("ignore special and bonus against someone who isn't the nemesis", async () => {
		const player = await login("player-pw");
		const { data } = await kill(player, {
			killer: "warmachine",
			victim: "falcon",
			special: true,
			bonus: true,
			note: "x",
		});
		expect(data.points).toBe(1);
	});

	test("limits reset every day", async () => {
		const player = await login("player-pw");
		const status = async (body: Record<string, unknown>) =>
			(await kill(player, body)).res.status;
		expect(await status({ killer: "warmachine", victim: "falcon" })).toBe(201);
		expect(await status({ killer: "warmachine", victim: "falcon" })).toBe(409);
		expect(await status({ killer: "warmachine", victim: "falcon", day: "2026-10-13" })).toBe(201);
		expect(await status({ killer: "cap", victim: "widow", rps: true, day: "2026-10-14" })).toBe(201);
		expect(await status({ killer: "widow", victim: "cap", day: "2026-10-14" })).toBe(409);
		expect(await status({ killer: "widow", victim: "cap", day: "2026-10-15" })).toBe(201);
	});

	test("reject repeats, teammates and rps rematches", async () => {
		const player = await login("player-pw");
		expect(
			(await kill(player, { killer: "warmachine", victim: "falcon" })).res
				.status,
		).toBe(201);
		expect(
			(await kill(player, { killer: "warmachine", victim: "falcon" })).res
				.status,
		).toBe(409);
		expect(
			(await kill(player, { killer: "warmachine", victim: "ironman" })).res
				.status,
		).toBe(409);
		expect(
			(await kill(player, { killer: "cap", victim: "vision", rps: true })).res
				.status,
		).toBe(201);
		expect(
			(await kill(player, { killer: "vision", victim: "cap" })).res.status,
		).toBe(409);
		// Losing rps only protects Vision from Cap; anyone else can still get him.
		expect(
			(await kill(player, { killer: "falcon", victim: "vision" })).res.status,
		).toBe(201);
	});

	test("nobody can be killed on Sunday", async () => {
		const player = await login("player-pw");
		const { res, data } = await kill(player, { killer: "warmachine", victim: "falcon", day: "2026-10-18" });
		expect(res.status).toBe(409);
		expect(data.error).toContain("day of rest");
	});

	test("undo", async () => {
		const player = await login("player-pw");
		const { data } = await kill(player, {
			killer: "warmachine",
			victim: "falcon",
		});
		expect(
			(
				await call(`/api/kills/${data.id}`, {
					method: "DELETE",
					cookie: player,
				})
			).res.status,
		).toBe(200);
		expect((await call("/api/state")).data.kills).toHaveLength(0);
	});
});

describe("scaled specials", () => {
	test("Falcon's chicken scores what was entered, between 1 and 3", async () => {
		const player = await login("player-pw");
		expect((await kill(player, { killer: "falcon", victim: "warmachine", special: true, scale: 2 })).data.points).toBe(2);
		expect((await kill(player, { killer: "falcon", victim: "warmachine", special: true, scale: 9, day: "2026-10-19" })).data.points).toBe(3);
		expect((await kill(player, { killer: "falcon", victim: "warmachine", special: true, scale: 0, day: "2026-10-26" })).data.points).toBe(1);
	});

	test("other specials still score 2 whatever scale is sent", async () => {
		const player = await login("player-pw");
		expect((await kill(player, { killer: "warmachine", victim: "wanda", special: true, scale: 3 })).data.points).toBe(2);
	});
});

describe("sides", () => {
	test("Black Widow fights either side and scores for the other team", async () => {
		const player = await login("player-pw");
		expect((await kill(player, { killer: "widow", victim: "ironman" })).res.status).toBe(201);
		expect((await kill(player, { killer: "widow", victim: "falcon" })).res.status).toBe(201);
		expect((await kill(player, { killer: "spidey", victim: "widow" })).res.status).toBe(201);
		const [onStark, onCap, onWidow] = (await call("/api/state")).data.kills;
		expect(onStark).toMatchObject({ victim: "ironman", killerTeam: "cap" });
		expect(onCap).toMatchObject({ victim: "falcon", killerTeam: "stark" });
		expect(onWidow).toMatchObject({ killer: "spidey", killerTeam: "stark" });
	});

	test("Black Widow can only be killed once a day", async () => {
		const player = await login("player-pw");
		const status = async (body: Record<string, unknown>) => (await kill(player, body)).res.status;
		expect(await status({ killer: "spidey", victim: "widow" })).toBe(201);
		expect(await status({ killer: "falcon", victim: "widow" })).toBe(409);
		expect(await status({ killer: "falcon", victim: "widow", day: "2026-10-13" })).toBe(201);
	});

	test("Hawkeye's special puts Black Widow out of commission for the day", async () => {
		const player = await login("player-pw");
		const status = async (body: Record<string, unknown>) => (await kill(player, body)).res.status;
		expect(await status({ killer: "spidey", victim: "widow" })).toBe(201);
		// Once a day for everyone, nemesis included.
		expect(await status({ killer: "hawkeye", victim: "widow", special: true })).toBe(409);
		expect(await status({ killer: "hawkeye", victim: "widow", special: true, day: "2026-10-13" })).toBe(201);
		expect(await status({ killer: "widow", victim: "falcon", day: "2026-10-13" })).toBe(409);
		expect(await status({ killer: "widow", victim: "falcon", day: "2026-10-14" })).toBe(201);
	});

	test("Iron Man's special controls Bucky: her whole day scores for Stark", async () => {
		const player = await login("player-pw");
		const status = async (body: Record<string, unknown>) => (await kill(player, body)).res.status;
		// She keeps fighting Stark, even while controlled.
		expect(await status({ killer: "bucky", victim: "panther" })).toBe(201);
		expect(await status({ killer: "ironman", victim: "bucky", special: true })).toBe(201);
		expect(await status({ killer: "bucky", victim: "vision" })).toBe(201);
		expect(await status({ killer: "bucky", victim: "falcon" })).toBe(409);
		let s = (await call("/api/state")).data;
		const byVictim = (id: string) => s.kills.find((k: any) => k.killer === "bucky" && k.victim === id);
		// Before and after the control, both count for Stark.
		expect(byVictim("panther")).toMatchObject({ killerTeam: "stark" });
		expect(byVictim("vision")).toMatchObject({ killerTeam: "stark" });
		// Undoing the control hands them back.
		const control = s.kills.find((k: any) => k.converts);
		await call(`/api/kills/${control.id}`, { method: "DELETE", cookie: player });
		s = (await call("/api/state")).data;
		expect(byVictim("panther")).toMatchObject({ killerTeam: "cap" });
	});

	test("the day after control, Iron Man's special is a plain 2-point kill", async () => {
		const player = await login("player-pw");
		const status = async (body: Record<string, unknown>) => (await kill(player, body)).res.status;
		expect(await status({ killer: "ironman", victim: "bucky", special: true })).toBe(201);
		const next = "2026-10-13";
		expect(await status({ killer: "warmachine", victim: "bucky", day: next })).toBe(201);
		const res = await kill(player, { killer: "ironman", victim: "bucky", special: true, day: next });
		expect(res.data.points).toBe(2);
		await kill(player, { killer: "bucky", victim: "vision", day: next });
		const s = (await call("/api/state")).data;
		expect(s.kills.find((k: any) => k.day === next && k.killer === "ironman")).toMatchObject({ converts: false });
		expect(s.kills.find((k: any) => k.day === next && k.killer === "bucky")).toMatchObject({ killerTeam: "cap" });
		// The day after that, he can control her again.
		const again = await kill(player, { killer: "ironman", victim: "bucky", special: true, day: "2026-10-14" });
		expect(again.res.status).toBe(201);
		expect((await call("/api/state")).data.kills.at(-1)).toMatchObject({ converts: true });
	});

	test("a disabled Iron Man can still go after Bucky, and only Bucky", async () => {
		const player = await login("player-pw");
		const status = async (body: Record<string, unknown>) => (await kill(player, body)).res.status;
		expect(await status({ killer: "cap", victim: "ironman", special: true })).toBe(201);
		expect(await status({ killer: "ironman", victim: "falcon" })).toBe(409);
		expect(await status({ killer: "ironman", victim: "bucky", special: true })).toBe(201);
	});

	test("a regular kill on Bucky doesn't control her", async () => {
		const player = await login("player-pw");
		await kill(player, { killer: "ironman", victim: "bucky" });
		await kill(player, { killer: "bucky", victim: "vision" });
		const s = (await call("/api/state")).data;
		expect(s.kills.at(-1)).toMatchObject({ killerTeam: "cap" });
	});
});

describe("remapping", () => {
	test("leaves already scored kills with their original player, team and points", async () => {
		const admin = await login("player-pw");
		await kill(admin, { killer: "warmachine", victim: "wanda", special: true });

		// Kieran defects to Team Cap as Falcon's new player, and War Machine changes nemesis.
		await call("/api/characters/swap", {
			method: "POST",
			cookie: admin,
			body: { a: "warmachine", b: "falcon" },
		});
		await call("/api/characters/warmachine", {
			method: "PATCH",
			cookie: admin,
			body: { team: "cap", target: "spidey" },
		});

		const { data: s } = await call("/api/state");
		const wm = s.characters.find((c: any) => c.id === "warmachine");
		expect(wm).toMatchObject({
			player: "Zoe Hungerford",
			team: "cap",
			target: "spidey",
		});
		expect(s.characters.find((c: any) => c.id === "falcon").player).toBe(
			"Kieran Klukas",
		);
		expect(s.kills[0]).toMatchObject({
			killerPlayer: "Kieran Klukas",
			killerTeam: "stark",
			points: 2,
		});

		// New kills use the new mapping.
		const { data } = await kill(admin, {
			killer: "warmachine",
			victim: "spidey",
			special: true,
		});
		expect(data.points).toBe(2);
		const after = (await call("/api/state")).data.kills.at(-1);
		expect(after).toMatchObject({
			killerPlayer: "Zoe Hungerford",
			killerTeam: "cap",
		});
	});

	test("removing a character with history retires it", async () => {
		const admin = await login("player-pw");
		await kill(admin, { killer: "spidey", victim: "cap" });
		const { data } = await call("/api/characters/spidey", {
			method: "DELETE",
			cookie: admin,
		});
		expect(data.retired).toBe(true);
		const s = (await call("/api/state")).data;
		expect(s.characters.find((c: any) => c.id === "spidey").active).toBe(false);
		expect(s.characters.find((c: any) => c.id === "antman").target).toBeNull();
		expect(
			(await kill(admin, { killer: "spidey", victim: "falcon" })).res.status,
		).toBe(409);
	});

	test("adding a character", async () => {
		const admin = await login("player-pw");
		const { res, data } = await call("/api/characters", {
			method: "POST",
			cookie: admin,
			body: {
				hero: "Winter Soldier",
				player: "Someone",
				team: "cap",
				target: "ironman",
				special: "Arm punch",
			},
		});
		expect(res.status).toBe(201);
		expect(data.id).toBe("wintersoldier");
	});
});

describe("auth", () => {
	test("admin routes are open", async () => {
		const { res } = await call("/api/characters/cap", {
			method: "PATCH",
			body: { player: "x" },
		});
		expect(res.status).toBe(200);
	});

	test("forged and expired cookies are ignored", async () => {
		const player = await login("player-pw");
		const [, value] = player.split("=");
		const [, exp, sig] = value.split(".");
		const forged = `cw_session=player.${Number(exp) + 1}.${sig}`;
		expect(
			(await call("/api/session", { cookie: forged })).data.role,
		).toBeNull();
		expect((await call("/api/session", { cookie: player })).data.role).toBe(
			"player",
		);
	});

	test("changing the password signs everyone out", async () => {
		const player = await login("player-pw");
		env.PLAYER_PASSWORD = "new-pw";
		expect(
			(await call("/api/session", { cookie: player })).data.role,
		).toBeNull();
	});

	test("mutations need a JSON content type", async () => {
		const req = new Request("https://cw.test/api/kills", {
			method: "POST",
			body: "killer=cap",
		});
		const res = await worker.fetch(req as any, env);
		expect(res.status).toBe(415);
	});
});

describe("home page", () => {
	test("social tags get absolute URLs", async () => {
		const html = `<meta property="og:image" content="/og.png"><meta property="og:title" content="Civil War">`;
		env.ASSETS = {
			fetch: async () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
		} as unknown as Fetcher;
		const res = await worker.fetch(new Request("https://war.example/") as any, env);
		const body = await res.text();
		expect(body).toContain('content="https://war.example/og.png"');
		expect(body).toContain('content="Civil War"');
	});
});
