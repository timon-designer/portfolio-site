/* =========================================================
   全站交互运行时
   ---------------------------------------------------------
   纯原生 JS，零框架、零 CDN。所有交互按模块分隔，
   每个模块自己判断「当前页面有没有对应元素」，没有就跳过。

   动效清单
   01 配置读取          从 <html> 上的 data-* 读站点开关
   02 平滑滚动          Lenis，加载失败自动退回原生
   03 进场加载          问候语轮播 + 上下圆角面板翻开
   04 自定义光标        小点即时跟随 + 圆环缓动 + View 标签
   05 滚动揭示          上浮淡入 / 逐行推入 / 图片遮罩 / 分隔线生长
   06 磁吸按钮          data-strength 控制位移像素
   07 鼠标跟随预览      作品行 hover 浮出图片
   08 顶栏              下滚隐藏 / 上滚出现 / 当前页高亮
   09 全屏菜单          开 / 关 / Esc / 锁滚动
   10 页面切换转场      5 列面板扫屏，跨真实页面导航
   11 作品页            筛选 + 列表/网格切换
   12 视差              首屏照片、页脚
   13 数字滚动计数      详情页数据块
   14 本地时钟          页脚时区时间
   15 联系表单          有接口就提交，没接口就转邮件
   16 点击复制          菜单/页脚的联系方式，点一下复制账号
   ========================================================= */

(function () {
  'use strict';

  var doc = document.documentElement;
  var body = document.body;

  /* ---------- 能力探测 ---------- */
  /* 动效模式由构建时写在 <html data-opt-motion="on|off"> 上：
       on   → 强制播（无视系统「减少动态效果」）
       off  → 一律不播
       缺省 → 跟随系统设置 */
  var motionMode = doc.getAttribute('data-opt-motion') || 'auto';
  var reduceMotion = motionMode === 'off' ||
    (motionMode !== 'on' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var EASE = 'cubic-bezier(.7, 0, .3, 1)';

  /* ---------- 小工具 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function on(el, ev, fn, opt) { if (el) el.addEventListener(ev, fn, opt); }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }

  /* =======================================================
     01. 站点开关
     构建时把 content/site.config.js 的 sections 写到 <html data-opt-*>。
     ★ 开关必须带 opt- 前缀：<html> 上裸写 data-xxx 有过血的教训 ——
     页脚时钟当年按 [data-clock] 选择，<html> 上裸挂 data-clock 会被它自己命中，
     el.textContent 赋值把整份文档清成一行纯文本。
     （时钟已删，但新增开关时这条规则照旧。）
     ======================================================= */
  var CFG = {
    loader:       doc.dataset.optLoader !== 'off',
    cursor:       doc.dataset.optCursor !== 'off',
    smoothScroll: doc.dataset.optSmooth !== 'off',
    transition:   doc.dataset.optTransition !== 'off',
    firstName:    doc.dataset.loaderName || '你好'
  };

  /* =======================================================
     02. 平滑滚动
     ======================================================= */
  var lenis = null;

  if (CFG.smoothScroll && window.Lenis && !reduceMotion) {
    try {
      lenis = new window.Lenis({
        duration: 1.1,
        easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
        smoothWheel: true,
        wheelMultiplier: 1,
        touchMultiplier: 1.6
      });
      (function raf(t) { lenis.raf(t); window.requestAnimationFrame(raf); })();
      window.__lenis = lenis;          // 调试钩子
    } catch (e) {
      console.warn('[site] Lenis 初始化失败，回退原生滚动', e);
      lenis = null;
    }
  }

  function scrollToEl(el, offset) {
    if (!el) return;
    var off = offset || 0;
    if (lenis) lenis.scrollTo(el, { offset: off, duration: 1.2 });
    else window.scrollTo({
      top: el.getBoundingClientRect().top + window.pageYOffset + off,
      behavior: reduceMotion ? 'auto' : 'smooth'
    });
  }
  function scrollToTop(immediate) {
    if (lenis) lenis.scrollTo(0, { immediate: !!immediate });
    else window.scrollTo(0, 0);
  }

  /* =======================================================
     03. 进场加载
     播放时机：首次进入、手动刷新、关掉页面后重开（导航类型 navigate / reload）。
     不播放：浏览器返回 / 前进（导航类型 back_forward）—— 页面内容本身没变，
     重播开场动画只会让人觉得「卡了」；此时直接摘掉加载层进内容。
     站内点链接的跳转由白幕转场（is-wiping）接管，本来就不走这里。
     注意：不能用 sessionStorage「看过没有」做主判据 —— 它在刷新后依然存在，
     会把「刷新也要播」一起误杀。导航类型才是精确信号。
     ======================================================= */
  var loader = $('#loader');

  /* 本次文档加载是不是「返回 / 前进」触发的。
     优先用 Performance API；老浏览器回退 performance.navigation（type 2 = back_forward）。 */
  function navWasBackForward() {
    try {
      if (window.performance && performance.getEntriesByType) {
        var entries = performance.getEntriesByType('navigation');
        if (entries && entries.length) return entries[0].type === 'back_forward';
      }
      if (window.performance && performance.navigation) return performance.navigation.type === 2;
    } catch (e) {}
    return false;
  }

/* 原 splitStatements() 已删除 —— 空占位函数，全站无调用点（静态扫描确认）。 */

  function enterContent() {
    doc.classList.remove('is-loading');
    doc.classList.add('is-ready');
  }

  function runLoader() {
    var isBackForward = navWasBackForward();
    if (!loader || !CFG.loader || reduceMotion || doc.classList.contains('is-wiping')) {
      if (loader) { loader.classList.add('is-done'); window.setTimeout(function () { loader.setAttribute('hidden', ''); }, 600); }
      enterContent();
      return;
    }
    /* 返回 / 前进进入：不播动画，加载层直接拍死。
       ★ 必须三管齐下：is-done（走全站统一的隐形机制）+ 内联 display:none
       （author 的 .loader{display:grid} 会压过 UA 的 [hidden]，只设属性 =
       加载层永远挂在屏幕上 → 整页看着像卡死）；hidden 属性留给 CSS 兜底。 */
    if (isBackForward) {
      loader.classList.add('is-done');
      loader.style.display = 'none';
      loader.setAttribute('hidden', '');
      enterContent();
      return;
    }

    var words = $$('.loader-word', loader);
    var numEl = $('[data-loader-num]', loader);
    var barEl = $('[data-loader-bar]', loader);
    var HTML_MS = 300;                     // 每个问候语停留时长
    var i = 0;

    // 问候语轮播，最后一个停留久一点
    function nextWord() {
      if (i >= words.length) { finish(); return; }
      words.forEach(function (w, k) {
        w.classList.toggle('is-out', k < i);
        w.classList.toggle('is-on', k === i);
      });
      var last = i === words.length - 1;
      var wait = last ? 520 : HTML_MS;
      if (barEl) {
        barEl.style.transition = 'transform ' + (wait / 1000) + 's linear';
        barEl.style.transform = 'scaleX(' + ((i + 1) / words.length).toFixed(3) + ')';
      }
      if (numEl) numEl.textContent = String(Math.round(((i + 1) / words.length) * 100)).padStart(3, '0');
      i++;
      window.setTimeout(nextWord, wait);
    }

    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      loader.classList.add('is-done');
      enterContent();
      window.setTimeout(function () {
        loader.setAttribute('hidden', '');
      }, 1100);
    }

    try { sessionStorage.setItem('__seen', '1'); } catch (e) {}
    window.requestAnimationFrame(function () { window.setTimeout(nextWord, 120); });
    window.setTimeout(finish, 4200);                    // 兜底，绝不卡住
  }

  /* =======================================================
     04. 自定义光标
     ======================================================= */
  var cursorEl = $('#cursor');

  if (cursorEl && CFG.cursor && canHover && !reduceMotion) {
    var curDot = $('.cur-dot', cursorEl);
    var curRing = $('.cur-ring', cursorEl);
    var mx = window.innerWidth / 2, my = window.innerHeight / 2;
    var dx = mx, dy = my, rx = mx, ry = my;
    var curRunning = false;

    doc.classList.add('has-cursor');

    function curLoop() {
      dx += (mx - dx) * 0.5;
      dy += (my - dy) * 0.5;
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;

      var settled = Math.abs(mx - rx) < 0.15 && Math.abs(my - ry) < 0.15;
      if (settled) { rx = mx; ry = my; dx = mx; dy = my; }

      if (curDot) curDot.style.transform = 'translate3d(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px,0)';
      if (curRing) curRing.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)';

      if (settled) { curRunning = false; return; }
      window.requestAnimationFrame(curLoop);
    }

    on(window, 'mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      cursorEl.classList.add('is-awake');
      if (!curRunning) { curRunning = true; window.requestAnimationFrame(curLoop); }
    }, { passive: true });

    on(doc, 'mouseleave', function () { cursorEl.classList.remove('is-awake'); });

    // 事件委托，不给每个元素挂监听
    on(document, 'mouseover', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var onRow = !!t.closest('.lt-row, .tile');
      var onLink = !!t.closest('a, button, input, textarea, select, [role="button"]');
      cursorEl.classList.toggle('is-media', onRow);
      cursorEl.classList.toggle('is-link', onLink && !onRow);
    }, { passive: true });
  }

  /* =======================================================
     05. 滚动揭示
     同一批进入视口的元素才错开，避免逐个滚入时延迟累积
     ======================================================= */
  var revealSel = '.reveal, [data-reveal-lines], .stripe, .mask, .lt-item, .svc-item, .tl-item, .pstat';
  var io = null;

  function countUp(el) {
    var raw = String(el.dataset.count || '').trim();
    var m = /^(-?\d+(?:\.\d+)?)(.*)$/.exec(raw);
    if (!m) return;
    var to = parseFloat(m[1]);
    var tail = m[2] || '';
    var decimals = (m[1].split('.')[1] || '').length;
    var abs = Math.abs(to);
    var sign = to < 0 ? '-' : '';
    if (reduceMotion || !abs) { el.textContent = raw; return; }

    var dur = 900, start = null;
    function step(now) {
      if (start === null) start = now;
      var k = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = sign + (abs * e).toFixed(decimals) + tail;
      if (k < 1) window.requestAnimationFrame(step);
      else el.textContent = raw;
    }
    window.requestAnimationFrame(step);
  }

  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(function (entries) {
      var k = 0;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        if (k < 6) el.style.setProperty('--d', (k * 80) + 'ms');
        k++;
        el.classList.add('in');
        if (el.classList.contains('pstat')) countUp(el);
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  }

  function observeReveals(root) {
    var els = $$(revealSel, root || document).filter(function (el) { return !el.classList.contains('in'); });
    if (!io) { els.forEach(function (el) { el.classList.add('in'); }); return; }
    els.forEach(function (el) { io.observe(el); });
  }

  /* =======================================================
     06. 磁吸按钮
     ======================================================= */
  /* 磁吸位移的收敛时间常数（秒）。越小越跟手，越大越柔和。
     跟随/回中分开给：进的时候要跟得上光标，出的时候稍微缓一点更自然。
     这两个值实测调过：0.075/0.13 时尾巴拖得太长（420ms 才到目标的 95%，
     视觉上像"慢慢飘过去"），收到 0.055/0.085 后约 130ms 到位九成、250ms 内停稳。 */
  var MAG_TAU_IN = 0.055;
  var MAG_TAU_OUT = 0.085;

  function bindMagnetic(root) {
    if (!canHover || reduceMotion) return;
    $$('[data-strength]', root || document).forEach(function (el) {
      if (el.dataset.magBound) return;
      el.dataset.magBound = '1';
      var s = num(el.dataset.strength, 20);

      var curX = 0, curY = 0;    // 当前位移
      var toX = 0, toY = 0;      // 目标位移
      var tau = MAG_TAU_IN;      // 本轮的收敛时间常数
      var raf = 0;
      var last = 0;

      /* 颜色过渡仍然交给 CSS；transform 绝不能挂 transition ——
         那会和下面 rAF 的逐帧插值叠成双重缓动，出现拖影和过冲。
         原先是把整条 transition 换成 'transform 0s' 来"跟手"，
         结果位移变成硬跳，正是抖动的来源之一。 */
      el.style.transition = 'background-color .18s ' + EASE + ', border-color .18s ' + EASE +
                            ', color .18s ' + EASE;
      el.style.willChange = 'transform';

      function paint() {
        el.style.transform = 'translate3d(' + curX.toFixed(2) + 'px,' + curY.toFixed(2) + 'px,0)';
      }

      /* 指数收敛：每帧吃掉剩余距离的固定比例（按时间换算，与刷新率无关）。
         数学上单调逼近目标，永远不过冲，也就不会有回弹。 */
      function tick(now) {
        var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
        last = now;
        var k = 1 - Math.exp(-dt / tau);

        curX += (toX - curX) * k;
        curY += (toY - curY) * k;

        /* 收敛到位就吸附并停帧：0.08px 远在肉眼之下，再逼近只是白跑帧 */
        if (Math.abs(toX - curX) < 0.08 && Math.abs(toY - curY) < 0.08) {
          curX = toX;
          curY = toY;
          paint();
          raf = 0;
          last = 0;
          return;
        }

        paint();
        raf = requestAnimationFrame(tick);
      }

      function run(t) {
        tau = t;
        if (raf) return;
        last = 0;
        raf = requestAnimationFrame(tick);
      }

      on(el, 'mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var halfW = (r.width / 2) || 1;
        var halfH = (r.height / 2) || 1;
        /* 关键：扣掉已经施加的位移，还原出「没被磁吸推开时」的基准框。
           否则元素一动，参考系跟着动，目标值来回追自己 —— 光标快移时会明显抖。 */
        var cx = (r.left - curX) + halfW;
        var cy = (r.top - curY) + halfH;
        var nx = (e.clientX - cx) / halfW;
        var ny = (e.clientY - cy) / halfH;
        /* 钳到 [-1,1]：子元素冒泡上来的坐标可能落在元素外 */
        toX = Math.max(-1, Math.min(1, nx)) * s;
        toY = Math.max(-1, Math.min(1, ny)) * s;
        run(MAG_TAU_IN);
      });

      on(el, 'mouseleave', function () {
        toX = 0;
        toY = 0;
        run(MAG_TAU_OUT);
      });
    });
  }

  /* =======================================================
     07. 鼠标跟随的作品预览
     ======================================================= */
  var previewRoot = $('#hoverPreview');

  function initHoverPreview() {
    if (!previewRoot || !canHover || reduceMotion) return;
    var rows = $$('.lt-row[data-thumb], .tile[data-thumb]');
    if (!rows.length) { previewRoot.remove(); return; }

    var inner = document.createElement('div');
    inner.className = 'hp-inner';
    previewRoot.appendChild(inner);

    var phEl = function (row) {
      var ph = document.createElement('span');
      ph.className = 'hp-ph';
      ph.textContent = (row.dataset.name || '作品') + ' · 待放图';
      return ph;
    };

    var items = rows.map(function (row) {
      var el = document.createElement('div');
      el.className = 'hp-item';
      var src = row.dataset.thumb;
      if (src) {
        var img = document.createElement('img');
        img.src = src; img.alt = ''; img.loading = 'lazy';
        img.addEventListener('error', function () {
          img.remove();
          el.appendChild(phEl(row));   // 图挂了才回落占位
        });
        el.appendChild(img);
      } else {
        el.appendChild(phEl(row));
      }
      inner.appendChild(el);
      return el;
    });

    var pmx = 0, pmy = 0, pcx = 0, pcy = 0, running = false, active = -1;

    function loop() {
      pcx += (pmx - pcx) * 0.13;
      pcy += (pmy - pcy) * 0.13;
      /* 预览框中心跟随光标（VIEW 圆点落在图中央），并夹在视口内 */
      var w = inner.offsetWidth, h = inner.offsetHeight;
      var vw = window.innerWidth, vh = window.innerHeight;
      var x = Math.min(Math.max(pcx, w / 2 + 16), vw - w / 2 - 16);
      var y = Math.min(Math.max(pcy, h / 2 + 16), vh - h / 2 - 16);
      previewRoot.style.transform = 'translate3d(' + (x - w / 2).toFixed(2) + 'px,' + (y - h / 2).toFixed(2) + 'px,0)';
      if (running) window.requestAnimationFrame(loop);
    }

    on(window, 'mousemove', function (e) { pmx = e.clientX; pmy = e.clientY; }, { passive: true });

    function show(i) {
      if (i === active) return;
      if (items[active]) items[active].classList.remove('is-on');
      active = i;
      if (i > -1 && items[i]) items[i].classList.add('is-on');
      previewRoot.classList.toggle('is-on', i > -1);
    }

    rows.forEach(function (row, i) {
      on(row, 'mouseenter', function () {
        if (window.innerWidth <= 720) return;
        if (active < 0) { pcx = pmx; pcy = pmy; }
        show(i);
        if (!running) { running = true; window.requestAnimationFrame(loop); }
      });
      on(row, 'mouseleave', function () { show(-1); running = false; });
    });
  }

  /* =======================================================
     08. 顶栏
     ======================================================= */
  var head = $('#siteHead');
  var lastY = window.pageYOffset;
  var toTop = $('#toTop');
  if (toTop) on(toTop, 'click', function () { scrollToTop(); });

  function onScroll() {
    var y = window.pageYOffset;
    if (head && !head.classList.contains('is-behind')) {
      head.classList.toggle('is-scrolled', y > 24);
      head.classList.toggle('is-hidden', y > lastY && y > 340);
    }
    /* 顶栏实时底边 → --head-cur，供吸顶元素（如作品页 .toolbar）精确贴齐。
       取 max(0, bottom)：顶栏滑出（is-hidden）时归 0，吸顶栏贴顶不留缝。 */
    if (head) {
      var headBottom = head.getBoundingClientRect().bottom;
      document.documentElement.style.setProperty('--head-cur', Math.max(0, headBottom) + 'px');
    }
    if (toTop) toTop.classList.toggle('is-show', y > 480);
    lastY = y;
    queueParallax();
  }
  on(window, 'scroll', onScroll, { passive: true });
  onScroll();   /* 初始同步一次（bfcache 恢复到页面中部时按钮状态才对） */

  /* 当前页面高亮 */
  (function markCurrentNav() {
    var here = location.pathname.split('/').pop() || 'index.html';
    $$('.nav-btn, .head-logo').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('/').pop();
      a.classList.toggle('is-active', href === here);
      if (href === here) a.setAttribute('aria-current', 'page');
    });
    $$('.menu-list a').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('/').pop();
      a.classList.toggle('is-active', href === here);
    });
  })();

  /* =======================================================
     09. 全屏菜单
     ======================================================= */
  (function initMenu() {
    var menu = $('#menu');
    if (!menu) return;
    var openers = $$('[data-menu-open]');
    var closers = $$('[data-menu-close]', menu);
    var isOpen = false;
    var lastFocus = null;      // 打开前的焦点，关闭后要还回去

    /* 面板里真正可聚焦的元素。用 getClientRects() 判可见，
       不用 offsetParent —— 面板是 position:fixed，offsetParent 在这类结构上不可靠。 */
    function focusables() {
      return $$('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])', menu)
        .filter(function (el) { return el.getClientRects().length > 0; });
    }

    /* role="dialog" + aria-modal="true" 是个契约：焦点必须进到面板里、
       Tab 不能跑到背后的页面上、关闭后要还给触发它的按钮。
       之前这三件事都没做（实测：打开后焦点停在 BODY，背后 15 个元素仍可 Tab 到）。 */
    function open() {
      if (isOpen) return;
      isOpen = true;
      lastFocus = document.activeElement;
      menu.classList.add('is-open');
      menu.removeAttribute('hidden');
      menu.setAttribute('aria-hidden', 'false');
      body.classList.add('no-scroll');
      if (lenis) lenis.stop();
      if (head) head.classList.add('is-behind');
      /* aria-expanded 原来写死在模板里、JS 从不更新 —— 读屏软件永远被告知「已收起」 */
      openers.forEach(function (b) { b.setAttribute('aria-expanded', 'true'); });
      var f = focusables();
      if (f.length) f[0].focus({ preventScroll: true });
    }
    function close(skipFocus) {
      if (!isOpen) return;
      isOpen = false;
      menu.classList.remove('is-open');
      menu.setAttribute('aria-hidden', 'true');
      body.classList.remove('no-scroll');
      if (lenis) lenis.start();
      if (head) head.classList.remove('is-behind');
      openers.forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
      if (lastFocus && lastFocus.focus && !skipFocus) lastFocus.focus({ preventScroll: true });
      lastFocus = null;
      /* 页面转场接管时不需要等待菜单退场再补 hidden；普通关闭仍保留退场时间。 */
      if (skipFocus || wiping) {
        menu.setAttribute('hidden', '');
        return;
      }
      window.setTimeout(function () { if (!isOpen) menu.setAttribute('hidden', ''); }, 780);
    }

    openers.forEach(function (b) { on(b, 'click', function (e) { e.preventDefault(); isOpen ? close() : open(); }); });
    closers.forEach(function (b) { on(b, 'click', function (e) { e.preventDefault(); close(); }); });
    on(document, 'keydown', function (e) {
      if (!isOpen) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (!menu.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // 菜单里的站内链接：先关菜单再跳转
    $$('a[href]', menu).forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || a.target === '_blank') return;
      on(a, 'click', function (e) {
        if (isInternalLink(a)) return;
        close();
      });
    });

    window.__menu = { open: open, close: close, isOpen: function () { return isOpen; } };
  })();

  /* =======================================================
     10. 页面切换转场
     ======================================================= */
  var wipe = $('#pageWipe');
  var wipePath = wipe ? $('.wipe-path', wipe) : null;
  var wipeLabel = wipe ? $('.wipe-label', wipe) : null;
  var wiping = false;
  var wipeRaf = 0;
  var pendingHref = '';

  /* 白幕停留时长（ms）：完全变白后页名展示多久再继续转场。 */
  var WIPE_HOLD_MS = 520;

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInCubic(t) { return t * t * t; }
  function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
  function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }

  /* 与 Codrops 022 相同的思路：用一条水平 SVG 曲线接管页面。
     不再在关键帧之间硬切 path，而是逐帧插值每个控制点，避免卡顿。 */
  function entryPath(t) {
    var edge, c1x, c1y, c2x, c2y;
    if (t < .78) {
      var a = easeInCubic(t / .78);
      edge = lerp(0, 48, a);
      c1x = lerp(0, 14, a); c1y = lerp(33, 25, a);
      c2x = lerp(0, 84, a); c2y = lerp(67, 76, a);
    } else {
      var b = easeInOutSine((t - .78) / .22);
      edge = lerp(48, 100, b);
      c1x = lerp(14, 100, b); c1y = lerp(25, 33, b);
      c2x = lerp(84, 100, b); c2y = lerp(76, 67, b);
    }
    return 'M 0 0 H ' + edge.toFixed(3) + ' C ' + c1x.toFixed(3) + ' ' + c1y.toFixed(3) + ' ' + c2x.toFixed(3) + ' ' + c2y.toFixed(3) + ' ' + edge.toFixed(3) + ' 100 H 0 Z';
  }

  function exitPath(t) {
    var p = easeOutQuart(t);
    var edge = lerp(0, 100, p);
    var c1x = lerp(0, 82, p), c1y = lerp(33, 42, p);
    var c2x = lerp(0, 122, p), c2y = lerp(67, 80, p);
    return 'M 100 0 H ' + edge.toFixed(3) + ' C ' + c1x.toFixed(3) + ' ' + c1y.toFixed(3) + ' ' + c2x.toFixed(3) + ' ' + c2y.toFixed(3) + ' ' + edge.toFixed(3) + ' 100 H 100 Z';
  }

  function setWipePath(d) {
    if (wipePath) wipePath.setAttribute('d', d);
  }

  function animateWipe(duration, draw, done) {
    if (wipeRaf) cancelAnimationFrame(wipeRaf);
    var started = 0;
    function frame(now) {
      if (!started) started = now;
      var p = clamp01((now - started) / duration);
      draw(p);
      if (p < 1) wipeRaf = requestAnimationFrame(frame);
      else { wipeRaf = 0; if (done) done(); }
    }
    wipeRaf = requestAnimationFrame(frame);
  }

  /* 从导航链接解析出目标页名：index → home，work.html → work，子目录取最后一段。 */
  function wipePageKey(href) {
    var file = (href.split('/').pop() || '').replace(/[?#].*$/, '');
    if (!file || file === 'index.html') return 'navHome';
    var base = file.replace(/\.html?$/, '');
    if (base === 'work') return 'navWork';
    if (base === 'about') return 'navAbout';
    if (base === 'archive') return 'navWork';
    if (base === '404') return 'navHome';
    return base;
  }

  function showWipeLabel(key) {
    if (!wipeLabel) return;
    var hit = null;
    $$('.wipe-page', wipeLabel).forEach(function (el) {
      var on = el.getAttribute('data-wipe-page') === key;
      el.classList.toggle('is-on', on);
      if (on) hit = el;
    });
    if (hit) wipe.classList.add('is-hold');
  }

  function hideWipeLabel() {
    if (!wipeLabel) return;
    wipe.classList.remove('is-hold');
    $$('.wipe-page', wipeLabel).forEach(function (el) { el.classList.remove('is-on'); });
  }

  function playWipeIn(cb) {
    if (!wipe || !wipePath || !CFG.transition || reduceMotion) { cb(); return; }
    wipe.classList.add('is-active');
    setWipePath(entryPath(0));
    /* 首屏 WebGL 与 SVG 同时满帧绘制会争 GPU；遮罩期间暂停，返回页由 pageshow 恢复。 */
    if (window.__heroBg && window.__heroBg.stop) window.__heroBg.stop();
    var enterDone = function () {
      /* 整屏完全变白后才亮出页名：提前显示会在黑底上闪出文字。 */
      showWipeLabel(wipePageKey(pendingHref || location.pathname));
      /* 停留 WIPE_HOLD_MS，让页名读清楚再转场。 */
      window.setTimeout(function () {
        hideWipeLabel();
        cb();
      }, WIPE_HOLD_MS);
    };
    animateWipe(window.innerWidth < 720 ? 620 : 760, function (p) {
      setWipePath(entryPath(p));
    }, enterDone);
  }

  function resumeWipeIn() {
    if (!wipe || !wipePath || !doc.classList.contains('is-wiping')) return;
    hideWipeLabel();
    wipe.classList.add('is-active');
    setWipePath(exitPath(0));
    /* 两帧后再启动，确保首帧白幕已绘制，防止新页闪黑。 */
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        doc.classList.remove('is-wiping');
        animateWipe(window.innerWidth < 720 ? 680 : 860, function (p) {
          setWipePath(exitPath(p));
        }, function () {
          wipe.classList.remove('is-active');
          setWipePath(exitPath(1));
          wiping = false;
        });
      });
    });
  }

  function isInternalLink(a) {
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return false;
    if (a.host && a.host !== location.host) return false;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return false;
    return /\.html?(\?|#|$)/.test(href) || href === '' ;
  }

  on(document, 'click', function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !isInternalLink(a)) return;
    e.preventDefault();
    if (wiping) return;
    var target = new URL(a.href, location.href);
    if (target.href === location.href) { return; }
    wiping = true;
    pendingHref = target.href;
    var willAnimate = !!(wipe && wipePath && CFG.transition && !reduceMotion);
    if (willAnimate) {
      try { sessionStorage.setItem('__wipe', '1'); } catch (err) {}
    }
    (window.__menu && window.__menu.close) && window.__menu.close(true);
    if (cursorEl) cursorEl.classList.remove('is-awake');
    if (previewRoot) previewRoot.classList.remove('is-on');
    playWipeIn(function () { location.href = pendingHref; });
  });

  /* BFCache 返回时旧 JS 状态会一并恢复，必须清掉锁和遮罩。 */
  on(window, 'pageshow', function (e) {
    if (!e.persisted) return;
    wiping = false;
    pendingHref = '';
    if (wipeRaf) { cancelAnimationFrame(wipeRaf); wipeRaf = 0; }
    doc.classList.remove('is-wiping', 'is-loading');
    /* 同 runLoader 的 back_forward 分支：只设 hidden 属性压不住 .loader 的 display:grid */
    if (loader) { loader.classList.add('is-done'); loader.style.display = 'none'; loader.setAttribute('hidden', ''); }
    if (wipe) wipe.classList.remove('is-active');
    hideWipeLabel();
    setWipePath(exitPath(1));
    if (window.__heroBg && window.__heroBg.start) window.__heroBg.start();
  });

  /* =======================================================
     11. 作品页：筛选 + 视图切换
     ======================================================= */
  (function initToolbar() {
    var table = $('.list-table');
    var items = $$('.lt-item', table || document);
    var empty = $('#listEmpty');

    // 每个筛选项的真实条数，回写到按钮上
    $$('[data-filter]').forEach(function (btn) {
      var f = btn.dataset.filter;
      var n = f === 'all' ? items.length : items.filter(function (i) { return i.dataset.cat === f; }).length;
      var cnt = $('.cnt', btn);
      if (cnt) { cnt.textContent = n; cnt.setAttribute('data-n', n); }
      if (n === 0) btn.hidden = true;         // 空分类直接不显示
    });

    $$('[data-filter]').forEach(function (btn) {
      on(btn, 'click', function () {
        $$('[data-filter]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        var f = btn.dataset.filter;
        var shown = 0;
        items.forEach(function (item) {
          var ok = f === 'all' || item.dataset.cat === f;
          item.classList.toggle('is-out', !ok);
          if (ok) { shown++; item.querySelectorAll('.stripe').forEach(function (s) { s.classList.add('in'); }); }
        });
        if (empty) empty.hidden = shown > 0;
      });
    });

    $$('[data-view]').forEach(function (btn) {
      on(btn, 'click', function () {
        $$('[data-view]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        if (table) table.classList.toggle('is-tiles', btn.dataset.view === 'tiles');
        if (previewRoot) previewRoot.classList.toggle('is-hidden', btn.dataset.view === 'tiles');
      });
    });
  })();

  /* =======================================================
     12. 视差
     ======================================================= */
  var parallaxEls = $$('[data-parallax]');
  var pQueued = false;

  function updateParallax() {
    pQueued = false;
    if (reduceMotion || !parallaxEls.length) return;
    var vh = window.innerHeight || 1;
    parallaxEls.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom < -300 || r.top > vh + 300) return;
      var strength = num(el.dataset.parallax, -40);
      var p = ((r.top + r.height / 2) - vh / 2) / vh;    // -1 ~ 1
      var shift = Math.max(-1, Math.min(1, p)) * strength;
      el.style.transform = 'translate3d(0,' + shift.toFixed(2) + 'px,0)';
    });
  }
  function queueParallax() {
    if (pQueued) return;
    pQueued = true;
    window.requestAnimationFrame(updateParallax);
  }

  /* =======================================================
     13.（已移除）页脚本地时钟
     2026-09-23：页脚「本地时间」列删除，模板不再输出 [data-clock]，
     CFG 里的 clock / timezone / timezoneLabel 也一并去掉。
     ======================================================= */

  /* =======================================================
     14. 联系表单
     没配接口就退回 mailto，绝不假装提交成功
     ======================================================= */
  (function initForm() {
    var form = $('#contactForm');
    if (!form) return;
    var status = $('#formStatus', form);
    var action = form.getAttribute('action') || '';
    var successUrl = form.dataset.success || 'success.html';

    on(form, 'submit', function (e) {
      // 原生校验没过就交给浏览器
      if (!form.checkValidity()) return;

      if (!action) {
        e.preventDefault();
        var data = new FormData(form);
        var lines = [];
        data.forEach(function (v, k) { if (String(v).trim()) lines.push(k + '：' + v); });
        var subject = '来自个人网站的留言';
        var mailto = 'mailto:' + (form.dataset.email || '') +
                     '?subject=' + encodeURIComponent(subject) +
                     '&body=' + encodeURIComponent(lines.join('\n'));
        window.location.href = mailto;
        if (status) {
          status.textContent = '已为你打开邮件客户端，发送即可。';
          status.hidden = false;
        }
        return;
      }

      e.preventDefault();
      var btn = $('[type="submit"]', form);
      if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = '发送中…'; }

      fetch(action, { method: form.method || 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          location.href = successUrl;
        })
        .catch(function (err) {
          console.warn('[site] 表单提交失败', err);
          if (status) {
            status.textContent = '发送失败，可以直接发邮件给我：' + (form.dataset.email || '');
            status.classList.add('is-error');
            status.hidden = false;
          }
          if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || '发送'; }
        });
    });
  })();

  /* =======================================================
     14.5 中 / EN 切换
     -------------------------------------------------------
     只改 <html data-cp-lang>，剩下交给 CSS：
     [data-mode="auto"] 的文案位跟着换，固定中/固定英的那几处不动。
     选过的语言记在 localStorage，翻页和刷新都不会跳回去。
     ======================================================= */
  (function initLangSwitch() {
    var root = document.documentElement;
    var btn = $('[data-lang-toggle]');
    if (!btn) return;

    on(btn, 'click', function () {
      var next = root.getAttribute('data-cp-lang') === 'en' ? 'zh' : 'en';
      root.setAttribute('data-cp-lang', next);
      root.setAttribute('lang', next === 'en' ? 'en' : 'zh-CN');
      try { localStorage.setItem('__lang', next); } catch (e) {}
    });
  })();

  /* =======================================================
     16. 点击复制（联系方式）
     ---------------------------------------------------------
     菜单底部 / 页脚那一排账号：点一下把账号写进剪贴板。
     写剪贴板有三条路，按可靠性依次退：
       1) navigator.clipboard —— 只在安全上下文（https / localhost）存在，
          而且必须由用户手势触发，否则会被浏览器直接拒绝；
       2) 临时 textarea + execCommand('copy') —— 老浏览器、file:// 兜底；
       3) 都失败 → 提示条里把账号显示出来，让人自己选中复制。
     成功和失败都在页面上给一句可见反馈，不依赖 console。
     提示语从页面里已有的 [data-copy-fail] 取，所以中英文跟着全站切换走。
     ======================================================= */
  (function initCopy() {
    var btns = $$('[data-copy]').filter(function (b) { return b.getAttribute('data-copy'); });
    if (!btns.length) return;

    var failSrc = $('[data-copy-fail]');
    var toast = null;
    var toastTimer = 0;

    function failText() {
      if (!failSrc) return 'Copy failed';
      var isEn = doc.getAttribute('data-cp-lang') === 'en';
      var pick = failSrc.querySelector(isEn ? '.cp-en' : '.cp-zh') || failSrc.querySelector('.cp-zh');
      return pick ? pick.textContent.trim() : 'Copy failed';
    }

    function showToast(text, isError) {
      if (!toast) {
        toast = document.createElement('div');
        toast.className = 'copy-toast mono';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
      }
      toast.textContent = text;
      toast.classList.toggle('is-error', !!isError);
      toast.classList.add('is-on');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(function () {
        toast.classList.remove('is-on');
      }, isError ? 4200 : 2200);
    }

    function legacyCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e) { /* 某些浏览器只读框不给选 */ }
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }

    function write(text) {
      if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(
          function () { return true; },
          function () { return legacyCopy(text); }   // 权限被拒 → 走兜底，而不是直接报错
        );
      }
      return Promise.resolve(legacyCopy(text));
    }

    btns.forEach(function (btn) {
      on(btn, 'click', function (e) {
        e.preventDefault();
        var id = btn.getAttribute('data-copy');
        var name = btn.getAttribute('data-copy-name') || '';
        write(id).then(function (ok) {
          if (!ok) { showToast(failText() + ' · ' + id, true); return; }
          btn.setAttribute('data-copied', '');
          window.setTimeout(function () { btn.removeAttribute('data-copied'); }, 1800);
          showToast((name ? name + ' · ' : '') + id, false);
        });
      });
    });
  })();

  /* =======================================================
     16.5 后台实时排版（保存前预览用）
     -------------------------------------------------------
     后台调字号 / 字重滑杆时 postMessage 过来，这里直接改
     元素上的 --zs/--zw/--es/--ew，不用刷新、不用重新生成。
     消息格式：{ type:'pf-typography', selector:'.p-title', vars:{'--zs':1.25,...} }
     ======================================================= */
  on(window, 'message', function (e) {
    const d = e && e.data;
    if (!d || d.type !== 'pf-typography' || !d.selector || !d.vars) return;
    let els;
    try { els = document.querySelectorAll(String(d.selector)); } catch (err) { return; }
    if (!els || !els.length) return;
    Object.keys(d.vars).forEach(function (k) {
      const v = d.vars[k];
      if (v === null || v === undefined || v === '') return;
      Array.prototype.forEach.call(els, function (el) { el.style.setProperty(k, v); });
    });
  });

  /* =======================================================
     16.6 图片加载扫光：图在传输/解码期间，容器显示流光扫过，
          该容器内所有图就绪（含失败）后自动撤掉
     ======================================================= */
  function initImgShimmer() {
    $$('.fig-media, .tile-media').forEach(function (box) {
      var imgs = $$('img', box).filter(function (img) { return !img.complete; });
      if (!imgs.length) return;
      var left = imgs.length;
      box.classList.add('img-loading');
      imgs.forEach(function (img) {
        var done = function () { if (--left <= 0) box.classList.remove('img-loading'); };
        on(img, 'load', done);
        on(img, 'error', done);
      });
    });
  }

  /* =======================================================
     17. 启动
     ======================================================= */
  function boot() {
    /* 给内联看门狗用：runtime.js 正常跑到这里，就不需要 8 秒后的降级兜底了 */
    window.__booted = true;
    resumeWipeIn();
    observeReveals(document);
    bindMagnetic(document);
    initHoverPreview();
    initImgShimmer();
    runLoader();
    updateParallax();

    // 图片加载完后重算一次视差，避免高度变化导致偏移
    window.setTimeout(updateParallax, 420);
    on(window, 'load', function () { updateParallax(); observeReveals(document); });
  }

  if (document.readyState === 'loading') on(document, 'DOMContentLoaded', boot);
  else boot();

  on(window, 'resize', queueParallax, { passive: true });
  on(window, 'resize', onScroll, { passive: true });

  // 调试钩子：自动化验证用
  window.__site = {
    lenis: function () { return !!lenis; },
    reveals: function () { return $$('.reveal.in').length; },
    wipe: function () { return wiping; }
  };

})();
