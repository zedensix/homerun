import { z } from "zod";

import { parseDotEnv } from "#lib/env-parse.js";

export const envOverrideMap = z.record(
	z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
	z
		.string()
		.refine(
			(value) => !/[\0\r\n]/.test(value),
			"An override value can't contain a line break or a NUL character.",
		),
);

/**
 * Env overrides typed as `KEY=value` lines in a form, checked against the
 * same rules as the API's override maps so a form post can't store a value
 * the API would refuse. Returns the first problem as `error` instead.
 */
export function parseEnvOverrides(
	text: string,
): { error: string } | { overrides: Record<string, string> } {
	const result = envOverrideMap.safeParse(
		Object.fromEntries(parseDotEnv(text).map((row) => [row.key, row.value])),
	);
	return result.success
		? { overrides: result.data }
		: { error: result.error.issues[0]?.message ?? "Invalid override." };
}
