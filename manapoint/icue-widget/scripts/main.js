// Polls the Manapoint loopback endpoint and renders one mini-bar per window.
// iCUE injects endpointUrl / refreshSec globals from the widget properties;
// typeof-guards keep it working in preview mode before injection happens.
var timer = 0;

function endpoint() {
  return (typeof endpointUrl !== "undefined" && endpointUrl) || "http://127.0.0.1:47901/v1/usage";
}

function intervalMs() {
  var s = (typeof refreshSec !== "undefined" && refreshSec) || 60;
  s = Number(s) || 60;
  return Math.min(300, Math.max(15, s)) * 1000;
}

function kindLabel(kind) {
  return kind === "Rolling" ? "5H" : kind === "Weekly" ? "WEEK" : kind === "Monthly" ? "MONTH" : String(kind);
}

function barColor(percent) {
  return percent >= 85 ? "#f87171" : percent >= 60 ? "#fbbf24" : "#4ade80";
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;";
  });
}

function setStatus(ok, when) {
  document.getElementById("dot").className = ok ? "" : "off";
  document.getElementById("ago").textContent = ok ? when : "offline";
}

function render(data) {
  var html = "";
  (data.cards || []).forEach(function (card) {
    html += '<div class="card"><div class="cname">' + esc(card.name) + "</div>";
    (card.windows || []).forEach(function (w) {
      var p = Math.max(0, Math.min(100, w.percent));
      html += '<div class="win"><span class="k">' + esc(kindLabel(w.kind)) + "</span>" +
        '<div class="track"><span class="fill" style="width: ' + p + "%; background: " + barColor(w.percent) + '"></span></div>' +
        '<span class="pct">' + Math.round(w.percent) + "%</span></div>";
    });
    var aside = card.error || card.note;
    if (aside) html += '<div class="sub">' + esc(aside) + "</div>";
    html += "</div>";
  });
  document.getElementById("cards").innerHTML = html || '<div class="sub">no data</div>';
}

function stamp() {
  var d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function refresh() {
  fetch(endpoint(), { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    })
    .then(function (data) {
      render(data);
      setStatus(true, stamp());
    })
    .catch(function () {
      setStatus(false);
    });
}

function reboot() {
  if (timer) clearInterval(timer);
  refresh();
  timer = setInterval(refresh, intervalMs());
}

function boot() {
  reboot();
}
