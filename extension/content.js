/*
 * Runs on goofish.com. On a listing, seller or search page it either sends the
 * tab to the Viewer (automatic mode) or shows a floating "ver em português" button.
 */
(function () {
  "use strict";
  if (window.top !== window) return;

  // The Viewer's "Abrir no Goofish" button adds #xv-stay: keep that tab on Goofish.
  try {
    if (location.hash.indexOf("xv-stay") >= 0) sessionStorage.setItem("xv-stay", "1");
  } catch (e) { /* storage blocked: ignore */ }
  function stayHere() {
    try { return sessionStorage.getItem("xv-stay") === "1"; } catch (e) { return false; }
  }

  var auto = true;
  var shown = null;      // key of the page the button is showing
  var hostEl = null, btn = null;

  function ensureButton() {
    if (hostEl && document.documentElement.contains(hostEl)) return;
    hostEl = document.createElement("div");
    hostEl.id = "xv-viewer-button";
    hostEl.style.cssText = "position:fixed;right:20px;bottom:24px;z-index:2147483647;";
    var shadow = hostEl.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      '<style>' +
      'a{display:flex;align-items:center;gap:8px;background:#FFE400;color:#1a1a1a;border:2px solid #1a1a1a;' +
      'border-radius:26px;padding:11px 18px;font:700 15px/1.2 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;' +
      'text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer}' +
      'a:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(0,0,0,.3)}' +
      '</style><a id="b" target="_self"></a>';
    btn = shadow.getElementById("b");
    document.documentElement.appendChild(hostEl);
  }

  function showButton(t) {
    ensureButton();
    btn.textContent = t.type === "search" ? "🐟 Buscar em português ›" : "🐟 Ver em português ›";
    btn.href = XV.viewerUrl(t);
    hostEl.style.display = "block";
  }
  function hideButton() { if (hostEl) hostEl.style.display = "none"; }

  function check() {
    var t = XV.parse(location.href);
    var key = t ? JSON.stringify(t) : null;
    if (key === shown) return;
    shown = key;
    if (!t) { hideButton(); return; }
    if (auto && !stayHere()) {
      // replace(): the Back button skips this Goofish page instead of bouncing back to it
      location.replace(XV.viewerUrl(t));
      return;
    }
    showButton(t);
  }

  chrome.storage.sync.get({ auto: true }, function (s) {
    auto = s.auto !== false;
    check();
    // Goofish changes pages without reloading (search box, clicks): watch the address.
    setInterval(check, 700);
  });
  chrome.storage.onChanged.addListener(function (c) {
    if (c.auto) { auto = c.auto.newValue !== false; shown = null; check(); }
  });
})();
