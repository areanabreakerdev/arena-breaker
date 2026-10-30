// Landscape + fullscreen immersive for the generated Android project.
const fs = require('fs');
const path = require('path');
const app = path.join(__dirname, '..', 'android', 'app', 'src', 'main');
const mf = path.join(app, 'AndroidManifest.xml');
let m = fs.readFileSync(mf, 'utf8');
if (!m.includes('screenOrientation')) m = m.replace('<activity', '<activity\n            android:screenOrientation="sensorLandscape"');
for (const perm of ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'INTERNET']) {
  if (!m.includes('android.permission.' + perm)) m = m.replace('<application', '<uses-permission android:name="android.permission.' + perm + '" />\n    <application');
}
fs.writeFileSync(mf, m);
const dir = path.join(app, 'java', 'com', 'arenabreaker', 'game');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'MainActivity.java'), `package com.arenabreaker.game;

import android.view.View;
import android.view.WindowManager;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }
}
`);

// Halloween app icon (optional: skipped if scripts/icons is missing)
try {
  const icons = path.join(__dirname, 'icons');
  const res = path.join(app, 'res');
  for (const d of fs.readdirSync(icons)) {
    const src = path.join(icons, d), dst = path.join(res, d);
    if (!fs.statSync(src).isDirectory()) continue;
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
  fs.mkdirSync(path.join(res, 'values'), { recursive: true });
  fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1A0A2E</color>\n</resources>\n');
  console.log('icon installed');
} catch (e) { console.log('icon skipped: ' + e.message); }
console.log('android patched');
