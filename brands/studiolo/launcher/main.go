// Studiolo launcher for Windows: opens resources\index.html (next to this program) in the
// default web browser. Studiolo itself runs entirely in the browser; this file only starts it.
package main

import (
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

var (
	shell32       = syscall.NewLazyDLL("shell32.dll")
	user32        = syscall.NewLazyDLL("user32.dll")
	shellExecuteW = shell32.NewProc("ShellExecuteW")
	messageBoxW   = user32.NewProc("MessageBoxW")
)

func utf16(s string) uintptr {
	p, _ := syscall.UTF16PtrFromString(s)
	return uintptr(unsafe.Pointer(p))
}

func fail(msg string) {
	const mbIconError = 0x10
	messageBoxW.Call(0, utf16(msg), utf16("Studiolo"), mbIconError)
	os.Exit(1)
}

func main() {
	exe, err := os.Executable()
	if err != nil {
		fail("Studiolo couldn't find where it is installed.")
	}
	page := filepath.Join(filepath.Dir(exe), "resources", "index.html")
	if _, err := os.Stat(page); err != nil {
		fail("Studiolo couldn't find its \"resources\" folder.\n\nKeep Studiolo.exe in the same folder as the \"resources\" folder, then try again.")
	}
	const swShowNormal = 1
	ret, _, _ := shellExecuteW.Call(0, utf16("open"), utf16(page), 0, utf16(filepath.Dir(page)), swShowNormal)
	if ret <= 32 { // ShellExecute returns a value above 32 on success
		fail("Studiolo couldn't open your web browser.\n\nYou can also open resources\\index.html yourself.")
	}
}
