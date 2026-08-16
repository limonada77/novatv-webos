/* XtreamPlay — webOS IPTV player (Xtream Codes only) */
(function () {
  "use strict";

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, RED: 403, PLAY: 415, PAUSE: 19, STOP: 413 };
  var STORE = "xtreamplay.account";

  var state = {
    acc: null,
    type: "live",
    cats: [],
    items: [],
    filtered: [],
    catIndex: 0,
    zone: "cats", // tabs | cats | items | search
    tabIndex: 0,
    itemIndex: 0,
    screen: "login",
    loginIndex: 0,
    hls: null,
    overlayTimer: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ["login", "browse", "player", "loginForm", "f_host", "f_user", "f_pass", "btnLogin", "loginMsg",
   "catList", "itemList", "itemsTitle", "search", "userInfo", "btnLogout", "loader", "browseMsg",
   "video", "pOverlay", "pTitle", "pState"].forEach(function (k) { el[k] = $(k); });
  var tabs = Array.prototype.slice.call(document.querySelectorAll("#tabs .tab"));

  /* ---------- helpers ---------- */
  function show(name) {
    ["login", "browse", "player"].forEach(function (s) { el[s].classList.toggle("active", s === name); });
    state.screen = name;
  }
  function loading(on) { el.loader.classList.toggle("hidden", !on); }
  function msg(node, text, ok) {
    node.textContent = text || "";
    node.classList.toggle("ok", !!ok);
  }
  function normHost(h) {
    h = String(h || "").trim().replace(/\/+$/, "");
    if (!h) return "";
    if (!/^https?:\/\//i.test(h)) h = "http://" + h;
    return h;
  }
  function esc(s) { return String(s == null ? "" : s); }

  function request(url, timeout) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var done = false;
      xhr.open("GET", url, true);
      xhr.timeout = timeout || 20000;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || done) return;
        done = true;
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error("Resposta inválida do servidor")); }
        } else {
          reject(new Error("Falha de conexão (" + (xhr.status || "sem resposta") + ")"));
        }
      };
      xhr.ontimeout = function () { if (!done) { done = true; reject(new Error("Tempo esgotado ao contatar o servidor")); } };
      xhr.onerror = function () { if (!done) { done = true; reject(new Error("Não foi possível conectar ao servidor")); } };
      try { xhr.send(); } catch (e) { reject(new Error("Não foi possível conectar ao servidor")); }
    });
  }

  function api(action, params) {
    var a = state.acc;
    var url = a.host + "/player_api.php?username=" + encodeURIComponent(a.user) +
      "&password=" + encodeURIComponent(a.pass);
    if (action) url += "&action=" + action;
    if (params) Object.keys(params).forEach(function (k) { url += "&" + k + "=" + encodeURIComponent(params[k]); });
    return request(url);
  }

  function saveAcc(a) { try { localStorage.setItem(STORE, JSON.stringify(a)); } catch (e) {} }
  function loadAcc() {
    try { var v = localStorage.getItem(STORE); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }

  /* ---------- login ---------- */
  var loginFields = [];
  function initLoginFocus() {
    loginFields = [el.f_host, el.f_user, el.f_pass, el.btnLogin];
    state.loginIndex = 0;
    focusLogin();
  }
  function focusLogin() {
    var n = loginFields[state.loginIndex];
    if (n) { try { n.focus(); } catch (e) {} }
  }

  function doLogin(host, user, pass, silent) {
    host = normHost(host);
    if (!host || !user || !pass) { msg(el.loginMsg, "Preencha servidor, usuário e senha."); return; }
    state.acc = { host: host, user: user, pass: pass };
    msg(el.loginMsg, "Conectando…", true);
    el.btnLogin.disabled = true;
    api(null).then(function (info) {
      el.btnLogin.disabled = false;
      if (!info || !info.user_info) throw new Error("Servidor não respondeu como Xtream Codes");
      if (String(info.user_info.auth) !== "1") throw new Error("Usuário ou senha inválidos");
      if (info.user_info.status && String(info.user_info.status).toLowerCase() !== "active")
        throw new Error("Conta " + info.user_info.status);
      saveAcc(state.acc);
      var exp = info.user_info.exp_date
        ? new Date(Number(info.user_info.exp_date) * 1000).toLocaleDateString("pt-BR") : "—";
      el.userInfo.textContent = info.user_info.username + " · expira " + exp;
      msg(el.loginMsg, "");
      show("browse");
      selectTab(0);
    }).catch(function (e) {
      el.btnLogin.disabled = false;
      state.acc = null;
      msg(el.loginMsg, e && e.message ? e.message : "Erro ao entrar");
      if (silent) show("login");
    });
  }

  el.loginForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    doLogin(el.f_host.value, el.f_user.value, el.f_pass.value);
  });
  el.btnLogout.addEventListener("click", function () {
    try { localStorage.removeItem(STORE); } catch (e) {}
    stopPlayback();
    state.acc = null;
    show("login");
    initLoginFocus();
  });

  /* ---------- browse ---------- */
  function selectTab(i) {
    state.tabIndex = i;
    state.type = tabs[i].getAttribute("data-type");
    tabs.forEach(function (t, k) { t.classList.toggle("active", k === i); });
    loadCategories();
  }

  function loadCategories() {
    msg(el.browseMsg, "");
    loading(true);
    el.catList.innerHTML = "";
    el.itemList.innerHTML = "";
    var action = state.type === "live" ? "get_live_categories"
      : state.type === "vod" ? "get_vod_categories" : "get_series_categories";
    api(action).then(function (list) {
      loading(false);
      state.cats = Array.isArray(list) ? list : [];
      if (!state.cats.length) { msg(el.browseMsg, "Nenhuma categoria disponível."); return; }
      renderCats();
      state.catIndex = 0;
      state.zone = "cats";
      loadItems(state.cats[0].category_id);
      paint();
    }).catch(function (e) {
      loading(false);
      msg(el.browseMsg, e.message || "Erro ao carregar categorias");
    });
  }

  function renderCats() {
    el.catList.innerHTML = "";
    state.cats.forEach(function (c, i) {
      var li = document.createElement("li");
      li.textContent = esc(c.category_name);
      li.addEventListener("click", function () { state.catIndex = i; state.zone = "cats"; loadItems(c.category_id); paint(); });
      el.catList.appendChild(li);
    });
  }

  function loadItems(catId) {
    loading(true);
    el.itemList.innerHTML = "";
    var action = state.type === "live" ? "get_live_streams"
      : state.type === "vod" ? "get_vod_streams" : "get_series";
    api(action, { category_id: catId }).then(function (list) {
      loading(false);
      state.items = Array.isArray(list) ? list : [];
      el.search.value = "";
      applyFilter();
    }).catch(function (e) {
      loading(false);
      msg(el.browseMsg, e.message || "Erro ao carregar itens");
    });
  }

  function itemName(it) { return esc(it.name || it.title || it.stream_display_name || "Sem nome"); }
  function itemIcon(it) { return it.stream_icon || it.cover || it.movie_image || ""; }

  function applyFilter() {
    var q = el.search.value.trim().toLowerCase();
    state.filtered = q ? state.items.filter(function (it) { return itemName(it).toLowerCase().indexOf(q) >= 0; }) : state.items.slice();
    state.itemIndex = 0;
    renderItems();
  }

  function renderItems() {
    el.itemsTitle.textContent = (state.type === "live" ? "Canais" : state.type === "vod" ? "Filmes" : "Séries") +
      " (" + state.filtered.length + ")";
    el.itemList.innerHTML = "";
    var max = Math.min(state.filtered.length, 300);
    for (var i = 0; i < max; i++) {
      (function (it, idx) {
        var li = document.createElement("li");
        var ic = itemIcon(it);
        if (ic) {
          var img = document.createElement("img");
          img.src = ic;
          img.onerror = function () { img.style.visibility = "hidden"; };
          li.appendChild(img);
        }
        var sp = document.createElement("span");
        sp.textContent = itemName(it);
        li.appendChild(sp);
        li.addEventListener("click", function () { state.itemIndex = idx; openItem(it); });
        el.itemList.appendChild(li);
      })(state.filtered[i], i);
    }
    if (!state.filtered.length) msg(el.browseMsg, "Nada encontrado nesta categoria.");
    else msg(el.browseMsg, "");
    paint();
  }

  function paint() {
    tabs.forEach(function (t, i) { t.classList.toggle("focus", state.zone === "tabs" && i === state.tabIndex); });
    el.search.classList.toggle("focus", state.zone === "search");
    var cs = el.catList.children;
    for (var i = 0; i < cs.length; i++) {
      cs[i].classList.toggle("focus", state.zone === "cats" && i === state.catIndex);
      cs[i].classList.toggle("active", i === state.catIndex);
    }
    var is = el.itemList.children;
    for (var j = 0; j < is.length; j++) is[j].classList.toggle("focus", state.zone === "items" && j === state.itemIndex);
    var f = (state.zone === "cats" ? cs[state.catIndex] : state.zone === "items" ? is[state.itemIndex] : null);
    if (f && f.scrollIntoView) { try { f.scrollIntoView({ block: "nearest" }); } catch (e) { f.scrollIntoView(false); } }
  }

  el.search.addEventListener("input", applyFilter);
  tabs.forEach(function (t, i) { t.addEventListener("click", function () { state.tabIndex = i; selectTab(i); }); });

  /* ---------- open item ---------- */
  function openItem(it) {
    if (!it) return;
    if (state.type === "live") {
      var id = it.stream_id;
      play(streamUrl("live", id, "m3u8"), itemName(it), [streamUrl("live", id, "ts")]);
    } else if (state.type === "vod") {
      var ext = it.container_extension || "mp4";
      play(streamUrl("movie", it.stream_id, ext), itemName(it), [streamUrl("movie", it.stream_id, "mp4"), streamUrl("movie", it.stream_id, "mkv")]);
    } else {
      openSeries(it);
    }
  }

  function streamUrl(kind, id, ext) {
    var a = state.acc;
    return a.host + "/" + kind + "/" + encodeURIComponent(a.user) + "/" + encodeURIComponent(a.pass) + "/" + id + "." + ext;
  }

  function openSeries(serie) {
    loading(true);
    api("get_series_info", { series_id: serie.series_id }).then(function (info) {
      loading(false);
      var eps = [];
      if (info && info.episodes) {
        Object.keys(info.episodes).forEach(function (s) {
          (info.episodes[s] || []).forEach(function (e) {
            eps.push({ name: "T" + s + " E" + (e.episode_num || "?") + " · " + esc(e.title || ""), id: e.id, ext: (e.container_extension || "mp4") });
          });
        });
      }
      if (!eps.length) { msg(el.browseMsg, "Sem episódios disponíveis."); return; }
      state.items = eps.map(function (e) { return { name: e.name, __ep: e }; });
      state.type = "episode";
      el.search.value = "";
      applyFilter();
      state.zone = "items";
      paint();
    }).catch(function (e) {
      loading(false);
      msg(el.browseMsg, e.message || "Erro ao carregar episódios");
    });
  }

  /* ---------- player ---------- */
  var fallbacks = [];
  function play(url, title, alts) {
    fallbacks = (alts || []).slice();
    show("player");
    el.pTitle.textContent = title || "";
    el.pState.textContent = "Carregando…";
    el.pOverlay.classList.remove("hide");
    startSrc(url);
    hideOverlaySoon();
  }

  function stopPlayback() {
    try { el.video.pause(); } catch (e) {}
    if (state.hls) { try { state.hls.destroy(); } catch (e) {} state.hls = null; }
    try { el.video.removeAttribute("src"); el.video.load(); } catch (e) {}
  }

  function startSrc(url) {
    stopPlayback();
    var isHls = /\.m3u8(\?|$)/i.test(url);
    var v = el.video;
    var canNative = v.canPlayType("application/vnd.apple.mpegurl") !== "" ||
      v.canPlayType("application/x-mpegURL") !== "";
    if (isHls && !canNative && window.Hls && window.Hls.isSupported()) {
      var hls = new window.Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 30 });
      state.hls = hls;
      hls.on(window.Hls.Events.ERROR, function (_e, data) {
        if (data && data.fatal) tryFallback("Erro de reprodução");
      });
      hls.loadSource(url);
      hls.attachMedia(v);
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () { safePlay(); });
    } else {
      v.src = url;
      safePlay();
    }
  }

  function safePlay() {
    var p = el.video.play();
    if (p && p.catch) p.catch(function () { /* autoplay gate: retry on user OK */ });
  }

  function tryFallback(reason) {
    if (fallbacks.length) {
      el.pState.textContent = "Tentando outro formato…";
      startSrc(fallbacks.shift());
      return;
    }
    el.pState.textContent = reason + ". Pressione VOLTAR.";
    el.pOverlay.classList.remove("hide");
  }

  el.video.addEventListener("playing", function () { el.pState.textContent = "Reproduzindo"; hideOverlaySoon(); });
  el.video.addEventListener("waiting", function () { el.pState.textContent = "Carregando…"; });
  el.video.addEventListener("pause", function () { el.pState.textContent = "Pausado"; el.pOverlay.classList.remove("hide"); });
  el.video.addEventListener("error", function () { tryFallback("Não foi possível reproduzir"); });

  function hideOverlaySoon() {
    clearTimeout(state.overlayTimer);
    state.overlayTimer = setTimeout(function () {
      if (!el.video.paused) el.pOverlay.classList.add("hide");
    }, 4000);
  }

  function exitPlayer() {
    stopPlayback();
    show("browse");
    state.zone = "items";
    paint();
  }

  /* ---------- remote / keys ---------- */
  function typing() {
    var a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
  }

  document.addEventListener("keydown", function (ev) {
    var k = ev.keyCode;
    if (state.screen === "login") {
      if (k === KEY.DOWN || k === KEY.UP) {
        ev.preventDefault();
        state.loginIndex = (state.loginIndex + (k === KEY.DOWN ? 1 : loginFields.length - 1)) % loginFields.length;
        focusLogin();
      } else if (k === KEY.BACK || k === KEY.ESC) {
        closeApp();
      }
      return;
    }
    if (state.screen === "player") {
      ev.preventDefault();
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.STOP) exitPlayer();
      else if (k === KEY.OK || k === KEY.PLAY || k === KEY.PAUSE) {
        if (el.video.paused) safePlay(); else el.video.pause();
        el.pOverlay.classList.remove("hide");
        hideOverlaySoon();
      } else if (k === KEY.RIGHT || k === KEY.LEFT) {
        if (isFinite(el.video.duration) && el.video.duration > 0) {
          el.video.currentTime = Math.max(0, Math.min(el.video.duration - 1,
            el.video.currentTime + (k === KEY.RIGHT ? 10 : -10)));
          el.pOverlay.classList.remove("hide");
          hideOverlaySoon();
        }
      }
      return;
    }
    // browse
    if (k === KEY.BACK || k === KEY.ESC) {
      ev.preventDefault();
      if (state.type === "episode") { selectTab(2); }
      else if (typing()) { el.search.blur(); state.zone = "items"; paint(); }
      else closeApp();
      return;
    }
    if (typing() && k !== KEY.UP && k !== KEY.DOWN) return;

    var cols = 3;
    if (k === KEY.UP || k === KEY.DOWN || k === KEY.LEFT || k === KEY.RIGHT || k === KEY.OK) ev.preventDefault();

    if (state.zone === "tabs") {
      if (k === KEY.LEFT) state.tabIndex = Math.max(0, state.tabIndex - 1);
      else if (k === KEY.RIGHT) state.tabIndex = Math.min(tabs.length - 1, state.tabIndex + 1);
      else if (k === KEY.DOWN) state.zone = "cats";
      else if (k === KEY.OK) { selectTab(state.tabIndex); state.zone = "cats"; }
      paint();
      return;
    }
    if (state.zone === "search") {
      if (k === KEY.DOWN) { el.search.blur(); state.zone = "items"; }
      else if (k === KEY.UP) { el.search.blur(); state.zone = "tabs"; }
      paint();
      return;
    }
    if (state.zone === "cats") {
      if (k === KEY.DOWN) state.catIndex = Math.min(state.cats.length - 1, state.catIndex + 1);
      else if (k === KEY.UP) {
        if (state.catIndex === 0) state.zone = "tabs";
        else state.catIndex--;
      } else if (k === KEY.RIGHT) state.zone = "items";
      else if (k === KEY.OK) { loadItems(state.cats[state.catIndex].category_id); state.zone = "items"; }
      if (state.zone === "cats" && (k === KEY.UP || k === KEY.DOWN) && state.cats[state.catIndex])
        loadItems(state.cats[state.catIndex].category_id);
      paint();
      return;
    }
    if (state.zone === "items") {
      var n = el.itemList.children.length;
      if (!n) { if (k === KEY.LEFT) { state.zone = "cats"; paint(); } return; }
      if (k === KEY.RIGHT) state.itemIndex = Math.min(n - 1, state.itemIndex + 1);
      else if (k === KEY.LEFT) {
        if (state.itemIndex % cols === 0) state.zone = "cats";
        else state.itemIndex--;
      } else if (k === KEY.DOWN) state.itemIndex = Math.min(n - 1, state.itemIndex + cols);
      else if (k === KEY.UP) {
        if (state.itemIndex < cols) { state.zone = "search"; try { el.search.focus(); } catch (e) {} }
        else state.itemIndex -= cols;
      } else if (k === KEY.OK) {
        var it = state.filtered[state.itemIndex];
        if (it && it.__ep) play(streamUrl("series", it.__ep.id, it.__ep.ext), it.name, [streamUrl("series", it.__ep.id, "mp4")]);
        else openItem(it);
      }
      paint();
    }
  });

  function closeApp() {
    if (window.webOS && window.webOS.platformBack) { try { window.webOS.platformBack(); return; } catch (e) {} }
    try { window.close(); } catch (e) {}
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state.screen === "player") { try { el.video.pause(); } catch (e) {} }
  });
  window.addEventListener("error", function (e) {
    if (state.screen === "browse") msg(el.browseMsg, "");
    if (window.console) console.warn("app error:", e && e.message);
  });

  /* ---------- boot ---------- */
  var saved = loadAcc();
  initLoginFocus();
  if (saved && saved.host && saved.user && saved.pass) {
    el.f_host.value = saved.host; el.f_user.value = saved.user; el.f_pass.value = saved.pass;
    doLogin(saved.host, saved.user, saved.pass, true);
  }
})();
