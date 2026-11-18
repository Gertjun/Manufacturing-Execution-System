// Draait in het invoerscherm en de portalen binnen de demo: API-verzoeken gaan naar de
// nagebootste server in het bovenliggende venster in plaats van over het netwerk.
(function () {
  var API = ["/auth", "/config", "/batches", "/registraties", "/lots", "/werkvoorraad", "/beheer", "/analyse", "/gezondheid"];
  var echt = window.fetch.bind(window);
  function isApi(url) {
    return typeof url === "string" && url.charAt(0) === "/" &&
      API.some(function (p) { return url === p || url.indexOf(p + "/") === 0 || url.indexOf(p + "?") === 0; });
  }
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input && input.url;
    if (!isApi(url)) return echt(input, init);
    init = init || {};
    var headers = {};
    if (init.headers) {
      if (typeof init.headers.forEach === "function" && !Array.isArray(init.headers)) init.headers.forEach(function (w, k) { headers[k] = w; });
      else Object.keys(init.headers).forEach(function (k) { headers[k] = init.headers[k]; });
    }
    return window.parent.demoApi({ methode: init.method || "GET", url: url, headers: headers, body: init.body })
      .then(function (r) { return new Response(r.body || null, { status: r.status, headers: { "content-type": "application/json" } }); });
  };
  // Geen service worker in de demo (de pagina's laden toch uit de demo zelf).
  if (navigator.serviceWorker) {
    try { navigator.serviceWorker.register = function () { return Promise.reject(new Error("demo")); }; } catch (e) {}
  }
  // Links tussen invoerscherm en portalen: wissel van tabblad in de demo.
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var h = a.getAttribute("href");
    if (h === "/invoer/" || h === "/portaal/") {
      e.preventDefault();
      window.parent.demoOpen(h === "/invoer/" ? "invoer" : "portaal");
    }
  }, true);
})();
