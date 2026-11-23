import type { BuildCapacity } from "#lib/build-servers.js";
import { WorkerClient } from "#lib/server/worker-client.js";

export interface SystemStats {
	cpuPercent: number;
	diskTotalGb: number | null;
	diskUsedGb: number | null;
	gpu: GpuStats | null;
	memTotalMb: number;
	memUsedMb: number;
}

export interface GpuStats {
	memTotalMb: number;
	memUsedMb: number;
	name: string;
	utilizationPercent: number;
}

/** What a worker answers for its host, on `/v1/host/stats` locally and `/v1/stats` in agent mode. */
export interface HostStats {
	cpuCount?: number;
	cpuPercent: number;
	diskPercent: number | null;
	diskTotalMb: number | null;
	diskUsedMb: number | null;
	gpu: GpuStats | null;
	memPercent: number;
	memTotalMb: number;
	memUsedMb: number;
}

const MB_PER_GB = 1024;

/** A worker's host stats in the dashboard's shape, disk in GB. */
export function toSystemStats(host: HostStats): SystemStats {
	return {
		cpuPercent: host.cpuPercent,
		diskTotalGb:
			host.diskTotalMb === null ? null : host.diskTotalMb / MB_PER_GB,
		diskUsedGb: host.diskUsedMb === null ? null : host.diskUsedMb / MB_PER_GB,
		gpu: host.gpu,
		memTotalMb: host.memTotalMb,
		memUsedMb: host.memUsedMb,
	};
}

/** How many CPUs and how much memory a worker's host has, for showing a build cap against it; an agent too old to send its CPU count leaves that null. */
export function capacityOf(host: HostStats): BuildCapacity {
	return {
		cpuCount: host.cpuCount || null,
		memTotalMb: host.memTotalMb || null,
	};
}

/** Host-level (not per-container) CPU/RAM/disk/GPU stats for the dashboard. */
class SystemStatsServiceClass {
	/**
	 * Current host CPU/RAM/disk/GPU snapshot, run for the dashboard's Host
	 * Resources panel and the stats sampler. Read from the Go worker, which is
	 * the process on the real Docker host : the app may be a container, and its
	 * own `os`/`df` readings would describe that container's limits rather than
	 * the machine's. CPU% is a delta over at least a second against the
	 * worker's baseline sample, shared by every caller, so the first call after
	 * the worker starts reports 0.
	 */
	async getSystemStats(): Promise<SystemStats> {
		return toSystemStats(await WorkerClient.get<HostStats>("/v1/host/stats"));
	}

	/** This host's CPUs and memory, null when the worker can't be reached. */
	async getCapacity(): Promise<BuildCapacity | null> {
		return await WorkerClient.get<HostStats>("/v1/host/stats")
			.then(capacityOf)
			.catch(() => null);
	}
}

export const SystemStatsService = new SystemStatsServiceClass();
