#!/usr/bin/env bun
// The social card and the apple touch icon, drawn from the same colors and
// type as the scoreboard.
//
//   bun scripts/og-image.mjs        # -> public/og.png, public/apple-touch-icon.png
//
// Shapes go through rsvg-convert and text through ImageMagick with the font
// files named outright, because rsvg falls back to a system sans whatever
// fontconfig is told.

import * as path from "node:path";
import { existsSync } from "node:fs";
import { $ } from "bun";

const ROOT = path.join(import.meta.dir, "..");
const PUBLIC = path.join(ROOT, "public");
const CACHE = path.join(ROOT, "node_modules/.cache/og-fonts");
const TMP = path.join(CACHE, "tmp");
const W = 1200;
const H = 630;

const BG = "#0f1219";
const INK = "#e8ebf2";
const CAP = "#6d9cf0";
const STARK = "#f0776b";

const FONTS = {
	display: {
		file: `${CACHE}/big-shoulders-display-900.ttf`,
		css: "https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@900&display=swap",
	},
};

await $`mkdir -p ${TMP}`.quiet();
for (const { file, css } of Object.values(FONTS)) {
	if (existsSync(file)) continue;
	// The old-browser user agent is what makes Google serve ttf rather than woff2.
	const sheet = await fetch(css, { headers: { "user-agent": "Mozilla/5.0 (X11)" } }).then((r) => r.text());
	const url = sheet.match(/https:\/\/[^)]*\.ttf/)?.[0];
	if (!url) throw new Error(`Could not find a ttf in ${css}`);
	await Bun.write(file, await fetch(url).then((r) => r.arrayBuffer()));
	console.log(`  fetched ${path.basename(file)}`);
}

// ─── shapes ─────────────────────────────────────────────────────────────────

// The title and the favicon's badge sit side by side, centered as a pair.
const SIZE = 200;
const BR = 84;
const GAP = 48;
const titleW = Number(
	await $`magick -font ${FONTS.display.file} -pointsize ${SIZE} label:${"CIVIL WAR"} -trim -format %w info:`.text(),
);
const TX = Math.round((W - (titleW + GAP + 2 * BR)) / 2);
const BX = TX + titleW + GAP + BR;
const BY = H / 2;
const star = (cx, cy, r) => {
	const pts = [];
	for (let i = 0; i < 10; i++) {
		const a = -Math.PI / 2 + (i * Math.PI) / 5;
		const rr = i % 2 ? r * 0.382 : r;
		pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
	}
	return pts.join(" ");
};

// Each team's color washes faintly in from its side.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
	<defs>
		<linearGradient id="cap" x1="0" x2="1"><stop offset="0" stop-color="${CAP}" stop-opacity=".16"/><stop offset="1" stop-color="${CAP}" stop-opacity="0"/></linearGradient>
		<linearGradient id="stark" x1="1" x2="0"><stop offset="0" stop-color="${STARK}" stop-opacity=".16"/><stop offset="1" stop-color="${STARK}" stop-opacity="0"/></linearGradient>
		<clipPath id="badge"><circle cx="${BX}" cy="${BY}" r="${BR}"/></clipPath>
	</defs>
	<rect width="${W}" height="${H}" fill="${BG}"/>
	<rect width="${W / 2}" height="${H}" fill="url(#cap)"/>
	<rect x="${W / 2}" width="${W / 2}" height="${H}" fill="url(#stark)"/>
	<g clip-path="url(#badge)">
		<rect x="${BX - BR}" y="${BY - BR}" width="${BR}" height="${2 * BR}" fill="#2f63c4"/>
		<rect x="${BX}" y="${BY - BR}" width="${BR}" height="${2 * BR}" fill="#c8331f"/>
	</g>
	<polygon points="${star(BX, BY + BR * 0.7 * 0.0955, BR * 0.7)}" fill="#f3f4f7"/>
</svg>`;

const base = `${TMP}/base.png`;
await Bun.write(`${TMP}/base.svg`, svg);
await $`rsvg-convert -w ${W} -h ${H} ${TMP}/base.svg -o ${base}`.quiet();

// ─── text ───────────────────────────────────────────────────────────────────

const text = (font, size, color, x, y, s, gravity = "NorthWest") => [
	"-gravity",
	gravity,
	"-font",
	font,
	"-pointsize",
	String(size),
	"-fill",
	color,
	"-kerning",
	"1",
	"-annotate",
	`+${x}+${y}`,
	s,
];

await $`magick ${base} ${[
	...text(FONTS.display.file, SIZE, INK, TX, 0, "CIVIL WAR", "West"),
]} -strip ${path.join(PUBLIC, "og.png")}`.quiet();

// The home screen icon: the favicon on a solid square, since iOS won't keep
// transparency and rounds the corners itself.
await Bun.write(
	`${TMP}/touch.svg`,
	(await Bun.file(path.join(PUBLIC, "favicon.svg")).text()).replace(
		"<clipPath",
		`<rect x="-6" y="-6" width="76" height="76" fill="${BG}"/><clipPath`,
	).replace('viewBox="0 0 64 64"', 'viewBox="-6 -6 76 76"'),
);
await $`rsvg-convert -w 180 -h 180 ${TMP}/touch.svg -o ${path.join(PUBLIC, "apple-touch-icon.png")}`.quiet();

console.log("  wrote public/og.png and public/apple-touch-icon.png");
