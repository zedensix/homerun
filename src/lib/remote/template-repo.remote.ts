import { query } from "$app/server";
import { z } from "zod";

import { TemplateDTO } from "#lib/dto/template-dto.js";
import { requirePermission } from "#lib/server/remote-auth.js";
import {
	getGitHubRepoInfo,
	type GitHubRepoInfo,
} from "#lib/services/github-repo.service.js";

export const getTemplateRepo = query(
	z.string(),
	async (templateId): Promise<GitHubRepoInfo | null> => {
		requirePermission("templates", "read");
		const tmpl = await TemplateDTO.get(templateId);
		return tmpl ? await getGitHubRepoInfo(tmpl.toJSON().sourceUrl) : null;
	},
);
