import { describe, expect, test } from "bun:test";

import { updateStepsFrom } from "../../../src/lib/self-update-steps";

const states = (log: string[], exitCode: number | null) =>
	updateStepsFrom(log, exitCode).map((step) => step.state);

const UPDATING = "==> Updating Homerun to v1.2.0";
const PULLING = "==> Pulling the new images";
const CHECKING = "==> Checking the new version before switching to it";
const RECREATING = "==> Recreating the Homerun containers";
const WAITING = "==> Waiting for the new version to answer";

describe("updateStepsFrom", () => {
	test("nothing logged yet starts on Prepare", () => {
		expect(states([], null)).toEqual([
			"active",
			"pending",
			"pending",
			"pending",
			"pending",
		]);
	});

	test("each marker moves to its step and the lines after it land there", () => {
		const steps = updateStepsFrom(
			[UPDATING, "backing up", PULLING, "app Pulled", "worker Pulled"],
			null,
		);
		expect(steps.map((step) => step.state)).toEqual([
			"done",
			"active",
			"pending",
			"pending",
			"pending",
		]);
		expect(steps[0].lines).toEqual(["backing up"]);
		expect(steps[1].lines).toEqual(["app Pulled", "worker Pulled"]);
	});

	test("two markers for one step keep it on that step", () => {
		const steps = updateStepsFrom(
			[
				UPDATING,
				CHECKING,
				"==> Keeping the login wall answering while the containers switch",
				RECREATING,
				"Container homerun-app-1 Recreated",
			],
			null,
		);
		expect(steps.map((step) => step.state)).toEqual([
			"done",
			"done",
			"done",
			"active",
			"pending",
		]);
		expect(steps[3].lines).toEqual(["Container homerun-app-1 Recreated"]);
	});

	test("a clean exit marks every step done", () => {
		expect(
			states([UPDATING, PULLING, CHECKING, RECREATING, WAITING, "==> Done"], 0),
		).toEqual(["done", "done", "done", "done", "done"]);
	});

	test("a failed check fails that step and keeps the reason in its lines", () => {
		const steps = updateStepsFrom(
			[
				UPDATING,
				PULLING,
				CHECKING,
				"==> v1.2.0 failed its check: staying on the current version",
				"panic: boom",
			],
			1,
		);
		expect(steps.map((step) => step.state)).toEqual([
			"done",
			"done",
			"failed",
			"pending",
			"pending",
		]);
		expect(steps[2].lines).toEqual([
			"v1.2.0 failed its check: staying on the current version",
			"panic: boom",
		]);
	});

	test("a rollback fails Verify, even before the updater exits", () => {
		expect(
			states(
				[
					UPDATING,
					PULLING,
					CHECKING,
					RECREATING,
					WAITING,
					"==> v1.2.0 didn't come up: rolling back",
				],
				null,
			),
		).toEqual(["done", "done", "done", "done", "failed"]);
	});

	test("an updater that dies without a marker fails the step it was on", () => {
		expect(states([UPDATING, PULLING, "no space left on device"], 1)).toEqual([
			"done",
			"failed",
			"pending",
			"pending",
			"pending",
		]);
	});
});
