<script lang="ts">
	import * as InputGroup from "@zedensix/ui/input-group";
	import { Label } from "@zedensix/ui/label";

	import type { BuildCapacity } from "#lib/build-servers.js";
	import { settings } from "#lib/settings.js";

	interface Props {
		/** The machine's own CPUs and memory, shown after each field; null when it can't be read. */
		capacity: BuildCapacity | null;
		cpuLimit: number | null;
		cpuName: string;
		memoryLimitMb: number | null;
		/** Posted in GB; the action converts it back to MB. */
		memoryName: string;
		placeholder?: { cpu: string; memory: string };
	}

	const {
		capacity,
		cpuLimit,
		cpuName,
		memoryLimitMb,
		memoryName,
		placeholder = { cpu: "No limit", memory: "No limit" },
	}: Props = $props();

	const MB_PER_GB = 1024;

	const gigabytes = (megabytes: number) =>
		Math.round((megabytes / MB_PER_GB) * 100) / 100;
</script>

<div class="grid gap-4 md:grid-cols-2">
	<div>
		<Label class="mb-1.5" for={cpuName}>CPUs</Label>
		<InputGroup.Root>
			<InputGroup.Input
				id={cpuName}
				max={capacity?.cpuCount ?? settings.docker.maxBuildCpuLimit}
				min={0}
				name={cpuName}
				placeholder={placeholder.cpu}
				step="0.1"
				type="number"
				value={cpuLimit ?? ""}
			/>
			{#if capacity?.cpuCount}
				<InputGroup.Addon align="inline-end">
					<InputGroup.Text>
						/ {capacity.cpuCount}
						{capacity.cpuCount === 1 ? "CPU" : "CPUs"}
					</InputGroup.Text>
				</InputGroup.Addon>
			{/if}
		</InputGroup.Root>
	</div>
	<div>
		<Label class="mb-1.5" for={memoryName}>Memory</Label>
		<InputGroup.Root>
			<InputGroup.Input
				id={memoryName}
				max={capacity?.memTotalMb ? gigabytes(capacity.memTotalMb) : undefined}
				min={0}
				name={memoryName}
				placeholder={placeholder.memory}
				step="0.25"
				type="number"
				value={memoryLimitMb === null ? "" : gigabytes(memoryLimitMb)}
			/>
			<InputGroup.Addon align="inline-end">
				<InputGroup.Text>
					{capacity?.memTotalMb
						? `/ ${gigabytes(capacity.memTotalMb)} GB`
						: "GB"}
				</InputGroup.Text>
			</InputGroup.Addon>
		</InputGroup.Root>
	</div>
</div>
