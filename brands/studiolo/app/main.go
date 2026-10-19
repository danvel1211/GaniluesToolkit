//go:build windows

// Studiolo portable app.
//
// This is a thin native wrapper around the Studiolo web app. The whole web app
// (HTML, CSS, JavaScript, fonts) is compiled *inside* this single .exe. When the
// file is double-clicked it:
//
//  1. serves those embedded files from memory on a loopback-only address
//     (127.0.0.1) - nothing is written to disk, and nothing
//     is reachable from outside this computer;
//  2. opens them in a plain application window using the WebView2 engine that
//     ships with Windows 10 and 11.
//
// There is no installer, no setup step, and no admin rights are needed. The file
// can be run from the Desktop, a folder, or a USB stick. It works fully offline;
// like the web version, nothing ever leaves the device.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	_ "embed"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
)

// The build script packs the whole web app into one compressed, encrypted blob
// (app.bin) and generates keydata.go, so the executable holds no readable
// HTML, CSS or JavaScript. It is unpacked in memory only.
//
//go:embed app.bin
var packed []byte

// version is set at build time (tools/build_exe.py reads brands/studiolo/version.txt).
var version = "0.0.0"

// openApp decrypts and unpacks the embedded web app into an in-memory file system.
func openApp() (fs.FS, error) {
	key := make([]byte, len(kA))
	for i := range kA {
		key[i] = kA[i] ^ kB[i]
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	n := gcm.NonceSize()
	plain, err := gcm.Open(nil, packed[:n], packed[n:], nil)
	if err != nil {
		return nil, err
	}
	return zip.NewReader(bytes.NewReader(plain), int64(len(plain)))
}

func main() {
	defer func() {
		// If the window engine can't start (almost always because the WebView2
		// runtime is missing on a very old Windows), show a friendly message box
		// instead of silently doing nothing.
		if r := recover(); r != nil {
			messageBox(
				"Studiolo needs the Microsoft Edge WebView2 runtime, which is built\r\n"+
					"into Windows 10 and 11. Please update Windows (or Microsoft Edge)\r\n"+
					"and try again.",
				"Studiolo")
		}
	}()

	sub, err := openApp()
	if err != nil {
		panic(err)
	}

	exe, _ := os.Executable()
	// Started by an update? Then the previous copy is still shutting down: wait for it, and tidy up after it.
	updated := len(os.Args) > 1 && os.Args[1] == "--updated"

	// Loopback only. Serving over http keeps relative paths, blob workers and the
	// CSP behaving exactly as they do on disk, but the "site" exists only in this
	// process's memory. The port is fixed (with a few fallbacks) because the saved
	// licence lives in the page's storage, which is tied to the address.
	var ln net.Listener
	for tries := 0; ln == nil && tries < 40; tries++ {
		for port := 47615; port < 47625 && ln == nil; port++ {
			if l, e := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port)); e == nil {
				ln = l
			}
			if updated && ln == nil && port == 47615 {
				break // after an update only the usual port will do: wait for the old copy to let go of it
			}
		}
		if ln == nil && updated {
			time.Sleep(500 * time.Millisecond)
		} else if ln == nil {
			break
		}
	}
	if ln == nil {
		panic("no free local port")
	}
	// Always revalidate, so a new version's pages are never mixed with cached old ones.
	files := http.FileServer(http.FS(sub))
	go http.Serve(ln, http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(rw, r)
	}))
	url := "http://" + ln.Addr().String() + "/index.html"

	// The window engine keeps the app's saved settings (name and licence) in a small
	// per-user folder, so they survive between runs and wherever the .exe is moved.
	data := ""
	if base, e := os.UserCacheDir(); e == nil {
		data = filepath.Join(base, "Studiolo")
	}

	if updated {
		clearWebCache(data)
	}
	go cleanupOld(exe)

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false, // no developer tools in the shipped app
		AutoFocus: true,
		DataPath:  data,
		WindowOptions: webview2.WindowOptions{
			Title:  "Studiolo",
			Width:  1280,
			Height: 820,
			IconId: 1, // the group icon (id 1) embedded from winres/icon.ico
			Center: true,
		},
	})
	if w == nil {
		panic("webview2 unavailable")
	}
	defer w.Destroy()

	// The page's "Updates" button talks to the updater through these. Each call returns at once;
	// the page asks for progress with __sxu_state.
	up := newUpdater(exe, version, updated)
	w.Bind("__sxu_version", func() string { return version })
	w.Bind("__sxu_check", func(addr, code, name string) string { up.StartCheck(addr, code, name); return "started" })
	w.Bind("__sxu_download", func(addr, code, name string) string { up.StartDownload(addr, code, name); return "started" })
	w.Bind("__sxu_state", func() string { return up.StateJSON() })
	w.Bind("__sxu_install", func() string {
		if err := up.Install(); err != nil {
			return err.Error()
		}
		// Start the new program, then close this one so the new one can take over.
		if err := exec.Command(exe, "--updated").Start(); err != nil {
			return "The update is installed, but Studiolo couldn't restart itself. Please open it again."
		}
		w.Dispatch(func() { w.Terminate() })
		return ""
	})

	w.Navigate(url)
	w.Run()
}

// messageBox shows a native Windows dialog without any extra dependencies.
func messageBox(text, title string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(title)
	proc.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x40) // MB_ICONINFORMATION
}
