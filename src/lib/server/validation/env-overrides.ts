import { z } from "zod";

export const envOverrideMap = z.record(
	z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
	z
		.string()
		.refine(
			(value) => !/[\0\r\n]/.test(value),
			"An override value can't contain a line break or a NUL character.",
		),
);
