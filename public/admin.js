import { $, api, esc, fmtDay } from "/common.js";
import { TEAMS } from "/rules.js";

let characters = [];
let chars = {};
let kills = [];

const status = (msg) => ($("status").textContent = msg);

function targetOptions(selfId, selected) {
	return (
		`<option value="">No nemesis</option>` +
		characters
			.filter((c) => c.id !== selfId)
			.map((c) => `<option value="${esc(c.id)}"${c.id === selected ? " selected" : ""}>${esc(c.hero)}${c.active ? "" : " (retired)"}</option>`)
			.join("")
	);
}

function charCard(c) {
	const teams = Object.entries(TEAMS)
		.map(([id, name]) => `<option value="${id}"${c.team === id ? " selected" : ""}>${name}</option>`)
		.join("");
	return `<form class="char ${c.team}${c.active ? "" : " retired"}" data-id="${esc(c.id)}">
		<label class="f">Character<input type="text" name="hero" maxlength="60" value="${esc(c.hero)}" required></label>
		<label class="f">Player<input type="text" name="player" maxlength="80" value="${esc(c.player)}"></label>
		<label class="f">Team<select name="team">${teams}</select></label>
		<label class="f">Nemesis<select name="target">${targetOptions(c.id, c.target)}</select></label>
		<label class="f wide">Special attack<input type="text" name="special" maxlength="200" value="${esc(c.special)}"></label>
		<label class="f wide">Bonus (+1)<input type="text" name="bonus" maxlength="200" value="${esc(c.bonus ?? "")}" placeholder="Extra special (+1)"></label>
		<label class="f">Cooldown days<input type="number" name="cooldown" min="0" max="999" value="${c.cooldown}"></label>
		<label class="f">Order<input type="number" name="sort" min="0" max="999" value="${c.sort}"></label>
		<label class="inline"><input type="checkbox" name="knocksOut"${c.knocksOut ? " checked" : ""}> Special knocks target out for the day</label>
		<label class="inline"><input type="checkbox" name="active"${c.active ? " checked" : ""}> In the game</label>
		<div class="acts"><button class="x" type="button" data-remove>Remove</button><button class="go" type="submit">Save</button></div>
	</form>`;
}

function render() {
	$("chars").innerHTML = characters.map(charCard).join("");

	const opts = characters.filter((c) => c.active).map((c) => `<option value="${esc(c.id)}">${esc(c.hero)} · ${esc(c.player || "(unassigned)")}</option>`).join("");
	for (const id of ["swapA", "swapB"]) {
		const prev = $(id).value;
		$(id).innerHTML = opts;
		if (chars[prev]) $(id).value = prev;
	}
	$("addTarget").innerHTML = targetOptions(null, null);

	$("kills").innerHTML = kills.length
		? [...kills]
				.reverse()
				.map((k) => {
					const how = k.rps ? "Rock paper scissors" : k.special ? `Special${k.bonus ? " + bonus" : ""}` : "Regular";
					return `<tr data-id="${k.id}">
						<td><input type="date" name="day" value="${esc(k.day)}" title="${esc(fmtDay(k.day))}"></td>
						<td><b style="color:var(--${k.killerTeam})">${esc(k.killerPlayer)}</b> (${esc(k.killerHero)}) got <b style="color:var(--${k.victimTeam})">${esc(k.victimPlayer)}</b> (${esc(k.victimHero)})</td>
						<td>${how}</td>
						<td class="r"><input type="number" name="points" min="-10" max="10" value="${k.points}"></td>
						<td><input type="text" name="note" maxlength="140" value="${esc(k.note)}"></td>
						<td style="white-space:nowrap"><button class="x" type="button" data-save>Save</button> <button class="x" type="button" data-delete>Delete</button></td>
					</tr>`;
				})
				.join("")
		: `<tr><td colspan="6" class="empty">No kills yet.</td></tr>`;
}

async function load() {
	const s = await api("/api/state");
	characters = s.characters;
	chars = Object.fromEntries(characters.map((c) => [c.id, c]));
	kills = s.kills;
	render();
}

async function act(fn, done) {
	try {
		await fn();
		status(done);
		await load();
	} catch (err) {
		status(err.message);
		if (err.status === 401) await boot();
	}
}

$("chars").addEventListener("submit", (e) => {
	e.preventDefault();
	const form = e.target;
	const f = new FormData(form);
	const body = {
		hero: f.get("hero"),
		player: f.get("player"),
		team: f.get("team"),
		target: f.get("target") || null,
		special: f.get("special"),
		bonus: f.get("bonus"),
		cooldown: Number(f.get("cooldown")),
		sort: Number(f.get("sort")),
		knocksOut: f.has("knocksOut"),
		active: f.has("active"),
	};
	act(() => api(`/api/characters/${encodeURIComponent(form.dataset.id)}`, { method: "PATCH", body }), `Saved ${body.hero}.`);
});

$("chars").addEventListener("click", (e) => {
	const b = e.target.closest("[data-remove]");
	if (!b) return;
	if (!b.classList.contains("arm")) {
		b.classList.add("arm");
		b.textContent = "Really?";
		setTimeout(() => {
			b.classList.remove("arm");
			b.textContent = "Remove";
		}, 3000);
		return;
	}
	const id = b.closest("form").dataset.id;
	act(async () => {
		const r = await api(`/api/characters/${encodeURIComponent(id)}`, { method: "DELETE" });
		if (r.retired) setTimeout(() => status(`${chars[id]?.hero ?? "Character"} has kills on record, so it was retired instead of deleted.`));
	}, "Removed.");
});

$("swap").addEventListener("submit", (e) => {
	e.preventDefault();
	const a = $("swapA").value;
	const b = $("swapB").value;
	act(() => api("/api/characters/swap", { method: "POST", body: { a, b } }), `Swapped ${chars[a]?.player} and ${chars[b]?.player}.`);
});

$("add").addEventListener("submit", (e) => {
	e.preventDefault();
	const body = {
		hero: $("addHero").value,
		player: $("addPlayer").value,
		team: $("addTeam").value,
		target: $("addTarget").value || null,
		special: $("addSpecial").value,
	};
	act(async () => {
		await api("/api/characters", { method: "POST", body });
		$("add").reset();
	}, `Added ${body.hero}.`);
});

$("kills").addEventListener("click", (e) => {
	const row = e.target.closest("tr[data-id]");
	if (!row) return;
	const id = row.dataset.id;
	if (e.target.closest("[data-save]")) {
		const body = {
			day: row.querySelector("[name=day]").value,
			points: Number(row.querySelector("[name=points]").value),
			note: row.querySelector("[name=note]").value,
		};
		act(() => api(`/api/kills/${id}`, { method: "PATCH", body }), "Kill updated.");
	}
	const del = e.target.closest("[data-delete]");
	if (del) {
		if (!del.classList.contains("arm")) {
			del.classList.add("arm");
			del.textContent = "Really?";
			return;
		}
		act(() => api(`/api/kills/${id}`, { method: "DELETE" }), "Kill deleted.");
	}
});

$("login").addEventListener("submit", async (e) => {
	e.preventDefault();
	try {
		const s = await api("/api/session", { method: "POST", body: { password: $("password").value } });
		$("password").value = "";
		if (s.role !== "admin") {
			status("That's the player password. Admin needs its own.");
			return;
		}
		status("");
		await boot();
	} catch (err) {
		status(err.message);
	}
});

$("logout").addEventListener("click", async () => {
	await api("/api/session", { method: "DELETE" }).catch(() => {});
	await boot();
});

async function boot() {
	const s = await api("/api/session");
	const admin = s.role === "admin";
	$("main").hidden = !admin;
	$("logout").hidden = !s.role;
	$("login").hidden = admin || !s.adminEnabled;
	if (!s.adminEnabled) status("Admin is turned off. Set ADMIN_PASSWORD on the worker to turn it on.");
	if (admin) await load();
}

boot().catch((err) => status(err.message));
