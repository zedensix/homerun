import { describe, expect, test } from "bun:test";

import { parseEnvOverrides } from "../../../src/lib/server/validation/env-overrides";

describe("parseEnvOverrides", () => {
	test("returns the parsed map when every value passes", () => {
		expect(parseEnvOverrides('A=1\nB=" padded "\nC=')).toEqual({
			overrides: { A: "1", B: " padded ", C: "" },
		});
	});

	test("refuses a bare carriage return or a NUL a form post slipped in", () => {
		for (const text of ["A=one\rtwo", "A=one\u0000two"]) {
			expect(parseEnvOverrides(text)).toEqual({
				error:
					"An override value can't contain a line break or a NUL character.",
			});
		}
	});
});
