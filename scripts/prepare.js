// Builds ./www (the web app Capacitor wraps): game files + three.js + cannon-es + touch controls.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'lib'), { recursive: true });
const cp = (a, b) => fs.cpSync(path.join(root, a), path.join(www, b), { recursive: true });
cp('game/game.js', 'game.js');
cp('game/mobile.js', 'mobile.js');
cp('game/mobile.css', 'mobile.css');
cp('node_modules/three/build', 'lib/three');
cp('node_modules/cannon-es/dist', 'lib/cannon-es');
cp('node_modules/peerjs/dist/peerjs.min.js', 'lib/peerjs.min.js');
let html = fs.readFileSync(path.join(root, 'game/index.html'), 'utf8');
html = html.replace('./node_modules/three/build/three.module.js', './lib/three/three.module.js');
html = html.replace('./node_modules/cannon-es/dist/cannon-es.js', './lib/cannon-es/cannon-es.js');
html = html.replace('./node_modules/peerjs/dist/peerjs.min.js', './lib/peerjs.min.js');
html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">');
html = html.replace('</head>', '<link rel="stylesheet" href="./mobile.css">\n</head>');
html = html.replace('<script type="module" src="./game.js"></script>', '<script type="module" src="./game.js"></script>\n<script src="./mobile.js"></script>');
// web/iPhone extras: home-screen app, icons, and a "rotate your phone" screen in portrait
html = html.replace('</head>', `<link rel="manifest" href="./manifest.webmanifest">
<link rel="apple-touch-icon" href="./icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Arena Breaker">
<meta name="theme-color" content="#0e121a">
<style>#rot{display:none;position:fixed;inset:0;z-index:9999;background:#05080c;color:#fff;align-items:center;justify-content:center;flex-direction:column;font:700 20px "Segoe UI",Arial,sans-serif;letter-spacing:2px;text-align:center}
#rot i{font-style:normal;font-size:64px;display:block;margin-bottom:12px;animation:rr 2s ease-in-out infinite}@keyframes rr{0%,100%{transform:rotate(0)}50%{transform:rotate(90deg)}}
@media (orientation:portrait) and (pointer:coarse){#rot{display:flex}}</style>
</head>`);
html = html.replace('<body>', '<body>\n<div id="rot"><div><i>&#128241;</i>ROTATE YOUR PHONE<br><small style="opacity:.6;font-size:13px">Arena Breaker plays in landscape</small></div></div>');
fs.writeFileSync(path.join(www, 'index.html'), html);
for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(root, 'web', f), path.join(www, f));
for (const f of ['lib/three/three.module.js', 'lib/cannon-es/cannon-es.js', 'lib/peerjs.min.js', 'index.html']) {
  if (!fs.existsSync(path.join(www, f))) throw new Error('missing ' + f);
}
console.log('www ready');
