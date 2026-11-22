package deploy_test

import (
	"reflect"
	"testing"

	"github.com/zedensix/homerun/internal/jobs/deploy"
)

func TestRemountTemplateMovesTheContainerBind(t *testing.T) {
	template := map[string]any{"HostConfig": map[string]any{"Binds": []any{
		"db-data:/var/lib/postgresql/18/docker",
		"db-data-2:/var/lib/postgresql/18/docker",
		"conf:/etc/postgresql:ro",
	}}}
	deploy.RemountTemplate(template, "db-data", "/var/lib/postgresql/18/docker", "/var/lib/postgresql")
	want := []any{"db-data:/var/lib/postgresql", "db-data-2:/var/lib/postgresql/18/docker", "conf:/etc/postgresql:ro"}
	if got := template["HostConfig"].(map[string]any)["Binds"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("Binds = %v, want %v", got, want)
	}
}

func TestRemountTemplateMovesTheSwarmMount(t *testing.T) {
	mount := map[string]any{"ReadOnly": false, "Source": "db-data", "Target": "/var/lib/postgresql/data", "Type": "volume"}
	template := map[string]any{"TaskTemplate": map[string]any{"ContainerSpec": map[string]any{"Mounts": []any{mount}}}}
	deploy.RemountTemplate(template, "db-data", "/var/lib/postgresql/data", "/var/lib/postgresql")
	if mount["Target"] != "/var/lib/postgresql" {
		t.Fatalf("Target = %v, want /var/lib/postgresql", mount["Target"])
	}
}
