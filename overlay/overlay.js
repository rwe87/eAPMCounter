(function () {
  // Relative URL: the page is served by the same program that serves the number.
  var URL = "/eapm";
  var el = document.getElementById("eapm-value");
  if (!el) return;

  function show(text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function tick() {
    fetch(URL, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        show(d && d.inGame && d.eapm !== null ? String(d.eapm) : "0");
      })
      .catch(function () { show("0"); });
  }

  tick();
  setInterval(tick, 1000);
})();
