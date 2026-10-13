import { $, api, esc, fmtDay, watchState } from "/common.js";
import {
	TEAMS,
	addDays,
	check,
	cooldownThrough,
	outOn,
	points,
	today,
	weekStart,
	weeks,
} from "/rules.js";

let characters = [];
let chars = {};
let kills = [];
let session = { role: null, playerPasswordRequired: false };
let loaded = false;

// What's picked in the form. The killer sticks around between kills, since
// it's usually the person holding the phone.
const entry = {
	killer: localStorage.getItem("cw:killer") || "",
	victim: "",
	method: "regular",
	picking: false,
};

const SHORT = {
	repeat: "Already got them",
	"rps-pair": "Settled by RPS",
	"rps-day": "Safe today (lost RPS)",
};

const canWrite = () => !session.playerPasswordRequired || !!session.role;
const active = () => characters.filter((c) => c.active);
const name = (c) => esc(c.player || "(unassigned)");

function draft() {
	return {
		killer: entry.killer,
		victim: entry.victim,
		day: $("day").value || today(),
		rps: entry.method === "rps",
		special: entry.method === "special",
		bonus: entry.method === "special" && !!chars[entry.killer]?.bonus && $("bonus").checked,
	};
}

function renderEntry() {
	const k = chars[entry.killer]?.active ? chars[entry.killer] : null;
	const picking = entry.picking || !k;
	const d = draft();

	$("killerStep").innerHTML =
		`<div class="step-label">Name of killer</div>` +
		(picking
			? Object.entries(TEAMS)
					.map(
						([team, label]) =>
							`<div class="team-label ${team}">${label}</div><div class="picker">${active()
								.filter((c) => c.team === team)
								.map(
									(c) =>
										`<button type="button" class="chip ${team}" data-killer="${esc(c.id)}" aria-pressed="${c.id === entry.killer}"><b>${name(c)}</b><small>${esc(c.hero)}</small></button>`,
								)
								.join("")}</div>`,
					)
					.join("")
			: `<div class="me"><span class="dot ${k.team}"></span><div><b>${name(k)}</b><small>${esc(k.hero)} · ${TEAMS[k.team]}</small></div><button type="button" class="link" data-change>Change</button></div>`);

	$("victimStep").hidden = picking;
	let v = null;
	if (!picking) {
		const out = outOn(d.day, kills);
		const foes = active()
			.filter((c) => c.team !== k.team)
			.sort((a, b) => (b.id === k.target) - (a.id === k.target));
		const why = Object.fromEntries(
			foes.map((c) => [
				c.id,
				loaded ? check({ ...d, victim: c.id }, kills, chars) : null,
			]),
		);
		if (!foes.some((c) => c.id === entry.victim) || why[entry.victim])
			entry.victim = "";
		v = chars[entry.victim] ?? null;
		$("victims").innerHTML = foes
			.map((c) => {
				const no = why[c.id];
				const sub = no
					? (SHORT[no.code] ?? "Unavailable")
					: out.has(c.id)
						? `${esc(c.hero)} · out today`
						: esc(c.hero);
				const star =
					c.id === k.target
						? `<span class="star" title="Your nemesis">★</span>`
						: "";
				return `<button type="button" class="chip ${c.team}" data-victim="${esc(c.id)}" aria-pressed="${c.id === entry.victim}"${no ? ` disabled title="${esc(no.message)}"` : ""}><span class="chip-top"><b>${name(c)}</b>${star}</span><small>${sub}</small></button>`;
			})
			.join("");
	}

	$("methodStep").hidden = !v;
	const nemesis = !!v && k.target === v.id;
	if (!nemesis && entry.method === "special") entry.method = "regular";
	for (const b of document.querySelectorAll("[data-method]")) {
		b.setAttribute("aria-pressed", String(b.dataset.method === entry.method));
		if (b.dataset.method === "special") {
			b.disabled = !nemesis;
			b.title = nemesis ? "" : "Specials only count on your nemesis";
		}
	}
	const special = entry.method === "special";
	if (k) {
		$("bonusText").textContent = k.bonus?.replace(/\s*\(\+1[^)]*\)\s*$/, "") ?? "";
	}
	const bonusOn = special && !!k?.bonus;
	$("bonusWrap").hidden = !bonusOn;
	if (!bonusOn) $("bonus").checked = false;
	$("note").hidden = !$("bonus").checked;

	const final = draft();
	const warns = [];
	if (k && special) {
		const end = cooldownThrough(k, kills, final.day);
		if (end)
			warns.push(
				`${k.hero}'s special is on cooldown until ${fmtDay(addDays(end, 1))}.`,
			);
	}
	$("warn").hidden = !warns.length;
	$("warn").textContent = warns.join(" ");

	const p = k && v ? points(k, final) : 0;
	$("submit").textContent = picking
		? "Pick your hero (or villain 😈)"
		: !v
			? "Pick your target to murder"
			: `Log kill · ${p} ${p === 1 ? "point" : "points"}`;
	$("submit").disabled =
		!loaded || picking || !v || !!check(final, kills, chars);
	$("submit").hidden = !canWrite();
	$("gate").hidden = canWrite();
}

function fmtShort(day) {
	const [y, m, d] = day.split("-").map(Number);
	return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderChart(thisWeek) {
	const done = weeks(kills).filter((w) => w.start < thisWeek);
	$("chartPanel").hidden = !done.length;
	if (!done.length) return;

	// Running count of weeks won, starting from nothing. A tied week moves
	// neither line.
	const list = [{ label: "Start", cap: 0, stark: 0 }];
	for (const w of done) {
		const prev = list[list.length - 1];
		list.push({
			label: fmtShort(w.start),
			cap: prev.cap + (w.winner === "cap" ? 1 : 0),
			stark: prev.stark + (w.winner === "stark" ? 1 : 0),
		});
	}

	const W = 320;
	const H = 150;
	const L = 22;
	const R = 10;
	const T = 10;
	const B = 22;
	const max = Math.max(3, ...list.flatMap((w) => [w.cap, w.stark]));
	const step = Math.max(1, Math.ceil(max / 4));
	const top = step * Math.ceil(max / step);
	const x = (i) => L + (i * (W - L - R)) / (list.length - 1);
	const y = (v) => T + (H - T - B) * (1 - v / top);

	let svg = "";
	for (let v = 0; v <= top; v += step)
		svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/><text x="${L - 6}" y="${y(v) + 3.5}" class="axis" text-anchor="end">${v}</text>`;
	const every = Math.ceil(list.length / 6);
	list.forEach((w, i) => {
		if (i % every && i !== list.length - 1) return;
		const anchor = i === 0 ? "start" : i === list.length - 1 ? "end" : "middle";
		svg += `<text x="${x(i)}" y="${H - 6}" class="axis" text-anchor="${anchor}">${w.label}</text>`;
	});
	// Draw the leader last so it sits on top where the lines overlap.
	const order = list.at(-1).cap >= list.at(-1).stark ? ["stark", "cap"] : ["cap", "stark"];
	for (const team of order) {
		const pts = list.map((w, i) => `${x(i).toFixed(1)},${y(w[team]).toFixed(1)}`);
		svg += `<polyline points="${pts.join(" ")}" class="line ${team}"/>`;
		list.forEach((w, i) => {
			svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(w[team]).toFixed(1)}" r="3.5" class="pt ${team}"><title>${TEAMS[team]} · ${w.label}: ${w[team]} ${w[team] === 1 ? "week" : "weeks"} won</title></circle>`;
		});
	}
	$("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Weeks won by each team over the semester">${svg}</svg>`;
}

function renderWeeks(thisWeek) {
	renderChart(thisWeek);
	const done = weeks(kills).filter((w) => w.start < thisWeek);
	$("pastPanel").hidden = !done.length;
	$("past").innerHTML = [...done]
		.reverse()
		.map((w) => {
			const result = w.winner
				? `<b style="color:var(--${w.winner})">${TEAMS[w.winner]}</b> won the week`
				: "Tied, nobody gets the week";
			return `<li><div>${result}<small>${fmtShort(w.start)} to ${fmtShort(w.end)}</small></div><span class="num"><span style="color:var(--cap)">${w.cap}</span> · <span style="color:var(--stark)">${w.stark}</span></span></li>`;
		})
		.join("");
}

function render() {
	const thisWeek = weekStart(today());
	renderWeeks(thisWeek);
	// Everything below is this week only; points reset every Monday.
	const weekKills = kills.filter((k) => weekStart(k.day) === thisWeek);
	const by = {};
	for (const c of characters) by[c.id] = { pts: 0, kills: 0, was: new Set() };
	const team = { cap: 0, stark: 0 };
	for (const k of weekKills) {
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
	const ranked = shown.sort(
		(a, b) =>
			by[b.id].pts - by[a.id].pts ||
			by[b.id].kills - by[a.id].kills ||
			a.player.localeCompare(b.player),
	);
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
			if (cooldownThrough(c, kills, t))
				tags.push(`<span class="pill cd">Special on cooldown</span>`);
			const was = s.was.size
				? ` · earlier: ${[...s.was].map(esc).join(", ")}`
				: "";
			return `<tr><td class="rank">${s.pts > 0 ? rank : `<span class="unranked">-</span>`}</td><td><div class="who"><span class="dot ${c.team}"></span><div>${esc(c.player || "(unassigned)")} ${tags.join(" ")}<small>${esc(c.hero)}${was}</small></div></div></td><td class="r num">${s.kills}</td><td class="r num"><b>${s.pts}</b></td></tr>`;
		})
		.join("");

	if (!weekKills.length) {
		$("feed").innerHTML =
			`<li class="empty" style="display:block">No kills yet! Go out and multiply death ^-^</li>`;
	} else {
		let html = "";
		let lastDay = null;
		for (const k of [...weekKills].reverse()) {
			if (k.day !== lastDay) {
				html += `<li class="daytag" style="display:block">${fmtDay(k.day)}</li>`;
				lastDay = k.day;
			}
			const bonus = k.bonus
				? ` · bonus${k.note ? ": " + esc(k.note) : ""}`
				: "";
			const detail = k.rps
				? "Won rock paper scissors"
				: k.special
					? `Special: ${esc(k.specialDesc)}${bonus}`
					: "Regular kill";
			html += `<li><span class="p" style="color:var(--${k.killerTeam})">${k.points}</span><div class="t"><b>${esc(k.killerPlayer)}</b> got <b>${esc(k.victimPlayer)}</b><small>${esc(k.killerHero)} → ${esc(k.victimHero)} · ${detail}</small></div>${canWrite() ? `<button class="x" data-id="${k.id}" type="button">Undo</button>` : "<span></span>"}</li>`;
		}
		$("feed").innerHTML = html;
	}

	renderEntry();
}

$("form").addEventListener("click", (e) => {
	const b = e.target.closest("button");
	if (!b || b.disabled) return;
	if (b.dataset.killer) {
		if (b.dataset.killer !== entry.killer) {
			entry.victim = "";
			entry.method = "regular";
		}
		entry.killer = b.dataset.killer;
		entry.picking = false;
		localStorage.setItem("cw:killer", entry.killer);
	} else if ("change" in b.dataset) entry.picking = true;
	else if (b.dataset.victim)
		entry.victim = entry.victim === b.dataset.victim ? "" : b.dataset.victim;
	else if (b.dataset.method) entry.method = b.dataset.method;
	else return;
	renderEntry();
});
for (const id of ["bonus", "day"])
	$(id).addEventListener("change", renderEntry);

$("form").addEventListener("submit", async (e) => {
	e.preventDefault();
	if (!canWrite()) return;
	const d = draft();
	$("submit").disabled = true;
	$("status").textContent = "Saving…";
	try {
		await api("/api/kills", {
			method: "POST",
			body: { ...d, note: $("note").value },
		});
		$("status").textContent = "";
		entry.victim = "";
		entry.method = "regular";
		$("bonus").checked = false;
		$("note").value = "";
		renderEntry();
		watcher.refresh();
	} catch (err) {
		if (err.status === 401) session.role = null;
		$("status").textContent = err.message;
		renderEntry();
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
		session = await api("/api/session", {
			method: "POST",
			body: { password: $("password").value },
		});
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
		render();
	},
	() => {
		$("status").textContent = "Couldn't reach the scoreboard. Retrying…";
		$("status").dataset.offline = "1";
	},
);
