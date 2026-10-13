import { describe, expect, test } from "bun:test";
import { weekStart, weeks, type Kill } from "../public/rules.js";

describe("weeks", () => {
	test("start on Monday", () => {
		expect(weekStart("2026-10-12")).toBe("2026-10-12");
		expect(weekStart("2026-10-18")).toBe("2026-10-12");
		expect(weekStart("2026-10-19")).toBe("2026-10-19");
		expect(weekStart("2027-01-01")).toBe("2026-12-28");
	});

	test("total each week by the killer's team at the time, ties go to nobody", () => {
		const k = (day: string, killerTeam: "cap" | "stark", points: number) =>
			({ day, killerTeam, points }) as Kill;
		const list = weeks([
			k("2026-10-12", "cap", 2),
			k("2026-10-14", "stark", 1),
			k("2026-10-20", "stark", 3),
			k("2026-10-27", "cap", 1),
			k("2026-10-28", "stark", 1),
		]);
		expect(list.map((w) => [w.start, w.cap, w.stark, w.winner])).toEqual([
			["2026-10-12", 2, 1, "cap"],
			["2026-10-19", 0, 3, "stark"],
			["2026-10-26", 1, 1, null],
		]);
	});
});
