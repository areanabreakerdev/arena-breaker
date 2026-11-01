// Touch controls for Android. Talks to the game through window.AB (defined in game.js).
(function () {
  const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!touch) return;
  const ready = () => window.AB;
  const tc = document.createElement('div');
  tc.id = 'tc';
  const B = (id, ic, lb) => `<div class="b" id="${id}"><span class="ic">${ic}</span><span class="lb">${lb}</span></div>`;
  tc.innerHTML =
    '<div id="look"></div><div id="stick"><i class="ring"></i><i class="tk t1"></i><i class="tk t2"></i><i class="tk t3"></i><i class="tk t4"></i><div id="knob"></div></div>' +
    B('fire', '◉', 'FIRE') + B('jump', '▲', 'JUMP') + B('ads', '◎', 'AIM') + B('slide', '▼', 'SLIDE') +
    B('rel', '⟳', 'RELOAD') + B('gren', '●', 'NADE') + B('skill', '✦', 'SKILL') + B('lockb', '⌖', 'LOCK') +
    '<div id="topbar"><div class="p" id="pause">❚❚</div><div class="p" id="leaveb">LEAVE</div><div class="p" id="chatb">CHAT</div><div class="p" id="micb">MIC</div><div class="p" id="assb">ASSIST</div><div class="p" id="autob">AUTO</div></div>' +
    '<div id="wrow">' + [1, 2, 3, 4].map((n) => `<div class="b w" id="w${n}">${n}</div>`).join('') + '</div>';
  document.body.appendChild(tc);
  const $ = (id) => tc.querySelector('#' + id);

  // hold-style buttons
  const hold = (id, down, up) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('down'); down(); }, { passive: false });
    const end = (e) => { e.preventDefault(); el.classList.remove('down'); if (up) up(); };
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  };
  hold('fire', () => AB.fire(true), () => AB.fire(false));
  hold('ads', () => AB.ads(true), () => AB.ads(false));
  hold('jump', () => AB.key('Space', true), () => AB.key('Space', false));
  hold('slide', () => AB.slide(true), () => AB.slide(false));
  hold('rel', () => AB.reload());
  hold('gren', () => AB.grenade());
  hold('skill', () => AB.ability());
  hold('pause', () => AB.pause());
  { // leave the match any time: tap once to arm, tap again within 3 s to leave
    const lb = $('leaveb'); let armT = 0;
    lb.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (armT) { clearTimeout(armT); armT = 0; AB.leave(); return; }
      lb.textContent = 'TAP AGAIN'; lb.classList.add('down');
      armT = setTimeout(() => { armT = 0; lb.textContent = 'LEAVE'; lb.classList.remove('down'); }, 3000);
    }, { passive: false });
  }
  hold('lockb', () => AB.toggleLock());
  hold('chatb', () => AB.chat());
  hold('micb', () => AB.mic());
  // balanced aim assist + auto shoot (both default on, each can be toggled)
  const sv = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { /* ignore */ } };
  const setA = (btn, key, label) => {
    const el = $(btn);
    const paint = () => { el.textContent = label; el.classList.toggle('on', !!AB.assist[key]); el.classList.toggle('off', !AB.assist[key]); };
    const wait = setInterval(() => { if (ready()) { clearInterval(wait); AB.assist[key] = sv('ab_' + key, true); paint(); } }, 100);
    hold(btn, () => { AB.assist[key] = !AB.assist[key]; put('ab_' + key, AB.assist[key]); paint(); });
  };
  setA('assb', 'aim', 'AIM+'); setA('autob', 'auto', 'AUTO');
  for (let n = 1; n <= 4; n++) hold('w' + n, () => AB.equip(n - 1));

  // virtual joystick -> WASD (+ sprint when pushed to the edge)
  const stick = $('stick'), knob = $('knob');
  let sid = null, cx = 0, cy = 0, rad = 1;
  const setKeys = (dx, dy) => {
    const m = Math.hypot(dx, dy);
    const dead = 0.25;
    AB.key('KeyW', dy < -dead * rad && m > dead * rad);
    AB.key('KeyS', dy > dead * rad && m > dead * rad);
    AB.key('KeyA', dx < -dead * rad && m > dead * rad);
    AB.key('KeyD', dx > dead * rad && m > dead * rad);
    AB.key('ShiftLeft', m > 0.9 * rad && dy < -0.3 * rad);
  };
  stick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    sid = t.identifier;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2; rad = r.width / 2;
  }, { passive: false });
  stick.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== sid) continue;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const m = Math.hypot(dx, dy);
      if (m > rad) { dx *= rad / m; dy *= rad / m; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      setKeys(dx, dy);
    }
  }, { passive: false });
  const stickEnd = (e) => {
    e.preventDefault();
    sid = null;
    knob.style.transform = '';
    setKeys(0, 0);
    ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'].forEach((k) => AB.key(k, false));
  };
  stick.addEventListener('touchend', stickEnd, { passive: false });
  stick.addEventListener('touchcancel', stickEnd, { passive: false });

  // drag anywhere on the right side to look
  const look = $('look');
  let lid = null, lx = 0, ly = 0;
  look.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    lid = t.identifier; lx = t.clientX; ly = t.clientY;
  }, { passive: false });
  look.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== lid) continue;
      AB.look(t.clientX - lx, t.clientY - ly);
      lx = t.clientX; ly = t.clientY;
    }
  }, { passive: false });
  const lookEnd = (e) => { e.preventDefault(); lid = null; };
  look.addEventListener('touchend', lookEnd, { passive: false });
  look.addEventListener('touchcancel', lookEnd, { passive: false });

  // overlay tap = start / resume (pointer lock does not exist on phones)
  const overlay = document.getElementById('overlay');
  overlay.addEventListener('click', (e) => {
    if (!(e.target.closest && e.target.closest('[data-start]'))) return;
    e.stopImmediatePropagation();
    AB.start();
  }, true);
  const adminEl = document.getElementById('admin');
  if (adminEl) adminEl.addEventListener('touchstart', (e) => e.stopPropagation());

  setInterval(() => {
    if (!ready()) return;
    tc.classList.toggle('on', AB.playing);
    const a = AB.admin.auth;
    $('w4').style.display = a ? '' : 'none';
    for (let n = 1; n <= 4; n++) $('w' + n).classList.toggle('cur', AB.slot === n - 1);
    $('micb').classList.toggle('on', !!AB.micOn); $('micb').classList.toggle('off', !AB.micOn);
    $('lockb').style.display = a ? 'flex' : 'none';
    $('lockb').style.background = AB.admin.lock ? 'rgba(255,0,0,.6)' : 'rgba(255,0,0,.3)';
  }, 200);
})();
