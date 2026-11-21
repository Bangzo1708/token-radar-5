// Token Launch Radar — dashboard logic. Reads window.TOKEN_RADAR (written
// by main.ts as data.js beside the page), renders the board, the filters and
// the detail view. No network: every byte it needs ships with the entry.
(function () {
  var D = window.TOKEN_RADAR;
  if (!D || !D.rows) { document.getElementById("rows").innerHTML = "<tr><td colspan=10>No board data.</td></tr>"; return; }
  var rows = D.rows, meta = D.meta;

  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }
  function pct(x) { return x === null || x === undefined ? "—" : (x > 0 ? "+" : "") + x.toFixed(1) + "%"; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // ---- header stats -------------------------------------------------------
  var total = meta.total_implied_value_usd;
  document.getElementById("stats").innerHTML =
    "<div class=stat><b>" + money(total) + "</b><span>board implied value</span></div>" +
    "<div class=stat><b>" + rows.length + "</b><span>protocols ranked</span></div>" +
    "<div class=stat><b>" + rows.filter(function (r) { return r.watchlist; }).length + "</b><span>watchlist covered</span></div>" +
    "<div class=stat><b>" + esc(rows[0].name) + "</b><span>rank 1 · " + money(rows[0].implied_value_usd) + "</span></div>";

  // ---- filter controls ----------------------------------------------------
  var catSel = document.getElementById("cat"), chainSel = document.getElementById("chain");
  var cats = {}, chains = {};
  rows.forEach(function (r) { if (r.category) cats[r.category] = 1; r.chains.forEach(function (c) { chains[c] = 1; }); });
  Object.keys(cats).sort().forEach(function (c) { catSel.add(new Option(c, c)); });
  Object.keys(chains).sort().forEach(function (c) { chainSel.add(new Option(c, c)); });

  var state = { q: "", cat: "", chain: "", wl: false, sort: "implied", sel: rows[0].slug };

  function filtered() {
    var list = rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if ((r.name + " " + r.slug).toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var by = {
      implied: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || -1e9) - (a.change_7d || -1e9); },
      age: function (a, b) { return (b.age_days || -1) - (a.age_days || -1); },
      name: function (a, b) { return a.name < b.name ? -1 : 1; },
    }[state.sort] || function (a, b) { return a.rank - b.rank; };
    return list.sort(by);
  }

  function renderBoard() {
    var list = filtered();
    document.getElementById("count").textContent = list.length + " of " + rows.length + " shown";
    var html = "";
    list.forEach(function (r) {
      var chg = r.change_7d, cls = chg === null ? "" : chg >= 0 ? "pos" : "neg";
      html += "<tr data-slug=\"" + esc(r.slug) + "\" class=\"" + (r.slug === state.sel ? "sel" : "") + "\">" +
        "<td class=rank>" + r.rank + "</td>" +
        "<td class=pname>" + esc(r.name) + (r.watchlist ? "<span class=wl>WL</span>" : "") + "</td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        "<td>" + esc(r.chains.slice(0, 2).join(", ")) + (r.chains.length > 2 ? " +" + (r.chains.length - 2) : "") + "</td>" +
        "<td class=num>" + money(r.tvl_usd) + "</td>" +
        "<td class=\"num " + cls + "\">" + pct(chg) + "</td>" +
        "<td class=num>" + (r.age_days === null ? "—" : r.age_days + "d") + "</td>" +
        "<td class=num>" + r.multiple.toFixed(2) + "×</td>" +
        "<td class=num>" + Math.round(r.launch_probability * 100) + "%</td>" +
        "<td class=\"num imp\">" + money(r.implied_value_usd) + "</td></tr>";
    });
    document.getElementById("rows").innerHTML = html || "<tr><td colspan=10>Nothing matches this filter.</td></tr>";
  }

  function renderDetail() {
    var r = rows.filter(function (x) { return x.slug === state.sel; })[0] || rows[0];
    var age = r.age_days === null ? "listed date not reported" : r.age_days + " days with no token recorded";
    document.getElementById("detail").innerHTML =
      "<h2>" + esc(r.name) + "</h2>" +
      "<p class=meta>Rank #" + r.rank + " · " + esc(r.category || "Uncategorised") + " · " + esc(r.chains.join(", ")) +
      (r.watchlist ? " · on the watchlist" : " · below the $50M floor") + "</p>" +
      "<span class=badge>TVL " + money(r.tvl_usd) + "</span>" +
      "<span class=badge>7d " + pct(r.change_7d) + "</span>" +
      "<span class=badge>" + age + "</span>" +
      "<span class=badge>Implied value " + money(r.implied_value_usd) + "</span>" +
      "<table class=fact>" +
      "<tr><td>Category multiple (median mcap/TVL)</td><td>" + r.multiple.toFixed(3) + "×</td></tr>" +
      "<tr><td>Tier factor (diminishing returns)</td><td>" + r.tier_factor.toFixed(3) + "×</td></tr>" +
      "<tr><td>Growth factor (7-day change)</td><td>" + r.growth_factor.toFixed(3) + "×</td></tr>" +
      "<tr><td>Breadth factor (" + r.chains.length + " chain" + (r.chains.length > 1 ? "s" : "") + ")</td><td>" + r.breadth_factor.toFixed(3) + "×</td></tr>" +
      "<tr><td>Launch probability (" + age + ")</td><td>" + Math.round(r.launch_probability * 100) + "%</td></tr>" +
      "<tr><td>Implied fully-diluted value</td><td>" + money(r.implied_fdv_usd) + "</td></tr>" +
      "<tr><td>Implied value (× 7% airdrop share)</td><td>" + money(r.implied_value_usd) + "</td></tr>" +
      "</table>" +
      "<p class=math>" + money(r.tvl_usd) + " × " + r.multiple.toFixed(3) + " × " + r.tier_factor.toFixed(3) + " × " + r.growth_factor.toFixed(3) + " × " + r.breadth_factor.toFixed(3) + " = " + money(r.implied_fdv_usd) + " FDV; × " + Math.round(r.launch_probability * 100) + "% launch × 7% = " + money(r.implied_value_usd) + "</p>" +
      "<h2 style=\"margin-top:12px;font-size:15px\">How to farm it</h2>" +
      "<ol class=steps>" + r.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
  }

  function render() { renderBoard(); renderDetail(); }

  // ---- events -------------------------------------------------------------
  document.getElementById("q").addEventListener("input", function (e) { state.q = e.target.value; renderBoard(); });
  catSel.addEventListener("change", function (e) { state.cat = e.target.value; renderBoard(); });
  chainSel.addEventListener("change", function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById("wl").addEventListener("change", function (e) { state.wl = e.target.checked; renderBoard(); });
  document.getElementById("sort").addEventListener("change", function (e) { state.sort = e.target.value; renderBoard(); });
  document.getElementById("rows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-slug]");
    if (!tr) return;
    state.sel = tr.getAttribute("data-slug");
    render();
  });

  // ---- hash views: #detail=<slug> and #filter=category:<name> ------------
  // Screenshots and shared links use these: the board view is the default,
  // a detail view opens one protocol, a filtered view applies one filter.
  function applyHash() {
    var h = location.hash.replace(/^#/, "");
    var m = h.match(/detail=([\w\-.]+)/);
    if (m && rows.some(function (r) { return r.slug === m[1]; })) state.sel = m[1];
    var f = h.match(/filter=category:([^&]+)/);
    if (f) { state.cat = decodeURIComponent(f[1]); catSel.value = state.cat; }
    if (m) setTimeout(function () { document.getElementById("detail").scrollIntoView({ behavior: "auto", block: "start" }); }, 60);
  }
  applyHash();
  render();
})();
