<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { Input } from "@zedensix/ui/input";
	import { Label } from "@zedensix/ui/label";
	import {
		Select as SelectRoot,
		SelectContent,
		SelectItem,
		SelectTrigger,
	} from "@zedensix/ui/select";
	import { untrack } from "svelte";

	import type { BuildCapacity } from "#lib/build-servers.js";
	import BuildLimitFields from "#lib/components/build-limit-fields.svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { settings } from "#lib/settings.js";
	import { saveToast } from "#lib/toast.js";

	interface Props {
		buildConcurrency: number;
		buildCpuLimit: number | null;
		buildMemoryLimitMb: number | null;
		buildOnHost: boolean;
		defaultBuildServer: string;
		hostBuildCpuLimit: number | null;
		hostBuildMemoryLimitMb: number | null;
		hostCapacity: BuildCapacity | null;
		servers: { id: string; name: string }[];
	}

	const {
		buildConcurrency,
		buildCpuLimit,
		buildMemoryLimitMb,
		buildOnHost,
		defaultBuildServer,
		hostBuildCpuLimit,
		hostBuildMemoryLimitMb,
		hostCapacity,
		servers,
	}: Props = $props();

	let defaultServer = $state(untrack(() => defaultBuildServer));
	const defaultServerName = $derived(
		servers.find((s) => s.id === defaultServer)?.name,
	);
</script>

<section class="panel rounded-md">
	<PanelHeader title="Build servers">
		{#snippet description()}
			Where git builds run when
			<a class="underline" href={resolve("remote-hosts")}>build servers</a>
			are registered. Each service picks its own on its Source tab; these are the
			defaults.
		{/snippet}
		{#snippet trailing()}
			<SaveButton form="build-servers" />
		{/snippet}
	</PanelHeader>
	<form
		id="build-servers"
		action="?/updateBuildServers"
		class="space-y-4 p-5"
		method="POST"
		use:enhance={saveToast("Build server settings")}
	>
		<div>
			<Label class="mb-1.5" for="buildConcurrency">
				Concurrent builds per server
			</Label>
			<Input
				id="buildConcurrency"
				max={settings.docker.maxBuildConcurrency}
				min={0}
				name="buildConcurrency"
				required
				type="number"
				value={buildConcurrency}
			/>
			<p class="text-text-subtle mt-1.5 text-xs">
				0 for no limit. A server can set its own on its page. A deploy that
				finds its server full waits for a free slot.
			</p>
		</div>
		<div class="grid gap-6 xl:grid-cols-2">
			<fieldset class="space-y-2">
				<legend class="text-sm font-medium">Build resources on this host</legend
				>
				<BuildLimitFields
					capacity={hostCapacity}
					cpuLimit={hostBuildCpuLimit || null}
					cpuName="hostBuildCpuLimit"
					memoryLimitMb={hostBuildMemoryLimitMb || null}
					memoryName="hostBuildMemoryLimitGb"
				/>
			</fieldset>
			<fieldset class="space-y-2">
				<legend class="text-sm font-medium">
					Build resources per remote build server
				</legend>
				<BuildLimitFields
					capacity={null}
					cpuLimit={buildCpuLimit || null}
					cpuName="buildCpuLimit"
					memoryLimitMb={buildMemoryLimitMb || null}
					memoryName="buildMemoryLimitGb"
				/>
			</fieldset>
			<p class="text-text-subtle text-xs xl:col-span-2">
				What every build running on a machine shares at once, so a build can't
				starve the services next to it. Blank or 0 for no limit, memory at least
				{settings.docker.minBuildMemoryLimitMb / 1024} GB. A remote server can set
				its own on its page. A build that needs more memory fails instead of swapping.
				Buildpacks builds (Heroku, Paketo) aren't capped.
			</p>
		</div>
		<div>
			<Label class="mb-1.5" for="defaultBuildServer">
				Default for new services
			</Label>
			<SelectRoot
				name="defaultBuildServer"
				type="single"
				bind:value={defaultServer}
			>
				<SelectTrigger id="defaultBuildServer">
					{#if defaultServerName}
						{defaultServerName}
					{:else if defaultServer === settings.docker.anyBuildServer}
						Any free build server
					{:else}
						This host
					{/if}
				</SelectTrigger>
				<SelectContent>
					<SelectItem label="This host" value="" />
					<SelectItem
						label="Any free build server"
						value={settings.docker.anyBuildServer}
					/>
					{#each servers as server (server.id)}
						<SelectItem label={server.name} value={server.id} />
					{/each}
				</SelectContent>
			</SelectRoot>
		</div>
		<CheckBox
			checked={buildOnHost}
			helperText="Off sends every git build that would run here to the least busy build server instead. With no build server registered, builds still run here."
			id="buildOnHost"
			label="Build on this host"
			name="buildOnHost"
		/>
	</form>
</section>
