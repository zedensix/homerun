import { z } from "zod";

export const releaseChannelsApiBody = z.object({
	branch: z
		.string()
		.trim()
		.min(1)
		.optional()
		.describe(
			"The branch that feeds the canary. Defaults to the one already set, else the service's branch.",
		),
	canaryDomain: z
		.string()
		.trim()
		.toLowerCase()
		.nullable()
		.optional()
		.describe(
			"A custom domain for the canary, null for none (it keeps its default <slug>-canary hostname). Omit to keep the current one.",
		),
	enabled: z
		.boolean()
		.describe(
			"Turn release channels on or off. Off deletes the canary service.",
		),
	envOverrides: z
		.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string())
		.optional()
		.describe(
			"Environment variables set on the canary over what it inherited; {branch} and {slug} are filled in. Replaces the current set; omit to keep it.",
		),
	inheritEnv: z
		.boolean()
		.optional()
		.describe(
			"Whether the canary starts from this service's environment variables, with this service's own hostnames in them pointed at the canary. Omit to keep the current setting.",
		),
	tagPattern: z
		.string()
		.trim()
		.min(1)
		.optional()
		.describe(
			"Glob a pushed tag must match to deploy the stable service, e.g. v*. Defaults to the one already set.",
		),
});
