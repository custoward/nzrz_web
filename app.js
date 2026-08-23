// 풍경(風磬). 막대에 매달린 획 넷이 각자 감쇠 진자로 흔들린다.
//
// 정해진 애니메이션을 재생하는 게 아니라 매 프레임 물리를 푼다:
//   각가속도 = -ω₀²·θ  -  2ζω₀·θ'
//              (복원력)     (감쇠)
// 마우스·손가락·기기 흔들림이 각속도(θ')를 밀어준다. 속도를 더하는
// 방식이라 힘이 누적된다 — 리듬을 맞추면 공명해서 점점 크게 흔들리고,
// 가만두면 스스로 잦아든다. 이웃한 획끼리 부딪히면 소리가 난다.
//
// 이중진자다. 막대(ㅡ)가 제 중심을 축으로 흔들리고, 획 넷은 그 막대에
// 매달려 한 번 더 흔들린다. 획의 각도는 «막대 기준 상대각»이라
// 화면에서 보이는 각도는 막대각 + 상대각이다. 막대가 흔들리면 획이
// 향해야 할 «아래»가 획의 좌표계에서 움직이므로, 획은 흔들리는 기준을
// 쫓아가느라 저 혼자일 때는 나올 수 없는 궤적을 그린다.

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

    // 기기 기울임 — 중력
    tiltGain: 0.85,    // 기기가 1도 기울 때 획이 따라 눕는 각도
    tiltMax: 11,       // 아무리 기울여도 이보다 더 눕지 않는다(도).
                       // max(15~19)보다 낮게 둬야 흔들릴 여지가 남는다
    tiltRate: 12,      // 매달린 각도가 옮겨가는 최대 속도(도/초).
                       // 진자 주기(0.8~1s)보다 느리게 움직여야 획이 따라오기만
                       // 하고 안 튄다. 지수완화로는 초반이 계단이라 크게 튀었다
    tiltDead: 1.2,     // 이보다 작은 차이는 손떨림으로 보고 무시(도)

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
    breezeMax: 11000,

    // 들어가는 문
    enterDelay: 1800,  // 첫 부딪힘 뒤 화살표가 나오기까지(ms)

    // 부딪힌 자리에서 퍼지는 파동
    waveMin: 130,      // 살짝 스쳤을 때 퍼지는 반지름(px)
    waveMax: 540,      // 세게 부딪혔을 때
    waveSpeed: 130     // 퍼지는 속도(px/초). 세기는 얼마나 멀리 가느냐를
                       // 정하지 얼마나 빨리 가느냐를 정하지 않는다.
                       // 빠르면 «튀어나온다»가 되고 느려야 «번진다»가 된다
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
  //
  // m = 부딪히는 지점에서 느껴지는 무게. 획을 하나씩 캔버스에 그려
  // 칠해진 픽셀로 회전축 기준 관성모멘트를 구하고 아래끝 거리²로 나눴다.
  // 지어낸 값이 아니라 글자 모양에서 나온 값이다 — ㄴ은 획이 적고 잉크가
  // 위쪽에 몰려 제일 가볍고(0.89), ㄹ은 아래가 두툼해 제일 무겁다(1.08).
  // 차이가 ±10% 라 크지 않지만, 넷을 같다고 두는 것보다는 맞다.
  var PARTS = [
    { sel: '.leg-1', tone: 0, x: 150.0, L: 373.4, oxL: -19.7, oxR: 111.1, w0: 6.1,  zeta: 0.055, gain: 1.00, max: 19, m: 0.89 },
    { sel: '.leg-2', tone: 1, x: 386.7, L: 368.1, oxL: -79.3, oxR:  90.6, w0: 7.3,  zeta: 0.050, gain: 0.90, max: 16, m: 1.01 },
    { sel: '.leg-3', tone: 2, x: 601.2, L: 368.6, oxL: -73.5, oxR:  72.9, w0: 6.7,  zeta: 0.052, gain: 0.95, max: 17, m: 1.08 },
    { sel: '.leg-4', tone: 3, x: 814.7, L: 366.1, oxL: -84.6, oxR:  86.3, w0: 7.9,  zeta: 0.048, gain: 0.85, max: 15, m: 1.02 },
    // 막대는 이중진자의 위쪽 팔이다. 획보다 느리고 덜 움직이지만 «조금만»
    // 움직여선 안 된다 — 막대가 흔들려야 획이 쫓아갈 기준이 생긴다.
    // 돌리는 대상은 막대 획 하나가 아니라 획 넷까지 담은 #rig 덩어리다.
    { sel: '#rig',            x: 517.4, w0: 6.5,  zeta: 0.100, gain: 0.35, max: 5 }
  ];

  var RAD = Math.PI / 180;

  // ══ 요소 ════════════════════════════════════════════════════

  var stage = document.getElementById('stage');
  var mark = document.getElementById('mark');
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var LEGS = PARTS.slice(0, 4);

  // 덩어리의 회전축은 막대의 중심이다. fill-box 는 덩어리 전체 bbox를
  // 잡아버리므로 viewBox 좌표로 직접 찍어준다.
  var barBox = mark.querySelector('.bar').getBBox();
  var barCx = barBox.x + barBox.width / 2;
  var barCy = barBox.y + barBox.height / 2;
  var rig = mark.querySelector('#rig');
  rig.style.transformBox = 'view-box';
  rig.style.transformOrigin = barCx.toFixed(1) + 'px ' + barCy.toFixed(1) + 'px';

  PARTS.forEach(function (p) {
    p.el = mark.querySelector(p.sel);
    p.a = 0;   // 각도(도)
    p.v = 0;   // 각속도(도/초)

    // 회전축의 y. transform-origin이 획의 윗변(0%)이므로 bbox 위쪽이 곧 축이다.
    // 파동을 부딪힌 자리에 그리려면 x뿐 아니라 y도 필요한데,
    // 상수로 박아두면 로고를 고칠 때 어긋나므로 그때그때 잰다.
    p.y = p.el.getBBox().y;
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
        'orient 상태    : ' + (kv.orient || 'idle'),
        '기울기         : ' + (kv.tilt || '-'),
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

  // ══ 기울임 ══════════════════════════════════════════════════
  // 풍경은 중력으로 매달린다. 기기를 기울이면 획이 향하는 «아래»가 바뀌고,
  // 넷이 새 평형으로 흔들려 가다가 서로 부딪힌다. 소리는 그 결과지
  // 기울임에 직접 매인 것이 아니다 — 기울임과 소리가 각각 다른 뜻을 갖지 않는다.
  //
  // 넷이 같은 각도로 눕는데 어떻게 부딪히느냐면, 고유 진동수(w0)가 저마다
  // 어긋나 있어서 새 평형에 닿는 속도와 위상이 다르기 때문이다. 가는 도중에
  // 서로를 스친다. 다 눕고 나면 나란해져 조용해진다.
  //
  // gamma(좌우 기울기, -90~90)만 쓴다. 화면 평면에 매달린 물건이라 앞뒤
  // 기울기(beta)는 보이는 각도를 바꾸지 않는다. accelerationIncludingGravity
  // 로도 잴 수 있지만 iOS와 안드로이드가 부호를 반대로 줘서, 규격이 같은
  // gamma 쪽이 안전하다.

  var hang = 0;         // 획이 쉬어야 할 각도(도). 0이면 화면 아래쪽.
  var lastOrientT = 0;

  var BAR = PARTS[PARTS.length - 1];

  /**
   * 이 부분이 쉬어야 할 각도.
   * 막대는 화면에 매인 걸이라 기기를 기울여도 제자리다(0).
   * 획은 막대에 매달렸으니 «막대 기준»으로 보면, 막대가 돌아간 만큼
   * 평형이 반대로 밀린다. 이 한 줄이 이중진자의 전부다.
   */
  function equilibrium(p) {
    return p.tone === undefined ? 0 : hang - BAR.a;
  }

  function onOrient(e) {
    if (still || e.gamma === null || e.gamma === undefined) return;

    // 오른쪽으로 기울이면(gamma +) 획의 아래끝은 오른쪽으로 가야 한다.
    // 회전축이 위에 있어 아래끝을 오른쪽으로 보내는 건 음의 회전이다.
    var want = -e.gamma * CFG.tiltGain;
    if (want > CFG.tiltMax) want = CFG.tiltMax;
    if (want < -CFG.tiltMax) want = -CFG.tiltMax;

    // 손에 들고 있으면 gamma 가 늘 1~2도씩 떨린다. 그걸 그대로 따라가면
    // 획이 영영 안 멈추고 잘게 통통거린다. 이만큼은 벌어져야 움직인다.
    var diff = want - hang;
    if (Math.abs(diff) < CFG.tiltDead) return;

    // interval 은 기기마다 단위가 달라 못 믿는다. 직접 잰다.
    var now = e.timeStamp || performance.now();
    var dt = lastOrientT ? (now - lastOrientT) / 1000 : 0.016;
    lastOrientT = now;
    if (!(dt > 0.002 && dt < 0.2)) dt = 0.016;

    // 한 번에 옮기지 않고 초당 몇 도로 끌고 간다. 평형이 획보다 느리게
    // 움직이면 획은 매달려 따라오기만 한다 — 튀는 건 평형이 계단처럼
    // 건너뛸 때 생긴다.
    var step = CFG.tiltRate * dt;
    hang += Math.abs(diff) <= step ? diff : (diff > 0 ? step : -step);

    if (D.on) D.set('tilt', 'gamma ' + e.gamma.toFixed(1) + '° → 매달림 ' + hang.toFixed(1) + '°');
    start();
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
      // 복원력은 «화면 아래»가 아니라 «지금 아래»를 향한다.
      var eq = equilibrium(p);
      for (var i = 0; i < n; i++) {
        p.v += (-p.w0 * p.w0 * (p.a - eq) - 2 * p.zeta * p.w0 * p.v) * h;
        p.a += p.v * h;
      }
      if (p.a > p.max)  { p.a = p.max;  p.v *= -0.4; }
      if (p.a < -p.max) { p.a = -p.max; p.v *= -0.4; }
    });

    collide();

    var moving = false;
    PARTS.forEach(function (p) {
      if (Math.abs(p.a - equilibrium(p)) > 0.015 || Math.abs(p.v) > 0.05) moving = true;
      p.el.style.transform = 'rotate(' + p.a.toFixed(3) + 'deg)';
    });

    if (moving) {
      requestAnimationFrame(step);
    } else {
      running = false;
      PARTS.forEach(function (p) {
        // 기울여둔 채로 멈췄으면 기운 자세 그대로 선다. 똑바로 되돌리지 않는다.
        p.a = equilibrium(p);
        p.v = 0;
        p.el.style.transform = p.a ? 'rotate(' + p.a.toFixed(3) + 'deg)' : '';
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
        // 운동량은 지키고 반발계수만큼 튕긴다. 무게가 다르면 가벼운 쪽이
        // 더 멀리 튕겨 나가고 무거운 쪽은 덜 밀린다 — 넷을 같다고 두면
        // 누가 누구를 쳤든 결과가 똑같아진다.
        var e = CFG.restitution;
        var mt = a.m + b.m;
        var p = a.m * va + b.m * vb;
        var na = (p + b.m * e * (vb - va)) / mt;
        var nb = (p + a.m * e * (va - vb)) / mt;
        a.v = -na / (a.L * RAD);
        b.v = -nb / (b.L * RAD);
        chime(i, closing);

        // 닿은 자리. 두 가장자리가 만난 지점이니 x는 그 중간이고,
        // y는 축에서 획 길이만큼 내려온 곳 — 기울면 그만큼 덜 내려온다.
        ripple(i, (edgeA + edgeB) / 2, a.y + a.L * Math.cos(ra), closing);

        // 소리가 날 만한 세기로 부딪혔다. 여기서 길이 갈린다 —
        // 실제로 울렸으면 문이 열리고, 소리가 잠겨 있었으면 여는 법을 알린다.
        if (closing >= CFG.hitFloor) {
          if (ready()) showEnter();
          else hintSound();
        }
      }

      // 겹친 만큼 서로 밀어내 붙어버리는 걸 막는다. 밀리는 몫도 무게로
      // 나눈다 — 가벼운 쪽이 더 많이 비켜준다. 둘을 합치면 겹친 만큼이다.
      var mtot = a.m + b.m;
      a.a += (-gap * b.m / mtot) / (a.L * RAD);
      b.a -= (-gap * a.m / mtot) / (b.L * RAD);
    }
  }

  // ══ 파동 ════════════════════════════════════════════════════
  // 소리는 파동인데 눈에는 안 보인다. 부딪힌 자리에서 고리를 퍼뜨려
  // 그 파동을 배경에 그린다. 세기·크기·속도는 전부 충돌 세기에서 뽑되,
  // 음량을 정하는 것과 같은 식(1.4승)을 쓴다 — 크게 울린 것이 크게 퍼진다.
  //
  // 소리와 달리 오디오 상태를 보지 않는다. 볼륨을 내려둔 사람에게는
  // 이게 유일하게 남는 울림이다.

  var waves = document.getElementById('waves');
  var lastWave = [];

  function ripple(pair, vx, vy, closing) {
    if (!waves || still || closing < CFG.hitFloor) return;

    // 세게 흔들면 세 쌍이 쉬지 않고 부딪힌다. 고리가 쌓이면 화면이
    // 뭉개지므로 넘치면 그냥 그리지 않는다.
    if (waves.childElementCount > 8) return;

    // 한 번 부딪히면 몇 프레임에 걸쳐 겹쳐 판정된다. 소리와 같은 간격으로 솎는다.
    var now = performance.now();
    if (now - (lastWave[pair] || -9999) < 90) return;
    lastWave[pair] = now;

    // 넘겨받은 좌표는 «막대 기준»이다. 막대가 기울어 있으면 접촉 지점도
    // 그만큼 돌아가 있으므로, 막대 중심을 축으로 되돌려 viewBox 좌표를 얻는다.
    var rb = BAR.a * RAD;
    var cs = Math.cos(rb), sn = Math.sin(rb);
    var dx = vx - barCx, dy = vy - barCy;
    var wx = barCx + dx * cs - dy * sn;
    var wy = barCy + dx * sn + dy * cs;

    // viewBox 좌표 → 화면 좌표. 로고 크기가 화면마다 다르므로 그때그때 잰다.
    var r = mark.getBoundingClientRect();
    var x = r.left + wx / 1024 * r.width;
    var y = r.top + wy / 1024 * r.height;

    var vel = Math.pow(Math.min(closing / CFG.hitFull, 1), 1.4);
    var span = CFG.waveMin + (CFG.waveMax - CFG.waveMin) * vel;

    // 소리 하나에 고리 하나. 여러 개를 겹쳐 파문처럼 보이게 해봤지만
    // 화면이 지저분해질 뿐이었다. 세기 차이는 크기와 진하기로 이미 보인다.
    //
    // 크기와 진하기만 조금씩 흔든다. 속도는 흔들지 않는다 — 매질이 같으면
    // 파동의 속도도 같다. 세기는 얼마나 멀리 가느냐를 정하지 얼마나 빨리
    // 가느냐를 정하지 않는다. 속도가 제각각이면 같은 물 위가 아닌 게 된다.
    emit(x, y,
         span * rand(0.86, 1.14),
         vel * rand(0.85, 1.15),
         CFG.waveSpeed);
  }

  function emit(x, y, radius, strength, speed) {
    var el = document.createElement('div');
    el.className = 'wave';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    // 정원으로 둔다. 눌러 찌그러뜨려 봤지만 파동은 둥근 게 맞다.
    el.style.width = el.style.height = (radius * 2).toFixed(1) + 'px';
    // 띠는 넓어서 실선보다 훨씬 무겁게 보인다. 여기 있는 줄 모르고
    // 지나쳤다가 «방금 뭐가 지나갔나» 싶은 정도까지 낮춘다.
    el.style.setProperty('--peak', (0.035 + 0.13 * strength).toFixed(3));
    // 지속시간은 «얼마나 멀리를 그 속도로 가느냐»에서 나온다. 세게 부딪히면
    // 더 멀리 가니 더 오래 남는 것이지, 느리게 가는 게 아니다.
    el.style.animationDuration = Math.max(radius / speed, 0.35).toFixed(2) + 's';
    el.addEventListener('animationend', function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    waves.appendChild(el);
  }

  // ══ 들어가는 문 ═════════════════════════════════════════════
  // 화살표는 획끼리 부딪혀 실제로 소리가 난 뒤에야 드러난다.
  // 흔들어보기만 한 사람과 울려본 사람을 가르는 문턱이다.
  //
  // 신호가 온 자리에서 바로 띄우면 한창 흔들리는 와중에 묻힌다.
  // 한 박 쉬었다가, 움직임이 잦아들 즈음 스르르 밀려나오게 한다.

  var entered = false;

  function showEnter() {
    if (entered) return;
    entered = true;
    setTimeout(function () {
      var el = document.getElementById('enter');
      if (el) el.classList.add('on');
    }, CFG.enterDelay);
  }

  // ══ 소리 켜기 ═══════════════════════════════════════════════
  // 브라우저 정책상 소리를 열려면 클릭·탭이 한 번 필요한데, 빈 페이지에는
  // 그걸 알릴 방법이 없다. 상시 안내문을 놓는 대신 침묵 자체를 신호로 쓴다:
  // 소리가 났어야 할 바로 그 순간에 소리가 없으면, 그때 여는 법이 나타난다.
  // 소리가 이미 열린 사람에게는 한 번도 뜨지 않는다.

  var soundBtn = document.getElementById('sound');
  var hinted = false;

  function hintSound() {
    if (hinted || !soundBtn) return;
    hinted = true;
    soundBtn.classList.add('on');
  }

  function hideHint() {
    if (soundBtn) soundBtn.classList.remove('on');
  }

  if (soundBtn) {
    soundBtn.addEventListener('click', function () {
      // 여는 일 자체는 window의 unlock 리스너가 이미 했다. 여기서는 결과만 본다.
      // resume()이 끝날 틈을 주고 확인한다.
      setTimeout(function () {
        hideHint();
        // 눌렀는데도 안 열리는 기기가 있다(무음 스위치, 정책, 미지원).
        // 시도한 사람을 현관에 가둘 수는 없으니 소리 없이도 문을 연다.
        if (!ready()) showEnter();
      }, 600);
    });
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

    start();
  }

  // 기울기는 DeviceOrientation 이고, 흔들기는 DeviceMotion 이다. iOS 는
  // 이 둘의 권한을 따로 받는다 — 모션을 허락했다고 방향까지 열리지 않는다.
  var orientOn = false;

  function enableOrientation() {
    if (orientOn || !window.DeviceOrientationEvent) return;

    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      orientOn = true;   // 요청은 한 번만
      D.set('orient', '요청 중');
      DeviceOrientationEvent.requestPermission().then(function (state) {
        if (state === 'granted') {
          window.addEventListener('deviceorientation', onOrient);
          D.set('orient', 'on');
        } else {
          orientOn = false;
          D.set('orient', '거부됨(' + state + ')');
        }
      }).catch(function (err) {
        orientOn = false;
        D.set('orient', '요청실패: ' + (err && err.message ? err.message : err));
      });
    } else {
      window.addEventListener('deviceorientation', onOrient);
      orientOn = true;
      D.set('orient', 'on(권한불필요)');
    }
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

  // 소리가 열렸으면 여는 법을 알릴 이유가 없다. 어느 제스처로 열렸든 거둔다.
  function settled() {
    if (ready()) hideHint();
    D.show();
  }

  function unlock() {
    unmuteIOS();
    initAudio();
    if (audio.ctx && audio.ctx.state !== 'running' && audio.ctx.resume) {
      audio.ctx.resume().then(settled).catch(settled);
    }
    enableMotion();
    enableOrientation();
    settled();
  }

  ['pointerdown', 'touchstart', 'click'].forEach(function (ev) {
    window.addEventListener(ev, unlock);
  });

  console.log('느즈러짐 — 서울패를 운영합니다.');
  console.log('teamnzrz@gmail.com / @team.nzrz');
})();
