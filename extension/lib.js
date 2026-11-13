/*
 * Shared by the content script, the popup and the background worker.
 * Recognizes Goofish/Xianyu links and builds the matching Viewer URL.
 */
(function (root) {
  "use strict";

  var VIEWER = "https://izacbertin.github.io/xianyu-viewer/";

  var GOOFISH_HOST = /(^|\.)goofish\.com$|^2\.taobao\.com$/i;
  var TAOBAO_IDLE_HOST = /^(market\.m|h5\.m)\.taobao\.com$/i;

  function digits(v, min) {
    v = String(v || "").trim();
    return new RegExp("^\\d{" + min + ",}$").test(v) ? v : null;
  }

  /** Returns {type:"item"|"seller", id} or {type:"search", q} for a Goofish URL, else null. */
  function parse(href, depth) {
    var u;
    try { u = new URL(href); } catch (e) { return null; }
    var host = u.hostname, path = u.pathname, p = u.searchParams;

    if (!GOOFISH_HOST.test(host) && !(TAOBAO_IDLE_HOST.test(host) && /idle/i.test(path))) {
      // Shopping-agent and redirect links often carry the Goofish link inside a parameter.
      if ((depth || 0) > 0) return null;
      var decoded = href;
      try { decoded = decodeURIComponent(href); } catch (e) { /* keep raw */ }
      var inner = decoded.match(/https?:\/\/(?:[\w-]+\.)*goofish\.com\/[^\s"'<>]*/i);
      return inner ? parse(inner[0], 1) : null;
    }

    var userId = digits(p.get("userId") || p.get("userid"), 5);
    if (/personal|user/i.test(path) && userId) return { type: "seller", id: userId };

    var id = digits(p.get("id") || p.get("itemId") || p.get("itemid"), 6);
    if (/item|detail/i.test(path) && id) return { type: "item", id: id };

    if (/search/i.test(path)) {
      var q = (p.get("q") || p.get("keyword") || "").replace(/\s+/g, " ").trim();
      if (q) return { type: "search", q: q.slice(0, 80) };
    }
    return null;
  }

  /** Text the user selected or typed: a link, a bare listing id, or words to search. */
  function fromText(text) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    var link = text.match(/https?:\/\/\S+/);
    if (link) { var r = parse(link[0]); if (r) return r; }
    if (/^\d{8,}$/.test(text)) return { type: "item", id: text };
    return text.length >= 2 ? { type: "search", q: text.slice(0, 80) } : null;
  }

  function viewerUrl(t) {
    if (!t) return VIEWER;
    if (t.type === "item") return VIEWER + "?id=" + t.id;
    if (t.type === "seller") return VIEWER + "?seller=" + t.id;
    return VIEWER + "?q=" + encodeURIComponent(t.q);
  }

  root.XV = { VIEWER: VIEWER, parse: parse, fromText: fromText, viewerUrl: viewerUrl };
})(typeof globalThis !== "undefined" ? globalThis : this);
