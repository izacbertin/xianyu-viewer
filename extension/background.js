/* Right-click menus: open a Goofish link, or search the selected text, in the Viewer. */
importScripts("lib.js");

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: "xv-link",
      title: "Abrir no Viewer em português",
      contexts: ["link"],
      targetUrlPatterns: ["*://*.goofish.com/*", "*://2.taobao.com/*", "*://market.m.taobao.com/*", "*://h5.m.taobao.com/*"],
    });
    chrome.contextMenus.create({
      id: "xv-selection",
      title: "Buscar no Viewer: “%s”",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  var t = info.menuItemId === "xv-link" ? XV.parse(info.linkUrl) : XV.fromText(info.selectionText);
  var opts = { url: XV.viewerUrl(t) };
  if (tab && tab.index != null) opts.index = tab.index + 1;
  chrome.tabs.create(opts);
});
