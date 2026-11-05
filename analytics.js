/*
 * マドリモ 利用状況の計測（Google アナリティクス 4）
 *
 * 方針
 *  - 測定IDが未設定・形式不正・対象外のホストでは、何も読み込まず何も送信しない（完全停止）。
 *  - 送るのは「イベント名」と、下の EVENTS に定義した集計用の値だけ。
 *    現場名・住所・調査日・部屋名・寸法・仕様・メモ・写真・保存データ・バックアップ内容は送らない。
 *    EVENTS にない項目や、許可していない値は送信前に捨てる。
 *  - ページURLはクエリ・ハッシュを除いたもの、ページタイトルは固定文字列で送る。
 *  - Google シグナル・広告のパーソナライズは無効。
 *  - 利用者は「使い方」画面からいつでも計測を止められる（端末ごとに記録）。
 */
(function(){
  'use strict';

  // ▼ マドリモ専用 GA4 プロパティの測定ID（G-XXXXXXXXXX）。空のままなら計測しない。
  //   他アプリ用の測定IDを流用しないこと。
  var MEASUREMENT_ID = 'G-GC5QG4X5YD';

  // 計測を有効にする公開ホスト
  var ALLOWED_HOSTS = ['madorimo.ktm-work.com'];

  var OPT_OUT_KEY = 'madorimo_analytics_optout';
  var NOTICE_KEY = 'madorimo_analytics_notice_v1';
  var PAGE_TITLE = 'マドリモ 現場調査シート';

  // 送ってよいイベントと、その値。値は列挙値か小さな整数のみ。
  var EVENTS = {
    app_open:         {launch_mode: ['standalone', 'browser']},
    site_save:        {save_kind: ['new', 'update'], window_count_range: 'range'},
    site_new:         {},
    site_list_open:   {},
    window_add:       {},
    window_duplicate: {},
    window_delete:    {},
    photo_add:        {photo_count: 'int'},
    bulk_color_apply: {window_count_range: 'range'},
    pdf_preview:      {},
    pdf_export:       {method: ['share', 'download']},
    pdf_zip_export:   {method: ['share', 'download']},
    backup_export:    {scope: ['changed', 'full', 'selected'], record_count_range: 'range'},
    backup_restore:   {record_count_range: 'range'},
    manual_open:      {}
  };

  // 開発時の検証用（localhost でのみ有効。本番では無視される）
  var override = null;
  try {
    var h = location.hostname;
    if ((h === 'localhost' || h === '127.0.0.1') && window.__MADORIMO_ANALYTICS_TEST__) {
      override = window.__MADORIMO_ANALYTICS_TEST__;
    }
  } catch (_) {}

  var id = override && override.measurementId != null ? String(override.measurementId) : MEASUREMENT_ID;
  var hosts = override ? [location.hostname] : ALLOWED_HOSTS;
  var debug = !!(override && override.debug);

  function lsGet(k){ try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v){ try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k){ try { localStorage.removeItem(k); } catch (_) {} }

  var configured = /^G-[A-Z0-9]{4,20}$/.test(id) && hosts.indexOf(location.hostname) >= 0;
  var optedOut = lsGet(OPT_OUT_KEY) === '1';
  var active = false;
  var loaded = false;

  function range(n){
    n = Number(n);
    if (!isFinite(n) || n < 0) return undefined;
    if (n === 0) return '0';
    if (n === 1) return '1';
    if (n <= 5) return '2-5';
    if (n <= 10) return '6-10';
    if (n <= 20) return '11-20';
    return '21+';
  }

  function clean(name, params){
    var spec = EVENTS[name];
    if (!spec) return null;
    var out = {};
    params = params || {};
    Object.keys(spec).forEach(function(k){
      var rule = spec[k], v = params[k];
      if (v == null) return;
      if (Array.isArray(rule)) { if (rule.indexOf(v) >= 0) out[k] = v; }
      else if (rule === 'int') { v = Math.floor(Number(v)); if (isFinite(v) && v >= 0 && v <= 99) out[k] = v; }
      else if (rule === 'range') { v = range(v); if (v) out[k] = v; }
    });
    return out;
  }

  function cleanLocation(){ return location.origin + location.pathname; }
  function cleanReferrer(){
    try { return document.referrer ? new URL(document.referrer).origin + '/' : ''; } catch (_) { return ''; }
  }

  function start(){
    if (!configured || optedOut || active) return;
    active = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
    var common = {
      page_location: cleanLocation(),
      page_referrer: cleanReferrer(),
      page_title: PAGE_TITLE
    };
    window.gtag('js', new Date());
    window.gtag('set', common);
    window.gtag('set', {allow_google_signals: false, allow_ad_personalization_signals: false});
    var cfg = {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: common.page_location,
      page_referrer: common.page_referrer,
      page_title: PAGE_TITLE
    };
    if (debug) cfg.debug_mode = true;
    window.gtag('config', id, cfg);
    window.gtag('event', 'page_view', common);
    if (!loaded) {
      loaded = true;
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
      document.head.appendChild(s);
    }
  }

  function track(name, params){
    if (!active || optedOut) return;
    var p = clean(name, params);
    if (!p) return;
    try { window.gtag('event', name, p); } catch (_) {}
  }

  function setOptOut(off){
    optedOut = !!off;
    if (optedOut) {
      lsSet(OPT_OUT_KEY, '1');
      if (active) window['ga-disable-' + id] = true;
    } else {
      lsDel(OPT_OUT_KEY);
      window['ga-disable-' + id] = false;
      if (!active) start(); else track('app_open', {launch_mode: launchMode()});
    }
    renderStatus();
  }

  function launchMode(){
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
      if (navigator.standalone) return 'standalone';
    } catch (_) {}
    return 'browser';
  }

  // ---- 利用者向けの表示 ----
  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function renderStatus(){
    var box = document.getElementById('analyticsStatus');
    if (!box) return;
    if (!configured) {
      box.innerHTML = '<p class="analytics-state">現在、このアプリでは利用状況の計測を行っていません。</p>';
      return;
    }
    box.innerHTML =
      '<p class="analytics-state">この端末での計測：<strong>' + (optedOut ? '停止中' : '計測中') + '</strong></p>' +
      '<button type="button" class="analytics-toggle">' + esc(optedOut ? '計測を再開する' : 'この端末では計測しない') + '</button>';
    box.querySelector('.analytics-toggle').addEventListener('click', function(){ setOptOut(!optedOut); });
  }

  function showNotice(){
    if (!configured || lsGet(NOTICE_KEY) === '1') return;
    var bar = document.createElement('div');
    bar.className = 'analytics-notice no-print';
    bar.setAttribute('role', 'status');
    bar.innerHTML =
      '<p>改善のため、操作の回数（保存・PDF作成など）と端末の種類をGoogle アナリティクスで計測しています。現場名・住所・寸法・写真などの入力内容は送信しません。</p>' +
      '<div class="analytics-notice-actions">' +
      '<button type="button" data-a="more">詳しく</button>' +
      '<button type="button" data-a="off">計測しない</button>' +
      '<button type="button" data-a="ok" class="primary">OK</button></div>';
    bar.addEventListener('click', function(e){
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (!a) return;
      if (a === 'more') { if (typeof window.openManual === 'function') { window.openManual(); var t = document.getElementById('analyticsInfo'); if (t) t.scrollIntoView(); } return; }
      if (a === 'off') setOptOut(true);
      lsSet(NOTICE_KEY, '1');
      bar.remove();
    });
    document.body.appendChild(bar);
  }

  function injectStyle(){
    var st = document.createElement('style');
    st.textContent =
      '.analytics-notice{position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:150;max-width:640px;margin:0 auto;background:#fff;border:1px solid var(--bd,#d8d4cc);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.18);padding:12px 14px;font-size:13px;line-height:1.6;color:var(--text,#1a1a1a)}' +
      '.analytics-notice p{margin:0 0 8px}' +
      '.analytics-notice-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}' +
      '.analytics-notice button,.analytics-toggle{padding:7px 12px;border:1px solid var(--bd,#d8d4cc);border-radius:6px;background:#fff;font-size:13px;cursor:pointer}' +
      '.analytics-notice button.primary{background:var(--accent,#1a4a7a);color:#fff;border-color:var(--accent,#1a4a7a)}' +
      '@media print{.analytics-notice{display:none!important}}';
    document.head.appendChild(st);
  }

  window.MadorimoAnalytics = {
    track: track,
    range: range,
    isActive: function(){ return active && !optedOut; },
    isConfigured: function(){ return configured; },
    setOptOut: setOptOut,
    renderStatus: renderStatus,
    _events: Object.keys(EVENTS),
    _clean: clean
  };

  function boot(){
    injectStyle();
    renderStatus();
    if (!configured) return;
    start();
    track('app_open', {launch_mode: launchMode()});
    showNotice();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
