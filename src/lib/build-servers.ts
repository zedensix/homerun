import { settings } from "#lib/settings.js";

export interface BuildServerChoice {
	buildServerAny: boolean;
	buildServerRemoteHostId: string | null;
}

export interface BuildSlot {
	active: number;
	id: string;
	limit: number;
}

/**
 * The service columns a build server pick sets: a pinned host by id, any
 * free build server (`settings.docker.anyBuildServer`), or this host (empty).
 * Only a git build has a build server.
 */
export function buildServerChoice(input: {
	buildServer?: string | null;
	buildSource: string;
}): BuildServerChoice {
	const pick = input.buildServer;
	if (!(input.buildSource === "git" && pick)) {
		return { buildServerAny: false, buildServerRemoteHostId: null };
	}
	return pick === settings.docker.anyBuildServer
		? { buildServerAny: true, buildServerRemoteHostId: null }
		: { buildServerAny: false, buildServerRemoteHostId: pick };
}

/** The build server picker's value for a service's build server columns, the inverse of `buildServerChoice`. */
export function buildServerPick(choice: BuildServerChoice): string {
	if (choice.buildServerAny) {
		return settings.docker.anyBuildServer;
	}
	return choice.buildServerRemoteHostId ?? "";
}

/**
 * The build servers a git build may run on, empty when it builds on this
 * host: the pinned server, or every registered one when the service takes
 * any free server or the instance doesn't build on this host. With no build
 * server registered, it always builds here.
 */
export function buildServerCandidates(input: {
	buildOnHost: boolean;
	choice: BuildServerChoice;
	serverIds: string[];
}): string[] {
	const { buildOnHost, choice, serverIds } = input;
	if (choice.buildServerRemoteHostId) {
		return [choice.buildServerRemoteHostId];
	}
	if (choice.buildServerAny || !buildOnHost) {
		return serverIds;
	}
	return [];
}

/**
 * The least busy server with a free build slot, picked at random among the
 * equally busy ones, or null when all of them are full. A limit of 0 means
 * no limit.
 */
export function pickBuildServer(
	slots: BuildSlot[],
	random: () => number = Math.random,
): string | null {
	const free = slots.filter((s) => s.limit <= 0 || s.active < s.limit);
	if (free.length === 0) {
		return null;
	}
	const least = Math.min(...free.map((s) => s.active));
	const idle = free.filter((s) => s.active === least);
	return idle[Math.floor(random() * idle.length)]?.id ?? null;
}

export const BUILD_CPU_LIMIT_ERROR = `Build CPUs must be between 0 (no cap) and ${settings.docker.maxBuildCpuLimit} cores.`;
export const BUILD_MEMORY_LIMIT_ERROR = `Build memory must be 0 (no cap) or at least ${settings.docker.minBuildMemoryLimitMb} MB.`;

/** Whether `value` is a usable build CPU cap in cores: 0 (no cap) up to `settings.docker.maxBuildCpuLimit`. */
export function isBuildCpuLimit(value: number): boolean {
	return (
		Number.isFinite(value) &&
		value >= 0 &&
		value <= settings.docker.maxBuildCpuLimit
	);
}

/** Whether `value` is a usable build memory cap in MB: 0 (no cap) or a whole number from `settings.docker.minBuildMemoryLimitMb`. */
export function isBuildMemoryLimit(value: number): boolean {
	return (
		Number.isSafeInteger(value) &&
		(value === 0 || value >= settings.docker.minBuildMemoryLimitMb)
	);
}

/**
 * The CPU and memory caps a build gets on a server: the server's own, else
 * the instance's, each 0 when uncapped.
 */
export function buildResourceLimits(
	server: {
		buildCpuLimit: number | null;
		buildMemoryLimitMb: number | null;
	} | null,
	instance: { buildCpuLimit: number; buildMemoryLimitMb: number },
): { cpuLimit: number; memoryLimitMb: number } {
	return {
		cpuLimit: server?.buildCpuLimit ?? instance.buildCpuLimit,
		memoryLimitMb: server?.buildMemoryLimitMb ?? instance.buildMemoryLimitMb,
	};
}

/** Whether `value` is a usable concurrent-build limit: a whole number from 0 (no limit) to `settings.docker.maxBuildConcurrency`. */
export function isBuildConcurrency(value: number): boolean {
	return (
		Number.isInteger(value) &&
		value >= 0 &&
		value <= settings.docker.maxBuildConcurrency
	);
}
