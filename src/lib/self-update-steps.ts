export type UpdateStepId = "check" | "prepare" | "pull" | "switch" | "verify";

export type UpdateStepState = "active" | "done" | "failed" | "pending";

export interface UpdateStepInfo {
	hint: string;
	id: UpdateStepId;
	label: string;
}

export interface UpdateStep extends UpdateStepInfo {
	lines: string[];
	state: UpdateStepState;
}

export const UPDATE_STEPS: UpdateStepInfo[] = [
	{
		hint: "Back up the compose files and point them at the new version",
		id: "prepare",
		label: "Prepare",
	},
	{
		hint: "Download the new Homerun and worker images",
		id: "pull",
		label: "Pull images",
	},
	{
		hint: "Boot the new version next to the running one until it answers",
		id: "check",
		label: "Check",
	},
	{
		hint: "Recreate the Homerun containers, the dashboard drops for a moment",
		id: "switch",
		label: "Switch",
	},
	{
		hint: "Wait for the new version to answer, rolling back if it doesn't",
		id: "verify",
		label: "Verify",
	},
];

const MARKER = "==> ";

const STEP_MARKERS: [string, UpdateStepId][] = [
	["Updating Homerun to", "prepare"],
	["Refreshing the generated compose file", "prepare"],
	["Pulling the new images", "pull"],
	["Checking the new version", "check"],
	["Keeping the login wall answering", "switch"],
	["Recreating the Homerun containers", "switch"],
	["Waiting for the new version to answer", "verify"],
];

const FAILURE_MARKERS = ["failed its check", "didn't come up"];

/**
 * Splits the updater container's log into `UPDATE_STEPS`, each with the
 * lines it printed and its state. A `==> ` line naming a step starts it; a
 * failure line (`failed its check`, `didn't come up`) fails the step it's in
 * and stays in its lines. Steps before the current one are done; the current
 * one is active while the updater runs, done once it exits 0 (`==> Done`),
 * and failed when it exits otherwise.
 */
export function updateStepsFrom(
	log: string[],
	exitCode: number | null,
): UpdateStep[] {
	const steps: UpdateStep[] = UPDATE_STEPS.map((info) => ({
		...info,
		lines: [],
		state: "pending",
	}));
	let current = 0;
	let failed = false;
	let finished = false;
	for (const line of log) {
		if (line.startsWith(MARKER)) {
			const text = line.slice(MARKER.length);
			const started = STEP_MARKERS.find(([prefix]) => text.startsWith(prefix));
			if (started) {
				current = Math.max(
					current,
					steps.findIndex((step) => step.id === started[1]),
				);
				continue;
			}
			if (text === "Done") {
				finished = true;
				continue;
			}
			if (FAILURE_MARKERS.some((marker) => text.includes(marker))) {
				failed = true;
			}
			steps[current].lines.push(text);
			continue;
		}
		steps[current].lines.push(line);
	}
	const succeeded = exitCode === 0 || (finished && exitCode === null);
	if (exitCode !== null && exitCode !== 0) {
		failed = true;
	}
	return steps.map((step, index) => {
		if (index < current || (succeeded && index === current)) {
			return { ...step, state: "done" };
		}
		if (index === current) {
			return { ...step, state: failed ? "failed" : "active" };
		}
		return step;
	});
}
