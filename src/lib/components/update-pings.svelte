<script lang="ts">
	import Sparkline from "#lib/components/sparkline.svelte";
	import type { UpdateContainer } from "#lib/services/self-update.service.js";

	interface Props {
		containers: UpdateContainer[];
		lastPing: number | null;
		pings: number[];
		reachable: boolean;
	}

	const { containers, lastPing, pings, reachable }: Props = $props();

	const sorted = $derived([...containers].sort((a, b) => rank(a) - rank(b)));

	/** Where a container sits in the strip: Homerun's own first, the update's helpers next, the rest after. */
	function rank(container: UpdateContainer): number {
		const order = ["candidate", "updater"];
		if (container.name.includes("candidate")) {
			return 2;
		}
		const index = order.indexOf(container.service);
		if (index >= 0) {
			return 2 + index;
		}
		if (container.image.includes("homerun")) {
			return container.service.includes("worker") ? 1 : 0;
		}
		return 4;
	}

	/** A container's name in the strip: the update's helpers by role, the rest by compose service. */
	function containerLabel(container: UpdateContainer): string {
		if (container.name.includes("candidate")) {
			return "New version";
		}
		if (container.service === "updater") {
			return "Updater";
		}
		return container.service || container.name;
	}

	/**
	 * The image's tag, which flips to the new version as the containers
	 * switch. A container whose tag has moved on to the newly pulled image is
	 * listed by its old image id instead, shortened to 7 characters like a
	 * commit.
	 */
	function imageTag(image: string): string {
		const tag = image.split("@")[0].split("/").pop()?.split(":")[1];
		if (tag && /^[0-9a-f]{12,}$/.test(tag)) {
			return tag.slice(0, 7);
		}
		return tag ?? "latest";
	}

	/** A container's dot: green running, amber starting or restarting, red stopped, grey for a helper that finished cleanly. */
	function dotClass(container: UpdateContainer): string {
		const status = container.status.toLowerCase();
		if (container.state === "running") {
			if (status.includes("starting") || status.includes("unhealthy")) {
				return "bg-amber-500";
			}
			return "bg-emerald-500";
		}
		if (container.state === "restarting" || container.state === "created") {
			return "bg-amber-500";
		}
		if (container.service === "updater" && status.includes("(0)")) {
			return "bg-text-subtle";
		}
		return "bg-red-500";
	}

	/** Whether a container's dot pulses: it's doing something right now. */
	function busy(container: UpdateContainer): boolean {
		return (
			dotClass(container) === "bg-amber-500" ||
			(container.service === "updater" && container.state === "running") ||
			container.name.includes("candidate")
		);
	}
</script>

<ul class="grid grid-cols-2 gap-2 sm:grid-cols-3">
	<li class="border-border bg-surface-2/50 rounded-md border px-3 py-2">
		<div class="flex items-center gap-2">
			<span class="relative inline-flex size-2 shrink-0">
				{#if !reachable}
					<span
						class="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60"
					></span>
				{/if}
				<span
					class="relative size-2 rounded-full {reachable
						? 'bg-emerald-500'
						: 'bg-red-500'}"
				></span>
			</span>
			<span class="text-text truncate text-xs font-medium">Dashboard</span>
			<span class="text-text-muted ml-auto font-mono text-xs tabular-nums">
				{lastPing === null ? "down" : `${lastPing} ms`}
			</span>
		</div>
		<Sparkline
			class="mt-1 h-5 w-full"
			color={reachable ? "var(--color-emerald-500)" : "var(--color-red-500)"}
			values={pings}
		/>
	</li>
	{#each sorted as container (container.name)}
		<li
			class="border-border bg-surface-2/50 rounded-md border px-3 py-2"
			title={container.name}
		>
			<div class="flex items-center gap-2">
				<span class="relative inline-flex size-2 shrink-0">
					{#if busy(container)}
						<span
							class="absolute inset-0 animate-ping rounded-full opacity-60 {dotClass(
								container,
							)}"
						></span>
					{/if}
					<span class="relative size-2 rounded-full {dotClass(container)}"
					></span>
				</span>
				<span class="text-text shrink-0 text-xs font-medium"
					>{containerLabel(container)}</span
				>
				<span
					class="text-text-subtle ml-auto min-w-0 truncate font-mono text-[10px]"
					title={container.image}>{imageTag(container.image)}</span
				>
			</div>
			<p class="text-text-muted mt-1 truncate text-[11px]">
				{container.status || container.state}
			</p>
		</li>
	{/each}
</ul>
