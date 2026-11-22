<script lang="ts">
	import { onMount } from "svelte";

	import { title } from "#lib/store/title.js";

	import DangerZoneSection from "./danger-zone-section.svelte";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${data.serviceLabel} · Danger zone`));
</script>

<DangerZoneSection activeJobs={data.activeJobs} name={svc.name} />
