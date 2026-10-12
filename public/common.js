// Small helpers shared by the scoreboard and the admin page.

export const $ = (id) => document.getElementById(id);

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export function fmtDay(day) {
	const [y, m, d] = day.split("-").map(Number);
	return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export async function api(path, { method = "GET", body } = {}) {
	const res = await fetch(path, {
		method,
		headers: body === undefined ? {} : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
		credentials: "same-origin",
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(data.error || `Request failed (${res.status}).`);
		err.status = res.status;
		throw err;
	}
	return data;
}

/**
 * Polls /api/state and calls back only when something changed. The worker
 * answers unchanged polls with an empty 304, so this stays cheap.
 */
export function watchState(onChange, onError, every = 5000) {
	let etag = null;
	let timer = null;
	async function tick() {
		clearTimeout(timer);
		try {
			const res = await fetch("/api/state", { headers: etag ? { "if-none-match": etag } : {} });
			if (res.status === 200) {
				etag = res.headers.get("etag");
				onChange(await res.json());
			} else if (res.status !== 304) throw new Error(String(res.status));
		} catch (err) {
			onError?.(err);
		}
		if (!document.hidden) timer = setTimeout(tick, every);
	}
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) tick();
	});
	tick();
	return { refresh: () => tick() };
}
