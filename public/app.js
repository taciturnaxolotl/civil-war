import { $, api, esc, fmtDay, watchState } from "/common.js";
import { EXTRA, TEAMS, addDays, blocker, cooldownThrough, outOn, points, today, usesSpecial } from "/rules.js";

let characters = [];
let chars = {};
let kills = [];
let session = { role: null, playerPasswordRequired: false };
let loaded = false;

const canWrite = () => !session.playerPasswordRequired || !!session.role;
const bonusText = (c) => c.bonus || EXTRA;
const label = (c, extra = "") => `<option value="${esc(c.id)}">${esc(c.player || "(unassigned)")} · ${esc(c.hero)}${extra}</option>`;
const active = () => characters.filter((c) => c.active);

function fillKiller() {
	const prev = $("killer").value;
	$("killer").innerHTML = Object.entries(TEAMS)
		.map(([team, name]) => `<optgroup label="${name}">${active().filter((c) => c.team === team).map((c) => label(c)).join("")}</optgroup>`)
		.join("");
	const remembered = localStorage.getItem("cw:killer");
	const pick = [prev, remembered].find((id) => id && chars[id]?.active);
	if (pick) $("killer").value = pick;
}

function fillVictim() {
	const k = chars[$("killer").value];
	const prev = $("victim").value;
	if (!k) {
		$("victim").innerHTML = "";
		return;
	}
	const foes = active().filter((v) => v.team !== k.team);
	$("victim").innerHTML = foes.map((v) => label(v, k.target === v.id ? "  ★ nemesis" : "")).join("");
	const ids = foes.map((v) => v.id);
	$("victim").value = ids.includes(prev) ? prev : ids.includes(k.target) ? k.target : (ids[0] ?? "");
}

function draft() {
	return {
		killer: $("killer").value,
		victim: $("victim").value,
		day: $("day").value || today(),
		rps: $("rps").checked,
		special: $("special").checked,
		bonus: $("bonus").checked,
	};
}

function updateForm() {
	const k = chars[$("killer").value];
	const v = chars[$("victim").value];
	const rps = $("rps").checked;
	const nemesis = !!k && !!v && k.target === v.id && !rps;

	$("specialWrap").hidden = !nemesis;
	if (!nemesis) $("special").checked = false;
	$("specialDesc").textContent = k ? `: ${k.special}` : "";
	const showBonus = nemesis && $("special").checked;
	$("bonusWrap").hidden = !showBonus;
	if (!showBonus) $("bonus").checked = false;
	if (k) {
		$("bonusTitle").textContent = bonusText(k);
		$("bonusHint").textContent = k.bonus ? ", or anything else extra special, +1 either way" : ", pulled it off in some especially impressive way";
	}
	$("noteWrap").hidden = !$("bonus").checked;

	const d = draft();
	const p = k ? points(k, d) : 0;
	$("prev").textContent = p;
	$("prevNote").textContent = p === 1 ? "point" : "points";

	const warns = [];
	const why = loaded ? blocker(d, kills, chars) : null;
	if (why) warns.push(why);
	if (k && usesSpecial(k, d)) {
		const end = cooldownThrough(k, kills, d.day);
		if (end) warns.push(`${k.hero}'s special is on cooldown until ${fmtDay(addDays(end, 1))}.`);
	}
	if (v && outOn(d.day, kills).has(v.id)) warns.push(`${v.player} is already out of commission on this day.`);
	$("warn").hidden = !warns.length;
	$("warn").textContent = warns.join(" ");

	$("gate").hidden = canWrite();
	$("submit").hidden = !canWrite();
	$("submit").disabled = !loaded || !!why || !k || !v;
}

function render() {
	const by = {};
	for (const c of characters) by[c.id] = { pts: 0, kills: 0, was: new Set() };
	const team = { cap: 0, stark: 0 };
	for (const k of kills) {
		// Team totals use the team the killer was on when it happened.
		team[k.killerTeam] = (team[k.killerTeam] ?? 0) + k.points;
		const row = by[k.killer];
		if (!row) continue;
		row.pts += k.points;
		row.kills++;
		if (k.killerPlayer !== chars[k.killer].player) row.was.add(k.killerPlayer);
	}
	$("capPts").textContent = team.cap;
	$("starkPts").textContent = team.stark;
	const tot = team.cap + team.stark;
	$("barC").style.width = (tot ? (team.cap / tot) * 100 : 50) + "%";
	$("barS").style.width = (tot ? (team.stark / tot) * 100 : 50) + "%";

	const t = today();
	const out = outOn(t, kills);
	const shown = characters.filter((c) => c.active || by[c.id].kills);
	const ranked = shown.sort((a, b) => by[b.id].pts - by[a.id].pts || by[b.id].kills - by[a.id].kills || a.player.localeCompare(b.player));
	let rank = 0;
	let prevPts = null;
	$("standings").innerHTML = ranked
		.map((c, i) => {
			const s = by[c.id];
			if (s.pts !== prevPts) {
				rank = i + 1;
				prevPts = s.pts;
			}
			const tags = [];
			if (!c.active) tags.push(`<span class="pill">Retired</span>`);
			if (out.has(c.id)) tags.push(`<span class="pill out">Out today</span>`);
			if (cooldownThrough(c, kills, t)) tags.push(`<span class="pill cd">Special on cooldown</span>`);
			const was = s.was.size ? ` · earlier: ${[...s.was].map(esc).join(", ")}` : "";
			return `<tr><td class="rank">${rank}</td><td><div class="who"><span class="dot ${c.team}"></span><div>${esc(c.player || "(unassigned)")} ${tags.join(" ")}<small>${esc(c.hero)}${was}</small></div></div></td><td class="r num">${s.kills}</td><td class="r num"><b>${s.pts}</b></td></tr>`;
		})
		.join("");

	if (!kills.length) {
		$("feed").innerHTML = `<li class="empty" style="display:block">No kills yet. Log the first one above.</li>`;
	} else {
		let html = "";
		let lastDay = null;
		for (const k of [...kills].reverse()) {
			if (k.day !== lastDay) {
				html += `<li class="daytag" style="display:block">${fmtDay(k.day)}</li>`;
				lastDay = k.day;
			}
			const bonus = k.bonus ? ` · bonus${k.note ? ": " + esc(k.note) : ""}` : "";
			const detail = k.rps ? "Won rock paper scissors" : k.special ? `Special: ${esc(k.specialDesc)}${bonus}` : "Regular kill";
			html += `<li><span class="p" style="color:var(--${k.killerTeam})">${k.points}</span><div class="t"><b>${esc(k.killerPlayer)}</b> got <b>${esc(k.victimPlayer)}</b><small>${esc(k.killerHero)} → ${esc(k.victimHero)} · ${detail}</small></div>${canWrite() ? `<button class="x" data-id="${k.id}" type="button">Undo</button>` : "<span></span>"}</li>`;
		}
		$("feed").innerHTML = html;
	}

	$("rules").innerHTML =
		active()
			.map((c) => {
				const tgt = chars[c.target];
				const bits = [`<b style="color:var(--${c.team})">${esc(c.hero)}</b> → ${tgt ? esc(tgt.hero) : "no nemesis"}: ${esc(c.special)}`];
				if (c.bonus) bits.push(`bonus: ${esc(c.bonus)}`);
				if (c.knocksOut) bits.push("target out for the day");
				if (c.cooldown) bits.push(`${c.cooldown}-day cooldown`);
				return `<div>${bits.join(" · ")}</div>`;
			})
			.join("") +
		`<div style="margin-top:6px">Any special attack pulled off in an extra special way earns +1 (one bonus per kill, so 3 pts max).</div>` +
		`<div>See each other at the same time? Rock paper scissors: the winner gets a regular kill, the two of you can't kill each other after that, and nobody else can kill the loser that day.</div>` +
		`<div>Otherwise, after someone is killed, the killer's teammates can still kill them that same day (each person once).</div>` +
		`<div>Safe spots: lounge, dorms, classes, work. Immunity: sing your team's song.</div>`;

	updateForm();
}

$("killer").addEventListener("change", () => {
	localStorage.setItem("cw:killer", $("killer").value);
	fillVictim();
	$("special").checked = false;
	updateForm();
});
for (const id of ["victim", "rps", "special", "bonus", "day"]) $(id).addEventListener("change", updateForm);

$("form").addEventListener("submit", async (e) => {
	e.preventDefault();
	if (!canWrite()) return;
	const d = draft();
	$("submit").disabled = true;
	$("status").textContent = "Saving…";
	try {
		await api("/api/kills", { method: "POST", body: { ...d, note: $("note").value } });
		$("status").textContent = `Logged: ${chars[d.killer].player} got ${chars[d.victim].player}.`;
		for (const id of ["rps", "special", "bonus"]) $(id).checked = false;
		$("note").value = "";
		watcher.refresh();
	} catch (err) {
		if (err.status === 401) session.role = null;
		$("status").textContent = err.message;
		updateForm();
	}
});

$("feed").addEventListener("click", async (e) => {
	const b = e.target.closest(".x");
	if (!b) return;
	if (!b.classList.contains("arm")) {
		b.classList.add("arm");
		b.textContent = "Confirm";
		setTimeout(() => {
			b.classList.remove("arm");
			b.textContent = "Undo";
		}, 3000);
		return;
	}
	b.disabled = true;
	try {
		await api(`/api/kills/${b.dataset.id}`, { method: "DELETE" });
		$("status").textContent = "Kill removed.";
		watcher.refresh();
	} catch (err) {
		$("status").textContent = err.message;
		b.disabled = false;
	}
});

async function unlock() {
	try {
		session = await api("/api/session", { method: "POST", body: { password: $("password").value } });
		$("password").value = "";
		$("status").textContent = "Unlocked. Go get 'em.";
		render();
	} catch (err) {
		$("status").textContent = err.message;
	}
}
$("unlock").addEventListener("click", unlock);
$("password").addEventListener("keydown", (e) => {
	if (e.key === "Enter") {
		e.preventDefault();
		unlock();
	}
});

$("day").value = today();
api("/api/session")
	.then((s) => {
		session = s;
		render();
	})
	.catch(() => {});

const watcher = watchState(
	(s) => {
		characters = s.characters;
		chars = Object.fromEntries(characters.map((c) => [c.id, c]));
		kills = s.kills;
		loaded = true;
		if ($("status").dataset.offline) {
			$("status").textContent = "";
			delete $("status").dataset.offline;
		}
		fillKiller();
		fillVictim();
		render();
	},
	() => {
		$("status").textContent = "Couldn't reach the scoreboard. Retrying…";
		$("status").dataset.offline = "1";
	},
);
