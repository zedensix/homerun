package deploy_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/zedensix/homerun/internal/jobs/deploy"
)

func TestReadBuildStreamForwardsLinesThenReturnsTheResult(t *testing.T) {
	stream := `{"line":"Cloning..."}` + "\n" + `{}` + "\n\n" + `{"line":"#1 DONE 0.1s"}` + "\n" + `{"result":{"commit":"abc","success":true}}` + "\n"
	var lines []string
	result, err := deploy.ReadBuildStream(strings.NewReader(stream), func(line string) { lines = append(lines, line) })
	if err != nil || !result.Success || result.Commit == nil || *result.Commit != "abc" {
		t.Fatalf("got %+v %v", result, err)
	}
	if !reflect.DeepEqual(lines, []string{"Cloning...", "#1 DONE 0.1s"}) {
		t.Errorf("got %q", lines)
	}
}

func TestReadBuildStreamAcceptsAnOldAgentsBareResult(t *testing.T) {
	result, err := deploy.ReadBuildStream(strings.NewReader(`{"commit":null,"success":true}`), func(string) {})
	if err != nil || !result.Success {
		t.Errorf("got %+v %v", result, err)
	}
}

func TestReadBuildStreamFailsWithoutAResult(t *testing.T) {
	if _, err := deploy.ReadBuildStream(strings.NewReader(`{"line":"x"}`+"\n"), func(string) {}); err == nil {
		t.Error("a stream cut before its result is an error")
	}
}
