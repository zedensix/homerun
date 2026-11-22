import { stripAnsi } from "#lib/ansi.js";
import { config } from "#lib/config.js";
import { phaseLine } from "#lib/deploy-phases.js";
import type { ServiceDTO } from "#lib/dto/service-dto.js";
import { ServiceVolumeDTO } from "#lib/dto/service-volume-dto.js";
import type { ImageUpdateAvailable } from "#lib/image-versions.js";
import { diagnosisLines, withExitMeaning } from "#lib/revisions.js";
import { runtimeOptionsFrom } from "#lib/service-runtime.js";

import {
	VOLUME_HELPER_IMAGE,
	VOLUME_HELPER_TAG,
} from "./backup/volume-services.ts";
import { previousImages } from "./deploy/worker-spec.ts";
import { DockerService } from "./docker.service.ts";
import {
	dockerHealthcheck,
	healthcheckTimingOf,
} from "./docker/healthcheck.ts";
import { stackNetworkName } from "./docker/networks.ts";
import { listeningHealthcheck } from "./docker/readiness.ts";
import { runtimeHostConfig } from "./docker/runtime-options.ts";
import { swarmNetworkName } from "./docker/swarm.ts";

const TRIAL_LABEL = "homerun.update-trial";
const TRIAL_SETTLE_MS = 20_000;
const TRIAL_HEALTH_TIMEOUT_MS = 180_000;
const TRIAL_POLL_MS = 2000;
const TRIAL_LOG_LINES = 20;
const POSTGRES_UPGRADE_TIMEOUT_MS = 13 * 60 * 60 * 1000;

/** One of the live service's mounts as a trial container binds it: a fresh copy of a writable volume, the original itself when read-only. */
interface TrialMount {
	bind: string;
	copy: string | null;
	target: string;
}

/** What the worker answers once it upgraded, or found nothing to upgrade in, a Postgres cluster. */
interface PostgresUpgrade {
	error?: string;
	log: string[];
	remounts: { from: string; source: string; to: string }[];
	upgraded: boolean;
}

/** How a trial container proves it's ready: the `Healthcheck` to create it with (none keeps the image's own), whether to wait for health, and why not. */
interface TrialReadiness {
	healthcheck?: object;
	reason?: string;
	waits: boolean;
}

/** What a trial container is started from: the pulled image, the volume copies and the readiness check. */
interface TrialSpec {
	mounts: TrialMount[];
	readiness: TrialReadiness;
	ref: string;
}

interface TrialImageInspect {
	Config?: { Healthcheck?: { Test?: string[] | null } | null };
}

interface TrialInspect {
	State?: {
		ExitCode?: number;
		Health?: { Status?: string };
		Restarting?: boolean;
		Running?: boolean;
		Status?: string;
	};
}

/** The trial container's name for `svc`, which its volume copies are named after. */
function trialName(svc: ServiceDTO): string {
	return `homerun-trial-${svc.slug}`;
}

/** Waits `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The error message of whatever was thrown. */
export function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Trial runs of an image update: the new version started next to the live service, configured like it, on copies of its volumes. */
class UpdateTrialServiceClass {
	/**
	 * Pulls the update and starts it in a container of its own, configured
	 * like the live one: the service's env, command, entrypoint, user,
	 * capabilities, devices and resource limits, and every mount at its path,
	 * each writable volume as a fresh copy of the live one so the new version
	 * finds its config and data without being able to write to them. It joins
	 * the service's networks (Homerun's and its stack's, without the service's
	 * alias, so it reaches its database but never gets its traffic), with no
	 * published ports or Traefik labels, so it can't take the live service's
	 * ports or domains. Passes once the container reports healthy on the
	 * readiness check a real deploy would use, or is still running after
	 * `TRIAL_SETTLE_MS` when the service has healthchecks off. Each step, and
	 * the container's own output, goes to `progress` with the deploy log's
	 * phase markers. The container and the volume copies are always removed;
	 * the pulled image stays, ready for the real deploy.
	 * @returns A one-line summary of how it passed.
	 * @throws describing how it failed, with the container's last log lines.
	 */
	async run(
		svc: ServiceDTO,
		update: ImageUpdateAvailable,
		progress: (...lines: string[]) => Promise<void>,
	): Promise<string> {
		const auth = DockerService.buildAuthConfig(svc.toJSON());
		const ref = update.digest
			? `${svc.image}@${update.digest}`
			: `${svc.image}:${update.tag}`;
		await progress(phaseLine("image"), `Pulling ${svc.image}:${update.tag}`);
		try {
			await DockerService.pullImage({
				auth,
				image: svc.image,
				tag: update.digest ? `${update.tag}@${update.digest}` : update.tag,
			});
		} catch (err) {
			await progress(`Pull failed: ${messageOf(err)}`);
			throw err;
		}
		await progress(`Pulled ${ref}`, phaseLine("container"));
		const readiness = await this.#trialReadiness(svc, {
			image: svc.image,
			tag: update.digest ? `${update.tag}@${update.digest}` : update.tag,
		});
		await DockerService.worker
			.delete(`v1/containers/${trialName(svc)}`, { force: "1" })
			.catch(() => undefined);
		const mounts = await this.#trialMounts(svc, progress);
		try {
			const upgraded = await this.#upgradePostgres(
				svc,
				{ mounts, ref },
				progress,
			);
			await progress(
				"Starting a throwaway container on the service's networks, with copies of its volumes and no ports or domains",
			);
			return await this.#startTrial(
				svc,
				{ mounts: upgraded, readiness, ref },
				progress,
			);
		} finally {
			await this.#removeTrialVolumes(mounts);
		}
	}

	/** Creates and starts the trial container from `ref`, then watches it until it passes or fails, always removing it. */
	async #startTrial(
		svc: ServiceDTO,
		{ mounts, readiness, ref }: TrialSpec,
		progress: (...lines: string[]) => Promise<void>,
	): Promise<string> {
		const name = trialName(svc);
		const row = svc.toJSON();
		const runtime = runtimeOptionsFrom(row);
		const networks = await this.#trialNetworks(svc);
		const created = await DockerService.worker.post<{ id: string }>(
			"v1/containers",
			{
				body: {
					Cmd: svc.command ?? undefined,
					Entrypoint: row.entrypoint ?? undefined,
					Env: Object.entries(svc.envVars).map(
						([key, value]) => `${key}=${value}`,
					),
					HostConfig: {
						...runtimeHostConfig(runtime),
						Binds: mounts.length > 0 ? mounts.map((m) => m.bind) : undefined,
						Memory: svc.memoryLimitMb
							? svc.memoryLimitMb * 1024 * 1024
							: undefined,
						NanoCpus: svc.cpuLimit
							? Math.round(Number.parseFloat(svc.cpuLimit) * 1e9)
							: undefined,
						NetworkMode: networks[0],
						RestartPolicy: { Name: "no" },
					},
					Healthcheck: readiness.healthcheck,
					Image: ref,
					Labels: { [TRIAL_LABEL]: svc.id },
					NetworkingConfig: {
						EndpointsConfig: Object.fromEntries(
							networks.map((network) => [network, {}]),
						),
					},
					User: runtime.runAsUser || undefined,
				},
				name,
			},
		);
		try {
			await DockerService.worker.post(`v1/containers/${created.id}/start`);
			await progress(
				`Started ${name}`,
				phaseLine("health"),
				readiness.waits
					? "Waiting for it to report healthy"
					: `${readiness.reason}, waiting ${TRIAL_SETTLE_MS / 1000}s to see it stays up`,
			);
			const message = await this.#watchTrial(created.id);
			const logs = await this.#trialLogs(created.id);
			await progress(
				...(logs ? logs.split("\n") : []),
				phaseLine("ready"),
				message,
			);
			return message;
		} catch (err) {
			const diagnosis = await DockerService.containerDiagnosis(created.id);
			const message = withExitMeaning(messageOf(err), diagnosis);
			const output = diagnosis
				? diagnosisLines("Its last output:", diagnosis).map(stripAnsi)
				: [];
			await progress(...output, message);
			throw new Error(
				output.length > 0 ? `${message}\n\n${output.join("\n")}` : message,
			);
		} finally {
			await DockerService.worker
				.delete(`v1/containers/${created.id}`, { force: "1" })
				.catch(() => undefined);
		}
	}

	/**
	 * The service's mounts as the trial container binds them: each writable
	 * volume or host path copied into a fresh named volume (owners, modes and
	 * links kept), a read-only one bound as is. A copy left over from an
	 * earlier trial is removed first.
	 * @throws When a copy fails, after removing the copies already made.
	 */
	async #trialMounts(
		svc: ServiceDTO,
		progress: (...lines: string[]) => Promise<void>,
	): Promise<TrialMount[]> {
		const mounts: TrialMount[] = [];
		const live = await ServiceVolumeDTO.listForService(svc.id);
		try {
			for (const [index, m] of live.entries()) {
				const { containerPath, readOnly } = m.mount.toJSON();
				if (readOnly) {
					mounts.push({
						bind: `${m.volumeSource}:${containerPath}:ro`,
						copy: null,
						target: containerPath,
					});
					continue;
				}
				const copy = `${trialName(svc)}-${index}`;
				// oxlint-disable-next-line no-await-in-loop -- one copy at a time, each reported in order
				await DockerService.removeVolume(copy).catch(() => undefined);
				mounts.push({
					bind: `${copy}:${containerPath}`,
					copy,
					target: containerPath,
				});
				// oxlint-disable-next-line no-await-in-loop -- see above
				await progress(`Copying ${m.volumeName} for ${containerPath}`);
				// oxlint-disable-next-line no-await-in-loop -- see above
				const result = await DockerService.runOneOff({
					binds: [`${m.volumeSource}:/from:ro`, `${copy}:/to`],
					cmd: ["cp", "-a", "/from/.", "/to/"],
					image: VOLUME_HELPER_IMAGE,
					labels: { [TRIAL_LABEL]: svc.id },
					tag: VOLUME_HELPER_TAG,
				});
				if (result.exitCode !== 0 || result.timedOut) {
					throw new Error(
						`Couldn't copy ${m.volumeName}: ${result.timedOut ? "timed out" : result.stderr.toString().trim() || `cp exited ${result.exitCode}`}`,
					);
				}
			}
		} catch (err) {
			await progress(messageOf(err));
			await this.#removeTrialVolumes(mounts);
			throw err;
		}
		return mounts;
	}

	/**
	 * Upgrades the Postgres cluster in the trial's volume copies when the
	 * update switches Postgres majors, the way the real deploy will (see the
	 * worker's pgupgrade), dumping it with the live image. Does nothing for
	 * any other image.
	 * @returns The mounts, with each copy the upgrade moved to a new path
	 * (a Postgres 18 volume mounted where 19 doesn't keep its data) bound there.
	 * @throws When the upgrade fails, after logging what it did.
	 */
	async #upgradePostgres(
		svc: ServiceDTO,
		{ mounts, ref }: Pick<TrialSpec, "mounts" | "ref">,
		progress: (...lines: string[]) => Promise<void>,
	): Promise<TrialMount[]> {
		const volumes = mounts.flatMap((m) =>
			m.copy ? [{ source: m.copy, target: m.target }] : [],
		);
		if (volumes.length === 0) {
			return mounts;
		}
		const result = await DockerService.worker.request<PostgresUpgrade>(
			"POST",
			"/v1/volumes/postgres-upgrade",
			{
				body: {
					env: Object.entries(svc.envVars).map(
						([key, value]) => `${key}=${value}`,
					),
					image: ref,
					previous: [
						`${svc.image}:${svc.tag}`,
						...(await previousImages(svc.id)),
					],
					volumes,
				},
				timeoutMs: POSTGRES_UPGRADE_TIMEOUT_MS,
			},
		);
		if (result.log.length > 0) {
			await progress(...result.log);
		}
		if (result.error) {
			await progress(result.error);
			throw new Error(result.error);
		}
		return mounts.map((m) => {
			const remount = result.remounts.find(
				(r) => r.source === m.copy && r.from === m.target,
			);
			return remount && m.copy
				? { bind: `${m.copy}:${remount.to}`, copy: m.copy, target: remount.to }
				: m;
		});
	}

	/** Removes the volume copies a trial made, ignoring ones already gone. */
	async #removeTrialVolumes(mounts: TrialMount[]): Promise<void> {
		await Promise.all(
			mounts.flatMap((m) =>
				m.copy
					? [DockerService.removeVolume(m.copy).catch(() => undefined)]
					: [],
			),
		);
	}

	/**
	 * The networks a trial container joins, so it resolves the services it
	 * talks to the way the live one does: a swarm service's attachable
	 * overlay, where its stack's services answer to their slugs, otherwise
	 * Homerun's shared network and the service's stack network. The stack
	 * network is created first when missing, since only a standalone deploy
	 * creates it and Docker Cleanup prunes it once empty.
	 */
	async #trialNetworks(svc: ServiceDTO): Promise<string[]> {
		if (svc.swarmServiceId) {
			return [swarmNetworkName(), config.docker.networkName];
		}
		await DockerService.ensureSharedNetwork();
		if (!svc.stackId) {
			return [config.docker.networkName];
		}
		await DockerService.ensureStackNetwork(svc.stackId);
		return [config.docker.networkName, stackNetworkName(svc.stackId)];
	}

	/**
	 * The readiness check a real deploy would gate traffic on, picked the way
	 * the worker's `ReadinessCheck` picks it: none when healthchecks are off,
	 * the service's own command, the image's own HEALTHCHECK when nothing
	 * routes to the service (a runner, a queue consumer) or the image declares
	 * one, else a wait for its port to listen, as long as that port is TCP and
	 * the image ships `/bin/sh` to run it, which a throwaway helper checks.
	 */
	async #trialReadiness(
		svc: ServiceDTO,
		image: { image: string; tag: string },
	): Promise<TrialReadiness> {
		const row = svc.toJSON();
		if (row.healthcheckDisabled) {
			return {
				healthcheck: { Test: ["NONE"] },
				reason: "Healthchecks are off",
				waits: false,
			};
		}
		const timing = healthcheckTimingOf(row);
		const command = dockerHealthcheck(row.healthcheckCommand, timing);
		if (command) {
			return { healthcheck: command, waits: true };
		}
		const inspected = await DockerService.worker
			.get<TrialImageInspect>("v1/images/inspect", {
				ref: `${image.image}:${image.tag}`,
			})
			.catch(() => null);
		const test = inspected?.Config?.Healthcheck?.Test ?? [];
		if (test.length > 0 && test[0] !== "NONE") {
			return { waits: true };
		}
		if (!row.dnsResolvable || row.networkMode === "host") {
			return { reason: "Nothing routes to it", waits: false };
		}
		if (row.portProtocol === "udp") {
			return { reason: "A UDP-only port can't be checked", waits: false };
		}
		if (!inspected || !(await this.#hasShell(image))) {
			return {
				reason: "The image has no healthcheck and no shell to run one in",
				waits: false,
			};
		}
		return {
			healthcheck: listeningHealthcheck(row.containerPort, timing),
			waits: true,
		};
	}

	/** Whether `image` ships `/bin/sh`, by running `exit 0` in it with no network. */
	async #hasShell(image: { image: string; tag: string }): Promise<boolean> {
		const result = await DockerService.runOneOff({
			cmd: [],
			entrypoint: ["/bin/sh", "-c", "exit 0"],
			image: image.image,
			networkName: "none",
			tag: image.tag,
			timeoutMs: 120_000,
		}).catch(() => null);
		return !!result && !result.timedOut && result.exitCode === 0;
	}

	/** Polls a trial container until it's healthy, settled or dead, giving up `TRIAL_HEALTH_TIMEOUT_MS` after `started`. */
	async #watchTrial(id: string, started = Date.now()): Promise<string> {
		if (Date.now() - started >= TRIAL_HEALTH_TIMEOUT_MS) {
			throw new Error("The new version never reported healthy.");
		}
		await sleep(TRIAL_POLL_MS);
		const inspected = await DockerService.worker.get<TrialInspect>(
			`v1/containers/${id}/inspect`,
		);
		const state = inspected.State ?? {};
		if (state.Restarting || !state.Running) {
			throw new Error(
				`The new version exited with code ${state.ExitCode ?? "unknown"}.`,
			);
		}
		const health = state.Health?.Status;
		if (health === "healthy") {
			return "Reported healthy.";
		}
		if (health === "unhealthy") {
			throw new Error("The new version failed its healthcheck.");
		}
		if (!health && Date.now() - started >= TRIAL_SETTLE_MS) {
			return `Still running after ${TRIAL_SETTLE_MS / 1000}s.`;
		}
		return this.#watchTrial(id, started);
	}

	/** The last lines a trial container logged, or "" when they can't be read. */
	async #trialLogs(id: string): Promise<string> {
		try {
			const stream = await DockerService.streamLogs(id, {
				follow: false,
				tail: TRIAL_LOG_LINES,
			});
			return stripAnsi(await new Response(stream).text()).trim();
		} catch {
			return "";
		}
	}
}

export const UpdateTrialService = new UpdateTrialServiceClass();
