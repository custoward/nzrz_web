// 풍경(風磬). 막대에 매달린 획 넷이 각자 감쇠 진자로 흔들린다.
//
// 정해진 애니메이션을 재생하는 게 아니라 매 프레임 물리를 푼다:
//   각가속도 = -ω₀²·θ  -  2ζω₀·θ'
//              (복원력)     (감쇠)
// 마우스·손가락·기기 흔들림이 각속도(θ')를 밀어준다. 속도를 더하는
// 방식이라 힘이 누적된다 — 리듬을 맞추면 공명해서 점점 크게 흔들리고,
// 가만두면 스스로 잦아든다. 이웃한 획끼리 부딪히면 소리가 난다.

(function () {
  'use strict';

  // ══ 설정 ════════════════════════════════════════════════════
  // 만질 만한 숫자는 전부 여기 모아둔다.

  var CFG = {
    // 커서·손가락
    sigma: 190,     // 커서 영향이 퍼지는 범위(viewBox 단위). 획 간격이 ~210이라
                    // 이 정도면 옆 획도 약하게 딸려 흔들리며 물결이 생긴다.
    ref: 2600,      // 기준 속도(viewBox단위/초). 화면상 약 460px/초 — 평범한 스윕.
    drive: 0.36,    // 커서가 1단위 지나갈 때 밀어주는 각속도(도/초)

    // 기기 흔들기
    shakeDrive: 240,   // 방향이 있는 직접 구동 — 기울이면 그쪽으로 쏠린다
    shakePump: 300,    // 움직이던 방향으로 더 밀어 진폭을 키우는 항
    shakeFloor: 0.25,  // 이보다 약하면 손떨림으로 보고 무시(m/s²)

    // 부딪힘
    restitution: 0.55, // 부딪히면 이만큼 튕겨 나간다

    // 소리
    volume: 0.45,
    tones: [587.33, 659.25, 783.99, 880.00],   // 장5음계 레·미·솔·라
    hitFloor: 5,       // 이보다 약한 충돌은 무시
    hitFull: 260,      // 이 속도에서 최대 음량

    // 저절로 부는 바람
    breezeMin: 4500,   // 다음 바람까지 대기(ms)
    breezeMax: 11000
  };

  // 풍경은 종이 아니라 양끝이 자유로운 금속 관이다. 관의 진동 모드는
  // 정수배가 아니라 1 : 2.756 : 5.404 : 8.933 로 벌어져 있다.
  // 이 비율이 "음정 같으면서도 음정 아닌" 금속 울림의 정체다.
  // 다만 높은 모드를 다 살리면 쨍그랑거려 탁해지므로 위쪽은 확 줄였다.
  var MODES = [
    // [배수,   세기,  지속(초)]
    [ 1.000,   1.00,  7.0 ],
    [ 2.756,   0.34,  2.4 ],
    [ 5.404,   0.10,  0.9 ],
    [ 8.933,   0.03,  0.35]
  ];

  // 각 획의 회전축 x좌표와 고유 진동수.
  // ω₀를 일부러 조금씩 어긋나게 뒀다. 넷이 같은 박자로 흔들리면
  // 기계처럼 보이는데, 어긋나 있으면 위상이 밀리며 샤라랑거린다.
  // L = 회전축에서 아래끝까지 길이, oxL/oxR = 아랫부분 좌우 가장자리의
  // 축 기준 오프셋. 전부 logo.svg 패스에서 실측했고 충돌 판정에 쓴다.
  var PARTS = [
    { sel: '.leg-1', tone: 0, x: 150.0, L: 373.4, oxL: -19.7, oxR: 111.1, w0: 6.1,  zeta: 0.055, gain: 1.00, max: 19 },
    { sel: '.leg-2', tone: 1, x: 386.7, L: 368.1, oxL: -79.3, oxR:  90.6, w0: 7.3,  zeta: 0.050, gain: 0.90, max: 16 },
    { sel: '.leg-3', tone: 2, x: 601.2, L: 368.6, oxL: -73.5, oxR:  72.9, w0: 6.7,  zeta: 0.052, gain: 0.95, max: 17 },
    { sel: '.leg-4', tone: 3, x: 814.7, L: 366.1, oxL: -84.6, oxR:  86.3, w0: 7.9,  zeta: 0.048, gain: 0.85, max: 15 },
    // 막대는 걸이라서 훨씬 뻣뻣하고 조금만 움직인다. 부딪히지 않는다.
    { sel: '.bar',            x: 517.4, w0: 13.0, zeta: 0.140, gain: 0.16, max: 3 }
  ];

  var RAD = Math.PI / 180;

  // ══ 요소 ════════════════════════════════════════════════════

  var stage = document.getElementById('stage');
  var mark = document.getElementById('mark');
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var LEGS = PARTS.slice(0, 4);

  PARTS.forEach(function (p) {
    p.el = mark.querySelector(p.sel);
    p.a = 0;   // 각도(도)
    p.v = 0;   // 각속도(도/초)
  });

  function rand(a, b) { return a + Math.random() * (b - a); }

  // ══ 진단 ════════════════════════════════════════════════════
  // ?debug 를 붙였을 때만 동작한다. 꺼져 있으면 D의 메서드가 전부
  // 빈 함수라, 본 코드에는 호출 한 줄 외에 흔적이 남지 않는다.

  var D = (function () {
    if (location.search.indexOf('debug') < 0) {
      var noop = function () {};
      return { on: false, hit: noop, set: noop, show: noop };
    }

    var el = document.createElement('pre');
    el.id = 'debug';
    document.body.appendChild(el);

    var n = {}, kv = {};

    function show() {
      el.textContent = [
        'secure(HTTPS)  : ' + window.isSecureContext,
        'AudioContext   : ' + (audio.ctx ? audio.ctx.state : '아직 안 만듦'),
        '무음우회       : ' + (kv.unmute || '-'),
        'DeviceMotion   : ' + (window.DeviceMotionEvent ? '있음' : '없음'),
        'requestPerm    : ' + (window.DeviceMotionEvent &&
                               typeof DeviceMotionEvent.requestPermission === 'function'
                               ? '필요(iOS)' : '불필요(안드로이드)'),
        'motion 상태    : ' + (kv.motion || 'idle'),
        '',
        'touchmove      : ' + (n.touch || 0),
        'devicemotion   : ' + (n.motion || 0),
        '가속도         : ' + (kv.accel || '-'),
        '',
        '스침소리       : ' + (n.brush || 0),
        '부딪힘소리     : ' + (n.chime || 0),
        'UA             : ' + navigator.userAgent.slice(0, 60)
      ].join('\n');
    }

    return {
      on: true,
      hit: function (k, every) {
        n[k] = (n[k] || 0) + 1;
        if (!every || n[k] % every === 1) show();
      },
      set: function (k, v) { kv[k] = v; show(); },
      show: show
    };
  })();

  // ══ 소리 ════════════════════════════════════════════════════
  // 음원 파일 없이 Web Audio로 합성한다. 획마다 음 하나씩.

  var audio = { ctx: null, bus: null, noise: null };

  function ready() {
    return !!audio.ctx && audio.ctx.state === 'running';
  }

  // 잔향(여음). 노이즈를 지수적으로 감쇠시켜 임펄스응답을 즉석에서 만든다.
  function makeReverb(ctx, seconds, decay) {
    var n = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var ch = buf.getChannelData(c);
      for (var i = 0; i < n; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    var conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  function initAudio() {
    if (audio.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    var ctx = new AC();
    audio.ctx = ctx;

    audio.bus = ctx.createGain();
    audio.bus.gain.value = CFG.volume;

    // 부딪히는 순간의 반짝임에 쓸 노이즈. 한 번 만들어 재사용한다.
    audio.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
    var nd = audio.noise.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    var wet = ctx.createGain();
    wet.gain.value = 0.6;
    var verb = makeReverb(ctx, 4.0, 2.2);

    audio.bus.connect(ctx.destination);   // 직접음
    audio.bus.connect(verb);              // 잔향
    verb.connect(wet);
    wet.connect(ctx.destination);
  }

  // vel 은 0~1. 세게 칠수록 크고, 밝고, 오래 울린다 — 실제 금속이 그렇다.
  function strike(freq, vel) {
    var ctx = audio.ctx;
    var t = ctx.currentTime;
    var out = ctx.createGain();
    out.gain.value = 0.42;

    var detune = 1 + (Math.random() - 0.5) * 0.006;   // 칠 때마다 미세하게 다르게

    MODES.forEach(function (m) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * m[0] * detune;

      var peak = vel * m[1] * 0.20 * (0.35 + 0.65 * vel);
      var dur = m[2] * (0.85 + 0.3 * vel);

      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });

    // 닿는 순간의 반짝임. 세게 깔면 쇳덩이 부딪는 소리가 되니 아주 얇게.
    var src = ctx.createBufferSource();
    src.buffer = audio.noise;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 9;
    bp.Q.value = 0.7;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.03, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);

    src.connect(bp); bp.connect(ng); ng.connect(out);
    src.start(t);
    src.stop(t + 0.06);

    out.connect(audio.bus);
  }

  // 커서가 획을 가로지를 때. 부딪히는 소리보다 훨씬 여리게 —
  // 손끝으로 건드린 정도지 때린 게 아니다.
  function brush(p, speed) {
    if (!ready() || p.tone === undefined || speed < 0.06) return;

    var now = audio.ctx.currentTime;
    if (now - (p.lastBrush || -9) < 0.12) return;
    p.lastBrush = now;

    D.hit('brush');
    strike(CFG.tones[p.tone], Math.min(speed, 1) * 0.42);
  }

  // 이웃한 두 획이 부딪혔을 때 둘 다 운다.
  var lastChime = [];

  function chime(pair, closing) {
    if (!ready() || closing < CFG.hitFloor) return;

    var now = audio.ctx.currentTime;
    if (now - (lastChime[pair] || -9) < 0.09) return;
    lastChime[pair] = now;

    // 살짝 스친 것과 세게 부딪힌 것의 차이가 들려야 한다.
    // 선형이면 대부분 중간에 뭉치니 1.4승으로 폭을 벌린다.
    var vel = Math.pow(Math.min(closing / CFG.hitFull, 1), 1.4);

    D.hit('chime');
    strike(CFG.tones[pair], vel);
    strike(CFG.tones[pair + 1], vel * 0.8);
  }

  // ══ 물리 ════════════════════════════════════════════════════

  var running = false;

  function start() {
    if (running) return;
    running = true;
    step.prev = 0;
    requestAnimationFrame(step);
  }

  function step(now) {
    var dt = Math.min((now - step.prev || 16) / 1000, 0.05);
    step.prev = now;

    // 큰 각속도에서도 발산하지 않게 잘게 쪼개 적분한다
    var n = 4, h = dt / n;
    PARTS.forEach(function (p) {
      for (var i = 0; i < n; i++) {
        p.v += (-p.w0 * p.w0 * p.a - 2 * p.zeta * p.w0 * p.v) * h;
        p.a += p.v * h;
      }
      if (p.a > p.max)  { p.a = p.max;  p.v *= -0.4; }
      if (p.a < -p.max) { p.a = -p.max; p.v *= -0.4; }
    });

    collide();

    var moving = false;
    PARTS.forEach(function (p) {
      if (Math.abs(p.a) > 0.015 || Math.abs(p.v) > 0.05) moving = true;
      p.el.style.transform = 'rotate(' + p.a.toFixed(3) + 'deg)';
    });

    if (moving) {
      requestAnimationFrame(step);
    } else {
      running = false;
      PARTS.forEach(function (p) {
        p.a = p.v = 0;
        p.el.style.transform = '';
      });
    }
  }

  // 이웃한 획끼리 부딪히는지 본다. 풍경은 마우스가 닿아서가 아니라
  // 서로 부딪혀서 소리가 난다.
  function collide() {
    for (var i = 0; i < LEGS.length - 1; i++) {
      var a = LEGS[i], b = LEGS[i + 1];
      var ra = a.a * RAD, rb = b.a * RAD;

      // 회전한 뒤 마주보는 가장자리의 실제 x 위치
      var edgeA = a.x + a.oxR * Math.cos(ra) - a.L * Math.sin(ra);
      var edgeB = b.x + b.oxL * Math.cos(rb) - b.L * Math.sin(rb);
      var gap = edgeB - edgeA;
      if (gap >= 0) continue;

      // 아래끝의 좌우 속도 (각속도가 +면 아래끝은 왼쪽으로 간다)
      var va = -a.L * a.v * RAD;
      var vb = -b.L * b.v * RAD;
      var closing = va - vb;

      if (closing > 0) {
        // 질량이 같다고 보고 반발계수만큼 속도를 교환한다
        var e = CFG.restitution;
        var na = ((1 - e) * va + (1 + e) * vb) / 2;
        var nb = ((1 + e) * va + (1 - e) * vb) / 2;
        a.v = -na / (a.L * RAD);
        b.v = -nb / (b.L * RAD);
        chime(i, closing);
      }

      // 겹친 만큼 서로 밀어내 붙어버리는 걸 막는다
      var pen = -gap / 2;
      a.a += pen / (a.L * RAD);
      b.a -= pen / (b.L * RAD);
    }
  }

  // ══ 들어가는 문 ═════════════════════════════════════════════
  // 화살표는 풍경이 제대로 한 번 흔들린 뒤에 드러난다.
  // 소리와 묶으면 오디오가 막힌 기기에서 들어갈 길이 아예 없어진다.

  var entered = false;

  function showEnter() {
    if (entered) return;
    entered = true;
    var el = document.getElementById('enter');
    if (el) el.classList.add('on');
  }

  // ══ 입력 ════════════════════════════════════════════════════

  var lastX = null, lastT = 0;

  function push(e) {
    if (still) return;
    var pt = e.touches ? e.touches[0] : e;
    if (!pt) return;

    var r = mark.getBoundingClientRect();
    var ux = (pt.clientX - r.left) / r.width * 1024;   // 화면 → viewBox 좌표
    var now = e.timeStamp;

    if (lastX !== null) {
      var dt = (now - lastT) / 1000;
      if (dt > 0.001 && dt < 0.2) {
        var dx = ux - lastX;
        var vx = dx / dt;

        // 세기는 '얼마나 지나갔나'(dx)에 비례시킨다. 이벤트가 몇 개 오든
        // 총합이 이동거리로 정해져 기기 성능에 안 휘둘린다. 거기에 속도
        // 계수를 곱하되 tanh로 눌러, 빠를수록 세지되 휙 그어도 안 튄다.
        var speed = Math.tanh(Math.abs(vx) / CFG.ref);

        PARTS.forEach(function (p) {
          var d = (ux - p.x) / CFG.sigma;
          var falloff = Math.exp(-d * d);

          // 커서가 오른쪽으로 가면 획의 아래쪽도 오른쪽으로 —
          // 회전축이 위에 있어서 부호가 반대다
          p.v -= CFG.drive * dx * p.gain * falloff * speed;

          // 그 획을 '가로지르는 순간'에만 스치듯 울린다.
          // 근처에 있는 내내 울리면 소리가 뭉개진다.
          var side = ux > p.x ? 1 : -1;
          if (p.side !== undefined && p.side !== side) brush(p, speed);
          p.side = side;
        });

        if (Math.abs(vx) > 500) showEnter();
        start();
      }
    }
    lastX = ux;
    lastT = now;
  }

  // 로고를 누르면 한 번 훅 흔들린다. 마우스가 없는 기기에서도 놀 수 있게.
  // 방향은 넷이 공유하고 세기만 제각각 — 한 줄기 바람이 스친 것처럼.
  function pluck(strength) {
    if (still) return;
    var s = strength || 1;
    var dir = Math.random() < 0.5 ? -1 : 1;
    PARTS.forEach(function (p) {
      p.v += dir * rand(55, 120) * s * p.gain;
    });
    if (s > 0.5) showEnter();
    start();
  }

  stage.addEventListener('click', function () { pluck(); });
  stage.addEventListener('mousemove', push);
  stage.addEventListener('mouseleave', function () { lastX = null; });

  stage.addEventListener('touchmove', function (e) {
    e.preventDefault();          // 화면이 딸려 움직이는 걸 막는다
    D.hit('touch', 10);
    push(e);
  }, { passive: false });
  stage.addEventListener('touchend', function () { lastX = null; });

  // ══ 저절로 부는 바람 ════════════════════════════════════════
  // 풍경은 원래 사람이 없어도 운다. 가만히 있는 로고는 그림이지만
  // 이따금 저 혼자 흔들리면 만져볼 것이 된다. 소리를 열려면 클릭이
  // 필요하다는 걸 말로 알릴 수 없으니, 살아 있다는 티를 내서 손이 가게 한다.
  // 부딪힐락 말락 한 세기라 대개는 소리 없이 움직이기만 한다.

  function breeze() {
    if (!document.hidden) pluck(rand(0.12, 0.3));
    setTimeout(breeze, rand(CFG.breezeMin, CFG.breezeMax));
  }

  if (!still) setTimeout(breeze, rand(1200, 2600));

  // ══ 잠금 해제 ═══════════════════════════════════════════════
  // 오디오와 모션 센서는 사용자 제스처 안에서만 열 수 있다 —
  // 자동재생 정책과 iOS 권한 정책 때문이다. 한 번만 시도하면 그 한 번이
  // 실패했을 때 복구할 방법이 없으므로, 제스처마다 아직 안 열린 것만 다시 본다.

  // iOS는 오디오 세션이 기본 'ambient'라 Web Audio가 무음 스위치에 죽는다.
  // (HTML5 <audio> 태그는 안 죽는다 — WebKit의 알려진 동작)
  // 무음 파일을 <audio>로 재생시키면 세션이 'playback'으로 올라간다.
  var SILENT_WAV = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
  var silent = null;

  function unmuteIOS() {
    if (silent) return;
    silent = document.createElement('audio');
    silent.setAttribute('playsinline', '');
    silent.loop = true;
    silent.volume = 0.02;
    silent.src = SILENT_WAV;

    var pr = silent.play();
    if (pr && pr.then) {
      pr.then(function () {
        D.set('unmute', '성공');
      }).catch(function (err) {
        D.set('unmute', '실패: ' + (err && err.name ? err.name : err));
        silent = null;
      });
    }
  }

  var grav = { x: 0, y: 0, z: 0 };
  var lastMotionT = 0;
  var motionOn = false;

  function onMotion(e) {
    if (still) return;
    D.hit('motion', 10);

    // acceleration은 중력이 빠진 값이라 그대로 쓴다. 비어 있는 기기에서는
    // accelerationIncludingGravity에서 중력을 저역통과로 추정해 세 축 모두 뺀다.
    var pure = !!(e.acceleration && e.acceleration.x !== null);
    var src = pure ? e.acceleration : e.accelerationIncludingGravity;
    if (!src || src.x === null) return;

    var ax = src.x || 0, ay = src.y || 0, az = src.z || 0;
    if (!pure) {
      grav.x = grav.x * 0.88 + ax * 0.12;
      grav.y = grav.y * 0.88 + ay * 0.12;
      grav.z = grav.z * 0.88 + az * 0.12;
      ax -= grav.x; ay -= grav.y; az -= grav.z;
    }

    // e.interval을 믿지 않는다. 기기마다 단위가 다르게 오는 경우가 있고,
    // 그러면 dt가 통째로 어긋나 밀어주는 양이 사라진다. 직접 잰다.
    var t = e.timeStamp || performance.now();
    var dt = lastMotionT ? (t - lastMotionT) / 1000 : 0.016;
    lastMotionT = t;
    if (!(dt > 0.002 && dt < 0.2)) dt = 0.016;

    // 흔드는 방향은 사람마다 다르다. 좌우만 보면 앞뒤로 흔드는 사람은
    // 아무 반응도 못 얻는다. 세기는 세 축을 합쳐 재고, 기우는 방향만 x가 정한다.
    var mag = Math.sqrt(ax * ax + ay * ay + az * az);

    if (D.on) {
      D.set('accel', 'x ' + ax.toFixed(2) + ' / 합 ' + mag.toFixed(2) +
                     ' / dt ' + dt.toFixed(3) + (pure ? '' : ' (중력보정)'));
    }

    if (mag < CFG.shakeFloor) return;

    var drive = Math.tanh(ax / 5);     // 부호 있음 — 기우는 방향
    var pump = Math.tanh(mag / 5);     // 크기만 — 진폭을 키우는 힘

    PARTS.forEach(function (p) {
      p.v += drive * CFG.shakeDrive * p.gain * dt;

      // 이미 가고 있는 쪽으로 더 밀어준다. 흔드는 박자가 진자와 안 맞아도
      // 에너지가 쌓여 진폭이 커진다. 최대각에 가까울수록 덜 밀어 발산을 막는다.
      var room = 1 - Math.abs(p.a) / p.max;
      if (room > 0) {
        var dir = (p.v || drive) > 0 ? 1 : -1;
        p.v += dir * pump * CFG.shakePump * p.gain * dt * room;
      }
    });

    if (mag > 1.5) showEnter();
    start();
  }

  function enableMotion() {
    if (motionOn || !window.DeviceMotionEvent) return;

    // 안드로이드 크롬에는 requestPermission 자체가 없다 — 권한창이 안 뜨는 게 정상.
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      motionOn = true;   // 요청은 한 번만
      D.set('motion', '요청 중');
      DeviceMotionEvent.requestPermission().then(function (state) {
        if (state === 'granted') {
          window.addEventListener('devicemotion', onMotion);
          D.set('motion', 'on');
        } else {
          motionOn = false;
          D.set('motion', '거부됨(' + state + ')');
        }
      }).catch(function (err) {
        motionOn = false;
        D.set('motion', '요청실패: ' + (err && err.message ? err.message : err));
      });
    } else {
      window.addEventListener('devicemotion', onMotion);
      motionOn = true;
      D.set('motion', 'on(권한불필요)');
    }
  }

  function unlock() {
    unmuteIOS();
    initAudio();
    if (audio.ctx && audio.ctx.state !== 'running' && audio.ctx.resume) {
      audio.ctx.resume().then(D.show).catch(D.show);
    }
    enableMotion();
    D.show();
  }

  ['pointerdown', 'touchstart', 'click'].forEach(function (ev) {
    window.addEventListener(ev, unlock);
  });

  console.log('느즈러짐 — 서울패를 운영합니다.');
  console.log('teamnzrz@gmail.com / @team.nzrz');
})();
