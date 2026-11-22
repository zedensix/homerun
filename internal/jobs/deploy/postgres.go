package deploy

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/zedensix/homerun/internal/pgupgrade"
	"github.com/zedensix/homerun/internal/tracing"
)

// upgradePostgres moves the service's Postgres data onto the resolved image's
// major when it switches majors (see pgupgrade). The services using it are
// stopped first (see pauseDependents), then its own running containers or
// swarm tasks, so the dump is consistent and nothing writes behind it; it
// refuses to go on while any other container still mounts the volume. Its own
// workloads stay stopped once it succeeded, since whatever the old version
// wrote after the dump would be lost; a failed upgrade starts them again, the
// old cluster untouched. An image the manager can't inspect is left alone.
func (r *run) upgradePostgres(ctx context.Context, resolved resolvedImage) error {
	var volumes []pgupgrade.Volume
	for _, volume := range r.spec.Volumes {
		if !volume.ReadOnly && volume.Source != "" && volume.Target != "" {
			volumes = append(volumes, pgupgrade.Volume{Source: volume.Source, Target: volume.Target})
		}
	}
	if len(volumes) == 0 {
		return nil
	}
	if !r.isPostgres(ctx, resolved.ref()) {
		return nil
	}
	env, err := r.workloadEnv(ctx)
	if err != nil {
		return err
	}
	request := pgupgrade.Request{Env: env, Image: resolved.ref(), Previous: r.spec.Previous, Volumes: volumes}
	plan, err := pgupgrade.Find(ctx, r.docker, request)
	if err != nil || plan == nil {
		return err
	}
	if !plan.Upgrades() {
		if err := plan.Run(ctx, r.docker, request, r.progress.line); err != nil {
			return err
		}
		r.remount(plan)
		return nil
	}
	return tracing.Stage(ctx, "upgrade postgres", func(ctx context.Context) error {
		if err := r.pauseDependents(ctx); err != nil {
			return err
		}
		running, err := r.runningWorkloads(ctx, r.spec.ServiceID)
		if err != nil {
			return err
		}
		var stopped []stoppable
		upgradeErr := func() error {
			for _, workload := range running {
				if err := workload.stop(ctx); err != nil {
					return fmt.Errorf("couldn't stop %s before upgrading Postgres: %w", workload.name, err)
				}
				stopped = append(stopped, workload)
				r.progress.line(fmt.Sprintf("Stopped %s while Postgres is upgraded", workload.name))
			}
			users, err := r.docker.ContainersMounting(ctx, plan.Volume.Source)
			if err != nil {
				return err
			}
			if len(users) > 0 {
				return fmt.Errorf("%s is still mounted by %s: stop it before upgrading Postgres, so nothing writes to the old cluster after it's dumped", plan.Volume.Source, strings.Join(users, ", "))
			}
			return plan.Run(ctx, r.docker, request, r.progress.line)
		}()
		if upgradeErr == nil {
			r.remount(plan)
			return nil
		}
		for _, workload := range stopped {
			if err := workload.start(context.WithoutCancel(ctx)); err != nil {
				r.progress.line(fmt.Sprintf("Couldn't start %s again after the failed upgrade: %s", workload.name, err))
				continue
			}
			r.progress.line(fmt.Sprintf("Started %s again on Postgres %s", workload.name, plan.OldVersion))
		}
		return upgradeErr
	})
}

// pauseDependents stops the running workloads of every service that uses
// this one, before its own, so none of them writes to the old cluster or
// errors against a half-upgraded one. They're kept in r.paused for
// resumeDependents. A dependent that won't stop fails the upgrade, before
// anything was dumped.
func (r *run) pauseDependents(ctx context.Context) error {
	for _, dependent := range r.spec.Dependents {
		running, err := r.runningWorkloads(ctx, dependent.ID)
		if err != nil {
			return err
		}
		for _, workload := range running {
			if err := workload.stop(ctx); err != nil {
				return fmt.Errorf("couldn't stop %s (%s) before upgrading Postgres: %w", dependent.Name, workload.name, err)
			}
			workload.name = dependent.Name + " (" + workload.name + ")"
			r.paused = append(r.paused, workload)
			r.progress.line(fmt.Sprintf("Stopped %s, which uses this database, until the upgrade is done", workload.name))
		}
	}
	return nil
}

// resumeDependents starts again what pauseDependents stopped, once the
// deploy is over whatever its outcome, the database then running the new
// major or, after a failed upgrade, the old one.
func (r *run) resumeDependents(ctx context.Context) {
	ctx = context.WithoutCancel(ctx)
	for _, workload := range r.paused {
		if err := workload.start(ctx); err != nil {
			r.progress.line(fmt.Sprintf("Couldn't start %s again: %s", workload.name, err))
			continue
		}
		r.progress.line(fmt.Sprintf("Started %s again", workload.name))
	}
	r.paused = nil
}

// isPostgres reports whether ref is a Postgres image, by the PG_MAJOR the
// official image and the images built on it set. An image the daemon can't
// inspect isn't.
func (r *run) isPostgres(ctx context.Context, ref string) bool {
	inspected, err := r.docker.InspectImage(ctx, ref)
	return err == nil && slices.ContainsFunc(inspected.Config.Env, func(entry string) bool {
		return strings.HasPrefix(entry, "PG_MAJOR=")
	})
}

// remount moves the plan's volume to its new target in this deploy's
// workload, a container's Binds or a swarm service's Mounts, and reports the
// move so the app keeps it for the next deploys. A plan without a move is
// left alone.
func (r *run) remount(plan *pgupgrade.Plan) {
	if plan.Remounted == "" {
		return
	}
	source, from, to := plan.Volume.Source, plan.Remounted, plan.Volume.Target
	for index, volume := range r.spec.Volumes {
		if volume.Source == source && volume.Target == from {
			r.spec.Volumes[index].Target = to
		}
	}
	RemountTemplate(r.spec.Workload.Template, source, from, to)
	r.result.Remounts = append(r.result.Remounts, Remount{From: from, Source: source, To: to})
}

// RemountTemplate rewrites the mount of source at from to to in an Engine
// container create body (HostConfig.Binds, source:target[:ro]) or a swarm
// service spec (TaskTemplate.ContainerSpec.Mounts).
func RemountTemplate(template map[string]any, source, from, to string) {
	if hostConfig, ok := template["HostConfig"].(map[string]any); ok {
		if binds, ok := hostConfig["Binds"].([]any); ok {
			for index, bind := range binds {
				text, _ := bind.(string)
				if rest, found := strings.CutPrefix(text, source+":"+from); found && (rest == "" || strings.HasPrefix(rest, ":")) {
					binds[index] = source + ":" + to + rest
				}
			}
		}
	}
	task, _ := template["TaskTemplate"].(map[string]any)
	containerSpec, _ := task["ContainerSpec"].(map[string]any)
	mounts, _ := containerSpec["Mounts"].([]any)
	for _, mount := range mounts {
		if entry, ok := mount.(map[string]any); ok && entry["Source"] == source && entry["Target"] == from {
			entry["Target"] = to
		}
	}
}
