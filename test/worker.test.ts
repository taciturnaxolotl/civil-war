import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import worker, { type Env } from "../src/index";

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let env: Env;

const schema = readFileSync(`${import.meta.dir}/../migrations/0001_init.sql`, "utf8")
	.split(/;\s*\n/)
	.map((s: string) => s.replace(/^\s*--.*$/gm, "").trim())
	.filter(Boolean);

beforeAll(async () => {
	proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: false });
});
afterAll(() => proxy?.dispose());

beforeEach(async () => {
	const db = proxy.env.DB;
	await db.batch(["DROP TABLE IF EXISTS kills", "DROP TABLE IF EXISTS characters"].map((s) => db.prepare(s)));
	await db.batch(schema.map((s) => db.prepare(s)));
	env = { DB: db, ASSETS: {} as Fetcher, ADMIN_PASSWORD: "admin-pw", PLAYER_PASSWORD: "player-pw" };
});

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
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
	const { res } = await call("/api/session", { method: "POST", body: { password } });
	expect(res.status).toBe(200);
	return res.headers.get("set-cookie")!.split(";")[0];
}

const kill = (cookie: string, body: Record<string, unknown>) =>
	call("/api/kills", { method: "POST", cookie, body: { day: "2026-10-12", ...body } });

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
		const { res, data } = await kill(player, { killer: "warmachine", victim: "wanda", special: true, bonus: true, note: "never saw it" });
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

	test("ignore special and bonus against someone who isn't the nemesis", async () => {
		const player = await login("player-pw");
		const { data } = await kill(player, { killer: "warmachine", victim: "falcon", special: true, bonus: true, note: "x" });
		expect(data.points).toBe(1);
	});

	test("reject repeats, teammates and rps rematches", async () => {
		const player = await login("player-pw");
		expect((await kill(player, { killer: "warmachine", victim: "falcon" })).res.status).toBe(201);
		expect((await kill(player, { killer: "warmachine", victim: "falcon" })).res.status).toBe(409);
		expect((await kill(player, { killer: "warmachine", victim: "ironman" })).res.status).toBe(409);
		expect((await kill(player, { killer: "cap", victim: "widow", rps: true })).res.status).toBe(201);
		expect((await kill(player, { killer: "widow", victim: "cap" })).res.status).toBe(409);
		// Lost rps today, so nobody else gets Widow until tomorrow.
		expect((await kill(player, { killer: "falcon", victim: "widow" })).res.status).toBe(409);
		expect((await kill(player, { killer: "falcon", victim: "widow", day: "2026-10-13" })).res.status).toBe(201);
	});

	test("undo", async () => {
		const player = await login("player-pw");
		const { data } = await kill(player, { killer: "warmachine", victim: "falcon" });
		expect((await call(`/api/kills/${data.id}`, { method: "DELETE", cookie: player })).res.status).toBe(200);
		expect((await call("/api/state")).data.kills).toHaveLength(0);
	});
});

describe("remapping", () => {
	test("leaves already scored kills with their original player, team and points", async () => {
		const admin = await login("admin-pw");
		await kill(admin, { killer: "warmachine", victim: "wanda", special: true });

		// Kieran defects to Team Cap as Falcon's new player, and War Machine changes nemesis.
		await call("/api/characters/swap", { method: "POST", cookie: admin, body: { a: "warmachine", b: "falcon" } });
		await call("/api/characters/warmachine", { method: "PATCH", cookie: admin, body: { team: "cap", target: "spidey" } });

		const { data: s } = await call("/api/state");
		const wm = s.characters.find((c: any) => c.id === "warmachine");
		expect(wm).toMatchObject({ player: "Zoe Hungerford", team: "cap", target: "spidey" });
		expect(s.characters.find((c: any) => c.id === "falcon").player).toBe("Kieran Klukas");
		expect(s.kills[0]).toMatchObject({ killerPlayer: "Kieran Klukas", killerTeam: "stark", points: 2 });

		// New kills use the new mapping.
		const { data } = await kill(admin, { killer: "warmachine", victim: "spidey", special: true });
		expect(data.points).toBe(2);
		const after = (await call("/api/state")).data.kills.at(-1);
		expect(after).toMatchObject({ killerPlayer: "Zoe Hungerford", killerTeam: "cap" });
	});

	test("removing a character with history retires it", async () => {
		const admin = await login("admin-pw");
		await kill(admin, { killer: "spidey", victim: "cap" });
		const { data } = await call("/api/characters/spidey", { method: "DELETE", cookie: admin });
		expect(data.retired).toBe(true);
		const s = (await call("/api/state")).data;
		expect(s.characters.find((c: any) => c.id === "spidey").active).toBe(false);
		expect(s.characters.find((c: any) => c.id === "antman").target).toBeNull();
		expect((await kill(admin, { killer: "spidey", victim: "falcon" })).res.status).toBe(409);
	});

	test("adding a character", async () => {
		const admin = await login("admin-pw");
		const { res, data } = await call("/api/characters", {
			method: "POST",
			cookie: admin,
			body: { hero: "Winter Soldier", player: "Someone", team: "cap", target: "ironman", special: "Arm punch" },
		});
		expect(res.status).toBe(201);
		expect(data.id).toBe("wintersoldier");
	});
});

describe("auth", () => {
	test("players can't touch admin routes", async () => {
		const player = await login("player-pw");
		const { res } = await call("/api/characters/cap", { method: "PATCH", cookie: player, body: { player: "x" } });
		expect(res.status).toBe(401);
	});

	test("forged and expired cookies are ignored", async () => {
		const admin = await login("admin-pw");
		const [, value] = admin.split("=");
		const [, exp, sig] = value.split(".");
		const forged = `cw_session=admin.${Number(exp) + 1}.${sig}`;
		expect((await call("/api/session", { cookie: forged })).data.role).toBeNull();
		expect((await call("/api/session", { cookie: admin })).data.role).toBe("admin");
	});

	test("changing the password signs everyone out", async () => {
		const admin = await login("admin-pw");
		env.ADMIN_PASSWORD = "new-pw";
		expect((await call("/api/session", { cookie: admin })).data.role).toBeNull();
	});

	test("admin is off with no admin password", async () => {
		env.ADMIN_PASSWORD = undefined;
		expect((await call("/api/session", { method: "POST", body: { password: "" } })).res.status).toBe(401);
		const { res } = await call("/api/characters/cap", { method: "PATCH", body: { player: "x" } });
		expect(res.status).toBe(403);
	});

	test("mutations need a JSON content type", async () => {
		const req = new Request("https://cw.test/api/kills", { method: "POST", body: "killer=cap" });
		const res = await worker.fetch(req as any, env);
		expect(res.status).toBe(415);
	});
});
