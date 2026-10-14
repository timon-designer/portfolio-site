/* =========================================================
   首屏全屏背景 · Floating Lines
   ---------------------------------------------------------
   来源：reactbits.dev 的 FloatingLines 组件
        （github.com/DavidHDev/react-bits，MIT License）
        参数：lineDistance 50 / bendStrength -4.5 / bendRadius 12.5 /
              animationSpeed 2 / 渐变 #f32c71 → #b549f4 → #7d9dee

   为什么是原生 WebGL2、而不是直接装 React 组件？
   ---------------------------------------------------------
   原组件用 three.js，但整幅画面 100% 由 fragment shader 生成，
   three 在里面只承担三件事：
     · 创建 WebGL context
     · 编译 / 链接 shader
     · 画一个铺满屏幕的矩形（PlaneGeometry(2,2) + 正交相机）
   也就是说 three 只是个"壳"。这里用原生 WebGL2 复刻同一份 shader，
   把这层壳直接去掉 —— 本目录的站点是「零构建依赖」的静态站，
   为一张背景引入 React + ReactDOM + three（合计 300KB+ gzip，
   还要先上打包器）完全不划算。
   shader 逐字保留，所以视觉与官方组件一致。

   参数从哪来？
   ---------------------------------------------------------
   页面里放一个 <div class="hero-bg"> 容器，用 data-bg-* 传参，
   参数在 content/site.config.js 的 heroBg 里配。
   本模块自己找 .hero-bg，找不到就整个跳过（其他页面不受影响）。

   性能上做了四件事（详见文末「降级策略」）：
     · 像素密度上限 2x，并按实测帧率自动降到 1x
     · 滚出视口 / 切到别的标签页 → 停掉渲染循环
     · 系统开了「减少动态效果」→ 只画一帧静态图
     · 不支持 WebGL2 → 静默跳过，页面照常
   ========================================================= */

(function () {
  'use strict';

  /* ---------- 00 · 调试钩子 ----------
     失败原因记在 window.__heroBg.error 上，不静默吞掉 ——
     否则无头验证时只能看到「背景没出来」，分不清是没挂载、
     没 WebGL2、还是 shader 编译挂了。 */
  var DBG = window.__heroBg = { ok: false, error: '' };

  /* ---------- 01 · 找挂载点 ---------- */
  var host = document.querySelector('.hero-bg');
  if (!host) { DBG.error = 'no-host'; return; }   // 非首页，正常跳过

  /* ---------- 02 · 读参数（缺省回落到官方默认值） ---------- */
  function num(name, fallback) {
    var raw = host.getAttribute('data-bg-' + name);
    if (raw === null || raw === '') return fallback;
    var v = parseFloat(raw);
    return isFinite(v) ? v : fallback;
  }

  function hexList(name) {
    var raw = (host.getAttribute('data-bg-' + name) || '').trim();
    if (!raw) return [];
    return raw.split(',')
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .slice(0, 8);                         // shader 里数组上限是 8
  }

  var CFG = {
    lineDistance: num('lines', 5),          // 官方 lineDistance，默认 [5]
    lineCount: num('count', 6),             // 官方 lineCount，默认 [6]
    bendStrength: num('bend', -0.5),        // 官方 bendStrength
    bendRadius: num('radius', 5),           // 官方 bendRadius
    animationSpeed: num('speed', 1),        // 官方 animationSpeed
    mouseDamping: num('damping', 0.05),     // 官方 mouseDamping
    parallaxStrength: num('parallax', 0.2), // 官方 parallaxStrength
    gradient: hexList('gradient')           // 官方 linesGradient
  };

  /* 三个波层的位移/旋转，取官方默认值：
       top    { x: 10.0, y: 0.5,  rotate: -0.4 }
       middle { x: 5.0,  y: 0.0,  rotate:  0.2 }
       bottom { x: 2.0,  y: -0.7, rotate: -1.0 }
     注意 bottom 的 rotate 是 -1.0：组件签名里的默认对象写的是 -1，
     它会盖掉 uniforms 表里那个 0.4 的兜底值。这里跟随组件实际行为。 */
  var WAVE_TOP = [10.0, 0.5, -0.4];
  var WAVE_MID = [5.0, 0.0, 0.2];
  var WAVE_BOT = [2.0, -0.7, -1.0];

  /* 官方把线距乘了 0.01 再进 shader；标量会对三层同时生效
     （传数组时索引 1、2 会掉到兜底值 0.1，三层粗细不均，所以用标量） */
  var LINE_DISTANCE = CFG.lineDistance * 0.01;

  /* ---------- 03 · 动效偏好 ---------- */
  /* <html data-opt-motion="on|off"> 由构建时写入：
       on  → 无视系统设置强制播（本站默认）
       off → 一律不动
       缺省 → 跟随系统 */
  var html = document.documentElement;
  var motionMode = html.getAttribute('data-opt-motion') || 'auto';
  var reduceMotion = motionMode === 'off' ||
    (motionMode !== 'on' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- 04 · 建 context ---------- */
  /* 用 WebGL2：官方 shader 里 lineGradient[idx] 是「变量下标」访问 uniform 数组，
     GLSL ES 1.00（WebGL1）不允许这种动态索引，WebGL2 可以。
     three.js 内部同样是把 shader 转成 GLSL ES 3.00 再编译，所以行为一致。 */
  var canvas = document.createElement('canvas');
  var gl = canvas.getContext('webgl2', {
    alpha: false,          // 不透明：黑色基底靠 mix-blend-mode:screen 融进页面底色
    antialias: true,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: false
  });

  if (!gl) { DBG.error = 'no-webgl2'; return; }   // 没有 WebGL2 → 首屏照常显示

  /* ---------- 05 · shader（逐字照搬官方，仅转 GLSL ES 3.00 语法） ---------- */
  var VERT_SRC = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 aPos;',
    'void main() {',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAG_SRC = [
    '#version 300 es',
    'precision highp float;',
    '',
    'uniform float iTime;',
    'uniform vec3  iResolution;',
    'uniform float animationSpeed;',
    '',
    'uniform bool enableTop;',
    'uniform bool enableMiddle;',
    'uniform bool enableBottom;',
    '',
    'uniform int topLineCount;',
    'uniform int middleLineCount;',
    'uniform int bottomLineCount;',
    '',
    'uniform float topLineDistance;',
    'uniform float middleLineDistance;',
    'uniform float bottomLineDistance;',
    '',
    'uniform vec3 topWavePosition;',
    'uniform vec3 middleWavePosition;',
    'uniform vec3 bottomWavePosition;',
    '',
    'uniform vec2 iMouse;',
    'uniform bool interactive;',
    'uniform float bendRadius;',
    'uniform float bendStrength;',
    'uniform float bendInfluence;',
    '',
    'uniform bool parallax;',
    'uniform float parallaxStrength;',
    'uniform vec2 parallaxOffset;',
    '',
    'uniform vec3 lineGradient[8];',
    'uniform int lineGradientCount;',
    'uniform vec3 backgroundColor;',
    'uniform bool lightMode;',
    '',
    'out vec4 outColor;',
    '',
    'const vec3 BLACK = vec3(0.0);',
    'const vec3 PINK  = vec3(233.0, 71.0, 245.0) / 255.0;',
    'const vec3 BLUE  = vec3(47.0,  75.0, 162.0) / 255.0;',
    '',
    'mat2 rotate(float r) {',
    '  return mat2(cos(r), sin(r), -sin(r), cos(r));',
    '}',
    '',
    'vec3 background_color(vec2 uv) {',
    '  vec3 col = vec3(0.0);',
    '',
    '  float y = sin(uv.x - 0.2) * 0.3 - 0.1;',
    '  float m = uv.y - y;',
    '',
    '  col += mix(BLUE, BLACK, smoothstep(0.0, 1.0, abs(m)));',
    '  col += mix(PINK, BLACK, smoothstep(0.0, 1.0, abs(m - 0.8)));',
    '  return col * 0.5;',
    '}',
    '',
    'vec3 getLineColor(float t, vec3 baseColor) {',
    '  if (lineGradientCount <= 0) {',
    '    return baseColor;',
    '  }',
    '',
    '  vec3 gradientColor;',
    '',
    '  if (lineGradientCount == 1) {',
    '    gradientColor = lineGradient[0];',
    '  } else {',
    '    float clampedT = clamp(t, 0.0, 0.9999);',
    '    float scaled = clampedT * float(lineGradientCount - 1);',
    '    int idx = int(floor(scaled));',
    '    float f = fract(scaled);',
    '    int idx2 = min(idx + 1, lineGradientCount - 1);',
    '',
    '    vec3 c1 = lineGradient[idx];',
    '    vec3 c2 = lineGradient[idx2];',
    '',
    '    gradientColor = mix(c1, c2, f);',
    '  }',
    '',
    '  return gradientColor * 0.5;',
    '}',
    '',
    'float wave(vec2 uv, float offset, vec2 screenUv, vec2 mouseUv, bool shouldBend) {',
    '  float time = iTime * animationSpeed;',
    '',
    '  float x_offset   = offset;',
    '  float x_movement = time * 0.1;',
    '  float amp        = sin(offset + time * 0.2) * 0.3;',
    '  float y          = sin(uv.x + x_offset + x_movement) * amp;',
    '',
    '  if (shouldBend) {',
    '    vec2 d = screenUv - mouseUv;',
    '    float influence = exp(-dot(d, d) * bendRadius);',
    '    float bendOffset = (mouseUv.y - screenUv.y) * influence * bendStrength * bendInfluence;',
    '    y += bendOffset;',
    '  }',
    '',
    '  float m = uv.y - y;',
    '  return 0.0175 / max(abs(m) + 0.01, 1e-3) + 0.01;',
    '}',
    '',
    'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
    '  vec2 baseUv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;',
    '  baseUv.y *= -1.0;',
    '',
    '  if (parallax) {',
    '    baseUv += parallaxOffset;',
    '  }',
    '',
    '  vec3 col = vec3(0.0);',
    '',
    '  vec3 b = lineGradientCount > 0 ? vec3(0.0) : background_color(baseUv);',
    '',
    '  vec2 mouseUv = vec2(0.0);',
    '  if (interactive) {',
    '    mouseUv = (2.0 * iMouse - iResolution.xy) / iResolution.y;',
    '    mouseUv.y *= -1.0;',
    '  }',
    '',
    '  if (enableBottom) {',
    '    for (int i = 0; i < bottomLineCount; ++i) {',
    '      float fi = float(i);',
    '      float t = fi / max(float(bottomLineCount - 1), 1.0);',
    '      vec3 lineCol = getLineColor(t, b);',
    '',
    '      float angle = bottomWavePosition.z * log(length(baseUv) + 1.0);',
    '      vec2 ruv = baseUv * rotate(angle);',
    '      col += lineCol * wave(',
    '        ruv + vec2(bottomLineDistance * fi + bottomWavePosition.x, bottomWavePosition.y),',
    '        1.5 + 0.2 * fi,',
    '        baseUv,',
    '        mouseUv,',
    '        interactive',
    '      ) * 0.2;',
    '    }',
    '  }',
    '',
    '  if (enableMiddle) {',
    '    for (int i = 0; i < middleLineCount; ++i) {',
    '      float fi = float(i);',
    '      float t = fi / max(float(middleLineCount - 1), 1.0);',
    '      vec3 lineCol = getLineColor(t, b);',
    '',
    '      float angle = middleWavePosition.z * log(length(baseUv) + 1.0);',
    '      vec2 ruv = baseUv * rotate(angle);',
    '      col += lineCol * wave(',
    '        ruv + vec2(middleLineDistance * fi + middleWavePosition.x, middleWavePosition.y),',
    '        2.0 + 0.15 * fi,',
    '        baseUv,',
    '        mouseUv,',
    '        interactive',
    '      );',
    '    }',
    '  }',
    '',
    '  if (enableTop) {',
    '    for (int i = 0; i < topLineCount; ++i) {',
    '      float fi = float(i);',
    '      float t = fi / max(float(topLineCount - 1), 1.0);',
    '      vec3 lineCol = getLineColor(t, b);',
    '',
    '      float angle = topWavePosition.z * log(length(baseUv) + 1.0);',
    '      vec2 ruv = baseUv * rotate(angle);',
    '      ruv.x *= -1.0;',
    '      col += lineCol * wave(',
    '        ruv + vec2(topLineDistance * fi + topWavePosition.x, topWavePosition.y),',
    '        1.0 + 0.2 * fi,',
    '        baseUv,',
    '        mouseUv,',
    '        interactive',
    '      ) * 0.1;',
    '    }',
    '  }',
    '',
    '  if (lightMode) {',
    '    vec3 energy = max(col, vec3(0.0));',
    '    float peak = max(energy.r, max(energy.g, energy.b));',
    '    float coverage = smoothstep(0.018, 0.5, peak);',
    '    vec3 chroma = clamp(energy / max(peak, 0.0001), 0.0, 1.0);',
    '    chroma = pow(chroma, vec3(1.35));',
    '    float chromaPeak = max(chroma.r, max(chroma.g, chroma.b));',
    '    chroma /= max(chromaPeak, 0.0001);',
    '    vec3 ink = mix(chroma, clamp(chroma * 0.82, 0.0, 1.0), smoothstep(0.5, 1.0, coverage));',
    '    fragColor = vec4(mix(vec3(1.0), ink, coverage * 0.94), 1.0);',
    '  } else {',
    '    fragColor = vec4(col, 1.0);',
    '  }',
    '}',
    '',
    'void main() {',
    '  vec4 color = vec4(0.0);',
    '  mainImage(color, gl_FragCoord.xy);',
    '  outColor = color;',
    '}'
  ].join('\n');

  /* ---------- 06 · 编译链接 ---------- */
  var compileLog = '';
  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      compileLog += (compileLog ? ' | ' : '') + gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT_SRC);
  var fs = vs && compile(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) { DBG.error = 'shader-compile: ' + compileLog; return; }

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    DBG.error = 'program-link: ' + gl.getProgramInfoLog(prog);
    return;
  }

  gl.useProgram(prog);

  /* ---------- 07 · 全屏矩形 ---------- */
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1
  ]), gl.STATIC_DRAW);

  var aPos = gl.getAttribLocation(prog, 'aPos');
  if (aPos >= 0) {
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  }

  /* ---------- 08 · uniform 句柄 ---------- */
  var U = {};
  [
    'iTime', 'iResolution', 'animationSpeed',
    'enableTop', 'enableMiddle', 'enableBottom',
    'topLineCount', 'middleLineCount', 'bottomLineCount',
    'topLineDistance', 'middleLineDistance', 'bottomLineDistance',
    'topWavePosition', 'middleWavePosition', 'bottomWavePosition',
    'iMouse', 'interactive', 'bendRadius', 'bendStrength', 'bendInfluence',
    'parallax', 'parallaxStrength', 'parallaxOffset',
    'lineGradient', 'lineGradientCount', 'backgroundColor', 'lightMode'
  ].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

  /* 数组 uniform：优先用 [0] 取首元素地址，取不到再退回数组名 */
  if (!U.lineGradient) U.lineGradient = gl.getUniformLocation(prog, 'lineGradient[0]');

  /* uniform 传值一律判空 —— GLSL 编译器会优化掉没用到的 uniform，
     被优化掉的 getUniformLocation 返回 null，直接 set 会报错 */
  function set1f(n, v) { if (U[n]) gl.uniform1f(U[n], v); }
  function set1i(n, v) { if (U[n]) gl.uniform1i(U[n], v); }
  function set2f(n, a, b) { if (U[n]) gl.uniform2f(U[n], a, b); }
  function set3f(n, a, b, c) { if (U[n]) gl.uniform3f(U[n], a, b, c); }

  /* ---------- 09 · 一次性静态 uniform ---------- */
  set1f('animationSpeed', CFG.animationSpeed);
  set1i('interactive', 1);
  set1i('parallax', 1);
  set1f('bendRadius', CFG.bendRadius);
  set1f('bendStrength', CFG.bendStrength);
  set1f('parallaxStrength', CFG.parallaxStrength);
  set1i('lightMode', 0);                 // 深色站，走暗色分支
  set3f('backgroundColor', 0, 0, 0);

  set1i('enableTop', 1);
  set1i('enableMiddle', 1);
  set1i('enableBottom', 1);
  set1i('topLineCount', CFG.lineCount);
  set1i('middleLineCount', CFG.lineCount);
  set1i('bottomLineCount', CFG.lineCount);
  set1f('topLineDistance', LINE_DISTANCE);
  set1f('middleLineDistance', LINE_DISTANCE);
  set1f('bottomLineDistance', LINE_DISTANCE);
  set3f('topWavePosition', WAVE_TOP[0], WAVE_TOP[1], WAVE_TOP[2]);
  set3f('middleWavePosition', WAVE_MID[0], WAVE_MID[1], WAVE_MID[2]);
  set3f('bottomWavePosition', WAVE_BOT[0], WAVE_BOT[1], WAVE_BOT[2]);

  function hexToRgb(hex) {
    var v = String(hex).trim().replace(/^#/, '');
    if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    var n = parseInt(v, 16);
    if (!isFinite(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  var stops = CFG.gradient.slice(0, 8);
  set1i('lineGradientCount', stops.length);
  if (stops.length && U.lineGradient) {
    var flat = new Float32Array(24);     // 8 色 × RGB
    stops.forEach(function (h, i) {
      var c = hexToRgb(h);
      flat[i * 3] = c[0];
      flat[i * 3 + 1] = c[1];
      flat[i * 3 + 2] = c[2];
    });
    gl.uniform3fv(U.lineGradient, flat);
  }

  /* ---------- 10 · 尺寸与像素密度 ---------- */
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var degraded = false;

  function resize() {
    var w = host.clientWidth || 0;
    var h = host.clientHeight || 0;
    if (!w || !h) return false;

    var pw = Math.max(1, Math.round(w * dpr));
    var ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width === pw && canvas.height === ph) return false;

    canvas.width = pw;
    canvas.height = ph;
    gl.viewport(0, 0, pw, ph);
    set3f('iResolution', pw, ph, 1);
    return true;
  }

  resize();
  host.appendChild(canvas);

  /* ---------- 11 · 鼠标交互 ---------- */
  var targetMouse = [-1000, -1000];
  var curMouse = [-1000, -1000];
  var targetInfluence = 0;
  var curInfluence = 0;
  var targetParallax = [0, 0];
  var curParallax = [0, 0];

  /* 跟着 .hero 走而不是 canvas —— canvas 是 pointer-events:none，
     收不到事件；同时限定在最外层的 hero 容器内，不打扰别的区块 */
  var heroRoot = host.parentElement || host;

  function onMove(e) {
    var r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;

    var x = e.clientX - r.left;
    var y = e.clientY - r.top;

    targetMouse[0] = x * dpr;
    targetMouse[1] = (r.height - y) * dpr;   // shader 的 y 轴朝上
    targetInfluence = 1;

    targetParallax[0] = ((x - r.width / 2) / r.width) * CFG.parallaxStrength;
    targetParallax[1] = (-(y - r.height / 2) / r.height) * CFG.parallaxStrength;
  }

  function onLeave() { targetInfluence = 0; }

  heroRoot.addEventListener('pointermove', onMove, { passive: true });
  heroRoot.addEventListener('pointerleave', onLeave, { passive: true });

  /* ---------- 12 · 渲染循环 ---------- */
  var raf = 0;
  var t0 = 0;
  var running = false;
  var visible = true;        // 是否在视口内
  var awake = true;          // 标签页是否在前台
  var fpsAcc = 0;
  var fpsN = 0;
  var lastTs = 0;

  function lerp(a, b, t) { return a + (b - a) * t; }

  function draw(now) {
    if (!t0) t0 = now;
    set1f('iTime', (now - t0) / 1000);

    curMouse[0] = lerp(curMouse[0], targetMouse[0], CFG.mouseDamping);
    curMouse[1] = lerp(curMouse[1], targetMouse[1], CFG.mouseDamping);
    set2f('iMouse', curMouse[0], curMouse[1]);

    curInfluence = lerp(curInfluence, targetInfluence, CFG.mouseDamping);
    set1f('bendInfluence', curInfluence);

    curParallax[0] = lerp(curParallax[0], targetParallax[0], CFG.mouseDamping);
    curParallax[1] = lerp(curParallax[1], targetParallax[1], CFG.mouseDamping);
    set2f('parallaxOffset', curParallax[0], curParallax[1]);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /* 降级：18 条线全屏跑 shader，在 2x 像素密度下对集显偏重。
     连续 90 帧平均低于 45fps 就把像素密度压到 1x（只降一次）。 */
  function watchFps(now) {
    if (lastTs) {
      var dt = now - lastTs;
      if (dt > 0) { fpsAcc += 1000 / dt; fpsN += 1; }
      if (fpsN >= 90) {
        if (!degraded && dpr > 1 && fpsAcc / fpsN < 45) {
          degraded = true;
          dpr = 1;
          resize();
        }
        fpsAcc = 0;
        fpsN = 0;
      }
    }
    lastTs = now;
  }

  function loop(now) {
    if (!running) return;
    draw(now);
    watchFps(now);
    raf = window.requestAnimationFrame(loop);
  }

  function start() {
    if (running || reduceMotion || !visible || !awake) return;
    running = true;
    lastTs = 0;
    raf = window.requestAnimationFrame(loop);
  }

  function stop() {
    if (!running) return;
    running = false;
    window.cancelAnimationFrame(raf);
    raf = 0;
  }

  function sync() {
    if (visible && awake) start(); else stop();
  }

  /* ---------- 13 · 降级策略 ---------- */

  /* 系统要求减少动态 → 只画一帧静态图，之后不再占 GPU */
  if (reduceMotion) {
    resize();
    draw(0);
  } else {
    /* 滚出首屏就停：首页很长，没必要为看不见的动画烧电 */
    if (typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        sync();
      }, { threshold: 0 }).observe(host);
    }

    /* 切到别的标签页 → 停 */
    document.addEventListener('visibilitychange', function () {
      awake = !document.hidden;
      sync();
    }, { passive: true });

    /* 首屏尺寸随内容/字体变化 → 重算 */
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () {
        if (resize() && reduceMotion) draw(0);
      }).observe(host);
    } else {
      window.addEventListener('resize', function () { resize(); }, { passive: true });
    }

    /* 等首屏加载动画结束再进场，避免跟 loader 抢 GPU；
       没有 loader 就等两帧（确保布局已经稳定，量到的尺寸是对的） */
    (function whenReady(fn) {
      if (html.classList.contains('is-loading')) {
        var mo = new MutationObserver(function () {
          if (!html.classList.contains('is-loading')) {
            mo.disconnect();
            fn();
          }
        });
        mo.observe(html, { attributes: true, attributeFilter: ['class'] });
      } else {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(fn);
        });
      }
    })(function () {
      resize();
      sync();
    });
  }

  /* 调试钩子：自动化验证用 */
  DBG.ok = !!canvas.parentElement;
  DBG.error = '';
  DBG.ready = function () { return !!canvas.parentElement; };
  DBG.frames = function () { return running; };
  DBG.stop = stop;
  DBG.start = start;
  DBG.degraded = function () { return degraded; };
  DBG.reduce = function () { return reduceMotion; };
  DBG.size = function () { return [canvas.width, canvas.height]; };
  DBG.hostSize = function () { return [host.clientWidth, host.clientHeight]; };
  DBG.config = function () { return CFG; };

})();
