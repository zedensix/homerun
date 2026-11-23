export const URL_TOKEN = "{{url}}";

export const HOST_TOKEN = "{{host}}";

/**
 * `envVars` with every `{{url}}` replaced by the service's public URL and
 * every `{{host}}` by that URL's hostname, for apps that want a bare domain
 * (a Matrix server name, a link shortener's default domain).
 */
export function fillUrlInEnv(
	envVars: Record<string, string>,
	url: string,
): Record<string, string> {
	const { host } = new URL(url);
	return Object.fromEntries(
		Object.entries(envVars).map(([key, value]) => [
			key,
			value.replaceAll(URL_TOKEN, url).replaceAll(HOST_TOKEN, host),
		]),
	);
}
