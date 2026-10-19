// In-app updater: asks the licence script (Google Apps Script) whether a newer Studiolo.exe
// exists, downloads it in pieces, checks it, and swaps it in place of the running program.
//
// Nothing here touches the window, so it builds and is tested on any OS; main.go wires it to the page.
//
// How the swap works: Windows won't let a running program be overwritten, but it does let it be
// renamed. So Studiolo.exe is renamed to Studiolo.old.exe, the new file takes its name, the new
// program is started, and it deletes the .old file the next time it runs.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Only the licence script may be contacted for updates.
var scriptPrefix = "https://script.google.com/macros/s/"

type updateInfo struct {
	Status  string `json:"status"` // ok, denied, none, error
	Version string `json:"version"`
	Notes   string `json:"notes"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
	Chunks  int    `json:"chunks"`
}

type chunkReply struct {
	Status string `json:"status"`
	Data   string `json:"data"` // base64
}

// compareVersions compares dotted numbers like 1.10.2: -1 if a < b, 0 if equal, 1 if a > b.
func compareVersions(a, b string) int {
	pa, pb := strings.Split(strings.TrimSpace(a), "."), strings.Split(strings.TrimSpace(b), ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

func callScript(client *http.Client, url string, body map[string]string, out interface{}) error {
	if !strings.HasPrefix(url, scriptPrefix) {
		return errors.New("the update address isn't valid")
	}
	payload, _ := json.Marshal(body)
	// The script answers with a redirect to its result; Go follows it (turning the POST into a GET), as browsers do.
	resp, err := client.Post(url, "text/plain;charset=utf-8", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("the update service answered %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out)
}

func fetchUpdateInfo(client *http.Client, url, code, name, current string) (updateInfo, error) {
	var info updateInfo
	err := callScript(client, url, map[string]string{"a": "update", "c": code, "n": name, "v": current}, &info)
	return info, err
}

// downloadUpdate fetches every piece, checks size and fingerprint, and leaves the finished file at dest.
func downloadUpdate(client *http.Client, url, code, name string, info updateInfo, dest string, progress func(done int64)) error {
	part := dest + ".part"
	f, err := os.Create(part)
	if err != nil {
		return fmt.Errorf("can't write next to Studiolo.exe (%v). Move Studiolo to a folder you can write to, such as Documents", err)
	}
	ok := false
	defer func() {
		f.Close()
		if !ok {
			os.Remove(part)
		}
	}()
	h := sha256.New()
	var total int64
	for i := 0; i < info.Chunks; i++ {
		var reply chunkReply
		var lastErr error
		for attempt := 0; attempt < 3; attempt++ { // the script occasionally needs another try
			lastErr = callScript(client, url, map[string]string{"a": "chunk", "c": code, "n": name, "i": strconv.Itoa(i)}, &reply)
			if lastErr == nil && reply.Status == "ok" {
				break
			}
			if lastErr == nil {
				lastErr = fmt.Errorf("the update service said %q", reply.Status)
			}
			time.Sleep(time.Duration(attempt+1) * 700 * time.Millisecond)
		}
		if lastErr != nil || reply.Status != "ok" {
			return fmt.Errorf("download stopped at piece %d of %d: %v", i+1, info.Chunks, lastErr)
		}
		raw, err := base64.StdEncoding.DecodeString(reply.Data)
		if err != nil {
			return fmt.Errorf("piece %d was damaged", i+1)
		}
		if _, err := f.Write(raw); err != nil {
			return err
		}
		h.Write(raw)
		total += int64(len(raw))
		if progress != nil {
			progress(total)
		}
	}
	if total != info.Size {
		return fmt.Errorf("the download is incomplete (%d of %d bytes)", total, info.Size)
	}
	if !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), info.SHA256) {
		return errors.New("the download didn't match its fingerprint, so it was discarded")
	}
	if err := f.Sync(); err != nil {
		return err
	}
	f.Close()
	head := make([]byte, 2)
	if g, err := os.Open(part); err == nil {
		g.Read(head)
		g.Close()
	}
	if string(head) != "MZ" {
		return errors.New("the download isn't a Windows program, so it was discarded")
	}
	ok = true
	os.Remove(dest)
	return os.Rename(part, dest)
}

func oldName(exe string) string {
	ext := filepath.Ext(exe)
	return strings.TrimSuffix(exe, ext) + ".old" + ext
}

// swapExecutable puts newFile in place of exe, keeping the old program as exe.old until the next start.
func swapExecutable(exe, newFile string) error {
	old := oldName(exe)
	os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		return fmt.Errorf("couldn't move the current program aside: %v", err)
	}
	if err := os.Rename(newFile, exe); err != nil {
		os.Rename(old, exe) // put things back
		return fmt.Errorf("couldn't put the new program in place: %v", err)
	}
	return nil
}

// cleanupOld deletes the previous program after a successful update (it may take a moment to release).
func cleanupOld(exe string) {
	old := oldName(exe)
	for i := 0; i < 20; i++ {
		if _, err := os.Stat(old); os.IsNotExist(err) {
			return
		}
		if os.Remove(old) == nil {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// clearWebCache removes the window engine's caches so the new version's pages are never mixed with old ones.
// It deliberately leaves the engine's saved site data (the name and licence) alone.
func clearWebCache(dataDir string) {
	if dataDir == "" {
		return
	}
	base := filepath.Join(dataDir, "EBWebView")
	for _, rel := range []string{
		"Default/Cache", "Default/Code Cache", "Default/GPUCache", "Default/DawnCache",
		"Default/Service Worker/CacheStorage", "Default/Service Worker/ScriptCache",
		"ShaderCache", "GrShaderCache", "GraphiteDawnCache",
	} {
		os.RemoveAll(filepath.Join(base, filepath.FromSlash(rel)))
	}
}

/* ---------- state shared with the page ---------- */

type updater struct {
	mu      sync.Mutex
	client  *http.Client
	exe     string
	current string
	st      updateStatus
	info    updateInfo
	staged  string
	updated bool // this run was started right after an update
}

type updateStatus struct {
	Phase   string `json:"phase"` // idle, checking, latest, available, downloading, ready, error
	Current string `json:"current"`
	Latest  string `json:"latest"`
	Notes   string `json:"notes"`
	Done    int64  `json:"done"`
	Total   int64  `json:"total"`
	Error   string `json:"error"`
	Updated bool   `json:"updated"`
}

func newUpdater(exe, current string, updated bool) *updater {
	return &updater{
		client:  &http.Client{Timeout: 90 * time.Second},
		exe:     exe,
		current: current,
		updated: updated,
		st:      updateStatus{Phase: "idle", Current: current, Updated: updated},
	}
}

func (u *updater) set(f func(s *updateStatus)) {
	u.mu.Lock()
	f(&u.st)
	u.mu.Unlock()
}

func (u *updater) StateJSON() string {
	u.mu.Lock()
	defer u.mu.Unlock()
	b, _ := json.Marshal(u.st)
	return string(b)
}

func (u *updater) fail(msg string) {
	u.set(func(s *updateStatus) { s.Phase = "error"; s.Error = msg })
}

// StartCheck asks the script about the newest version; the page polls StateJSON for the answer.
func (u *updater) StartCheck(url, code, name string) {
	u.set(func(s *updateStatus) { *s = updateStatus{Phase: "checking", Current: u.current, Updated: u.updated} })
	go func() {
		info, err := fetchUpdateInfo(u.client, url, code, name, u.current)
		switch {
		case err != nil:
			u.fail("Couldn't reach the update service. Check your internet connection and try again.")
		case info.Status == "denied":
			u.fail("Your licence couldn't be verified, so updates aren't available right now.")
		case info.Status == "none" || info.Version == "":
			u.set(func(s *updateStatus) { s.Phase = "latest" })
		case info.Status != "ok":
			u.fail("The update service reported a problem. Please try again later.")
		case compareVersions(info.Version, u.current) <= 0:
			u.set(func(s *updateStatus) { s.Phase = "latest"; s.Latest = info.Version })
		default:
			u.mu.Lock()
			u.info = info
			u.mu.Unlock()
			u.set(func(s *updateStatus) {
				s.Phase = "available"
				s.Latest = info.Version
				s.Notes = info.Notes
				s.Total = info.Size
			})
		}
	}()
}

// StartDownload fetches the update next to the running program.
func (u *updater) StartDownload(url, code, name string) {
	u.mu.Lock()
	info := u.info
	u.mu.Unlock()
	if info.Version == "" {
		u.fail("Check for updates first.")
		return
	}
	u.set(func(s *updateStatus) { s.Phase = "downloading"; s.Done = 0; s.Error = "" })
	dest := filepath.Join(filepath.Dir(u.exe), "Studiolo.update.exe")
	go func() {
		err := downloadUpdate(u.client, url, code, name, info, dest, func(done int64) {
			u.set(func(s *updateStatus) { s.Done = done })
		})
		if err != nil {
			u.fail(err.Error())
			return
		}
		u.mu.Lock()
		u.staged = dest
		u.mu.Unlock()
		u.set(func(s *updateStatus) { s.Phase = "ready"; s.Done = s.Total })
	}()
}

// Install swaps the downloaded program in. The caller then starts it and exits.
func (u *updater) Install() error {
	u.mu.Lock()
	staged := u.staged
	u.mu.Unlock()
	if staged == "" {
		return errors.New("there is no downloaded update to install")
	}
	return swapExecutable(u.exe, staged)
}
