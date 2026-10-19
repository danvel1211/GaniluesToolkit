package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const chunkSize = 1_500_000

// fakeScript behaves like the Apps Script web app: it answers a POST with a redirect to the result.
type fakeScript struct {
	exe       []byte
	version   string
	deny      bool
	failFirst int32 // number of chunk requests to fail before succeeding
	badHash   bool
	calls     int32
}

func (f *fakeScript) handler() http.Handler {
	mux := http.NewServeMux()
	var last atomic.Value
	mux.HandleFunc("/macros/s/TEST/exec", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		var out interface{}
		switch {
		case f.deny:
			out = map[string]string{"status": "denied"}
		case body["a"] == "update":
			sum := sha256.Sum256(f.exe)
			h := hex.EncodeToString(sum[:])
			if f.badHash {
				h = strings.Repeat("0", 64)
			}
			out = updateInfo{Status: "ok", Version: f.version, Notes: "Better brushes", SHA256: h, Size: int64(len(f.exe)), Chunks: (len(f.exe) + chunkSize - 1) / chunkSize}
		case body["a"] == "chunk":
			if atomic.AddInt32(&f.failFirst, -1) >= 0 {
				out = map[string]string{"status": "error"}
				break
			}
			i := 0
			for _, c := range body["i"] {
				i = i*10 + int(c-'0')
			}
			lo, hi := i*chunkSize, (i+1)*chunkSize
			if hi > len(f.exe) {
				hi = len(f.exe)
			}
			out = chunkReply{Status: "ok", Data: base64.StdEncoding.EncodeToString(f.exe[lo:hi])}
		}
		atomic.AddInt32(&f.calls, 1)
		j, _ := json.Marshal(out)
		last.Store(j)
		http.Redirect(w, r, "/result", http.StatusFound) // like script.googleusercontent.com
	})
	mux.HandleFunc("/result", func(w http.ResponseWriter, r *http.Request) {
		j, _ := last.Load().([]byte)
		w.Header().Set("Content-Type", "application/json")
		w.Write(j)
	})
	return mux
}

func setup(t *testing.T, f *fakeScript) (url string, dir string) {
	t.Helper()
	srv := httptest.NewServer(f.handler())
	t.Cleanup(srv.Close)
	old := scriptPrefix
	scriptPrefix = srv.URL + "/macros/s/"
	t.Cleanup(func() { scriptPrefix = old })
	return srv.URL + "/macros/s/TEST/exec", t.TempDir()
}

func fakeExe(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i*7 + i/251)
	}
	b[0], b[1] = 'M', 'Z'
	return b
}

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{{"1.0.0", "1.0.0", 0}, {"1.0.0", "1.1.0", -1}, {"1.10.0", "1.9.9", 1}, {"2", "1.9", 1}, {"1.0", "1.0.0", 0}, {"1.0.1", "1.0", 1}}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compare(%s,%s)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestRejectsOtherAddresses(t *testing.T) {
	_, err := fetchUpdateInfo(http.DefaultClient, "https://example.com/evil", "c", "n", "1.0.0")
	if err == nil {
		t.Fatal("an address outside the licence script must be refused")
	}
}

func TestDownloadMultiChunk(t *testing.T) {
	f := &fakeScript{exe: fakeExe(3_700_000), version: "1.1.0"}
	url, dir := setup(t, f)
	info, err := fetchUpdateInfo(http.DefaultClient, url, "CODE", "Maria", "1.0.0")
	if err != nil || info.Status != "ok" || info.Chunks != 3 {
		t.Fatalf("info %+v err %v", info, err)
	}
	dest := filepath.Join(dir, "Studiolo.update.exe")
	var last int64
	if err := downloadUpdate(http.DefaultClient, url, "CODE", "Maria", info, dest, func(d int64) { last = d }); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(dest)
	if string(got) != string(f.exe) || last != int64(len(f.exe)) {
		t.Fatal("downloaded file differs from the original")
	}
	if _, err := os.Stat(dest + ".part"); !os.IsNotExist(err) {
		t.Fatal("temporary .part file left behind")
	}
}

func TestDownloadRetriesTransientFailures(t *testing.T) {
	f := &fakeScript{exe: fakeExe(2_000_000), version: "1.1.0", failFirst: 2}
	url, dir := setup(t, f)
	info, _ := fetchUpdateInfo(http.DefaultClient, url, "C", "N", "1.0.0")
	if err := downloadUpdate(http.DefaultClient, url, "C", "N", info, filepath.Join(dir, "u.exe"), nil); err != nil {
		t.Fatalf("should recover after two failed tries: %v", err)
	}
}

func TestDownloadRejectsBadFingerprint(t *testing.T) {
	f := &fakeScript{exe: fakeExe(1_000_000), version: "1.1.0", badHash: true}
	url, dir := setup(t, f)
	info, _ := fetchUpdateInfo(http.DefaultClient, url, "C", "N", "1.0.0")
	dest := filepath.Join(dir, "u.exe")
	if err := downloadUpdate(http.DefaultClient, url, "C", "N", info, dest, nil); err == nil {
		t.Fatal("a download that doesn't match its fingerprint must fail")
	}
	for _, p := range []string{dest, dest + ".part"} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("%s should not exist after a failed check", p)
		}
	}
}

func TestDownloadRejectsNonProgram(t *testing.T) {
	exe := fakeExe(500_000)
	exe[0] = 'X'
	f := &fakeScript{exe: exe, version: "1.1.0"}
	url, dir := setup(t, f)
	info, _ := fetchUpdateInfo(http.DefaultClient, url, "C", "N", "1.0.0")
	if err := downloadUpdate(http.DefaultClient, url, "C", "N", info, filepath.Join(dir, "u.exe"), nil); err == nil {
		t.Fatal("a file that isn't a Windows program must be rejected")
	}
}

func TestSwapAndCleanup(t *testing.T) {
	dir := t.TempDir()
	exe, upd := filepath.Join(dir, "Studiolo.exe"), filepath.Join(dir, "Studiolo.update.exe")
	os.WriteFile(exe, []byte("OLD"), 0o755)
	os.WriteFile(upd, []byte("NEW"), 0o755)
	if err := swapExecutable(exe, upd); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "NEW" {
		t.Fatal("new program not in place")
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "Studiolo.old.exe")); string(b) != "OLD" {
		t.Fatal("old program not kept aside")
	}
	cleanupOld(exe)
	if _, err := os.Stat(filepath.Join(dir, "Studiolo.old.exe")); !os.IsNotExist(err) {
		t.Fatal("old program not deleted")
	}
}

func TestSwapRollsBack(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "Studiolo.exe")
	os.WriteFile(exe, []byte("OLD"), 0o755)
	if err := swapExecutable(exe, filepath.Join(dir, "missing.exe")); err == nil {
		t.Fatal("expected an error")
	}
	if b, _ := os.ReadFile(exe); string(b) != "OLD" {
		t.Fatal("the original program must be restored when the swap fails")
	}
}

func TestClearWebCacheKeepsLicence(t *testing.T) {
	dir := t.TempDir()
	keep := filepath.Join(dir, "EBWebView", "Default", "Local Storage", "leveldb")
	drop := filepath.Join(dir, "EBWebView", "Default", "Cache", "Cache_Data")
	os.MkdirAll(keep, 0o755)
	os.MkdirAll(drop, 0o755)
	os.WriteFile(filepath.Join(keep, "000003.log"), []byte("licence"), 0o644)
	os.WriteFile(filepath.Join(drop, "f_000001"), []byte("old page"), 0o644)
	clearWebCache(dir)
	if _, err := os.Stat(drop); !os.IsNotExist(err) {
		t.Fatal("cache should be cleared")
	}
	if b, err := os.ReadFile(filepath.Join(keep, "000003.log")); err != nil || string(b) != "licence" {
		t.Fatal("saved licence data must survive an update")
	}
}

func waitPhase(t *testing.T, u *updater, want string) updateStatus {
	t.Helper()
	for i := 0; i < 200; i++ {
		var s updateStatus
		json.Unmarshal([]byte(u.StateJSON()), &s)
		if s.Phase == want {
			return s
		}
		if s.Phase == "error" && want != "error" {
			t.Fatalf("unexpected error: %s", s.Error)
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("never reached phase %s: %s", want, u.StateJSON())
	return updateStatus{}
}

func TestUpdaterFlow(t *testing.T) {
	f := &fakeScript{exe: fakeExe(1_800_000), version: "1.2.0"}
	url, dir := setup(t, f)
	exe := filepath.Join(dir, "Studiolo.exe")
	os.WriteFile(exe, []byte("MZ-old"), 0o755)
	u := newUpdater(exe, "1.0.0", false)
	u.StartCheck(url, "C", "N")
	s := waitPhase(t, u, "available")
	if s.Latest != "1.2.0" || s.Notes != "Better brushes" {
		t.Fatalf("status %+v", s)
	}
	u.StartDownload(url, "C", "N")
	waitPhase(t, u, "ready")
	if err := u.Install(); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); string(b) != string(f.exe) {
		t.Fatal("running program not replaced by the update")
	}
}

func TestUpdaterAlreadyLatestAndDenied(t *testing.T) {
	f := &fakeScript{exe: fakeExe(1000), version: "1.0.0"}
	url, dir := setup(t, f)
	u := newUpdater(filepath.Join(dir, "Studiolo.exe"), "1.0.0", false)
	u.StartCheck(url, "C", "N")
	waitPhase(t, u, "latest")

	f.deny = true
	u.StartCheck(url, "C", "N")
	s := waitPhase(t, u, "error")
	if !strings.Contains(s.Error, "licence") {
		t.Fatalf("denied message: %s", s.Error)
	}
}
