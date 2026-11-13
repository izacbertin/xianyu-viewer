(function () {
  "use strict";

  function open(url) { chrome.tabs.create({ url: url }); window.close(); }

  document.getElementById("f").addEventListener("submit", function (e) {
    e.preventDefault();
    var t = XV.fromText(document.getElementById("q").value);
    if (t) open(XV.viewerUrl(t));
  });
  document.getElementById("open").addEventListener("click", function (e) {
    e.preventDefault();
    open(XV.VIEWER);
  });

  // If the current tab is a Goofish listing, seller or search, offer to open it.
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var t = tabs && tabs[0] && tabs[0].url ? XV.parse(tabs[0].url) : null;
    if (!t) return;
    var b = document.getElementById("here");
    b.textContent = t.type === "item" ? "Ver este anúncio em português ›"
      : t.type === "seller" ? "Ver este vendedor em português ›"
      : "Ver esta busca em português ›";
    b.style.display = "block";
    b.addEventListener("click", function () { open(XV.viewerUrl(t)); });
  });

  var auto = document.getElementById("auto");
  chrome.storage.sync.get({ auto: true }, function (s) { auto.checked = s.auto !== false; });
  auto.addEventListener("change", function () { chrome.storage.sync.set({ auto: auto.checked }); });

  document.getElementById("q").focus();
})();
