// Touch controls for Android. Talks to the game through window.AB (defined in game.js).
(function () {
  const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!touch) return;
  const ready = () => window.AB;
  const tc = document.createElement('div');
  tc.id = 'tc';
  tc.innerHTML =
    '<div id="look"></div><div id="stick"><div id="knob"></div></div>' +
    '<div class="b" id="fire">FIRE</div><div class="b" id="jump">JUMP</div><div class="b" id="ads">AIM</div>' +
    '<div class="b" id="slide">SLIDE</div><div class="b" id="rel">RELOAD</div><div class="b" id="gren">NADE</div><div class="b" id="skill">SKILL</div>' +
    '<div class="b" id="pause">II</div><div class="b" id="lockb">LOCK</div><div class="b" id="chatb">CHAT</div><div class="b" id="assb">ASSIST</div><div class="b" id="autob">AUTO</div>' +
    [1, 2, 3, 4].map((n, i) => `<div class="b w" id="w${n}" style="left:${8 + i * 10.5}vh">${n}</div>`).join('');
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
  hold('lockb', () => AB.toggleLock());
  hold('chatb', () => AB.chat());
  // balanced aim assist + auto shoot (both default on, each can be toggled)
  const sv = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { /* ignore */ } };
  const setA = (btn, key, label) => {
    const el = $(btn);
    const paint = () => { el.textContent = label + (AB.assist[key] ? ' ON' : ' OFF'); el.style.opacity = AB.assist[key] ? '1' : '.55'; };
    const wait = setInterval(() => { if (ready()) { clearInterval(wait); AB.assist[key] = sv('ab_' + key, true); paint(); } }, 100);
    hold(btn, () => { AB.assist[key] = !AB.assist[key]; put('ab_' + key, AB.assist[key]); paint(); });
  };
  setA('assb', 'aim', 'ASSIST'); setA('autob', 'auto', 'AUTO');
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
    if (e.target.closest && e.target.closest('#maps, #optbox, #netbox, #roombox, #adminbtn, #admin')) return;
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
    $('lockb').style.display = a ? 'flex' : 'none';
    $('lockb').style.background = AB.admin.lock ? 'rgba(255,0,0,.6)' : 'rgba(255,0,0,.3)';
  }, 200);
})();
