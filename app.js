// 풍경(風磬). 막대에 매달린 획 넷이 각자 감쇠 진자로 흔들린다.
//
// 정해진 애니메이션을 재생하는 게 아니라 매 프레임 물리를 푼다:
//   각가속도 = -ω₀²·θ  -  2ζω₀·θ'
//              (복원력)     (감쇠)
// 커서가 지나가면 지나간 방향·속도만큼 각속도(θ')를 더해준다.
// 속도를 더하는 방식이라 힘이 누적된다 — 리듬 맞춰 왔다갔다 하면
// 공명해서 점점 크게 흔들리고, 가만두면 스스로 잦아든다.

var stage = document.getElementById('stage');
var mark = document.getElementById('mark');
var still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// 각 획의 회전축 x좌표(viewBox 1024 기준)와 고유 진동수.
// ω₀를 일부러 조금씩 어긋나게 뒀다. 넷이 같은 박자로 흔들리면
// 기계처럼 보이는데, 어긋나 있으면 서로 위상이 밀리며 샤라랑거린다.
// L = 회전축에서 아래끝까지 길이, oxL/oxR = 아랫부분 좌우 가장자리의 축 기준 오프셋.
// 전부 logo.svg 패스에서 실측한 값이다. 충돌 판정에 쓴다.
var PARTS = [
  { sel: '.leg-1', tone: 0, x: 150.0, L: 373.4, oxL: -19.7, oxR: 111.1, w0: 6.1,  zeta: 0.055, gain: 1.00, max: 19 },
  { sel: '.leg-2', tone: 1, x: 386.7, L: 368.1, oxL: -79.3, oxR:  90.6, w0: 7.3,  zeta: 0.050, gain: 0.90, max: 16 },
  { sel: '.leg-3', tone: 2, x: 601.2, L: 368.6, oxL: -73.5, oxR:  72.9, w0: 6.7,  zeta: 0.052, gain: 0.95, max: 17 },
  { sel: '.leg-4', tone: 3, x: 814.7, L: 366.1, oxL: -84.6, oxR:  86.3, w0: 7.9,  zeta: 0.048, gain: 0.85, max: 15 },
  // 막대는 걸이라서 훨씬 뻣뻣하고 조금만 움직인다. 부딪히지 않는다.
  { sel: '.bar',   x: 517.4, w0: 13.0, zeta: 0.140, gain: 0.16, max: 3 }
];

var LEGS = PARTS.slice(0, 4);
var RAD = Math.PI / 180;
var REST = 0.55;   // 반발계수 — 부딪히면 이만큼 튕겨 나간다

var SIGMA = 190;   // 커서 영향이 퍼지는 범위(viewBox 단위). 다리 간격이 ~210이라
                   // 이 정도면 옆 다리도 약하게 딸려 흔들리며 물결이 생긴다.

var REF = 2600;    // 기준 속도(viewBox단위/초). 화면상 약 460px/초 — 평범한 스윕.
var DRIVE = 0.36;  // 커서가 1단위 지나갈 때 밀어주는 각속도(도/초)

PARTS.forEach(function (p) {
  p.el = mark.querySelector(p.sel);
  p.a = 0;   // 각도(도)
  p.v = 0;   // 각속도(도/초)
});

var lastX = null, lastT = 0, running = false;

// ── 소리 ─────────────────────────────────────────────────────
// 음원 파일 없이 Web Audio로 합성한다. 획마다 음 하나씩, 5음계.
// 브라우저 자동재생 정책 때문에 사용자가 한 번 클릭해야 열린다.

// 장5음계 4음(레·미·솔·라). 왼쪽부터 낮은 음.
// 한 옥타브 올렸다 — 낮으면 웅웅거리고 높아야 청아하게 들린다.
var TONE = [587.33, 659.25, 783.99, 880.00];

// 풍경은 종이 아니라 양끝이 자유로운 금속 관이다. 관의 진동 모드는
// 정수배가 아니라 1 : 2.756 : 5.404 : 8.933 로 벌어져 있다.
// 이 비율이 "음정 같으면서도 음정 아닌" 금속 울림의 정체다.
// 다만 높은 모드를 다 살리면 쨍그랑거려서 탁해진다. 기음을 길게 남기고
// 위쪽은 확 줄여서 처음만 반짝이고 곧 맑은 기음만 남게 했다.
var MODES = [
  // [배수,   세기,  지속(초)]
  [ 1.000,   1.00,  7.0 ],
  [ 2.756,   0.34,  2.4 ],
  [ 5.404,   0.10,  0.9 ],
  [ 8.933,   0.03,  0.35]
];

var ac = null, bus = null, noise = null;

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
  if (ac) return;
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();

  bus = ac.createGain();
  bus.gain.value = 0.9;

  // 때리는 순간의 쇳소리용 노이즈. 한 번 만들어 재사용한다.
  noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.25), ac.sampleRate);
  var nd = noise.getChannelData(0);
  for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  var wet = ac.createGain();
  wet.gain.value = 0.6;
  var verb = makeReverb(ac, 4.0, 2.2);

  bus.connect(ac.destination);   // 직접음
  bus.connect(verb);             // 잔향
  verb.connect(wet);
  wet.connect(ac.destination);

  console.log('소리가 켜졌습니다. 마크 위로 마우스를 지나가 보세요.');
}

// 첫 클릭에 오디오를 연다 (사파리·크롬 모두 사용자 제스처를 요구한다)
window.addEventListener('pointerdown', function () {
  initAudio();
  if (ac && ac.state === 'suspended') ac.resume();
}, { once: true });

function strike(freq, vel) {
  var t = ac.currentTime;
  var out = ac.createGain();
  out.gain.value = 0.42;

  // 실제 관은 때릴 때마다 미세하게 다르게 운다
  var detune = 1 + (Math.random() - 0.5) * 0.006;

  MODES.forEach(function (m) {
    var osc = ac.createOscillator();
    var g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * m[0] * detune;

    // 높은 모드일수록 세게 때려야 살아난다 — 세게 칠수록 밝아지는 이유
    var peak = vel * m[1] * 0.16 * (0.45 + 0.55 * vel);
    var dur = m[2] * (0.85 + 0.3 * vel);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  });

  // 닿는 순간의 반짝임. 세게 깔면 쇳덩이 부딪는 소리가 되니 아주 얇게,
  // 높은 대역만 스치듯 넣는다.
  var src = ac.createBufferSource();
  src.buffer = noise;
  var bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq * 9;
  bp.Q.value = 0.7;
  var ng = ac.createGain();
  ng.gain.setValueAtTime(vel * 0.03, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);

  src.connect(bp); bp.connect(ng); ng.connect(out);
  src.start(t);
  src.stop(t + 0.06);

  out.connect(bus);
}

// 커서가 획을 스치고 지나갈 때. 부딪히는 소리보다 훨씬 여리게 —
// 손끝으로 건드린 정도지 때린 게 아니다.
function brush(p, speed) {
  if (!ac || ac.state !== 'running') return;
  if (p.tone === undefined) return;              // 막대는 울지 않는다
  if (speed < 0.06) return;                      // 기어가듯 지나가면 무음

  var now = ac.currentTime;
  if (now - (p.lastBrush || -9) < 0.12) return;

  p.lastBrush = now;
  strike(TONE[p.tone], Math.min(speed, 1) * 0.42);
}

// 이웃한 두 다리가 부딪혔을 때 둘 다 운다.
function chime(pairIndex, closingSpeed) {
  if (!ac || ac.state !== 'running') return;

  var now = ac.currentTime;
  chime.last = chime.last || [];
  if (now - (chime.last[pairIndex] || -9) < 0.09) return;   // 같은 쌍 연타 방지
  if (closingSpeed < 12) return;                            // 살짝 스친 건 무시

  chime.last[pairIndex] = now;
  var vel = Math.min(closingSpeed / 220, 1);

  strike(TONE[pairIndex], vel);
  strike(TONE[pairIndex + 1], vel * 0.8);
}

function push(e) {
  if (still) return;
  var r = mark.getBoundingClientRect();
  var ux = (e.clientX - r.left) / r.width * 1024;   // 화면 → viewBox 좌표
  var now = e.timeStamp;

  if (lastX !== null) {
    var dt = (now - lastT) / 1000;
    if (dt > 0.001 && dt < 0.2) {
      var dx = ux - lastX;                           // 이번에 지나간 거리
      var vx = dx / dt;                              // viewBox단위/초

      // 세기는 '얼마나 지나갔나'(dx)에 비례시킨다. 이벤트가 몇 개 오든
      // 총합이 이동거리로 정해져서 마우스 성능에 안 휘둘린다.
      // 거기에 속도 계수를 곱하되 tanh로 눌러서, 빠를수록 세지긴 하되
      // 휙 그어도 위로 튀지 않게 한다.
      var speed = Math.tanh(Math.abs(vx) / REF);

      PARTS.forEach(function (p) {
        var d = (ux - p.x) / SIGMA;
        var falloff = Math.exp(-d * d);              // 가까울수록 세게
        // 커서가 오른쪽으로 가면 획의 아래쪽도 오른쪽으로 —
        // 회전축이 위에 있어서 부호가 반대다
        p.v -= DRIVE * dx * p.gain * falloff * speed;

        // 커서가 그 획을 '가로지르는 순간'에만 스치듯 울린다.
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

function step(now) {
  var dt = Math.min((now - step.prev || 16) / 1000, 0.05);
  step.prev = now;

  var moving = false;
  // 큰 각속도에서도 발산하지 않게 잘게 쪼개 적분한다
  var n = 4, h = dt / n;
  PARTS.forEach(function (p) {
    for (var i = 0; i < n; i++) {
      p.v += (-p.w0 * p.w0 * p.a - 2 * p.zeta * p.w0 * p.v) * h;
      p.a += p.v * h;
    }
    if (p.a > p.max)  { p.a = p.max;  p.v *= -0.4; }   // 끝까지 가면 튕긴다
    if (p.a < -p.max) { p.a = -p.max; p.v *= -0.4; }
  });

  collide();

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

// 이웃한 다리끼리 부딪히는지 본다. 풍경은 마우스가 닿아서가 아니라
// 서로 부딪혀서 소리가 난다.
function collide() {
  for (var i = 0; i < LEGS.length - 1; i++) {
    var a = LEGS[i], b = LEGS[i + 1];
    var ra = a.a * RAD, rb = b.a * RAD;

    // 회전한 뒤 마주보는 가장자리의 실제 x 위치
    var edgeA = a.x + a.oxR * Math.cos(ra) - a.L * Math.sin(ra);
    var edgeB = b.x + b.oxL * Math.cos(rb) - b.L * Math.sin(rb);
    var gap = edgeB - edgeA;
    if (gap >= 0) continue;                    // 아직 안 닿음

    // 아래끝의 좌우 속도 (각속도가 +면 아래끝은 왼쪽으로 간다)
    var va = -a.L * a.v * RAD;
    var vb = -b.L * b.v * RAD;
    var closing = va - vb;                     // +면 서로 다가오는 중

    if (closing > 0) {
      // 질량이 같다고 보고 반발계수 REST로 속도를 교환한다
      var na = ((1 - REST) * va + (1 + REST) * vb) / 2;
      var nb = ((1 + REST) * va + (1 - REST) * vb) / 2;
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

function start() {
  if (running) return;
  running = true;
  step.prev = 0;
  requestAnimationFrame(step);
}

stage.addEventListener('mousemove', push);
stage.addEventListener('mouseleave', function () { lastX = null; });

console.log('느즈러짐 — 서울패를 운영합니다.');
console.log('아무데나 한 번 클릭하면 소리가 납니다.');
console.log('teamnzrz@gmail.com / @team.nzrz');
