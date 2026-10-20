#!/usr/bin/env python3
"""Builds Ring Breaker for Android: out/Ring-Breaker.apk

    python3 tools/build_apk.py

What it does (no Android Studio needed):
  1. builds the game into one HTML file (tools/build_game.py) and bundles it as the app's page;
  2. compiles the small Java shell in games/ring-breaker/android/ (a full-screen WebView);
  3. packs resources, code and page into an APK, aligns it, and signs it.

The build tools come from Maven Central and are downloaded once into out/android-tools/.
The signing key is created once in out/ (keep that file: updates must be signed with the same key,
or phones will refuse to install them over the old version).

Needs: Java 17+ (javac, keytool) and curl. Works on Linux, macOS and Windows.
"""
import os
import platform
import secrets
import shutil
import stat
import subprocess
import struct
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import build_game  # noqa: E402

APP = os.path.join(ROOT, 'games', 'ring-breaker', 'android')
OUT = os.path.join(ROOT, 'out')
TOOLS = os.path.join(OUT, 'android-tools')
BUILD = os.path.join(OUT, 'android-build')

VERSION_NAME = '1.1.0'
VERSION_CODE = 2
MIN_SDK = 24      # Android 7.0
TARGET_SDK = 34   # Android 14

MAVEN = 'https://repo1.maven.org/maven2/'
JARS = {
    'apktool-lib.jar': 'org/apktool/apktool-lib/2.9.3/apktool-lib-2.9.3.jar',            # carries the resource compiler (aapt2)
    'dx.jar': 'com/jakewharton/android/repackaged/dalvik-dx/14.0.0_r21/dalvik-dx-14.0.0_r21.jar',  # Java classes -> Android code
    'apksig.jar': 'com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar',               # APK signing
    'android.jar': 'org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar',  # Android 14 framework
}
MIN_BYTES = {'apktool-lib.jar': 5_000_000, 'dx.jar': 500_000, 'apksig.jar': 100_000, 'android.jar': 50_000_000}


def run(cmd, hide=(), **kw):
    shown = ' '.join(str(c) for c in cmd)
    for secret in hide:
        shown = shown.replace(secret, '****')
    print('  $', shown)
    subprocess.run(cmd, check=True, **kw)


def download(name):
    dest = os.path.join(TOOLS, name)
    if os.path.exists(dest) and os.path.getsize(dest) >= MIN_BYTES[name]:
        return dest
    os.makedirs(TOOLS, exist_ok=True)
    url = MAVEN + JARS[name]
    for attempt in range(6):
        print('  downloading', name)
        subprocess.run(['curl', '-fsSL', '--retry', '2', '-o', dest, url])
        if os.path.exists(dest) and os.path.getsize(dest) >= MIN_BYTES[name]:
            return dest
        time.sleep(20)  # Maven Central asks heavy users to slow down
    raise SystemExit('could not download ' + url)


def aapt2_path(apktool_jar):
    system = platform.system()
    member = {'Linux': 'prebuilt/linux/aapt2_64', 'Darwin': 'prebuilt/macosx/aapt2_64', 'Windows': 'prebuilt/windows/aapt2_64.exe'}[system]
    dest = os.path.join(TOOLS, 'aapt2' + ('.exe' if system == 'Windows' else ''))
    if not os.path.exists(dest):
        with zipfile.ZipFile(apktool_jar) as z, open(dest, 'wb') as f:
            f.write(z.read(member))
        os.chmod(dest, os.stat(dest).st_mode | stat.S_IEXEC)
    return dest


def pad_align(zout, info, data, align=4):
    """Writes one entry so its data starts on a 4-byte boundary (what zipalign does)."""
    if info.compress_type == zipfile.ZIP_STORED:
        offset = zout.fp.tell()
        extra = b''
        for _ in range(4):
            need = (-(offset + 30 + len(info.filename.encode()) + len(extra))) % align
            if need == 0:
                break
            extra = b'\x35\xd9' + struct.pack('<H', need + (4 if need < 4 else 0) - 4) + b'\x00' * (need + (4 if need < 4 else 0) - 4)
        info.extra = extra
    zout.writestr(info, data, compress_type=info.compress_type)


def assemble(base_apk, dex, dest):
    with zipfile.ZipFile(base_apk) as zin, zipfile.ZipFile(dest, 'w') as zout:
        for item in zin.infolist():
            info = zipfile.ZipInfo(item.filename, date_time=(2024, 1, 1, 0, 0, 0))
            info.compress_type = item.compress_type
            info.external_attr = item.external_attr
            pad_align(zout, info, zin.read(item.filename))
        info = zipfile.ZipInfo('classes.dex', date_time=(2024, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(dex, 'rb') as f:
            zout.writestr(info, f.read(), compress_type=zipfile.ZIP_DEFLATED)


def check_alignment(apk):
    """Every stored (uncompressed) entry must start on a 4-byte boundary, resources.arsc especially."""
    bad = []
    with zipfile.ZipFile(apk) as z, open(apk, 'rb') as f:
        for item in z.infolist():
            if item.compress_type != zipfile.ZIP_STORED:
                continue
            f.seek(item.header_offset + 26)
            name_len, extra_len = struct.unpack('<HH', f.read(4))
            if (item.header_offset + 30 + name_len + extra_len) % 4:
                bad.append(item.filename)
    return bad


SIGNER = r'''
import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.*;

public class Sign {
    public static void main(String[] a) throws Exception {
        String ks = a[0], pass = a[1], alias = a[2], in = a[3], out = a[4];
        KeyStore store = KeyStore.getInstance("JKS");
        try (InputStream is = new FileInputStream(ks)) { store.load(is, pass.toCharArray()); }
        PrivateKey key = (PrivateKey) store.getKey(alias, pass.toCharArray());
        X509Certificate cert = (X509Certificate) store.getCertificate(alias);
        ApkSigner.SignerConfig cfg = new ApkSigner.SignerConfig.Builder(alias, key, Collections.singletonList(cert)).build();
        new ApkSigner.Builder(Collections.singletonList(cfg))
            .setInputApk(new File(in)).setOutputApk(new File(out))
            .setMinSdkVersion(%d).setV1SigningEnabled(false).setV2SigningEnabled(true).build().sign();
        ApkVerifier.Result r = new ApkVerifier.Builder(new File(out)).build().verify();
        System.out.println("verified=" + r.isVerified() + " v1=" + r.isVerifiedUsingV1Scheme() + " v2=" + r.isVerifiedUsingV2Scheme());
        for (Object e : r.getErrors()) System.out.println("ERROR " + e);
        if (!r.isVerified()) System.exit(1);
    }
}
''' % MIN_SDK


def main():
    print('1/6 building the game page...')
    build_game.main()

    print('2/6 getting build tools...')
    jars = {n: download(n) for n in JARS}
    aapt2 = aapt2_path(jars['apktool-lib.jar'])

    shutil.rmtree(BUILD, ignore_errors=True)
    for d in ('assets', 'classes', 'sign'):
        os.makedirs(os.path.join(BUILD, d))
    shutil.copy(os.path.join(OUT, 'Ring-Breaker.html'), os.path.join(BUILD, 'assets', 'index.html'))

    print('3/6 compiling resources and the app shell...')
    compiled = os.path.join(BUILD, 'compiled.zip')
    run([aapt2, 'compile', '--dir', os.path.join(APP, 'res'), '-o', compiled])
    base = os.path.join(BUILD, 'base.apk')
    run([aapt2, 'link', '-o', base, '-I', jars['android.jar'], '--manifest', os.path.join(APP, 'AndroidManifest.xml'),
         '--min-sdk-version', str(MIN_SDK), '--target-sdk-version', str(TARGET_SDK),
         '--version-code', str(VERSION_CODE), '--version-name', VERSION_NAME,
         '-A', os.path.join(BUILD, 'assets'), compiled])
    sources = []
    for folder, _, files in os.walk(os.path.join(APP, 'src')):
        sources += [os.path.join(folder, f) for f in files if f.endswith('.java')]
    run(['javac', '-source', '8', '-target', '8', '-Xlint:-options', '-cp', jars['android.jar'], '-d', os.path.join(BUILD, 'classes')] + sources)
    dex = os.path.join(BUILD, 'classes.dex')
    run(['java', '-cp', jars['dx.jar'], 'com.android.dx.command.Main', '--dex', '--min-sdk-version=%d' % MIN_SDK,
         '--output=' + dex, os.path.join(BUILD, 'classes')])

    print('4/6 packing and aligning...')
    unsigned = os.path.join(BUILD, 'unsigned.apk')
    assemble(base, dex, unsigned)
    bad = check_alignment(unsigned)
    if bad:
        raise SystemExit('misaligned entries: %s' % bad)

    print('5/6 signing...')
    keystore = os.path.join(OUT, 'ringbreaker.jks')
    secret = os.path.join(OUT, 'ringbreaker-keystore-password.txt')
    if not os.path.exists(keystore):
        password = secrets.token_urlsafe(18)
        run(['keytool', '-genkeypair', '-keystore', keystore, '-alias', 'ringbreaker', '-keyalg', 'RSA', '-keysize', '2048',
             '-validity', '36500', '-storepass', password, '-keypass', password, '-dname', 'CN=Ring Breaker, O=Ring Breaker, C=US'],
            hide=[password])
        with open(secret, 'w') as f:
            f.write(password + '\n')
        print('  created a new signing key. KEEP out/ringbreaker.jks and out/ringbreaker-keystore-password.txt safe.')
    with open(secret) as f:
        password = f.read().strip()
    with open(os.path.join(BUILD, 'sign', 'Sign.java'), 'w') as f:
        f.write(SIGNER)
    run(['javac', '-cp', jars['apksig.jar'], '-d', os.path.join(BUILD, 'sign'), os.path.join(BUILD, 'sign', 'Sign.java')])
    final = os.path.join(OUT, 'Ring-Breaker.apk')
    sep = ';' if platform.system() == 'Windows' else ':'
    # the signing library is old and uses a few JDK internals; newer Java needs them opened up
    opens = ['--add-exports=java.base/sun.security.x509=ALL-UNNAMED', '--add-exports=java.base/sun.security.pkcs=ALL-UNNAMED',
             '--add-exports=java.base/sun.security.util=ALL-UNNAMED']
    run(['java'] + opens + ['-cp', os.path.join(BUILD, 'sign') + sep + jars['apksig.jar'], 'Sign', keystore, password, 'ringbreaker', unsigned, final],
        hide=[password])

    print('6/6 checking...')
    run([aapt2, 'dump', 'badging', final])
    print('built', os.path.relpath(final, ROOT), '(%.1f MB)' % (os.path.getsize(final) / 1e6))


if __name__ == '__main__':
    main()
