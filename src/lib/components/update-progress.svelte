<script lang="ts">
	import {
		Check,
		CheckCircle2,
		ChevronDown,
		Download,
		FileCog,
		HeartPulse,
		RefreshCw,
		Repeat,
		ShieldCheck,
		X,
		XCircle,
	} from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";
	import { Spinner } from "@zedensix/ui/spinner";
	import { type Component, untrack } from "svelte";

	import AnsiLine from "#lib/components/ansi-line.svelte";
	import UpdatePings from "#lib/components/update-pings.svelte";
	import { getUpdateProgress } from "#lib/remote/self-update.remote.js";
	import {
		UPDATE_STEPS,
		type UpdateStep,
		type UpdateStepId,
		type UpdateStepState,
	} from "#lib/self-update-steps.js";
	import type { UpdateReport } from "#lib/services/self-update.service.js";

	interface Props {
		from: string;
		to: string;
	}

	const { from, to }: Props = $props();

	const POLL_MS = 1500;
	const PING_HISTORY = 30;
	const RELOAD_AFTER_S = 5;
	const BACK_WITHOUT_REPORT_MS = 15_000;

	const ICONS: Record<UpdateStepId, Component> = {
		check: ShieldCheck,
		prepare: FileCog,
		pull: Download,
		switch: Repeat,
		verify: HeartPulse,
	};

	const progress = getUpdateProgress();

	let report = $state<UpdateReport | null>(null);
	let reachable = $state(true);
	let pings = $state<number[]>([]);
	let lastPing = $state<number | null>(null);
	let reportFailingSince = $state<number | null>(null);
	let selected = $state<UpdateStepId | null>(null);
	let now = $state(Date.now());
	let reloadIn = $state<number | null>(null);
	const startedAt = $state<Partial<Record<UpdateStepId, number>>>({});
	let endedAt = $state<number | null>(null);

	const steps = $derived<UpdateStep[]>(
		report?.steps ??
			UPDATE_STEPS.map((info, index) => ({
				...info,
				lines: [],
				state: index === 0 ? "active" : "pending",
			})),
	);
	const current = $derived(
		steps.find((step) => step.state === "active" || step.state === "failed") ??
			null,
	);
	const failed = $derived(report?.state === "exited" && report.exitCode !== 0);
	const succeeded = $derived(
		(report?.state === "exited" && report.exitCode === 0) ||
			report?.currentVersion === to,
	);
	const backWithoutReport = $derived(
		reachable &&
			reportFailingSince !== null &&
			now - reportFailingSince > BACK_WITHOUT_REPORT_MS,
	);
	const shown = $derived(
		steps.find((step) => step.id === (selected ?? current?.id)) ?? null,
	);
	const settled = $derived(steps.filter((s) => s.state === "done").length);
	const percent = $derived(
		succeeded
			? 100
			: Math.round(
					((settled + (current && !failed ? 0.5 : 0)) / steps.length) * 100,
				),
	);

	/** Pings the dashboard's own readiness endpoint, which answers the same on every version and needs no session. */
	async function ping(): Promise<void> {
		const start = performance.now();
		try {
			const answer = await fetch("/api/v1/ready", { cache: "no-store" });
			reachable = answer.ok;
		} catch {
			reachable = false;
		}
		lastPing = reachable ? Math.round(performance.now() - start) : null;
		pings = [...pings, lastPing ?? 0].slice(-PING_HISTORY);
	}

	/** Reads the update's report, keeping the last one while Homerun is restarting. */
	async function poll(): Promise<void> {
		await ping();
		try {
			await progress.refresh();
			if (progress.current) {
				report = progress.current;
			}
			reportFailingSince = null;
		} catch {
			reportFailingSince ??= Date.now();
		}
	}

	$effect(() => {
		void poll();
		const timer = setInterval(() => {
			now = Date.now();
			if (!(succeeded || failed)) {
				void poll();
			}
		}, POLL_MS);
		return () => clearInterval(timer);
	});

	$effect(() => {
		const entered = steps
			.filter((step) => step.state !== "pending")
			.map((step) => step.id);
		const over = succeeded || failed;
		untrack(() => {
			const at = Date.now();
			for (const id of entered) {
				startedAt[id] ??= at;
			}
			if (over) {
				endedAt ??= at;
			}
		});
	});

	$effect(() => {
		if (!(succeeded && report?.currentVersion === to)) {
			return;
		}
		reloadIn = RELOAD_AFTER_S;
		const timer = setInterval(() => {
			reloadIn = (reloadIn ?? 1) - 1;
			if (reloadIn <= 0) {
				clearInterval(timer);
				location.reload();
			}
		}, 1000);
		return () => clearInterval(timer);
	});

	/** Seconds spent in the step at `index`: until the next step started, or until now while it runs. */
	function secondsIn(index: number): number | null {
		const start = startedAt[steps[index].id];
		if (start === undefined) {
			return null;
		}
		const next = steps
			.slice(index + 1)
			.map((step) => startedAt[step.id])
			.find((at) => at !== undefined);
		const seconds = Math.round(((next ?? endedAt ?? now) - start) / 1000);
		return seconds >= 1 ? seconds : null;
	}

	/** `seconds` as `42s` or `3m 05s`. */
	function duration(seconds: number): string {
		if (seconds < 60) {
			return `${seconds}s`;
		}
		return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
	}

	/** The circle's colours for a step in `state`. */
	function circleClass(state: UpdateStepState): string {
		switch (state) {
			case "done":
				return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
			case "active":
				return "border-accent bg-accent-light text-accent ring-4 ring-accent/15";
			case "failed":
				return "border-red-500/50 bg-red-500/10 text-red-500 ring-4 ring-red-500/15";
			default:
				return "border-border bg-surface-2 text-text-subtle";
		}
	}

	/** Keeps a log scrolled to its newest line as lines arrive. */
	function followTail(node: HTMLElement, _lines: number) {
		node.scrollTop = node.scrollHeight;
		return {
			update() {
				node.scrollTop = node.scrollHeight;
			},
		};
	}
</script>

<div class="space-y-4">
	<div>
		<div class="mb-2 flex items-center justify-between gap-3 text-sm">
			<div class="flex min-w-0 items-center gap-2">
				{#if failed}
					<XCircle class="size-4 shrink-0 text-red-500" />
					<span class="text-text font-medium">
						The update didn't go through, Homerun stays on v{from}
					</span>
				{:else if succeeded}
					<CheckCircle2 class="size-4 shrink-0 text-emerald-500" />
					<span class="text-text font-medium">Homerun is on v{to}</span>
				{:else if current}
					<Spinner class="size-4 shrink-0" />
					<span class="text-text font-medium">{current.label}</span>
					<span class="text-text-muted truncate max-sm:hidden"
						>{current.hint}</span
					>
				{/if}
			</div>
			<span class="text-text-muted shrink-0 font-mono text-xs tabular-nums"
				>{percent}%</span
			>
		</div>
		<div class="bg-surface-2 h-1 overflow-hidden rounded-full">
			<div
				style:width="{percent}%"
				class="h-full rounded-full transition-[width] duration-500 {failed
					? 'bg-red-500'
					: succeeded
						? 'bg-emerald-500'
						: 'bg-accent'}"
			></div>
		</div>
	</div>

	<UpdatePings
		containers={report?.containers ?? []}
		{lastPing}
		{pings}
		{reachable}
	/>

	<ol class="space-y-1">
		{#each steps as step, index (step.id)}
			{@const Icon = ICONS[step.id]}
			{@const seconds = secondsIn(index)}
			{@const open = shown?.id === step.id}
			<li>
				<button
					class="hover:bg-surface-2 flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors disabled:cursor-default disabled:hover:bg-transparent"
					aria-expanded={open}
					disabled={step.lines.length === 0 && step.state === "pending"}
					onclick={() => {
						selected = open ? null : step.id;
					}}
					type="button"
				>
					<span
						class="relative flex size-7 shrink-0 items-center justify-center rounded-full border transition-all {circleClass(
							step.state,
						)}"
					>
						{#if step.state === "done"}
							<Check class="size-3.5" />
						{:else if step.state === "failed"}
							<X class="size-3.5" />
						{:else}
							<Icon class="size-3.5" />
						{/if}
						{#if step.state === "active" && !succeeded}
							<span
								class="border-t-accent absolute -inset-0.75 animate-spin rounded-full border-2 border-transparent"
								aria-hidden="true"
							></span>
						{/if}
					</span>
					<span class="min-w-0 flex-1">
						<span
							class="block text-sm {step.state === 'pending'
								? 'text-text-subtle'
								: step.state === 'failed'
									? 'font-medium text-red-500'
									: 'text-text font-medium'}">{step.label}</span
						>
						<span class="text-text-muted block truncate text-xs"
							>{step.hint}</span
						>
					</span>
					<span class="text-text-subtle font-mono text-[10px] tabular-nums">
						{seconds === null ? "" : duration(seconds)}
					</span>
					{#if step.lines.length > 0}
						<ChevronDown
							class="text-text-subtle size-4 shrink-0 transition-transform {open
								? 'rotate-180'
								: ''}"
						/>
					{/if}
				</button>
				{#if open && (step.lines.length > 0 || (step.id === "switch" && !reachable))}
					<div
						class="log-output mt-1 ml-12 max-h-48 overflow-y-auto rounded-md"
						use:followTail={step.lines.length}
					>
						{#each step.lines as line, lineIndex (lineIndex)}
							<AnsiLine {line} />
						{/each}
						{#if step.state === "active" && !reachable}
							<div class="text-amber-400">
								Homerun is restarting, reconnecting…
							</div>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ol>

	{#if succeeded || backWithoutReport}
		<div
			class="flex items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm"
		>
			<span class="text-text">
				{#if reloadIn !== null}
					Reloading the dashboard in {reloadIn}s.
				{:else}
					Homerun answers again. Reload to load the new dashboard.
				{/if}
			</span>
			<Button onclick={() => location.reload()} size="sm" type="button">
				<RefreshCw class="size-4" />
				Reload now
			</Button>
		</div>
	{:else if failed}
		<p class="text-text-muted text-sm">
			The compose files are back as they were and jobs run again. The step that
			failed has its log above; the notification feed has the reason too.
		</p>
	{/if}
</div>
