import { describe, expect, test } from "bun:test";

import { fillUrlInEnv } from "../../../src/lib/template-url";

describe("fillUrlInEnv", () => {
	test("fills the public URL and its bare hostname", () => {
		expect(
			fillUrlInEnv(
				{
					APP_URL: "{{url}}",
					NEXTAUTH_URL: "{{url}}/api/v1/auth",
					SERVER_NAME: "{{host}}",
					TZ: "UTC",
				},
				"https://chat.example.com",
			),
		).toEqual({
			APP_URL: "https://chat.example.com",
			NEXTAUTH_URL: "https://chat.example.com/api/v1/auth",
			SERVER_NAME: "chat.example.com",
			TZ: "UTC",
		});
	});
});
