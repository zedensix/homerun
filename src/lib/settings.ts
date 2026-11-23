export const settings = {
	docker: {
		anyBuildServer: "any",
		buildSlotPollMs: 5000,
		buildSlotTimeoutMs: 30 * 60 * 1000,
		maxBuildConcurrency: 64,
		maxBuildCpuLimit: 256,
		minBuildMemoryLimitMb: 256,
	},
} as const;
