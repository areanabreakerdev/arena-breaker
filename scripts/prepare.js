// Builds ./www (the web app Capacitor wraps): game files + three.js + cannon-es + touch controls.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const www = path.join(root, 'www');
fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(path.join(www, 'lib'), { recursive: true });
const cp = (a, b) => fs.cpSync(path.join(root, a), path.join(www, b), { recursive: true });
cp('game/game.js', 'game.js');
cp('game/sounds', 'sounds');
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
fs.writeFileSync(path.join(www, 'index.html'), html);
for (const f of ['lib/three/three.module.js', 'lib/cannon-es/cannon-es.js', 'lib/peerjs.min.js', 'index.html']) {
  if (!fs.existsSync(path.join(www, f))) throw new Error('missing ' + f);
}
console.log('www ready');
