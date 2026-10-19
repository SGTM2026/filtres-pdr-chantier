/* Filtres & PDR Chantier – application web (Supabase) */
(function () {
"use strict";
const CFG = window.APP_CONFIG || {};
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const today = () => ymd(new Date());
const fD = iso => iso && iso.length >= 10 ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : (iso || "");
const fDT = iso => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const nb = v => (v === null || v === undefined || v === "") ? "" : (+v).toLocaleString("fr-FR");
const N = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const has = v => v !== null && v !== undefined && v !== "";
const norm = s => String(s ?? "").toLowerCase();
const LIMIT = 300;
const toEmail = id => { id = id.trim().toLowerCase(); return id.includes("@") ? id : id + "@" + (CFG.DOMAINE_IDENTIFIANT || "filtres.example.com"); };
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; $("#toasts").appendChild(t); setTimeout(() => t.remove(), 6000); }
function errMsg(e) {
  const m = (e && (e.message || e.error_description || e.error)) || String(e || "");
  if (/row-level security|permission denied/i.test(m)) return "Action refusée : vos droits ne permettent pas cette modification.";
  if (/Invalid login credentials/i.test(m)) return "Identifiant ou mot de passe incorrect.";
  if (/banned|User is banned/i.test(m)) return "Ce compte est désactivé. Contactez l'administrateur.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Connexion impossible : vérifiez le réseau.";
  return m || "Erreur inconnue.";
}

if (!window.supabase || !CFG.SUPABASE_URL || /VOTRE/.test(CFG.SUPABASE_URL)) {
  document.body.innerHTML = '<div style="max-width:560px;margin:60px auto;padding:20px;font-family:Arial"><h2>Configuration à terminer</h2><p>Ouvrez le fichier <b>config.js</b> et renseignez l\'adresse et la clé publique de votre projet Supabase (voir le guide d\'installation).</p></div>';
  return;
}
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const APPNAME = CFG.NOM_APPLICATION || "Filtres & PDR Chantier";
document.title = APPNAME; $("#login-title").textContent = $("#app-title").textContent = APPNAME;

/* ---------- catégories ---------- */
const CATS = {
  FILTRE: { label: "Filtres", one: "filtre", many: "filtres", type: "Type de filtre", ref: "Référence filtre" },
  PDR: { label: "PDR", one: "pièce", many: "pièces (PDR)", type: "Désignation de la pièce", ref: "Référence pièce" }
};
const catOf = c => (c === "PDR" ? "PDR" : "FILTRE");
const catPill = c => '<span class="pill ' + (c === "PDR" ? "p-acc" : "p-info") + '">' + (c === "PDR" ? "PDR" : "Filtre") + "</span>";
function catTabs(cur, withAll) {
  const items = (withAll ? [["", "Tout"]] : []).concat([["FILTRE", "Filtres"], ["PDR", "PDR (pièces de rechange)"]]);
  return '<div class="subtabs" role="tablist">' + items.map(([k, l]) => '<button class="btn" data-cat="' + k + '" aria-pressed="' + (cur === k) + '">' + l + "</button>").join("") + "</div>";
}

/* ---------- état ---------- */
const S = {
  view: "dash", uid: null, me: null, role: "", isAdmin: false, canWrite: false, canDA: false, canCreateDA: false, canNumDA: false, lastSeen: null,
  da: new Map(), daL: new Map(),
  engins: new Map(), depart: new Map(), entrees: new Map(), sorties: new Map(), profiles: new Map(), journal: [],
  params: { nom_chantier: "", types: [], interventions: [], ateliers: [], unites: [], seuil: 1, seuil_pdr: 1 },
  f: { cat: "FILTRE", stockCat: "", depCat: "", stockQ: "", stockSt: "", entQ: "", entSt: "", entFrom: "", entTo: "", sorQ: "", sorFrom: "", sorTo: "", engQ: "", depQ: "", jQ: "", jUser: "", jTab: "", daQ: "", sdaQ: "", sdaFrom: "", sdaTo: "" },
  selEngin: "", selRef: "", loaded: false
};
let C = null;

/* ---------- correspondance base <-> application ---------- */
const mapE = r => ({ id: r.id, cat: catOf(r.categorie), date: r.date, ref: r.ref, type: r.type || "", marque: r.marque || "", equiv: r.equiv || "", dem: r.qte_bc, liv: r.qte_bl, bc: r.num_bc || "", bl: r.num_bl || "", engin: r.engin || "", obs: r.obs || "", source: r.source, createdAt: r.created_at, createdBy: r.created_by, updatedAt: r.updated_at, updatedBy: r.updated_by });
const mapS = r => ({ id: r.id, cat: catOf(r.categorie), date: r.date, engin: r.engin || "", enginInit: r.engin_initial || "", compteur: r.compteur, intervention: r.intervention || "", ref: r.ref, qte: r.qte, atelier: r.atelier || "", obs: r.obs || "", source: r.source, createdAt: r.created_at, createdBy: r.created_by, updatedAt: r.updated_at, updatedBy: r.updated_by });
const mapG = r => ({ code: String(r.code), designation: r.designation || "", marque: r.marque || "", modele: r.modele || "", serie: r.serie || "", unite: r.unite || "", intervalle: r.intervalle, statut: r.statut || "",
  refs: { huile: r.ref_huile || "", gasoil: r.ref_gasoil || "", separateur: r.ref_separateur || "", airP: r.ref_air_p || "", airS: r.ref_air_s || "", hydraulique: r.ref_hydraulique || "", transmission: r.ref_transmission || "" } });
const mapD = r => ({ id: r.id, cat: catOf(r.categorie), date: r.date_inv || "", engin: r.engin || "", ref: r.ref, type: r.type || "", marque: r.marque || "", equiv: r.equiv || "", qte: r.qte, min: r.stock_min, empl: r.emplacement || "", obs: r.obs || "" });

/* ---------- calcul du stock (mêmes règles que le classeur Excel, par catégorie) ---------- */
const KEY = (cat, ref, eng) => cat + "|" + ref + "|" + (eng || "COMMUN");
function compute() {
  const engMap = S.engins;
  const depart = [...S.depart.values()].sort((a, b) => a.id - b.id);
  const byDate = (a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || "").localeCompare(b.createdAt || "") || a.id - b.id;
  const ent = [...S.entrees.values()].sort(byDate), sor = [...S.sorties.values()].sort(byDate);
  const lines = new Map(), firstDep = new Map(), firstEnt = new Map(), maxMinRef = new Map(), refCat = new Map();
  const get = (cat, ref, eng) => { const key = KEY(cat, ref, eng); let l = lines.get(key); if (!l) { l = { key, cat, ref, engin: eng || "", dep: 0, ent: 0, sor: 0, minSum: 0, hasMin: false, lastE: "", lastS: "", users: new Set() }; lines.set(key, l); } return l; };
  for (const d of depart) { if (!d.ref) continue; const ref = String(d.ref), eng = String(d.engin || ""), ck = d.cat + "|" + ref;
    if (!firstDep.has(ck)) firstDep.set(ck, d); if (!refCat.has(ref)) refCat.set(ref, d.cat);
    const l = get(d.cat, ref, eng); l.dep += N(d.qte);
    if (has(d.min)) { l.hasMin = true; l.minSum += N(d.min); maxMinRef.set(ck, Math.max(maxMinRef.get(ck) ?? -Infinity, N(d.min))); } }
  for (const e of ent) { e.reste = has(e.dem) ? Math.max(0, N(e.dem) - N(e.liv)) : 0; e.livre = N(e.liv) > 0;
    if (!e.ref) continue; const ref = String(e.ref), ck = e.cat + "|" + ref; if (!firstEnt.has(ck)) firstEnt.set(ck, e); if (!refCat.has(ref)) refCat.set(ref, e.cat);
    if (N(e.liv) > 0) { const l = get(e.cat, ref, e.engin); l.ent += N(e.liv); if ((e.date || "") > l.lastE) l.lastE = e.date || ""; } }
  const base = new Set(lines.keys());
  for (const s of sor) { if (!s.ref) continue; const ref = String(s.ref), eng = String(s.engin || ""), c = s.cat; let se;
    if (s.enginInit) se = s.enginInit; else if (base.has(KEY(c, ref, eng))) se = eng; else if (base.has(KEY(c, ref, ""))) se = ""; else se = eng;
    s.stockEng = se; s.key = KEY(c, ref, se); if (!refCat.has(ref)) refCat.set(ref, c);
    s.mvt = !base.has(s.key) ? "sans" : (se === "" ? "commun" : (se === eng ? "propre" : "emprunt"));
    const l = get(c, ref, se); l.sor += N(s.qte); if ((s.date || "") > l.lastS) l.lastS = s.date || ""; if (eng) l.users.add(eng); }
  const info = (ref, cat) => { cat = cat || refCat.get(ref) || "FILTRE"; const ck = cat + "|" + ref, d = firstDep.get(ck) || {}, e = firstEnt.get(ck) || {};
    return { cat, type: (d.type || e.type || "").trim(), marque: (d.marque || e.marque || "").trim(), equiv: (d.equiv || e.equiv || "").trim() }; };
  const label = eng => { if (!eng) return "Stock commun"; const e = engMap.get(String(eng)); return e ? [e.designation, e.marque, e.modele].filter(Boolean).join(" ") : "⚠ Engin inconnu"; };
  const out = [];
  for (const l of lines.values()) { const i = info(l.ref, l.cat); l.type = i.type; l.marque = i.marque; l.equiv = i.equiv; const ck = l.cat + "|" + l.ref;
    const defSeuil = N(l.cat === "PDR" ? (S.params.seuil_pdr ?? S.params.seuil ?? 1) : (S.params.seuil ?? 1));
    l.seuil = l.hasMin ? l.minSum : (maxMinRef.has(ck) ? maxMinRef.get(ck) : defSeuil);
    l.stock = l.dep + l.ent - l.sor; l.statut = l.stock <= 0 ? "RUPTURE" : (l.stock <= l.seuil ? "ALERTE" : "OK"); l.label = label(l.engin); out.push(l); }
  out.sort((a, b) => a.cat.localeCompare(b.cat) || (a.engin || "~").localeCompare(b.engin || "~", undefined, { numeric: true }) || a.ref.localeCompare(b.ref));
  for (const s of sor) { s.type = info(String(s.ref), s.cat).type; s.label = label(s.engin); }
  for (const e of ent) { if (!e.type) e.type = info(String(e.ref), e.cat).type; }
  const refs = new Set(); out.forEach(l => refs.add(l.ref)); ent.forEach(e => e.ref && refs.add(String(e.ref)));
  const engDer = new Map([...engMap.values()].map(e => { const vids = sor.filter(s => s.engin === e.code && s.intervention === "Vidange");
    const lastVid = vids.reduce((m, s) => (s.date || "") > m ? s.date : m, ""); const cpt = vids.reduce((m, s) => Math.max(m, N(s.compteur)), 0);
    return [e.code, Object.assign({}, e, { lastVid, cptVid: cpt || null, next: (cpt && e.intervalle) ? cpt + N(e.intervalle) : null })]; }));
  C = { lines: out, lineMap: new Map(out.map(l => [l.key, l])), ent, sor, depart, engMap, engDer, info, label, refs: [...refs].sort(), base, refCat };
}

/* ---------- personnes ---------- */
const COLORS = ["#0f4c5c", "#cf5a14", "#2c7a4b", "#7a3e9d", "#9a6a10", "#b8322a", "#3065a8", "#5a6b74"];
function avatar(id) { const p = S.profiles.get(id) || {}; const n = (p.nom || "?").trim(); const ini = n.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  let h = 0; for (const c of String(id || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return '<span class="av" style="background:' + COLORS[h % COLORS.length] + '">' + esc(ini) + "</span>"; }
const nameOf = id => id === S.uid ? "Vous" : ((S.profiles.get(id) || {}).nom || "Un utilisateur");
function who(id) { if (!id) return '<span class="muted">Import initial</span>'; return '<span class="who">' + avatar(id) + esc(id === S.uid ? ((S.me && S.me.nom) || "Vous") + " (vous)" : nameOf(id)) + "</span>"; }

/* ---------- navigation ---------- */
const NAV = [
  ["Pilotage", [["dash", "Tableau de bord"], ["journal", "Journal d'activité"]]],
  ["Magasin", [["stock", "Stock actuel"], ["entrees", "Entrées (BC / BL)"], ["sorties", "Sorties"]]],
  ["Achats", [["da", "Création DA", "da"], ["suivida", "Suivi DA", "da"]]],
  ["Recherche", [["engin", "Suivi par engin"], ["ref", "Recherche référence"]]],
  ["Référentiel", [["engins", "Engins"], ["depart", "Stock de départ"], ["params", "Paramètres"]]],
  ["Administration", [["users", "Utilisateurs", true], ["compte", "Mon compte"]]]
];
let navHtml = "";
function renderNav() {
  const att = C ? C.ent.filter(e => e.reste > 0).length : 0, news = newsList().length, daN = S.canDA ? daPending().length : 0;
  const html = NAV.map(([g, items]) => { const it = items.filter(i => !i[2] || (i[2] === "da" ? S.canDA : S.isAdmin)); if (!it.length) return "";
    return '<div class="nav-g">' + g + "</div>" + it.map(([k, l]) => '<button class="nav-i" data-view="' + k + '"' + (S.view === k ? ' aria-current="page"' : "") + "><span>" + l + "</span>" +
      (k === "entrees" && att ? '<span class="badge" title="Lignes de BC non livrées">' + att + "</span>" : "") + (k === "dash" && news ? '<span class="badge" title="Nouveautés">' + news + "</span>" : "") + (k === "da" && daN ? '<span class="badge" title="DA en attente du N° DA">' + daN + "</span>" : "") + "</button>").join(""); }).join("");
  if (html !== navHtml) { $("#nav").innerHTML = html; navHtml = html; }
}
$("#nav").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (!b) return; go(b.dataset.view); });
$("#burger").addEventListener("click", () => $("#side").classList.toggle("open"));
document.addEventListener("click", e => { const b = e.target.closest("[data-view-go]"); if (b) go(b.dataset.viewGo); });
function go(v) { S.view = v; try { localStorage.setItem("fc-view", v); } catch (_) {} $("#side").classList.remove("open"); render(true); }
/* onglets de catégorie */
document.addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b || !$("#view-tools").contains(b)) return; const c = b.dataset.cat;
  if (S.view === "stock") S.f.stockCat = c; else if (S.view === "depart") S.f.depCat = c; else S.f.cat = c || "FILTRE"; render(true); });

let lastView = null;
function render(full) {
  if (!C) return;
  renderNav();
  const v = VIEWS[S.view] || VIEWS.dash;
  $("#page-title").textContent = typeof v.title === "function" ? v.title() : v.title;
  if (full || lastView !== S.view) { $("#view-tools").innerHTML = v.tools ? v.tools() : ""; lastView = S.view; v.bind && v.bind(); }
  $("#view-body").innerHTML = v.body();
}
function table(cols, rows, opts = {}) {
  if (!rows.length) return '<div class="empty">' + esc(opts.empty || "Aucune ligne.") + "</div>";
  const lim = opts.limit || LIMIT; const shown = rows.slice(0, lim);
  return '<div class="tw"><table><thead><tr>' + cols.map(c => "<th" + (c.n ? ' class="n"' : "") + ">" + c.h + "</th>").join("") + "</tr></thead><tbody>" +
    shown.map(r => "<tr" + (opts.rowCls ? ' class="' + opts.rowCls(r) + '"' : "") + ">" + cols.map(c => "<td" + (c.n ? ' class="n"' : "") + ">" + c.f(r) + "</td>").join("") + "</tr>").join("") +
    "</tbody></table></div>" + (rows.length > lim ? '<div class="more">' + rows.length + " lignes, " + lim + " affichées : affinez la recherche.</div>" : "");
}
const pill = st => '<span class="pill p-' + st + '">' + st + "</span>";
const kpi = (label, val, tone) => '<div class="kpi ' + (tone || "") + '"><b>' + val + "</b><span>" + label + "</span></div>";
const mono = v => '<span class="mono">' + esc(v) + "</span>";
const canEditDoc = d => S.isAdmin || (S.canWrite && d.createdBy && d.createdBy === S.uid);
const mvtLabel = s => ({ sans: "⚠ Sans entrée", commun: "Stock commun", propre: "Propre stock", emprunt: "Emprunt (stock de " + s.stockEng + ")" })[s.mvt] || "";
const mvtPill = s => '<span class="pill ' + ({ sans: "p-crit", commun: "p-info", propre: "p-ok", emprunt: "p-acc" })[s.mvt] + '">' + esc(mvtLabel(s)) + "</span>";
const inPeriod = (d, f, t) => (!f || (d || "") >= f) && (!t || (d || "") <= t);
function rowActs(kind, d) { let h = ""; if (kind === "entree" && d.reste > 0 && S.canWrite) h += '<button class="btn small" data-act="recv" data-id="' + d.id + '">Réceptionner</button>';
  if (canEditDoc(d)) h += '<button class="btn small" data-act="edit-' + kind + '" data-id="' + d.id + '">Modifier</button><button class="btn small danger" data-act="del-' + kind + '" data-id="' + d.id + '">Suppr.</button>';
  return '<div class="rowact">' + h + "</div>"; }
const field = (id, label, input) => '<div class="field"><label for="' + id + '">' + label + "</label>" + input + "</div>";
const searchF = (id, val, ph) => field(id, "Rechercher", '<input id="' + id + '" type="search" placeholder="' + esc(ph) + '" value="' + esc(val) + '">');
const sumStock = L => L.reduce((t, l) => t + Math.max(0, l.stock), 0);
const monthStart = () => today().slice(0, 8) + "01";

/* ---------- journal / nouveautés ---------- */
const TABLE_FR = { entrees: "Entrée", sorties: "Sortie", stock_depart: "Stock de départ", engins: "Engin", params: "Paramètres", da: "Demande d'achat" };
const ACT_FR = { insert: "a ajouté", update: "a modifié", delete: "a supprimé" };
const jText = j => (ACT_FR[j.action] || j.action) + " · " + (TABLE_FR[j.table_name] || j.table_name) + " : " + (j.resume || "");
function newsList() { if (!S.loaded) return []; const since = S.lastSeen || new Date(Date.now() - 7 * 864e5).toISOString(); return S.journal.filter(j => j.at > since && j.user_id !== S.uid); }
function feed(list) { if (!list.length) return '<div class="empty">Rien pour l\'instant.</div>';
  return '<ul class="feed">' + list.map(j => { const isNew = S.lastSeen && j.at > S.lastSeen && j.user_id !== S.uid;
    return "<li>" + (isNew ? '<i class="new" title="Nouveau"></i>' : "") + avatar(j.user_id) + "<div><b>" + esc(nameOf(j.user_id)) + "</b> " + esc(jText(j)) + '</div><span class="t">' + fDT(j.at) + "</span></li>"; }).join("") + "</ul>"; }

/* ---------- vues ---------- */
const VIEWS = {};
VIEWS.dash = { title: "Tableau de bord", body() {
  const att = C.ent.filter(e => e.reste > 0), news = newsList(), m0 = monthStart();
  const row = cat => { const L = C.lines.filter(l => l.cat === cat), rup = L.filter(l => l.statut === "RUPTURE").length, al = L.filter(l => l.statut === "ALERTE").length;
    const reste = att.filter(e => e.cat === cat).reduce((t, e) => t + e.reste, 0), mois = C.sor.filter(s => s.cat === cat && (s.date || "") >= m0).reduce((t, s) => t + N(s.qte), 0);
    return '<h3 class="kpi-title">' + catPill(cat) + " " + CATS[cat].label + '</h3><div class="kpis">' + kpi(CATS[cat].label + " en stock", nb(sumStock(L))) + kpi("Lignes de stock", nb(L.length)) + kpi("En rupture", nb(rup), "crit") +
      kpi("En alerte", nb(al), "warn") + kpi("Commandés non livrés", nb(reste), "acc") + kpi("Sortis ce mois", nb(mois)) + "</div>"; };
  const daN = S.canNumDA ? daPending().length : 0;
  let h = (daN ? '<div class="banner crit">🔔 ' + daN + " demande(s) d'achat en attente du N° DA. <button class=\"btn small\" data-view-go=\"da\">Ouvrir « Création DA »</button></div>" : "") + row("FILTRE") + row("PDR");
  h += '<div class="panel"><h3>Nouveautés ' + (S.lastSeen ? "depuis votre dernière visite <small>(" + fDT(S.lastSeen) + ")</small>" : "<small>des 7 derniers jours</small>") + '<button class="btn small" data-act="seen" style="margin-left:auto">Marquer comme lu</button></h3>' +
    (news.length ? '<div class="banner info">' + news.length + " action(s) de l'équipe.</div>" + feed(news.slice(0, 40)) : '<div class="empty">Aucune nouvelle action de l\'équipe.</div>') + "</div>";
  h += '<div class="grid2"><div class="panel"><h3>Activité récente <small>toute l\'équipe</small></h3>' + feed(S.journal.slice(0, 20)) + "</div>";
  h += '<div class="panel"><h3>Commandes en attente <small>' + att.length + " ligne(s) de BC</small></h3>" + table([{ h: "Cat.", f: e => catPill(e.cat) }, { h: "Date", f: e => fD(e.date) }, { h: "Référence", f: e => mono(e.ref) }, { h: "Engin", f: e => esc(e.engin || "Commun") },
    { h: "BC", n: 1, f: e => nb(e.dem) }, { h: "Livré", n: 1, f: e => nb(e.liv || 0) }, { h: "Reste", n: 1, f: e => '<span class="reste">' + nb(e.reste) + "</span>" }, { h: "N° BC", f: e => esc(e.bc) }], att.slice().reverse(), { limit: 15, empty: "Aucune commande en attente." }) + "</div></div>";
  const rup = C.lines.filter(l => l.statut === "RUPTURE");
  h += '<div class="panel"><h3>Ruptures <small>stock ≤ 0, filtres et PDR</small></h3>' + table([{ h: "Cat.", f: l => catPill(l.cat) }, { h: "Affectation", f: l => esc(l.engin || "Commun") }, { h: "Engin", f: l => esc(l.label) }, { h: "Référence", f: l => mono(l.ref) }, { h: "Désignation / type", f: l => esc(l.type) },
    { h: "Stock", n: 1, f: l => nb(l.stock) }, { h: "Dernière sortie", f: l => fD(l.lastS) }], rup, { limit: 40, empty: "Aucune rupture." }) + "</div>";
  return h; } };

VIEWS.journal = { title: "Journal d'activité",
  tools: () => '<div class="tools">' + searchF("j-q", S.f.jQ, "Référence, engin, BC, PDR…") +
    field("j-u", "Utilisateur", '<select id="j-u"><option value="">Tous</option>' + [...S.profiles.values()].map(p => '<option value="' + esc(p.id) + '">' + esc(p.nom || p.identifiant) + "</option>").join("") + "</select>") +
    field("j-t", "Type", '<select id="j-t"><option value="">Tous</option>' + Object.entries(TABLE_FR).map(([k, v]) => '<option value="' + k + '">' + v + "</option>").join("") + "</select>") + "</div>",
  bind() { $("#j-u").value = S.f.jUser; $("#j-t").value = S.f.jTab; $("#j-q").oninput = e => { S.f.jQ = e.target.value; render(); }; $("#j-u").onchange = e => { S.f.jUser = e.target.value; render(); }; $("#j-t").onchange = e => { S.f.jTab = e.target.value; render(); }; },
  body() { const q = norm(S.f.jQ); const r = S.journal.filter(j => (!S.f.jUser || j.user_id === S.f.jUser) && (!S.f.jTab || j.table_name === S.f.jTab) && (!q || norm(j.resume).includes(q)));
    return '<div class="more">' + r.length + " action(s) · 1 000 dernières actions conservées à l'écran</div>" + table([{ h: "Date", f: j => fDT(j.at) }, { h: "Utilisateur", f: j => who(j.user_id) }, { h: "Action", f: j => esc(ACT_FR[j.action] || j.action) },
      { h: "Sur", f: j => esc(TABLE_FR[j.table_name] || j.table_name) }, { h: "Détail", f: j => esc(j.resume) }], r, { limit: 400, empty: "Aucune action." }); } };

VIEWS.stock = { title: () => "Stock actuel" + (S.f.stockCat ? " – " + CATS[S.f.stockCat].label : ""),
  tools: () => catTabs(S.f.stockCat, true) + '<div class="tools">' + searchF("st-q", S.f.stockQ, "Référence, engin, désignation…") + field("st-s", "Statut", '<select id="st-s"><option value="">Tous</option><option>RUPTURE</option><option>ALERTE</option><option>OK</option></select>') + '<span class="grow"></span><button class="btn" data-act="xls-stock">Exporter Excel</button></div>',
  bind() { $("#st-s").value = S.f.stockSt; $("#st-q").oninput = e => { S.f.stockQ = e.target.value; render(); }; $("#st-s").onchange = e => { S.f.stockSt = e.target.value; render(); }; },
  rows() { const q = norm(S.f.stockQ); return C.lines.filter(l => (!S.f.stockCat || l.cat === S.f.stockCat) && (!S.f.stockSt || l.statut === S.f.stockSt) && (!q || norm(l.ref + " " + l.engin + " " + l.label + " " + l.type + " " + l.marque + " " + l.equiv).includes(q))); },
  body() { const r = this.rows(); return '<div class="more">' + r.length + " ligne(s) · " + nb(sumStock(r)) + " article(s) en stock · Stock = stock de départ + entrées livrées (BL) − sorties</div>" + table([
    { h: "Cat.", f: l => catPill(l.cat) }, { h: "Affectation", f: l => mono(l.engin || "Commun") }, { h: "Engin", f: l => esc(l.label) }, { h: "Référence", f: l => mono(l.ref) }, { h: "Désignation / type", f: l => esc(l.type) }, { h: "Marque", f: l => esc(l.marque) },
    { h: "Entrées", n: 1, f: l => nb(l.ent) }, { h: "Sorties", n: 1, f: l => nb(l.sor) }, { h: "Stock", n: 1, f: l => "<b>" + nb(l.stock) + "</b>" },
    { h: "Statut", f: l => pill(l.statut) }, { h: "Dern. entrée", f: l => fD(l.lastE) }, { h: "Dern. sortie", f: l => fD(l.lastS) }], r, { empty: "Aucune ligne." }); } };

VIEWS.entrees = { title: () => "Entrées – " + CATS[S.f.cat].label,
  tools: () => catTabs(S.f.cat) + '<div class="tools">' + searchF("en-q", S.f.entQ, "Réf., BC, BL, engin…") + field("en-s", "Livraison", '<select id="en-s"><option value="">Toutes</option><option value="att">Non livrées (reste &gt; 0)</option><option value="liv">Livrées</option></select>') +
    field("en-f", "Du", '<input id="en-f" type="date" value="' + esc(S.f.entFrom) + '">') + field("en-t", "Au", '<input id="en-t" type="date" value="' + esc(S.f.entTo) + '">') + '<span class="grow"></span><button class="btn" data-act="xls-ent">Exporter Excel</button>' +
    (S.canWrite ? '<button class="btn" data-act="imp-entrees">Importer Excel</button><button class="btn primary" data-act="new-entree">+ Nouvelle entrée</button>' : "") + "</div>",
  bind() { $("#en-s").value = S.f.entSt; ["en-q", "en-s", "en-f", "en-t"].forEach(id => $("#" + id).addEventListener(id === "en-q" ? "input" : "change", () => { S.f.entQ = $("#en-q").value; S.f.entSt = $("#en-s").value; S.f.entFrom = $("#en-f").value; S.f.entTo = $("#en-t").value; render(); })); },
  rows() { const q = norm(S.f.entQ); return C.ent.filter(e => e.cat === S.f.cat && inPeriod(e.date, S.f.entFrom, S.f.entTo) && (!S.f.entSt || (S.f.entSt === "att" ? e.reste > 0 : e.livre)) && (!q || norm([e.ref, e.type, e.marque, e.bc, e.bl, e.engin, e.obs].join(" ")).includes(q))).reverse(); },
  body() { const r = this.rows(), K = CATS[S.f.cat]; return '<div class="more">' + r.length + " ligne(s) · " + nb(r.reduce((t, e) => t + N(e.liv), 0)) + " " + K.many + " livré(e)s · reste à livrer " + nb(r.reduce((t, e) => t + e.reste, 0)) + ". Seule la quantité livrée (BL) entre dans le stock.</div>" + table([
    { h: "Date", f: e => fD(e.date) }, { h: "Référence", f: e => mono(e.ref) }, { h: K.type, f: e => esc(e.type) }, { h: "Marque", f: e => esc(e.marque) }, { h: "Qté BC", n: 1, f: e => nb(e.dem) }, { h: "Qté BL", n: 1, f: e => nb(e.liv) },
    { h: "Reste", n: 1, f: e => e.reste > 0 ? '<span class="reste">' + nb(e.reste) + "</span>" : "" }, { h: "N° BC", f: e => mono(e.bc) }, { h: "N° BL", f: e => mono(e.bl) }, { h: "Engin destinataire", f: e => esc(e.engin || "Stock commun") },
    { h: "Observations", f: e => esc(e.obs) }, { h: "Saisi par", f: e => who(e.createdBy) }, { h: "", f: e => rowActs("entree", e) }], r, { empty: "Aucune entrée de " + K.many + "." }); } };

VIEWS.sorties = { title: () => "Sorties – " + CATS[S.f.cat].label,
  tools: () => catTabs(S.f.cat) + '<div class="tools">' + searchF("so-q", S.f.sorQ, "Réf., engin, intervention…") + field("so-f", "Du", '<input id="so-f" type="date" value="' + esc(S.f.sorFrom) + '">') + field("so-t", "Au", '<input id="so-t" type="date" value="' + esc(S.f.sorTo) + '">') +
    '<span class="grow"></span><button class="btn" data-act="xls-sor">Exporter Excel</button>' + (S.canWrite ? '<button class="btn" data-act="imp-sorties">Importer Excel</button><button class="btn primary" data-act="new-sortie">+ Nouvelle sortie</button>' : "") + "</div>",
  bind() { ["so-q", "so-f", "so-t"].forEach(id => $("#" + id).addEventListener(id === "so-q" ? "input" : "change", () => { S.f.sorQ = $("#so-q").value; S.f.sorFrom = $("#so-f").value; S.f.sorTo = $("#so-t").value; render(); })); },
  rows() { const q = norm(S.f.sorQ); return C.sor.filter(s => s.cat === S.f.cat && inPeriod(s.date, S.f.sorFrom, S.f.sorTo) && (!q || norm([s.ref, s.engin, s.label, s.enginInit, s.intervention, s.atelier, s.obs, s.type].join(" ")).includes(q))).reverse(); },
  body() { const r = this.rows(), K = CATS[S.f.cat]; return '<div class="more">' + r.length + " sortie(s) · " + nb(r.reduce((t, s) => t + N(s.qte), 0)) + " " + K.many + " sorti(e)s</div>" + table([
    { h: "Date", f: s => fD(s.date) }, { h: "Monté sur", f: s => mono(s.engin) }, { h: "Engin", f: s => esc(s.label) }, { h: "Référence", f: s => mono(s.ref) }, { h: K.type, f: s => esc(s.type) }, { h: "Qté", n: 1, f: s => nb(s.qte) },
    { h: "Pris sur", f: s => mvtPill(s) }, { h: "Intervention", f: s => esc(s.intervention) }, { h: "Compteur", n: 1, f: s => nb(s.compteur) }, { h: "Atelier", f: s => esc(s.atelier) }, { h: "Observations", f: s => esc(s.obs) },
    { h: "Saisi par", f: s => who(s.createdBy) }, { h: "", f: s => rowActs("sortie", s) }], r, { empty: "Aucune sortie de " + K.many + "." }); } };

VIEWS.engin = { title: "Suivi par engin",
  tools: () => '<div class="tools">' + field("eg-q", "Code engin", '<input id="eg-q" list="dl-engins" placeholder="ex. 50406" value="' + esc(S.selEngin) + '">') + "</div>",
  bind() { $("#eg-q").addEventListener("change", e => { S.selEngin = e.target.value.trim(); render(); }); },
  body() { const code = S.selEngin; if (!code) return '<div class="empty">Choisissez un code engin pour voir son stock affecté (filtres et PDR), ses commandes non livrées, ses entrées et ses sorties.</div>';
    const e = C.engDer.get(code), L = C.lines.filter(l => l.engin === code), att = C.ent.filter(x => x.reste > 0 && String(x.engin || "") === code);
    const so = C.sor.filter(s => s.engin === code || s.stockEng === code).slice().reverse(), en = C.ent.filter(x => String(x.engin || "") === code).slice().reverse(), own = so.filter(s => s.engin === code);
    const sumC = (arr, cat, f) => arr.filter(x => x.cat === cat).reduce((t, x) => t + f(x), 0);
    let h = '<div class="card-head"><span class="code">' + esc(code) + '</span><span class="desc">' + esc(e ? [e.designation, e.marque, e.modele].filter(Boolean).join(" ") : "⚠ Code absent de la liste des engins") + "</span>" + (e && e.serie ? '<span class="muted">N° série ' + esc(e.serie) + "</span>" : "") + "</div>";
    const rF = sumC(att, "FILTRE", x => x.reste), rP = sumC(att, "PDR", x => x.reste);
    h += (rF + rP) > 0 ? '<div class="banner crit">⚠ Commandé non livré pour cet engin : ' + nb(rF) + " filtre(s) · " + nb(rP) + " PDR · " + att.length + " ligne(s) de BC en attente</div>" : '<div class="banner ok">✔ Aucun filtre ni PDR commandé en attente de livraison pour cet engin</div>';
    h += '<div class="kpis">' + kpi("Filtres en stock affectés", nb(sumC(L, "FILTRE", l => l.stock))) + kpi("PDR en stock affectées", nb(sumC(L, "PDR", l => l.stock))) + kpi("Filtres montés (total)", nb(sumC(own, "FILTRE", s => N(s.qte)))) +
      kpi("PDR sorties (total)", nb(sumC(own, "PDR", s => N(s.qte)))) + kpi("Dernière vidange", e && e.lastVid ? fD(e.lastVid) : "–", "txt") + kpi("Prochaine vidange à", e && e.next ? nb(e.next) + " " + esc(e.unite || "") : "non calculée", "txt") + "</div>";
    if (e) { const R = e.refs || {}, names = { huile: "Huile moteur", gasoil: "Gasoil", separateur: "Séparateur d'eau", airP: "Air primaire", airS: "Air secondaire", hydraulique: "Hydraulique", transmission: "Transmission" };
      const chips = Object.keys(names).filter(k => R[k]).map(k => { const o = C.lineMap.get(KEY("FILTRE", R[k], code)), c = C.lineMap.get(KEY("FILTRE", R[k], "")); return '<span class="chip">' + names[k] + " <b>" + esc(R[k]) + "</b> · propre " + (o ? nb(o.stock) : "–") + " · commun " + (c ? nb(c.stock) : "–") + "</span>"; }).join("");
      if (chips) h += '<div class="panel"><h3>Filtres prévus dans la fiche engin</h3><div class="chips">' + chips + "</div></div>"; }
    h += '<div class="panel"><h3>Stock affecté à cet engin <small>filtres et PDR</small></h3>' + table([{ h: "Cat.", f: l => catPill(l.cat) }, { h: "Référence", f: l => mono(l.ref) }, { h: "Désignation / type", f: l => esc(l.type) }, { h: "Marque", f: l => esc(l.marque) }, { h: "Entrées", n: 1, f: l => nb(l.ent) },
      { h: "Sorties", n: 1, f: l => nb(l.sor) }, { h: "Stock", n: 1, f: l => "<b>" + nb(l.stock) + "</b>" }, { h: "Statut", f: l => pill(l.statut) }, { h: "Dern. sortie", f: l => fD(l.lastS) }], L, { empty: "Aucun stock affecté : les articles de cet engin sont pris sur le stock commun." }) + "</div>";
    h += '<div class="panel"><h3>Commandés non livrés <small>toutes dates</small></h3>' + table([{ h: "Cat.", f: x => catPill(x.cat) }, { h: "Date", f: x => fD(x.date) }, { h: "Référence", f: x => mono(x.ref) }, { h: "Désignation / type", f: x => esc(x.type) }, { h: "Qté BC", n: 1, f: x => nb(x.dem) }, { h: "Qté BL", n: 1, f: x => nb(x.liv || 0) },
      { h: "Reste", n: 1, f: x => '<span class="reste">' + nb(x.reste) + "</span>" }, { h: "N° BC", f: x => esc(x.bc) }, { h: "N° BL", f: x => esc(x.bl) }, { h: "", f: x => rowActs("entree", x) }], att, { empty: "Aucune commande en attente." }) + "</div>";
    const mv = s => s.mvt === "sans" ? "Sans entrée en magasin" : (s.engin === code ? (s.stockEng === code ? "Propre stock" : (s.stockEng === "" ? "Stock commun" : "Emprunté au " + s.stockEng)) : "Prêté au " + s.engin);
    h += '<div class="panel"><h3>Sorties liées à cet engin <small>filtres et PDR montés sur lui ou pris sur son stock</small></h3>' + table([{ h: "Cat.", f: s => catPill(s.cat) }, { h: "Date", f: s => fD(s.date) }, { h: "Référence", f: s => mono(s.ref) }, { h: "Désignation / type", f: s => esc(s.type) }, { h: "Qté", n: 1, f: s => nb(s.qte) },
      { h: "Monté sur", f: s => esc(s.engin) }, { h: "Mouvement", f: s => esc(mv(s)) }, { h: "Intervention", f: s => esc(s.intervention) }, { h: "Compteur", n: 1, f: s => nb(s.compteur) }, { h: "Saisi par", f: s => who(s.createdBy) }], so, { limit: 80, empty: "Aucune sortie." }) + "</div>";
    h += '<div class="panel"><h3>Entrées pour cet engin</h3>' + table([{ h: "Cat.", f: x => catPill(x.cat) }, { h: "Date", f: x => fD(x.date) }, { h: "Référence", f: x => mono(x.ref) }, { h: "Désignation / type", f: x => esc(x.type) }, { h: "Qté BC", n: 1, f: x => nb(x.dem) }, { h: "Qté BL", n: 1, f: x => nb(x.liv) },
      { h: "N° BC", f: x => esc(x.bc) }, { h: "N° BL", f: x => esc(x.bl) }, { h: "Saisi par", f: x => who(x.createdBy) }], en, { limit: 60, empty: "Aucune entrée." }) + "</div>";
    return h; } };

VIEWS.ref = { title: "Recherche référence",
  tools: () => '<div class="tools">' + field("rf-q", "Référence (filtre ou PDR)", '<input id="rf-q" list="dl-refs" placeholder="ex. P550820" value="' + esc(S.selRef) + '">') + "</div>",
  bind() { $("#rf-q").addEventListener("change", e => { S.selRef = e.target.value.trim(); render(); }); },
  body() { const ref = S.selRef; if (!ref) return '<div class="empty">Choisissez une référence de filtre ou de pièce (PDR) pour voir son stock total, sa répartition par engin et les engins qui l\'ont reçue.</div>';
    const L = C.lines.filter(l => l.ref === ref), tot = L.reduce((t, l) => t + l.stock, 0), seuil = L.reduce((t, l) => t + l.seuil, 0), st = !L.length ? "–" : (tot <= 0 ? "RUPTURE" : (tot <= seuil ? "ALERTE" : "OK")), i = C.info(ref);
    const att = C.ent.filter(x => x.reste > 0 && String(x.ref) === ref), reste = att.reduce((t, x) => t + x.reste, 0), so = C.sor.filter(s => String(s.ref) === ref), prev = [...S.engins.values()].filter(e => Object.values(e.refs || {}).includes(ref));
    let h = '<div class="card-head">' + catPill(i.cat) + '<span class="code" style="font-family:var(--f-mono);font-size:26px">' + esc(ref) + '</span><span class="desc">' + esc(i.type || "Désignation non renseignée") + '</span><span class="muted">' + esc([i.marque, i.equiv && ("équiv. " + i.equiv)].filter(Boolean).join(" · ")) + "</span></div>";
    h += reste > 0 ? '<div class="banner crit">⚠ ' + nb(reste) + " article(s) de cette référence commandé(s) non livré(s) · " + att.length + " ligne(s) de BC en attente</div>" : '<div class="banner ok">✔ Aucune commande de cette référence en attente de livraison</div>';
    h += '<div class="kpis">' + kpi("Stock actuel total", nb(tot)) + '<div class="kpi"><b>' + (st === "–" ? "–" : pill(st)) + "</b><span>Statut global</span></div>" + kpi("Lignes d'affectation", nb(L.length)) + kpi("Entrés (livrés)", nb(L.reduce((t, l) => t + l.ent, 0))) +
      kpi("Sortis", nb(so.reduce((t, s) => t + N(s.qte), 0))) + (i.cat === "FILTRE" ? kpi("Engins qui la prévoient", nb(prev.length)) : "") + "</div>";
    h += '<div class="panel"><h3>Affectation du stock</h3>' + table([{ h: "Cat.", f: l => catPill(l.cat) }, { h: "Code engin", f: l => esc(l.engin || "Commun") }, { h: "Engin d'affectation", f: l => esc(l.label) }, { h: "Entrées", n: 1, f: l => nb(l.ent) }, { h: "Sorties", n: 1, f: l => nb(l.sor) },
      { h: "Stock", n: 1, f: l => "<b>" + nb(l.stock) + "</b>" }, { h: "Statut", f: l => pill(l.statut) }, { h: "Dern. entrée", f: l => fD(l.lastE) }, { h: "Dern. sortie", f: l => fD(l.lastS) }], L, { empty: "Cette référence n'a aucune ligne de stock." }) + "</div>";
    h += '<div class="panel"><h3>Commandes non livrées <small>toutes dates</small></h3>' + table([{ h: "Date", f: x => fD(x.date) }, { h: "Engin destinataire", f: x => esc(x.engin ? x.engin + " – " + C.label(x.engin) : "Stock commun") }, { h: "Qté BC", n: 1, f: x => nb(x.dem) }, { h: "Qté BL", n: 1, f: x => nb(x.liv || 0) },
      { h: "Reste", n: 1, f: x => '<span class="reste">' + nb(x.reste) + "</span>" }, { h: "N° BC", f: x => esc(x.bc) }, { h: "N° BL", f: x => esc(x.bl) }, { h: "", f: x => rowActs("entree", x) }], att, { empty: "Aucune commande en attente." }) + "</div>";
    const by = new Map(); for (const s of so) { const o = by.get(s.engin) || { engin: s.engin, cat: s.cat, qte: 0, n: 0, last: "", emp: 0 }; o.qte += N(s.qte); o.n++; if ((s.date || "") > o.last) o.last = s.date; if (s.mvt === "emprunt") o.emp += N(s.qte); by.set(s.engin, o); }
    h += '<div class="panel"><h3>Engins sur lesquels cette référence a été montée</h3>' + table([{ h: "Code", f: o => esc(o.engin) }, { h: "Engin", f: o => esc(C.label(o.engin)) }, { h: "Qté sortie", n: 1, f: o => nb(o.qte) }, { h: "Nb sorties", n: 1, f: o => nb(o.n) }, { h: "Dernière", f: o => fD(o.last) },
      { h: "dont empruntés", n: 1, f: o => nb(o.emp) }, { h: "Stock propre", n: 1, f: o => { const l = C.lineMap.get(KEY(o.cat, ref, o.engin)); return l ? nb(l.stock) : '<span class="muted">pas de ligne</span>'; } },
      { h: "Prévu dans sa fiche ?", f: o => { const e = C.engMap.get(o.engin); return !e || o.cat !== "FILTRE" ? "" : (Object.values(e.refs || {}).includes(ref) ? "✔ Oui" : "Non"); } }], [...by.values()].sort((a, b) => b.qte - a.qte), { empty: "Jamais sortie." }) + "</div>";
    return h; } };

VIEWS.engins = { title: "Engins",
  tools: () => '<div class="tools">' + searchF("ge-q", S.f.engQ, "Code, désignation, référence…") + '<span class="grow"></span>' + (S.isAdmin ? '<button class="btn primary" data-act="new-engin">+ Nouvel engin</button>' : '<span class="pill p-info">Lecture seule</span>') + "</div>",
  bind() { $("#ge-q").oninput = e => { S.f.engQ = e.target.value; render(); }; },
  body() { const q = norm(S.f.engQ); const r = [...C.engDer.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).filter(e => !q || norm([e.code, e.designation, e.marque, e.modele, e.serie, ...Object.values(e.refs || {})].join(" ")).includes(q));
    return '<div class="more">' + r.length + " engin(s)</div>" + table([{ h: "Code", f: e => mono(e.code) }, { h: "Désignation", f: e => esc(e.designation) }, { h: "Marque", f: e => esc(e.marque) }, { h: "Modèle", f: e => esc(e.modele) }, { h: "N° série", f: e => esc(e.serie) },
      { h: "Unité", f: e => esc(e.unite) }, { h: "Intervalle", n: 1, f: e => nb(e.intervalle) }, { h: "Huile", f: e => mono(e.refs.huile) }, { h: "Gasoil", f: e => mono(e.refs.gasoil) }, { h: "Air prim.", f: e => mono(e.refs.airP) }, { h: "Hydraul.", f: e => mono(e.refs.hydraulique) },
      { h: "Dern. vidange", f: e => fD(e.lastVid) }, { h: "Proch. vidange", n: 1, f: e => nb(e.next) }, { h: "", f: e => S.isAdmin ? '<div class="rowact"><button class="btn small" data-act="edit-engin" data-id="' + esc(e.code) + '">Modifier</button></div>' : "" }], r, { empty: "Aucun engin." }); } };

VIEWS.depart = { title: () => "Stock de départ" + (S.f.depCat ? " – " + CATS[S.f.depCat].label : ""),
  tools: () => catTabs(S.f.depCat, true) + '<div class="tools">' + searchF("sd-q", S.f.depQ, "Référence, engin, emplacement…") + '<span class="grow"></span>' + (S.isAdmin ? '<button class="btn" data-act="imp-depart">Importer Excel</button><button class="btn primary" data-act="new-dep">+ Ligne de stock</button>' : '<span class="pill p-info">Lecture seule</span>') + "</div>",
  bind() { $("#sd-q").oninput = e => { S.f.depQ = e.target.value; render(); }; },
  body() { const q = norm(S.f.depQ); const r = C.depart.filter(d => (!S.f.depCat || d.cat === S.f.depCat) && (!q || norm([d.ref, d.engin, d.type, d.marque, d.equiv, d.empl, d.obs].join(" ")).includes(q)));
    return '<div class="more">' + r.length + " ligne(s) · " + nb(r.reduce((t, d) => t + N(d.qte), 0)) + " article(s) à l'inventaire</div>" + table([{ h: "Cat.", f: d => catPill(d.cat) }, { h: "Date", f: d => fD(d.date) }, { h: "Code engin", f: d => esc(d.engin || "Commun") }, { h: "Référence", f: d => mono(d.ref) },
      { h: "Désignation / type", f: d => esc(d.type) }, { h: "Marque", f: d => esc(d.marque) }, { h: "Réf. équiv.", f: d => esc(d.equiv) }, { h: "Qté", n: 1, f: d => nb(d.qte) }, { h: "Emplacement", f: d => esc(d.empl) },
      { h: "", f: d => S.isAdmin ? '<div class="rowact"><button class="btn small" data-act="edit-dep" data-id="' + d.id + '">Modifier</button><button class="btn small danger" data-act="del-dep" data-id="' + d.id + '">Suppr.</button></div>' : "" }], r, { empty: "Aucune ligne." }); } };

VIEWS.params = { title: "Paramètres", body() { const P = S.params, ro = S.isAdmin ? "" : " readonly";
  const lst = (k, l) => '<div class="field full"><label for="pa-' + k + '">' + l + ' (une valeur par ligne)</label><textarea id="pa-' + k + '"' + ro + ">" + esc((P[k] || []).join("\n")) + "</textarea></div>";
  return '<div class="panel"><div class="fgrid">' + '<div class="field full"><label for="pa-nom">Nom du chantier</label><input id="pa-nom" value="' + esc(P.nom_chantier) + '"' + ro + "></div>" + lst("types", "Types de filtre") + lst("interventions", "Types d'intervention") + lst("ateliers", "Ateliers") + lst("unites", "Unités compteur") +
    '<div class="field"><label for="pa-seuil">Seuil d\'alerte par défaut – filtres</label><input id="pa-seuil" type="number" min="0" step="1" value="' + esc(P.seuil ?? 1) + '"' + ro + "></div>" +
    '<div class="field"><label for="pa-seuilp">Seuil d\'alerte par défaut – PDR</label><input id="pa-seuilp" type="number" min="0" step="1" value="' + esc(P.seuil_pdr ?? 1) + '"' + ro + '></div><div class="hint full">Une ligne passe en ALERTE quand stock ≤ seuil, sauf seuil propre saisi dans le stock de départ.</div></div>' +
    (S.isAdmin ? '<div class="actions"><button class="btn primary" data-act="save-params">Enregistrer les paramètres</button></div>' : '<p class="hint">Modification réservée aux administrateurs.</p>') + "</div>"; } };

const ROLE_FR = { admin: "Administrateur", gestionnaire: "Gestionnaire", magasinier: "Magasinier", saisie: "Saisie", consultation: "Consultation" };
VIEWS.users = { title: "Utilisateurs",
  tools: () => '<div class="tools"><span class="grow muted">Créez les comptes de l\'équipe : identifiant + mot de passe, et le rôle de chacun.</span><button class="btn primary" data-act="new-user">+ Nouveau compte</button></div>',
  body() { if (!S.isAdmin) return '<div class="empty">Réservé aux administrateurs.</div>';
    const act = new Map(); for (const j of S.journal) { if (!j.user_id) continue; const o = act.get(j.user_id) || { n: 0, last: "" }; o.n++; if (j.at > o.last) o.last = j.at; act.set(j.user_id, o); }
    const r = [...S.profiles.values()].sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
    return '<div class="panel"><h3>Rôles</h3><p class="muted" style="margin:0"><b>Administrateur</b> : tout (comptes, engins, stock de départ, paramètres, saisies de tous, demandes d\'achat) · <b>Gestionnaire</b> : crée les demandes d\'achat (DA) et consulte le stock · <b>Magasinier</b> : saisit le N° des DA, entrées et sorties · <b>Saisie</b> : entrées et sorties (filtres et PDR), modifie les siennes · <b>Consultation</b> : lecture seule (sans les DA).</p></div>' + table([
      { h: "Nom", f: p => who(p.id) }, { h: "Identifiant", f: p => mono(p.identifiant) }, { h: "Fonction", f: p => esc(p.fonction) }, { h: "Rôle", f: p => '<span class="role ' + (p.role === "admin" ? "admin" : "") + '">' + esc(ROLE_FR[p.role] || p.role) + "</span>" },
      { h: "État", f: p => p.actif ? '<span class="pill p-ok">Actif</span>' : '<span class="pill p-crit">Désactivé</span>' }, { h: "Actions (récentes)", n: 1, f: p => nb((act.get(p.id) || {}).n || 0) }, { h: "Dernière action", f: p => fDT((act.get(p.id) || {}).last) },
      { h: "Dernière visite", f: p => fDT(p.last_seen) }, { h: "", f: p => '<div class="rowact"><button class="btn small" data-act="edit-user" data-id="' + esc(p.id) + '">Modifier</button><button class="btn small" data-act="pw-user" data-id="' + esc(p.id) + '">Mot de passe</button></div>' }], r, { empty: "Aucun compte." }); } };

VIEWS.compte = { title: "Mon compte", body() { const m = S.me || {};
  return '<div class="grid2"><div class="panel"><h3>Mes informations</h3><p>' + who(S.uid) + "</p><p>Identifiant : " + mono(m.identifiant) + "<br>Rôle : <b>" + esc(ROLE_FR[m.role] || m.role) + "</b>" + (m.fonction ? "<br>Fonction : " + esc(m.fonction) : "") +
    '</p></div><div class="panel"><h3>Changer mon mot de passe</h3><div class="fgrid">' + field("pw1", "Nouveau mot de passe", '<input id="pw1" type="password" autocomplete="new-password">') + field("pw2", "Confirmer", '<input id="pw2" type="password" autocomplete="new-password">') +
    '</div><div class="err" id="pw-err"></div><div class="actions"><button class="btn primary" data-act="my-pw">Changer le mot de passe</button></div></div></div>' +
    '<div class="actions" style="justify-content:flex-start"><button class="btn danger" data-act="logout">Se déconnecter</button></div>'; } };

/* ---------- formulaires ---------- */
function modal(title, html, onSave, saveLabel, wide) {
  const ov = document.createElement("div"); ov.className = "overlay";
  ov.innerHTML = '<div class="modal' + (wide ? " wide" : "") + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h3>' + esc(title) + '</h3><form id="mf" novalidate>' + html + '<div class="err" id="mf-err"></div><div class="actions"><button type="button" class="btn" id="mf-cancel">Annuler</button><button type="submit" class="btn primary" id="mf-save">' + esc(saveLabel || "Enregistrer") + "</button></div></form></div>";
  document.body.appendChild(ov); const onKey = e => { if (e.key === "Escape") close(); }; const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); }; document.addEventListener("keydown", onKey);
  ov.querySelector("#mf-cancel").onclick = close; ov.addEventListener("mousedown", e => { if (e.target === ov) close(); });
  ov.querySelector("#mf").addEventListener("submit", async e => { e.preventDefault(); const btn = ov.querySelector("#mf-save"); if (btn.disabled) return; btn.disabled = true;
    try { const msg = await onSave(ov); if (msg) { ov.querySelector("#mf-err").textContent = msg; btn.disabled = false; } else close(); } catch (err) { ov.querySelector("#mf-err").textContent = errMsg(err); btn.disabled = false; } });
  const first = ov.querySelector("input:not([readonly]):not([type=file]),select,textarea"); first && first.focus(); return ov;
}
const fv = (ov, id) => { const el = ov.querySelector("#" + id); return el ? el.value.trim() : ""; };
const fnum = (ov, id) => { const v = fv(ov, id); return v === "" ? null : +v.replace(",", "."); };
const F = (id, label, input, cls) => '<div class="field' + (cls ? " " + cls : "") + '"><label for="' + id + '">' + label + "</label>" + input + "</div>";
const opts = (arr, sel) => arr.map(v => "<option" + (v === sel ? " selected" : "") + ">" + esc(v) + "</option>").join("");
const catSel = (id, v) => '<select id="' + id + '"><option value="FILTRE"' + (v !== "PDR" ? " selected" : "") + '>Filtre</option><option value="PDR"' + (v === "PDR" ? " selected" : "") + ">PDR (pièce de rechange)</option></select>";
async function must(q) { const { data, error } = await q; if (error) throw error; return data; }

function entreeForm(d, recv) { d = d || { date: today(), cat: S.f.cat }; const isNew = !d.id;
  const html = '<div class="fgrid">' + F("f-cat", "Catégorie", catSel("f-cat", d.cat)) + F("f-date", "Date", '<input id="f-date" type="date" value="' + esc(d.date) + '">') + F("f-ref", "Référence *", '<input id="f-ref" list="dl-refs" value="' + esc(d.ref) + '" autocomplete="off">') +
    F("f-type", "Désignation / type", '<input id="f-type" list="dl-types" value="' + esc(d.type) + '">') + F("f-marque", "Marque", '<input id="f-marque" list="dl-marques" value="' + esc(d.marque) + '">') + F("f-equiv", "Réf. équivalentes", '<input id="f-equiv" value="' + esc(d.equiv) + '">') +
    F("f-engin", "Engin destinataire (vide = stock commun)", '<input id="f-engin" list="dl-engins" value="' + esc(d.engin) + '">') + F("f-dem", "Qté demandée (BC)", '<input id="f-dem" type="number" min="0" step="any" inputmode="decimal" value="' + esc(d.dem ?? "") + '">') +
    F("f-liv", "Qté livrée (BL)", '<input id="f-liv" type="number" min="0" step="any" inputmode="decimal" value="' + esc(d.liv ?? "") + '"><div class="hint">Vide = pas encore livré. Livraison partielle : cumulez ici.</div>') +
    F("f-bc", "N° BC", '<input id="f-bc" value="' + esc(d.bc) + '">') + F("f-bl", "N° BL", '<input id="f-bl" value="' + esc(d.bl) + '">') + F("f-obs", "Observations", '<input id="f-obs" value="' + esc(d.obs) + '">', "full") + '<div class="hint full" id="f-info"></div></div>';
  const ov = modal(isNew ? "Nouvelle entrée" : (recv ? "Réception (BL)" : "Modifier l'entrée"), html, async ov => {
    const ref = fv(ov, "f-ref"); if (!ref) return "Saisissez la référence."; if (!fv(ov, "f-date")) return "Saisissez la date.";
    const dem = fnum(ov, "f-dem"), liv = fnum(ov, "f-liv"); if (dem === null && liv === null) return "Saisissez au moins la quantité demandée (BC) ou livrée (BL).";
    if ((dem !== null && dem < 0) || (liv !== null && liv < 0)) return "Les quantités ne peuvent pas être négatives.";
    const eng = fv(ov, "f-engin"); if (eng && !C.engMap.has(eng)) return "Code engin inconnu : choisissez-le dans la liste (ou laissez vide pour le stock commun).";
    const row = { categorie: fv(ov, "f-cat"), date: fv(ov, "f-date"), ref, type: fv(ov, "f-type") || null, marque: fv(ov, "f-marque") || null, equiv: fv(ov, "f-equiv") || null, qte_bc: dem, qte_bl: liv, num_bc: fv(ov, "f-bc") || null, num_bl: fv(ov, "f-bl") || null, engin: eng || null, obs: fv(ov, "f-obs") || null };
    if (isNew) { applyRow("entrees", await must(sb.from("entrees").insert(row).select().single())); toast("Entrée enregistrée."); }
    else { const r = await must(sb.from("entrees").update(row).eq("id", d.id).select()); if (!r.length) return "Modification refusée : vos droits ne le permettent pas."; applyRow("entrees", r[0]); toast("Entrée modifiée."); }
  }, recv ? "Enregistrer la réception" : "Enregistrer");
  const upd = () => { const ref = fv(ov, "f-ref"), cat = fv(ov, "f-cat"), i = ref ? C.info(ref, cat) : null, box = ov.querySelector("#f-info");
    if (ref && i && (i.type || i.marque)) { if (!fv(ov, "f-type")) ov.querySelector("#f-type").value = i.type; if (!fv(ov, "f-marque")) ov.querySelector("#f-marque").value = i.marque; if (!fv(ov, "f-equiv")) ov.querySelector("#f-equiv").value = i.equiv; }
    const eng = fv(ov, "f-engin"), l = ref ? C.lineMap.get(KEY(cat, ref, eng)) : null;
    box.textContent = ref ? (l ? "Stock actuel de cette ligne (" + (eng || "commun") + ") : " + nb(l.stock) : "Nouvelle ligne de stock : elle sera créée à la première livraison.") : ""; };
  ["f-ref", "f-engin", "f-cat"].forEach(id => ov.querySelector("#" + id).addEventListener("change", upd)); upd();
  if (recv) { const el = ov.querySelector("#f-liv"); el.focus(); el.select && el.select(); }
}

function sortieForm(d) { d = d || { date: today(), cat: S.f.cat, intervention: S.f.cat === "PDR" ? (S.params.interventions.find(x => /panne/i.test(x)) || S.params.interventions[0]) : (S.params.interventions[0] || "Vidange"), atelier: S.params.ateliers[0] || "", qte: 1 }; const isNew = !d.id;
  const html = '<div class="fgrid">' + F("s-cat", "Catégorie", catSel("s-cat", d.cat)) + F("s-date", "Date", '<input id="s-date" type="date" value="' + esc(d.date) + '">') + F("s-engin", "Code engin (monté sur) *", '<input id="s-engin" list="dl-engins" value="' + esc(d.engin) + '" autocomplete="off">') +
    F("s-ref", "Référence *", '<input id="s-ref" list="dl-refs" value="' + esc(d.ref) + '" autocomplete="off">') + F("s-qte", "Quantité *", '<input id="s-qte" type="number" min="0" step="any" inputmode="decimal" value="' + esc(d.qte ?? 1) + '">') +
    F("s-init", "Engin initial (si article emprunté)", '<input id="s-init" list="dl-engins" value="' + esc(d.enginInit) + '"><div class="hint">Vide : propre stock de l\'engin, sinon stock commun.</div>') +
    F("s-cpt", "Compteur (h / km)", '<input id="s-cpt" type="number" min="0" step="1" inputmode="numeric" value="' + esc(d.compteur ?? "") + '">') + F("s-int", "Type d'intervention", '<select id="s-int">' + opts(S.params.interventions, d.intervention) + "</select>") +
    F("s-at", "Atelier", '<select id="s-at"><option value=""></option>' + opts(S.params.ateliers, d.atelier) + "</select>") + F("s-obs", "Observations", '<input id="s-obs" value="' + esc(d.obs) + '">', "full") + '<div class="hint full" id="s-info"></div></div>';
  const ov = modal(isNew ? "Nouvelle sortie" : "Modifier la sortie", html, async ov => {
    const eng = fv(ov, "s-engin"), ref = fv(ov, "s-ref"), qte = fnum(ov, "s-qte"), init = fv(ov, "s-init");
    if (!eng || !C.engMap.has(eng)) return "Choisissez le code engin dans la liste."; if (!ref) return "Saisissez la référence."; if (!qte || qte <= 0) return "La quantité doit être supérieure à 0.";
    if (init && !C.engMap.has(init)) return "Engin initial inconnu : choisissez-le dans la liste ou laissez vide.";
    const row = { categorie: fv(ov, "s-cat"), date: fv(ov, "s-date"), engin: eng, engin_initial: init || null, compteur: fnum(ov, "s-cpt"), intervention: fv(ov, "s-int") || null, ref, qte, atelier: fv(ov, "s-at") || null, obs: fv(ov, "s-obs") || null };
    if (isNew) { applyRow("sorties", await must(sb.from("sorties").insert(row).select().single())); toast("Sortie enregistrée."); }
    else { const r = await must(sb.from("sorties").update(row).eq("id", d.id).select()); if (!r.length) return "Modification refusée : vos droits ne le permettent pas."; applyRow("sorties", r[0]); toast("Sortie modifiée."); } });
  const upd = () => { const eng = fv(ov, "s-engin"), ref = fv(ov, "s-ref"), init = fv(ov, "s-init"), cat = fv(ov, "s-cat"), box = ov.querySelector("#s-info"); if (!ref || !eng) { box.textContent = ""; box.className = "hint full"; return; }
    let se = null; if (init) se = init; else if (C.base.has(KEY(cat, ref, eng))) se = eng; else if (C.base.has(KEY(cat, ref, ""))) se = "";
    const key = se === null ? null : KEY(cat, ref, se), l = key && C.lineMap.get(key), t = C.info(ref, cat).type;
    if (!key || !C.base.has(key)) { box.className = "hint full crit"; box.textContent = "⚠ Aucune entrée en magasin pour cet article" + (init ? " sur le stock de " + init : "") + " : la sortie sera signalée « sans entrée »."; }
    else { box.className = "hint full ok"; const src = se === "" ? "stock commun" : (se === eng ? "propre stock de " + eng : "stock de " + se); box.textContent = (t ? t + " · " : "") + "Pris sur le " + src + " · disponible : " + nb(l ? l.stock : 0); } };
  ["s-engin", "s-ref", "s-init", "s-cat"].forEach(id => ov.querySelector("#" + id).addEventListener("change", upd)); upd();
}

function enginForm(code) { const e = code ? S.engins.get(code) : { refs: {} }; if (!e) return; const R = e.refs || {}, isNew = !code;
  const r = (k, l) => F("g-" + k, l, '<input id="g-' + k + '" list="dl-refs" value="' + esc(R[k]) + '">');
  const html = '<div class="fgrid">' + F("g-code", "Code engin *", '<input id="g-code" value="' + esc(e.code) + '"' + (isNew ? "" : " readonly") + ">") + F("g-des", "Désignation", '<input id="g-des" value="' + esc(e.designation) + '">') +
    F("g-mar", "Marque", '<input id="g-mar" value="' + esc(e.marque) + '">') + F("g-mod", "Modèle", '<input id="g-mod" value="' + esc(e.modele) + '">') + F("g-ser", "N° série / immatriculation", '<input id="g-ser" value="' + esc(e.serie) + '">') +
    F("g-uni", "Unité compteur", '<select id="g-uni"><option value=""></option>' + opts(S.params.unites.length ? S.params.unites : ["h", "km"], e.unite) + "</select>") + F("g-int", "Intervalle vidange", '<input id="g-int" type="number" min="0" value="' + esc(e.intervalle ?? "") + '">') +
    r("huile", "Réf. huile moteur") + r("gasoil", "Réf. gasoil") + r("separateur", "Réf. séparateur d'eau") + r("airP", "Réf. air primaire") + r("airS", "Réf. air secondaire") + r("hydraulique", "Réf. hydraulique") + r("transmission", "Réf. transmission") + "</div>";
  modal(isNew ? "Nouvel engin" : "Modifier l'engin " + code, html, async ov => { const c = fv(ov, "g-code"); if (!c) return "Saisissez le code engin."; if (isNew && S.engins.has(c)) return "Ce code engin existe déjà.";
    const row = { code: c, designation: fv(ov, "g-des") || null, marque: fv(ov, "g-mar") || null, modele: fv(ov, "g-mod") || null, serie: fv(ov, "g-ser") || null, unite: fv(ov, "g-uni") || null, intervalle: fnum(ov, "g-int"),
      ref_huile: fv(ov, "g-huile") || null, ref_gasoil: fv(ov, "g-gasoil") || null, ref_separateur: fv(ov, "g-separateur") || null, ref_air_p: fv(ov, "g-airP") || null, ref_air_s: fv(ov, "g-airS") || null, ref_hydraulique: fv(ov, "g-hydraulique") || null, ref_transmission: fv(ov, "g-transmission") || null };
    applyRow("engins", await must(isNew ? sb.from("engins").insert(row).select().single() : sb.from("engins").update(row).eq("code", c).select().single())); toast("Engin enregistré."); }); }

function depForm(id) { const l = id ? S.depart.get(+id) : { date: today(), cat: S.f.depCat || "FILTRE" }; if (!l) return;
  const html = '<div class="fgrid">' + F("d-cat", "Catégorie", catSel("d-cat", l.cat)) + F("d-date", "Date d'inventaire", '<input id="d-date" type="date" value="' + esc(l.date) + '">') + F("d-eng", "Code engin (vide = stock commun)", '<input id="d-eng" list="dl-engins" value="' + esc(l.engin) + '">') +
    F("d-ref", "Référence *", '<input id="d-ref" list="dl-refs" value="' + esc(l.ref) + '">') + F("d-type", "Désignation / type", '<input id="d-type" list="dl-types" value="' + esc(l.type) + '">') + F("d-mar", "Marque", '<input id="d-mar" list="dl-marques" value="' + esc(l.marque) + '">') +
    F("d-eq", "Réf. équivalentes", '<input id="d-eq" value="' + esc(l.equiv) + '">') + F("d-qte", "Quantité en stock", '<input id="d-qte" type="number" min="0" step="any" value="' + esc(l.qte ?? 0) + '">') + F("d-min", "Stock minimum (seuil)", '<input id="d-min" type="number" min="0" step="any" value="' + esc(l.min ?? "") + '">') +
    F("d-emp", "Emplacement magasin", '<input id="d-emp" value="' + esc(l.empl) + '">') + F("d-obs", "Observations", '<input id="d-obs" value="' + esc(l.obs) + '">') + "</div>";
  modal(id ? "Modifier la ligne de stock de départ" : "Nouvelle ligne de stock de départ", html, async ov => { const ref = fv(ov, "d-ref"); if (!ref) return "Saisissez la référence."; const eng = fv(ov, "d-eng"); if (eng && !C.engMap.has(eng)) return "Code engin inconnu.";
    const row = { categorie: fv(ov, "d-cat"), date_inv: fv(ov, "d-date") || null, engin: eng || null, ref, type: fv(ov, "d-type") || null, marque: fv(ov, "d-mar") || null, equiv: fv(ov, "d-eq") || null, qte: fnum(ov, "d-qte") || 0, stock_min: fnum(ov, "d-min"), emplacement: fv(ov, "d-emp") || null, obs: fv(ov, "d-obs") || null };
    applyRow("stock_depart", await must(id ? sb.from("stock_depart").update(row).eq("id", +id).select().single() : sb.from("stock_depart").insert(row).select().single())); toast("Stock de départ enregistré."); }); }

/* ---------- import Excel ---------- */
const nh = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const IMPORT = {
  entrees: { table: "entrees", title: "Importer des entrées", need: "write",
    cols: [["cat", "Catégorie", ["categorie", "cat", "famille"]], ["date", "Date", ["date", "datereception", "datebl"]], ["ref", "Référence", ["reference", "ref", "referencefiltre", "referencepiece", "refpiece", "refpdr", "codearticle", "article"]],
      ["type", "Désignation / type", ["designation", "type", "typedefiltre", "libelle", "desig", "designationdelapiece"]], ["marque", "Marque", ["marque", "fabricant"]], ["equiv", "Réf. équivalentes", ["refequivalentes", "refequivalente", "equivalence", "equiv", "refequiv"]],
      ["dem", "Qté demandée (BC)", ["qtedemandeebc", "qtedemandee", "qtebc", "quantitedemandee", "qtecommandee", "quantitecommandee"]], ["liv", "Qté livrée (BL)", ["qtelivreebl", "qtelivree", "qtebl", "quantitelivree", "quantite", "qte"]],
      ["bc", "N° BC", ["nbc", "numbc", "numerobc", "bc", "bondecommande", "nbondecommande"]], ["bl", "N° BL", ["nbl", "numbl", "numerobl", "bl", "bondelivraison", "nbondelivraison"]],
      ["engin", "Engin destinataire", ["engindestinataireaffectation", "engindestinataire", "codeengin", "engin", "affectation"]], ["obs", "Observations", ["observations", "observation", "obs", "remarque", "remarques", "commentaire"]]],
    example: [["Filtre", "08/10/2026", "P550820", "FILTRE A HUILE", "DONALDSON", "", 5, 5, "4400044415", "BL-1201", "50406", "Exemple – à supprimer"], ["PDR", "08/10/2026", "4130000418", "COURROIE ALTERNATEUR", "SDLG", "", 2, 1, "4400044420", "BL-1202", "44645", "Exemple – à supprimer"]] },
  sorties: { table: "sorties", title: "Importer des sorties", need: "write",
    cols: [["cat", "Catégorie", ["categorie", "cat", "famille"]], ["date", "Date", ["date", "datesortie"]], ["engin", "Code engin (monté sur)", ["codeenginmontesur", "codeengin", "montesur", "engin", "enginmontesur"]],
      ["enginInit", "Engin initial", ["engininitialaffectationdufiltre", "engininitial", "enginpreteur", "engindorigine"]], ["compteur", "Compteur (h / km)", ["compteurhkm", "compteur", "heures", "km", "index"]],
      ["intervention", "Type d'intervention", ["typedintervention", "typeintervention", "intervention", "motif"]], ["ref", "Référence", ["reference", "ref", "referencefiltre", "referencepiece", "refpiece", "refpdr", "codearticle", "article"]],
      ["qte", "Quantité", ["quantite", "qte", "qtesortie"]], ["atelier", "Atelier", ["atelier"]], ["obs", "Observations", ["observations", "observation", "obs", "remarque", "remarques", "commentaire"]]],
    example: [["Filtre", "08/10/2026", "50406", "", 152300, "Vidange", "P550820", 1, "ATELIER FIXE", "Exemple – à supprimer"], ["PDR", "08/10/2026", "44645", "", 8350, "Remplacement sur panne", "4130000418", 1, "ATELIER MOBILE", "Exemple – à supprimer"]] },
  depart: { table: "stock_depart", title: "Importer le stock de départ", need: "admin",
    cols: [["cat", "Catégorie", ["categorie", "cat", "famille"]], ["date", "Date d'inventaire", ["datedinventaire", "dateinventaire", "date"]], ["engin", "Code engin (vide = commun)", ["codeenginaffectation", "codeengin", "engin", "affectation"]],
      ["ref", "Référence", ["reference", "ref", "referencefiltre", "referencepiece", "refpiece", "refpdr", "codearticle", "article"]], ["type", "Désignation / type", ["designation", "type", "typedefiltre", "libelle"]], ["marque", "Marque", ["marque", "fabricant"]],
      ["equiv", "Réf. équivalentes", ["refequivalentes", "refequivalente", "equivalence", "equiv"]], ["qte", "Quantité en stock", ["quantiteenstock", "quantite", "qte", "stock"]], ["min", "Stock minimum (seuil)", ["stockminimumseuil", "stockminimum", "seuil", "stockmin", "min"]],
      ["empl", "Emplacement magasin", ["emplacementmagasin", "emplacement"]], ["obs", "Observations", ["observations", "observation", "obs", "remarque"]]],
    example: [["PDR", "09/10/2026", "", "4130000418", "COURROIE ALTERNATEUR", "SDLG", "", 4, 1, "Rayon B2", "Exemple – à supprimer"]] }
};
function matchCols(headers, cols) {
  const map = {}, used = new Set(), hs = headers.map(nh);
  for (const [k, , syn] of cols) { const i = hs.findIndex((h, j) => !used.has(j) && syn.includes(h)); if (i >= 0) { map[k] = i; used.add(i); } }
  for (const [k, , syn] of cols) { if (k in map) continue; const i = hs.findIndex((h, j) => !used.has(j) && h && syn.some(s => s.length >= 4 && h.startsWith(s))); if (i >= 0) { map[k] = i; used.add(i); } }
  return map;
}
function pDate(v) {
  if (v === "" || v === null || v === undefined) return { v: today(), warn: "date vide → aujourd'hui" };
  if (v instanceof Date && !isNaN(v)) return { v: ymd(new Date(v.getTime() + 12 * 3600e3)) };
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return { v: d.toISOString().slice(0, 10) }; }
  const s = String(v).trim(); let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[1]); if (d.getMonth() === +m[2] - 1) return { v: ymd(d) }; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return { v: m[1] + "-" + m[2] + "-" + m[3] };
  return { err: "date illisible (« " + s + " »)" };
}
const pNum = v => { if (v === "" || v === null || v === undefined) return null; if (typeof v === "number") return v; const x = parseFloat(String(v).replace(/\s/g, "").replace(",", ".")); return isFinite(x) ? x : NaN; };
const pStr = v => { if (v === null || v === undefined) return ""; if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v); return String(v).trim(); };
const pCat = (v, def) => { const s = nh(v); if (!s) return def; if (s.startsWith("pdr") || s.startsWith("piece") || s.includes("rechange")) return "PDR"; if (s.startsWith("filt")) return "FILTRE"; return null; };
function buildRow(kind, cells, map, defCat) {
  const g = k => (k in map ? cells[map[k]] : ""), errs = [], warns = [];
  const cat = pCat(g("cat"), defCat); if (!cat) errs.push("catégorie inconnue (Filtre ou PDR)");
  const dt = pDate(g("date")); if (dt.err) errs.push(dt.err); if (dt.warn) warns.push(dt.warn);
  const ref = pStr(g("ref")); if (!ref) errs.push("référence vide");
  const eng = pStr(g("engin"));
  let row;
  if (kind === "entrees") {
    const dem = pNum(g("dem")), liv = pNum(g("liv"));
    if (Number.isNaN(dem) || Number.isNaN(liv)) errs.push("quantité non numérique"); else if (dem === null && liv === null) errs.push("aucune quantité (BC ou BL)"); else if ((dem ?? 0) < 0 || (liv ?? 0) < 0) errs.push("quantité négative");
    if (eng && !C.engMap.has(eng)) errs.push("engin " + eng + " inconnu");
    row = { categorie: cat, date: dt.v, ref, type: pStr(g("type")) || null, marque: pStr(g("marque")) || null, equiv: pStr(g("equiv")) || null, qte_bc: Number.isNaN(dem) ? null : dem, qte_bl: Number.isNaN(liv) ? null : liv, num_bc: pStr(g("bc")) || null, num_bl: pStr(g("bl")) || null, engin: eng || null, obs: pStr(g("obs")) || null };
    if (!errs.length && C.ent.some(e => e.cat === cat && e.ref === ref && e.date === dt.v && (e.bl || "") === (row.num_bl || "") && N(e.liv) === N(liv) && N(e.dem) === N(dem))) warns.push("doublon possible (déjà saisi)");
  } else if (kind === "sorties") {
    const qte = pNum(g("qte")), cpt = pNum(g("compteur")), init = pStr(g("enginInit"));
    if (!eng) errs.push("code engin vide"); else if (!C.engMap.has(eng)) errs.push("engin " + eng + " inconnu");
    if (init && !C.engMap.has(init)) errs.push("engin initial " + init + " inconnu");
    if (qte === null || Number.isNaN(qte) || qte <= 0) errs.push("quantité invalide"); if (Number.isNaN(cpt)) errs.push("compteur non numérique");
    row = { categorie: cat, date: dt.v, engin: eng, engin_initial: init || null, compteur: Number.isNaN(cpt) ? null : cpt, intervention: pStr(g("intervention")) || null, ref, qte, atelier: pStr(g("atelier")) || null, obs: pStr(g("obs")) || null };
    if (!errs.length && C.sor.some(s => s.cat === cat && s.ref === ref && s.date === dt.v && s.engin === eng && N(s.qte) === N(qte))) warns.push("doublon possible (déjà saisi)");
  } else {
    const qte = pNum(g("qte")), min = pNum(g("min"));
    if (eng && !C.engMap.has(eng)) errs.push("engin " + eng + " inconnu");
    if (qte === null || Number.isNaN(qte) || qte < 0) errs.push("quantité invalide"); if (Number.isNaN(min)) errs.push("seuil non numérique");
    row = { categorie: cat, date_inv: dt.v, engin: eng || null, ref, type: pStr(g("type")) || null, marque: pStr(g("marque")) || null, equiv: pStr(g("equiv")) || null, qte, stock_min: Number.isNaN(min) ? null : min, emplacement: pStr(g("empl")) || null, obs: pStr(g("obs")) || null };
  }
  return { row, errs, warns, cat, ref };
}
const MODELES = { entrees: "modeles/Canevas_import_ENTREES.xlsx", sorties: "modeles/Canevas_import_SORTIES.xlsx" };
function templateXls(kind) { if (MODELES[kind]) { const a = document.createElement("a"); a.href = MODELES[kind]; a.download = MODELES[kind].split("/").pop(); document.body.appendChild(a); a.click(); a.remove(); return; } const K = IMPORT[kind];
  const aoa = [K.cols.map(c => c[1]), ...K.example];
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = K.cols.map(c => ({ wch: Math.max(12, c[1].length + 2) }));
  const help = XLSX.utils.aoa_to_sheet([["Mode d'emploi"], ["1. Une ligne par mouvement. Gardez la ligne d'en-têtes telle quelle."], ["2. Catégorie : « Filtre » ou « PDR ». Vide = la catégorie choisie dans la fenêtre d'import."],
    ["3. Date au format jj/mm/aaaa. Codes engin : ceux de la liste des engins de l'application."], ["4. Supprimez les lignes d'exemple avant l'import."]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Import"); XLSX.utils.book_append_sheet(wb, help, "Mode d'emploi"); XLSX.writeFile(wb, "Modele_import_" + kind + ".xlsx"); }
function importDialog(kind) {
  const K = IMPORT[kind]; if (K.need === "admin" ? !S.isAdmin : !S.canWrite) { toast("Vos droits ne permettent pas cet import."); return; }
  const defCat = kind === "depart" ? (S.f.depCat || "FILTRE") : S.f.cat; let parsed = [];
  const html = '<p class="muted" style="margin-top:0">Choisissez un fichier Excel (.xlsx, .xls) ou CSV : la première feuille est lue, la première ligne doit contenir les en-têtes. Les colonnes sont reconnues par leur nom (voir le modèle).</p>' +
    '<div class="tools" style="margin-bottom:8px">' + F("imp-cat", "Catégorie par défaut", catSel("imp-cat", defCat)) + F("imp-file", "Fichier", '<input id="imp-file" type="file" accept=".xlsx,.xls,.xlsm,.csv">') +
    '<span class="grow"></span><button type="button" class="btn" id="imp-tpl">Télécharger le modèle</button></div>' +
    '<label class="chk"><input type="checkbox" id="imp-dup" checked> Ignorer les lignes signalées « doublon possible »</label><div id="imp-prev" class="imp-prev"></div>';
  const ov = modal(K.title, html, async ov => {
    if (!parsed.length) return "Choisissez d'abord un fichier.";
    const skipDup = ov.querySelector("#imp-dup").checked;
    const ok = parsed.filter(p => !p.errs.length && !(skipDup && p.warns.some(w => w.startsWith("doublon"))));
    if (!ok.length) return "Aucune ligne importable : corrigez les erreurs dans le fichier.";
    const btn = ov.querySelector("#mf-save"); let done = 0;
    for (let i = 0; i < ok.length; i += 300) { const chunk = ok.slice(i, i + 300).map(p => p.row);
      btn.textContent = "Import… " + done + "/" + ok.length; const rows = await must(sb.from(K.table).insert(chunk).select()); rows.forEach(r => applyRow(K.table, r)); done += rows.length; }
    toast(done + " ligne(s) importée(s) dans « " + TABLE_FR[K.table] + " »."); }, "Importer", true);
  ov.querySelector("#imp-tpl").onclick = () => templateXls(kind);
  const btn = ov.querySelector("#mf-save"); btn.disabled = true;
  const refresh = async () => { const f = ov.querySelector("#imp-file").files[0], box = ov.querySelector("#imp-prev"); parsed = []; btn.disabled = true; btn.textContent = "Importer"; if (!f) { box.innerHTML = ""; return; }
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true }); const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true, blankrows: false });
      const hIdx = aoa.findIndex(r => r.filter(c => String(c).trim()).length >= 2); if (hIdx < 0) { box.innerHTML = '<div class="banner crit">Le fichier ne contient pas de ligne d\'en-têtes.</div>'; return; }
      const headers = aoa[hIdx].map(String), map = matchCols(headers, K.cols), dcat = ov.querySelector("#imp-cat").value;
      const missing = K.cols.filter(c => ["ref", "qte", "engin"].includes(c[0]) && !(c[0] in map) && !(kind !== "sorties" && c[0] === "engin") && !(kind === "entrees" && c[0] === "qte")).map(c => c[1]);
      if (kind === "entrees" && !("dem" in map) && !("liv" in map)) missing.push("Qté demandée (BC) ou Qté livrée (BL)");
      const recon = K.cols.filter(c => c[0] in map).map(c => c[1] + " ← « " + headers[map[c[0]]] + " »");
      parsed = aoa.slice(hIdx + 1).filter(r => r.some(c => String(c).trim() !== "")).map((cells, i) => Object.assign(buildRow(kind, cells, map, dcat), { line: hIdx + 2 + i }));
      if (missing.length) { box.innerHTML = '<div class="banner crit">Colonne(s) obligatoire(s) introuvable(s) : ' + esc(missing.join(", ")) + ". Utilisez le modèle ou renommez les en-têtes.</div>"; parsed = []; return; }
      const skipDup = ov.querySelector("#imp-dup").checked;
      const nErr = parsed.filter(p => p.errs.length).length, nDup = parsed.filter(p => !p.errs.length && p.warns.some(w => w.startsWith("doublon"))).length, nOk = parsed.length - nErr - (skipDup ? nDup : 0);
      const nF = parsed.filter(p => !p.errs.length && p.cat === "FILTRE").length, nP = parsed.filter(p => !p.errs.length && p.cat === "PDR").length;
      box.innerHTML = '<div class="banner ' + (nErr ? "crit" : "ok") + '">' + parsed.length + " ligne(s) lue(s) · <b>" + nOk + " à importer</b> (" + nF + " filtre(s), " + nP + " PDR)" + (nErr ? " · " + nErr + " avec erreur (ignorées)" : "") + (nDup ? " · " + nDup + " doublon(s) possible(s)" : "") + "</div>" +
        '<p class="hint">Colonnes reconnues : ' + esc(recon.join(" · ")) + "</p>" +
        table([{ h: "Ligne", n: 1, f: p => p.line }, { h: "État", f: p => p.errs.length ? '<span class="pill p-crit">Erreur</span>' : (p.warns.length ? '<span class="pill p-warn">À vérifier</span>' : '<span class="pill p-ok">OK</span>') },
          { h: "Cat.", f: p => p.cat ? catPill(p.cat) : "" }, { h: "Date", f: p => fD(p.row.date || p.row.date_inv) }, { h: "Référence", f: p => mono(p.ref) },
          { h: kind === "sorties" ? "Engin" : "Engin / affect.", f: p => esc(p.row.engin || "Commun") }, { h: "Qté", n: 1, f: p => kind === "entrees" ? nb(p.row.qte_bc) + " / " + nb(p.row.qte_bl) : nb(p.row.qte) },
          { h: "Remarque", f: p => esc(p.errs.concat(p.warns).join(" · ")) }], parsed, { limit: 300, rowCls: p => p.errs.length ? "row-err" : "" });
      btn.disabled = nOk === 0; btn.textContent = nOk ? "Importer " + nOk + " ligne(s)" : "Importer";
    } catch (err) { box.innerHTML = '<div class="banner crit">Lecture impossible : ' + esc(err.message || err) + "</div>"; }
  };
  ["imp-file", "imp-cat", "imp-dup"].forEach(id => ov.querySelector("#" + id).addEventListener("change", refresh));
}

async function adminCall(body) { const { data, error } = await sb.functions.invoke("admin-users", { body });
  if (error) { let m = error.message; try { const j = await error.context.json(); m = j.error || m; } catch (_) {} throw new Error(m); }
  if (data && data.error) throw new Error(data.error); return data; }
const roleSel = (id, v) => '<select id="' + id + '">' + Object.entries(ROLE_FR).map(([k, l]) => '<option value="' + k + '"' + (k === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select>";
function userForm(id) { const p = id ? S.profiles.get(id) : null;
  if (!p) { modal("Nouveau compte", '<div class="fgrid">' + F("u-nom", "Nom et prénom *", '<input id="u-nom">') + F("u-id", "Identifiant de connexion *", '<input id="u-id" placeholder="ex. ahmed.magasin" autocomplete="off"><div class="hint">Lettres, chiffres, point ou tiret. Une adresse e-mail convient aussi.</div>') +
      F("u-pw", "Mot de passe initial * (8 caractères min.)", '<input id="u-pw" type="text" autocomplete="off">') + F("u-role", "Rôle", roleSel("u-role", "saisie")) + F("u-fct", "Fonction", '<input id="u-fct" placeholder="ex. Magasinier, chef d\'atelier">') + "</div>",
      async ov => { const nom = fv(ov, "u-nom"), ident = fv(ov, "u-id"), pw = ov.querySelector("#u-pw").value; if (!nom || !ident) return "Saisissez le nom et l'identifiant."; if (pw.length < 8) return "Le mot de passe doit faire au moins 8 caractères.";
        await adminCall({ action: "create", nom, identifiant: ident, password: pw, role: fv(ov, "u-role"), fonction: fv(ov, "u-fct") }); await loadProfiles(); render(); toast("Compte créé. Transmettez l'identifiant et le mot de passe à la personne."); }, "Créer le compte"); return; }
  modal("Modifier : " + (p.nom || p.identifiant), '<div class="fgrid">' + F("u-nom", "Nom et prénom", '<input id="u-nom" value="' + esc(p.nom) + '">') + F("u-fct", "Fonction", '<input id="u-fct" value="' + esc(p.fonction) + '">') + F("u-role", "Rôle", roleSel("u-role", p.role)) +
    F("u-act", "État du compte", '<select id="u-act"><option value="1"' + (p.actif ? " selected" : "") + '>Actif</option><option value="0"' + (p.actif ? "" : " selected") + ">Désactivé (ne peut plus se connecter)</option></select>") + "</div>",
    async ov => { await adminCall({ action: "update", id: p.id, nom: fv(ov, "u-nom"), fonction: fv(ov, "u-fct"), role: fv(ov, "u-role"), actif: fv(ov, "u-act") === "1" }); await loadProfiles(); render(); toast("Compte mis à jour."); }); }
function pwForm(id) { const p = S.profiles.get(id); if (!p) return;
  modal("Nouveau mot de passe : " + (p.nom || p.identifiant), F("u-pw", "Nouveau mot de passe (8 caractères min.)", '<input id="u-pw" type="text" autocomplete="off">'), async ov => { const pw = ov.querySelector("#u-pw").value; if (pw.length < 8) return "Au moins 8 caractères.";
    await adminCall({ action: "reset_password", id, password: pw }); toast("Mot de passe changé. Transmettez-le à la personne."); }, "Changer le mot de passe"); }
function confirmBox(text, onYes) { modal("Confirmer", "<p>" + esc(text) + "</p>", async () => { await onYes(); }, "Supprimer"); }

/* =====================================================================
   DEMANDES D'ACHAT (DA) : création, numérotation par le magasinier, suivi
   ===================================================================== */
const mapDA = r => ({ id: r.id, date: r.date_da || "", engin: r.engin || "", objet: r.objet || "", statut: r.statut, numero: r.numero_da || "", numAt: r.numero_at, numBy: r.numero_by, createdAt: r.created_at, createdBy: r.created_by });
const mapDL = r => ({ id: r.id, da: r.da_id, poste: r.poste || "", designation: r.designation || "", ref: r.ref || "", qte: r.qte, unite: r.unite || "", engin: r.engin || "", obs: r.obs || "" });
const daLines = id => [...S.daL.values()].filter(l => l.da === id).sort((a, b) => a.id - b.id);
const daLabel = d => d.numero ? "DA " + d.numero : "Demande #" + d.id;
const canEditDA = d => d.statut === "en_attente" && (S.isAdmin || (S.role === "gestionnaire" && d.createdBy === S.uid));
const daPending = () => [...S.da.values()].filter(d => d.statut === "en_attente");
const enginTxt = code => { if (!code) return ""; const e = S.engins.get(String(code)); return e ? [e.designation, e.marque, e.modele].filter(Boolean).join(" ") : ""; };
const daPill = d => d.statut === "numerotee" ? '<span class="pill p-ok">N° ' + esc(d.numero) + "</span>" : '<span class="pill p-warn">En attente du N° DA</span>';

function daActs(d, where) {
  let h = '<button class="btn small" data-act="da-view" data-id="' + d.id + '">Voir</button>';
  if (where === "suivi") h += '<button class="btn small" data-act="da-pdf" data-id="' + d.id + '">PDF</button><button class="btn small" data-act="da-xls" data-id="' + d.id + '">Excel</button>';
  if (S.canNumDA && d.statut === "en_attente") h += '<button class="btn small primary" data-act="da-num" data-id="' + d.id + '">Saisir N° DA</button>';
  if (S.canNumDA && d.statut === "numerotee" && where === "suivi") h += '<button class="btn small" data-act="da-num" data-id="' + d.id + '">Corriger N°</button>';
  if (canEditDA(d)) h += '<button class="btn small" data-act="da-edit" data-id="' + d.id + '">Modifier</button><button class="btn small danger" data-act="da-del" data-id="' + d.id + '">Suppr.</button>';
  return '<div class="rowact">' + h + "</div>";
}
function daCols(where) {
  const cols = [];
  if (where === "suivi") cols.push({ h: "N° DA", f: d => "<b>" + mono(d.numero) + "</b>" });
  const suivi = where === "suivi";
  if (!suivi) cols.push({ h: "Réf. interne", f: d => mono("#" + d.id) });
  cols.push({ h: "Date DA", f: d => fD(d.date) });
  if (!suivi) cols.push({ h: "Engin", f: d => d.engin ? mono(d.engin) + ' <span class="muted">' + esc(enginTxt(d.engin)) + "</span>" : '<span class="muted">Plusieurs</span>' });
  cols.push({ h: "Lignes", n: 1, f: d => nb(daLines(d.id).length) });
  if (!suivi) cols.push({ h: "Qté totale", n: 1, f: d => nb(daLines(d.id).reduce((t, l) => t + N(l.qte), 0)) });
  cols.push({ h: "Demandeur", f: d => who(d.createdBy) }, { h: "Créée le", f: d => fDT(d.createdAt) });
  if (where === "suivi") cols.push({ h: "N° saisi par", f: d => who(d.numBy) }, { h: "le", f: d => fDT(d.numAt) });
  else cols.push({ h: "Statut", f: d => daPill(d) });
  cols.push({ h: "", f: d => daActs(d, where) });
  return cols;
}
const daMatch = (d, q) => !q || norm([d.id, d.numero, d.engin, enginTxt(d.engin), d.objet, nameOf(d.createdBy), ...daLines(d.id).map(l => l.ref + " " + l.designation + " " + l.engin)].join(" ")).includes(q);

VIEWS.da = { title: "Création DA",
  tools: () => '<div class="tools">' + searchF("da-q", S.f.daQ, "N°, engin, référence, désignation…") + '<span class="grow"></span>' +
    (("Notification" in window) && Notification.permission === "default" && S.canNumDA ? '<button class="btn" data-act="da-notif">Activer les notifications</button>' : "") +
    (S.canCreateDA ? '<button class="btn" data-act="da-tpl">Télécharger le canevas DA</button><button class="btn" data-act="da-imp">Importer Excel</button><button class="btn primary" data-act="da-new">+ Nouvelle demande d\'achat</button>' : "") + "</div>",
  bind() { $("#da-q").oninput = e => { S.f.daQ = e.target.value; render(); }; },
  body() { if (!S.canDA) return '<div class="empty">Réservé aux administrateurs, gestionnaires et magasiniers.</div>';
    const q = norm(S.f.daQ), pend = daPending().filter(d => daMatch(d, q)).sort((a, b) => b.id - a.id);
    let h = "";
    if (S.canNumDA) h += pend.length ? '<div class="banner crit">🔔 ' + pend.length + " demande(s) d'achat en attente de votre numéro de DA. Cliquez « Saisir N° DA » : la demande passe alors dans « Suivi DA ».</div>" : '<div class="banner ok">✔ Aucune demande d\'achat en attente de numéro.</div>';
    else h += '<div class="banner info">Créez la demande (ou importez votre tableau) : le magasinier et l\'administrateur sont notifiés, puis le magasinier saisit le N° de DA et la demande passe dans « Suivi DA ».</div>';
    h += '<div class="panel"><h3>Demandes en attente du N° DA <small>' + pend.length + "</small></h3>" + table(daCols("crea"), pend, { empty: "Aucune demande en attente." }) + "</div>";
    if (S.role === "gestionnaire") { const mine = [...S.da.values()].filter(d => d.createdBy === S.uid && d.statut === "numerotee").sort((a, b) => (b.numAt || "").localeCompare(a.numAt || "")).slice(0, 10);
      h += '<div class="panel"><h3>Mes dernières demandes numérotées</h3>' + table([{ h: "N° DA", f: d => "<b>" + mono(d.numero) + "</b>" }, { h: "Date DA", f: d => fD(d.date) }, { h: "Engin", f: d => mono(d.engin) }, { h: "Numérotée le", f: d => fDT(d.numAt) }, { h: "", f: d => daActs(d, "suivi") }], mine, { empty: "Aucune pour l'instant." }) + "</div>"; }
    return h; } };

VIEWS.suivida = { title: "Suivi DA",
  tools: () => '<div class="tools">' + searchF("sda-q", S.f.sdaQ, "N° DA, engin, référence…") + field("sda-f", "Du", '<input id="sda-f" type="date" value="' + esc(S.f.sdaFrom) + '">') + field("sda-t", "Au", '<input id="sda-t" type="date" value="' + esc(S.f.sdaTo) + '">') +
    '<span class="grow"></span><button class="btn" data-act="da-xls-all">Exporter la liste (Excel)</button></div>',
  bind() { ["sda-q", "sda-f", "sda-t"].forEach(id => $("#" + id).addEventListener(id === "sda-q" ? "input" : "change", () => { S.f.sdaQ = $("#sda-q").value; S.f.sdaFrom = $("#sda-f").value; S.f.sdaTo = $("#sda-t").value; render(); })); },
  rows() { const q = norm(S.f.sdaQ); return [...S.da.values()].filter(d => d.statut === "numerotee" && inPeriod(d.date, S.f.sdaFrom, S.f.sdaTo) && daMatch(d, q)).sort((a, b) => (b.numAt || "").localeCompare(a.numAt || "") || b.id - a.id); },
  body() { if (!S.canDA) return '<div class="empty">Réservé aux administrateurs, gestionnaires et magasiniers.</div>';
    const r = this.rows(); const lines = r.reduce((t, d) => t + daLines(d.id).length, 0);
    return '<div class="more">' + r.length + " demande(s) numérotée(s) · " + lines + " ligne(s). Téléchargez chaque DA en PDF ou en Excel (format du canevas).</div>" + table(daCols("suivi"), r, { empty: "Aucune demande numérotée." }); } };

/* ---------- formulaire DA ---------- */
const lineRow = (l, i) => '<tr data-i="' + i + '"><td><input class="dl-poste" value="' + esc(l.poste) + '"></td><td><input class="dl-des" list="dl-types" value="' + esc(l.designation) + '"></td><td><input class="dl-ref" list="dl-refs" value="' + esc(l.ref) + '"></td>' +
  '<td><input class="dl-qte" type="number" min="0" step="any" value="' + esc(l.qte ?? "") + '"></td><td><input class="dl-uni" list="dl-unites" value="' + esc(l.unite) + '"></td><td><input class="dl-eng" list="dl-engins" value="' + esc(l.engin) + '"></td><td><button type="button" class="btn small danger dl-del" title="Retirer la ligne">×</button></td></tr>';
function daForm(d) {
  const isNew = !d; d = d || { date: today(), engin: "", objet: "" };
  const L = isNew ? [] : daLines(d.id); while (L.length < (isNew ? 5 : Math.max(1, L.length))) L.push({ poste: "", designation: "", ref: "", qte: "", unite: "", engin: "" });
  const html = '<div class="fgrid">' + F("d-date", "Date de la DA *", '<input id="d-date" type="date" value="' + esc(d.date) + '">') + "</div>" +
    '<div class="tw le"><table><thead><tr><th style="width:90px">N° Poste</th><th>Désignation Catalogue</th><th style="width:150px">Référence</th><th style="width:90px">Quantité *</th><th style="width:90px">Unité</th><th style="width:110px">Code_Engin</th><th style="width:40px"></th></tr></thead><tbody id="dl-body">' + L.map(lineRow).join("") + "</tbody></table></div>" + '<datalist id="dl-unites">' + ["U", "PCS", "JEU", "KIT", "L", "KG", "M", "PAIRE", "BOITE"].map(u => '<option value="' + u + '">').join("") + "</datalist>" +
    '<div class="actions" style="justify-content:flex-start;margin-top:8px"><button type="button" class="btn small" id="dl-add">+ Ajouter une ligne</button><span class="hint">Une ligne = un article. Les lignes vides sont ignorées.</span></div>';
  const ov = modal(isNew ? "Nouvelle demande d'achat" : "Modifier la demande #" + d.id, html, async ov => {
    const date = fv(ov, "d-date"); if (!date) return "Saisissez la date de la DA.";
    const rows = [], errs = [];
    ov.querySelectorAll("#dl-body tr").forEach((tr, k) => { const g = c => tr.querySelector(c).value.trim(); const poste = g(".dl-poste"), des = g(".dl-des"), ref = g(".dl-ref"), qs = g(".dl-qte"), un = g(".dl-uni"), le = g(".dl-eng");
      if (!poste && !des && !ref && !qs && !un && !le) return; const q = +qs.replace(",", ".");
      if (!des && !ref) errs.push("ligne " + (k + 1) + " : désignation ou référence manquante"); if (!(q > 0)) errs.push("ligne " + (k + 1) + " : quantité invalide"); if (le && !S.engins.has(le)) errs.push("ligne " + (k + 1) + " : engin " + le + " inconnu");
      rows.push({ poste: poste || null, designation: des || null, ref: ref || null, qte: q, unite: un || null, engin: le || null }); });
    if (errs.length) return errs.slice(0, 4).join(" · "); if (!rows.length) return "Ajoutez au moins une ligne.";
    const engs = [...new Set(rows.map(x => x.engin).filter(Boolean))], eng = engs.length === 1 ? engs[0] : null;  // engin de la DA = Code_Engin des lignes
    if (isNew) { const r = await must(sb.from("da").insert({ date_da: date, engin: eng }).select().single());
      try { const ls = await must(sb.from("da_lignes").insert(rows.map(x => Object.assign({ da_id: r.id }, x))).select()); S.da.set(r.id, mapDA(r)); ls.forEach(l => S.daL.set(l.id, mapDL(l))); }
      catch (e) { await sb.from("da").delete().eq("id", r.id); throw e; }
      schedule(); toast("Demande d'achat #" + r.id + " créée (" + rows.length + " ligne(s)). Le magasinier et l'administrateur sont notifiés."); return; }
    const r = await must(sb.from("da").update({ date_da: date, engin: eng }).eq("id", d.id).select().single());
    await must(sb.from("da_lignes").delete().eq("da_id", d.id)); daLines(d.id).forEach(l => S.daL.delete(l.id));
    const ls = await must(sb.from("da_lignes").insert(rows.map(x => Object.assign({ da_id: d.id }, x))).select());
    S.da.set(r.id, mapDA(r)); ls.forEach(l => S.daL.set(l.id, mapDL(l))); schedule(); toast("Demande #" + d.id + " modifiée."); }, isNew ? "Créer la demande" : "Enregistrer", true);
  const body = ov.querySelector("#dl-body"); let n = L.length;
  ov.querySelector("#dl-add").onclick = () => { body.insertAdjacentHTML("beforeend", lineRow({ poste: "", designation: "", ref: "", qte: "", unite: "", engin: "" }, n++)); };
  body.addEventListener("click", e => { const b = e.target.closest(".dl-del"); if (b) { if (body.children.length > 1) b.closest("tr").remove(); else b.closest("tr").querySelectorAll("input").forEach(i => i.value = ""); } });
  body.addEventListener("change", e => { if (!e.target.classList.contains("dl-ref")) return; const tr = e.target.closest("tr"), des = tr.querySelector(".dl-des"); if (!des.value.trim() && C) { const i = C.info(e.target.value.trim()); if (i && i.type) des.value = i.type; } });
}

function daNumForm(d) {
  modal((d.numero ? "Corriger le N° de DA – " : "Saisir le N° de DA – ") + "demande #" + d.id, '<p class="muted" style="margin-top:0">' + esc([fD(d.date), d.engin && ("engin " + d.engin), d.objet, daLines(d.id).length + " ligne(s)", "demandeur : " + nameOf(d.createdBy)].filter(Boolean).join(" · ")) + "</p>" +
    F("n-num", "N° de DA *", '<input id="n-num" value="' + esc(d.numero) + '" placeholder="ex. 4500012345" autocomplete="off">') + '<div class="hint">Après validation, la demande passe dans « Suivi DA » et le demandeur est notifié.</div>',
    async ov => { const num = fv(ov, "n-num"); if (!num) return "Saisissez le numéro de DA.";
      const dup = [...S.da.values()].find(x => x.numero === num && x.id !== d.id); if (dup) return "Ce N° de DA est déjà utilisé (demande #" + dup.id + ").";
      const r = await must(sb.from("da").update({ numero_da: num }).eq("id", d.id).select().single()); S.da.set(r.id, mapDA(r)); schedule(); toast("N° DA " + num + " enregistré : la demande est dans « Suivi DA »."); }, "Valider le N° DA");
}

function daView(d) {
  const L = daLines(d.id);
  const html = '<div class="kpis">' + kpi("Statut", d.statut === "numerotee" ? "N° " + esc(d.numero) : "En attente", d.statut === "numerotee" ? "txt" : "warn") + kpi("Date DA", fD(d.date), "txt") + kpi("Lignes", nb(L.length)) + kpi("Qté totale", nb(L.reduce((t, l) => t + N(l.qte), 0))) + "</div>" +
    '<p class="muted">' + (d.engin ? "Engin principal : <b>" + esc(d.engin) + "</b> " + esc(enginTxt(d.engin)) + " · " : "") + (d.objet ? "Objet : " + esc(d.objet) + " · " : "") + "Demandeur : " + esc(nameOf(d.createdBy)) + " · créée le " + fDT(d.createdAt) + (d.numAt ? " · N° saisi par " + esc(nameOf(d.numBy)) + " le " + fDT(d.numAt) : "") + "</p>" +
    table([{ h: "N° Poste", f: l => esc(l.poste) }, { h: "Désignation Catalogue", f: l => esc(l.designation) }, { h: "Référence", f: l => mono(l.ref) }, { h: "Quantité", n: 1, f: l => "<b>" + nb(l.qte) + "</b>" }, { h: "Unité", f: l => esc(l.unite) }, { h: "Code_Engin", f: l => mono(l.engin) }], L, { empty: "Aucune ligne." }) +
    '<div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-act="da-pdf" data-id="' + d.id + '">Télécharger PDF</button><button type="button" class="btn" data-act="da-xls" data-id="' + d.id + '">Télécharger Excel</button>' +
    (S.canNumDA && d.statut === "en_attente" ? '<button type="button" class="btn primary" data-act="da-num" data-id="' + d.id + '">Saisir N° DA</button>' : "") + "</div>";
  const ov = modal(daLabel(d), html, async () => {}, "Fermer", true); ov.querySelector("#mf-cancel").hidden = true;
  ov.addEventListener("click", e => { if (e.target.closest("[data-act]")) ov.remove(); });
}

/* ---------- import d'un tableau de DA (canevas : Date | DA | N° Poste | Désignation Catalogue | Référance | Quantité | Code_Engin) ---------- */
const DA_COLS = [["date", "Date", ["date", "datedemande", "dateda"]], ["num", "DA", ["da", "nda", "numda", "numeroda", "nodemandeachat", "demandeachat"]], ["poste", "N° Poste", ["nposte", "poste", "numeroposte", "noposte", "item"]],
  ["designation", "Désignation Catalogue", ["designationcatalogue", "designation", "libelle", "article", "description"]], ["ref", "Référance", ["referance", "reference", "ref", "codearticle", "refpiece", "referencefiltre"]],
  ["qte", "Quantité", ["quantite", "qte", "qtedemandee", "quantitedemandee"]], ["unite", "Unité", ["unite", "unites", "um", "udm", "uniteqte", "unitedemesure"]], ["engin", "Code_Engin", ["codeengin", "engin", "codeengins", "enginconcerne"]]];
function daImportDialog() {
  if (!S.canCreateDA) { toast("Seuls l'administrateur et le gestionnaire créent des demandes d'achat."); return; }
  let groups = [];
  const html = '<p class="muted" style="margin-top:0">Choisissez votre tableau de demande d\'achat (.xlsx, .xls ou .csv) au format du canevas : <b>Date · DA · N° Poste · Désignation Catalogue · Référance · Quantité · Unité · Code_Engin</b> (la colonne Unité est facultative). Chaque feuille devient une demande ; si la colonne DA contient plusieurs numéros, une demande est créée par numéro.</p>' +
    '<div class="tools" style="margin-bottom:8px">' + F("di-file", "Fichier", '<input id="di-file" type="file" accept=".xlsx,.xls,.xlsm,.csv">') + '<span class="grow"></span><button type="button" class="btn" data-act="da-tpl">Télécharger le canevas DA</button></div><div id="di-prev" class="imp-prev"></div>';
  const ov = modal("Importer un tableau de demande d'achat", html, async ov => {
    const ok = groups.filter(g => g.ok.length && !g.err); if (!ok.length) return "Aucune demande importable : corrigez le fichier.";
    const btn = ov.querySelector("#mf-save"); let n = 0;
    for (const g of ok) { btn.textContent = "Import… " + n + "/" + ok.length;
      const head = { date_da: g.date, engin: g.engin || null, source: "import" }; if (g.num && S.canNumDA) head.numero_da = g.num;
      const r = await must(sb.from("da").insert(head).select().single());
      try { const ls = await must(sb.from("da_lignes").insert(g.ok.map(l => Object.assign({ da_id: r.id }, l))).select()); S.da.set(r.id, mapDA(r)); ls.forEach(l => S.daL.set(l.id, mapDL(l))); }
      catch (e) { await sb.from("da").delete().eq("id", r.id); throw e; } n++; }
    schedule(); toast(n + " demande(s) d'achat importée(s)." + (S.canNumDA ? "" : " Le magasinier et l'administrateur sont notifiés.")); }, "Importer", true);
  const btn = ov.querySelector("#mf-save"); btn.disabled = true;
  ov.querySelector("#di-file").addEventListener("change", async () => { const f = ov.querySelector("#di-file").files[0], box = ov.querySelector("#di-prev"); groups = []; btn.disabled = true; btn.textContent = "Importer"; if (!f) { box.innerHTML = ""; return; }
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true }); const used = new Set([...S.da.values()].map(d => d.numero).filter(Boolean)); const notes = [];
      for (const sn of wb.SheetNames) { const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "", raw: true, blankrows: false });
        const hIdx = aoa.findIndex(r => r.filter(c => String(c).trim()).length >= 2); if (hIdx < 0) continue;
        const map = matchCols(aoa[hIdx].map(String), DA_COLS); if (!("qte" in map) || (!("ref" in map) && !("designation" in map))) { notes.push("Feuille « " + sn + " » ignorée : colonnes Quantité et Référance / Désignation introuvables."); continue; }
        const sheetEng = S.engins.has(sn.trim()) ? sn.trim() : "", by = new Map();
        aoa.slice(hIdx + 1).forEach((cells, i) => { if (!cells.some(c => String(c).trim() !== "")) return; const g = k => (k in map ? cells[map[k]] : "");
          const num = pStr(g("num")), key = num || "", grp = by.get(key) || { sheet: sn, num, lines: [], dates: [] }; by.set(key, grp);
          const dt = pDate(g("date")); if (!dt.err && !dt.warn) grp.dates.push(dt.v);
          const q = pNum(g("qte")), ref = pStr(g("ref")), des = pStr(g("designation")), eng = pStr(g("engin")) || sheetEng, errs = [];
          if (!ref && !des) errs.push("désignation et référence vides"); if (q === null || Number.isNaN(q) || q <= 0) errs.push("quantité invalide"); if (eng && !S.engins.has(eng)) errs.push("engin " + eng + " inconnu"); if (dt.err) errs.push(dt.err);
          grp.lines.push({ line: hIdx + 2 + i, errs, row: { poste: pStr(g("poste")) || null, designation: des || null, ref: ref || null, qte: q, unite: pStr(g("unite")) || null, engin: eng || null } }); });
        for (const grp of by.values()) { const engs = [...new Set(grp.lines.map(l => l.row.engin).filter(Boolean))];
          grp.engin = engs.length === 1 ? engs[0] : sheetEng; grp.date = grp.dates.sort()[0] || today(); grp.ok = grp.lines.filter(l => !l.errs.length).map(l => l.row);
          if (grp.num && S.canNumDA && used.has(grp.num)) grp.err = "N° DA " + grp.num + " déjà enregistré"; if (grp.num && S.canNumDA) used.add(grp.num);
          groups.push(grp); } }
      if (!S.canNumDA && groups.some(g => g.num)) notes.push("Les N° DA présents dans le fichier sont ignorés : ils seront saisis par le magasinier.");
      const okG = groups.filter(g => g.ok.length && !g.err), bad = groups.flatMap(g => g.lines.filter(l => l.errs.length).map(l => Object.assign({ sheet: g.sheet }, l)));
      box.innerHTML = (groups.length ? '<div class="banner ' + (bad.length || okG.length < groups.length ? "crit" : "ok") + '">' + groups.length + " demande(s) détectée(s) · <b>" + okG.length + " à créer</b> (" + okG.reduce((t, g) => t + g.ok.length, 0) + " ligne(s))" + (bad.length ? " · " + bad.length + " ligne(s) en erreur ignorée(s)" : "") + "</div>" : '<div class="banner crit">Aucune donnée reconnue dans ce fichier.</div>') +
        notes.map(n => '<p class="hint">' + esc(n) + "</p>").join("") +
        table([{ h: "Feuille", f: g => esc(g.sheet) }, { h: "N° DA (fichier)", f: g => esc(g.num || "–") }, { h: "Date", f: g => fD(g.date) }, { h: "Engin", f: g => esc(g.engin || "plusieurs") }, { h: "Lignes OK", n: 1, f: g => nb(g.ok.length) },
          { h: "Qté", n: 1, f: g => nb(g.ok.reduce((t, l) => t + N(l.qte), 0)) }, { h: "État", f: g => g.err ? '<span class="pill p-crit">' + esc(g.err) + "</span>" : (g.ok.length ? '<span class="pill p-ok">OK</span>' : '<span class="pill p-crit">Aucune ligne valide</span>') }], groups) +
        (bad.length ? "<h4>Lignes en erreur</h4>" + table([{ h: "Feuille", f: l => esc(l.sheet) }, { h: "Ligne", n: 1, f: l => l.line }, { h: "Référence", f: l => mono(l.row.ref) }, { h: "Désignation", f: l => esc(l.row.designation) }, { h: "Erreur", f: l => esc(l.errs.join(" · ")) }], bad, { limit: 100, rowCls: () => "row-err" }) : "");
      btn.disabled = !okG.length; btn.textContent = okG.length ? "Créer " + okG.length + " demande(s)" : "Importer";
    } catch (err) { box.innerHTML = '<div class="banner crit">Lecture impossible : ' + esc(err.message || err) + "</div>"; } });
}

/* ---------- exports PDF / Excel ---------- */
const libs = {};
function loadScript(src) { return libs[src] || (libs[src] = new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => { delete libs[src]; ko(new Error("Chargement impossible de " + src)); }; document.head.appendChild(s); })); }
const fileSafe = s => String(s).replace(/[^\w.-]+/g, "_");
function saveBlob(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
const isoToDate = iso => { if (!iso) return null; const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };

async function daExcel(list, name) {
  await loadScript("vendor/exceljs.min.js");
  const wb = new ExcelJS.Workbook(); wb.creator = APPNAME;
  const one = list.length === 1, d0 = list[0];
  const ws = wb.addWorksheet(fileSafe(one ? (d0.engin || d0.numero || "DA") : "Suivi DA").slice(0, 31), { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 11 }, { width: 13 }, { width: 11 }, { width: 32.45 }, { width: 17.73 }, { width: 8.09 }, { width: 8 }, { width: 15 }];
  const thin = { style: "thin" }, bd = { top: thin, left: thin, bottom: thin, right: thin };
  const hr = ws.addRow(["Date", "DA", "N° Poste", "Désignation Catalogue", "Référance", "Quantité", "Unité", "Code_Engin"]); hr.height = 18.9;
  hr.eachCell(c => { c.font = { name: "Arial", size: 9, bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } }; c.border = bd; c.alignment = { horizontal: "center", vertical: "middle" }; });
  for (const d of list) for (const l of daLines(d.id)) {
    const num = /^\d{1,15}$/.test(d.numero) ? +d.numero : (d.numero || ""), poste = /^\d{1,9}$/.test(l.poste) ? +l.poste : l.poste, eng = /^\d{1,9}$/.test(l.engin) ? +l.engin : l.engin;
    const r = ws.addRow([isoToDate(d.date), num, poste, l.designation, l.ref, N(l.qte), l.unite, eng]);
    r.eachCell({ includeEmpty: true }, (c, col) => { c.font = { name: "Arial", size: 10, bold: col === 6 || col === 8 }; c.border = bd; c.alignment = { horizontal: [4, 5].includes(col) ? "left" : "center", vertical: "middle" }; });
    r.getCell(1).numFmt = "dd/mm/yyyy"; }
  ws.autoFilter = { from: "A1", to: { row: Math.max(1, ws.rowCount), column: 8 } };
  saveBlob(new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
}
async function daPdf(d) {
  await loadScript("vendor/jspdf.umd.min.js"); await loadScript("vendor/jspdf.plugin.autotable.min.js");
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" }), W = 210, L = daLines(d.id);
  doc.setFillColor(15, 76, 92); doc.rect(0, 0, W, 24, "F"); doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("DEMANDE D'ACHAT", 14, 11);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(S.params.nom_chantier || "", 14, 18);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(d.numero ? "N° DA : " + d.numero : "N° DA : en attente", W - 14, 11, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text("Réf. interne #" + d.id, W - 14, 18, { align: "right" });
  doc.setTextColor(30);
  // engin(s) : le code saisi dans Code_Engin des lignes → désignation, marque, type (modèle), série de la fiche engin
  const codes = [...new Set(L.map(l => l.engin).filter(Boolean))], eg = c => S.engins.get(String(c)) || {};
  if (codes.length <= 1) { const c = codes[0] || "", e = eg(c);
    doc.autoTable({ startY: 30, body: [["Date de la DA", fD(d.date)], ["Code engin", c || "-"], ["Désignation", e.designation || "-"], ["Marque", e.marque || "-"], ["Type", e.modele || "-"], ["N° de série", e.serie || "-"]],
      theme: "plain", styles: { fontSize: 9.5, cellPadding: 1.2 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 38, textColor: [15, 76, 92] } }, margin: { left: 14, right: 14 } });
  } else {
    doc.autoTable({ startY: 30, body: [["Date de la DA", fD(d.date)]], theme: "plain", styles: { fontSize: 9.5, cellPadding: 1.2 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 38, textColor: [15, 76, 92] } }, margin: { left: 14, right: 14 } });
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 2, head: [["Code engin", "Désignation", "Marque", "Type", "N° de série"]], body: codes.map(c => { const e = eg(c); return [c, e.designation || "-", e.marque || "-", e.modele || "-", e.serie || "-"]; }),
      theme: "grid", margin: { left: 14, right: 14 }, styles: { fontSize: 9, cellPadding: 1.6, lineColor: [160, 160, 160], lineWidth: 0.1, textColor: 20 }, headStyles: { fillColor: [222, 234, 237], textColor: [15, 76, 92], fontStyle: "bold" } }); }
  doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, head: [["N° Poste", "Désignation Catalogue", "Référence", "Quantité", "Unité", "Code_Engin"]], body: L.map(l => [l.poste, l.designation, l.ref, nb(l.qte), l.unite, l.engin]),
    theme: "grid", margin: { left: 14, right: 14 },
    styles: { fontSize: 9.5, cellPadding: 2, lineColor: [120, 120, 120], lineWidth: 0.1, textColor: 20 }, headStyles: { fillColor: [255, 255, 0], textColor: 0, fontStyle: "bold", halign: "center" },
    columnStyles: { 0: { halign: "center", cellWidth: 20 }, 2: { cellWidth: 36 }, 3: { halign: "center", cellWidth: 20, fontStyle: "bold" }, 4: { halign: "center", cellWidth: 16 }, 5: { halign: "center", cellWidth: 26, fontStyle: "bold" } } });
  const pages = doc.getNumberOfPages(); for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120); doc.text("page " + p + "/" + pages, W / 2, 290, { align: "center" }); }
  doc.save("DA_" + fileSafe(d.numero || ("interne_" + d.id)) + (d.engin ? "_" + fileSafe(d.engin) : "") + ".pdf");
}

/* ---------- notifications DA ---------- */
function daNotify(title, body) { toast(title + " – " + body);
  try { if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(title, { body }); } catch (_) {} }
function onDaChange(p) {
  const row = p.new, old = p.old;
  if (p.eventType === "DELETE") { S.da.delete(old.id); daLines(old.id).forEach(l => S.daL.delete(l.id)); schedule(); return; }
  const was = S.da.get(row.id); S.da.set(row.id, mapDA(row));
  if (p.eventType === "INSERT" && row.created_by !== S.uid && S.canNumDA && row.statut === "en_attente") daNotify("🔔 Nouvelle demande d'achat", "#" + row.id + " de " + nameOf(row.created_by) + (row.engin ? " · engin " + row.engin : "") + " : à numéroter dans « Création DA ».");
  if (p.eventType === "UPDATE" && row.numero_da && (!was || !was.numero) && row.numero_by !== S.uid && (row.created_by === S.uid || S.isAdmin)) daNotify("✔ DA numérotée", "Demande #" + row.id + " : N° DA " + row.numero_da + " saisi par " + nameOf(row.numero_by) + ". Elle est dans « Suivi DA ».");
  schedule();
}

/* ---------- actions ---------- */
document.addEventListener("click", async e => { const b = e.target.closest("[data-act]"); if (!b) return; const a = b.dataset.act, id = b.dataset.id;
  try {
    if (a === "new-entree") return entreeForm();
    if (a === "da-new") return daForm(null);
    if (a === "da-imp") return daImportDialog();
    if (a === "da-tpl") { const l = document.createElement("a"); l.href = "modeles/Canevas_DA.xlsx"; l.download = "Canevas_DA.xlsx"; document.body.appendChild(l); l.click(); l.remove(); return; }
    if (a === "da-notif") { await Notification.requestPermission(); render(true); return; }
    if (a.startsWith("da-") && a !== "da-xls-all") { const d = S.da.get(+id); if (!d) return;
      if (a === "da-view") return daView(d);
      if (a === "da-edit") return canEditDA(d) && daForm(d);
      if (a === "da-num") return S.canNumDA && daNumForm(d);
      if (a === "da-del") return confirmBox("Supprimer la demande d'achat #" + d.id + " (" + daLines(d.id).length + " ligne(s)) ?", async () => { const r = await must(sb.from("da").delete().eq("id", d.id).select()); if (!r.length) throw new Error("permission denied"); S.da.delete(d.id); daLines(d.id).forEach(l => S.daL.delete(l.id)); schedule(); toast("Demande supprimée."); });
      if (a === "da-pdf") { toast("Préparation du PDF…"); return await daPdf(d); }
      if (a === "da-xls") return await daExcel([d], "DA_" + fileSafe(d.numero || ("interne_" + d.id)) + (d.engin ? "_" + fileSafe(d.engin) : "") + ".xlsx"); }
    if (a === "da-xls-all") { const r = VIEWS.suivida.rows(); if (!r.length) { toast("Aucune DA à exporter."); return; } return await daExcel(r, "Suivi_DA_" + today() + ".xlsx"); }
    if (a === "new-sortie") return sortieForm();
    if (a === "imp-entrees") return importDialog("entrees");
    if (a === "imp-sorties") return importDialog("sorties");
    if (a === "imp-depart") return importDialog("depart");
    if (a === "recv" || a === "edit-entree") { const d = S.entrees.get(+id); return d && entreeForm(Object.assign({}, d), a === "recv"); }
    if (a === "edit-sortie") { const d = S.sorties.get(+id); return d && sortieForm(Object.assign({}, d)); }
    if (a === "del-entree") { const d = S.entrees.get(+id); return d && confirmBox("Supprimer l'entrée " + d.ref + " du " + fD(d.date) + " ? Le stock sera recalculé.", async () => { const r = await must(sb.from("entrees").delete().eq("id", d.id).select()); if (!r.length) throw new Error("permission denied"); S.entrees.delete(d.id); schedule(); toast("Entrée supprimée."); }); }
    if (a === "del-sortie") { const d = S.sorties.get(+id); return d && confirmBox("Supprimer la sortie " + d.ref + " sur " + d.engin + " du " + fD(d.date) + " ?", async () => { const r = await must(sb.from("sorties").delete().eq("id", d.id).select()); if (!r.length) throw new Error("permission denied"); S.sorties.delete(d.id); schedule(); toast("Sortie supprimée."); }); }
    if (a === "new-engin") return enginForm(null);
    if (a === "edit-engin") return enginForm(id);
    if (a === "new-dep") return depForm(null);
    if (a === "edit-dep") return depForm(id);
    if (a === "del-dep") { const l = S.depart.get(+id); return l && confirmBox("Supprimer la ligne de stock de départ " + l.ref + " (" + (l.engin || "commun") + ", " + nb(l.qte) + ") ?", async () => { await must(sb.from("stock_depart").delete().eq("id", l.id)); S.depart.delete(l.id); schedule(); toast("Ligne supprimée."); }); }
    if (a === "save-params") { const P = { nom_chantier: $("#pa-nom").value.trim() }; ["types", "interventions", "ateliers", "unites"].forEach(k => P[k] = $("#pa-" + k).value.split("\n").map(s => s.trim()).filter(Boolean)); P.seuil = N($("#pa-seuil").value); P.seuil_pdr = N($("#pa-seuilp").value);
      const r = await must(sb.from("params").update(P).eq("id", 1).select().single()); S.params = Object.assign(S.params, r); schedule(true); applyHeader(); toast("Paramètres enregistrés."); return; }
    if (a === "seen") { await sb.rpc("set_last_seen"); S.lastSeen = new Date().toISOString(); render(); toast("Nouveautés marquées comme lues."); return; }
    if (a === "new-user") return userForm(null);
    if (a === "edit-user") return userForm(id);
    if (a === "pw-user") return pwForm(id);
    if (a === "my-pw") { const p1 = $("#pw1").value, p2 = $("#pw2").value; if (p1.length < 8) { $("#pw-err").textContent = "Au moins 8 caractères."; return; } if (p1 !== p2) { $("#pw-err").textContent = "Les deux mots de passe ne sont pas identiques."; return; }
      const { error } = await sb.auth.updateUser({ password: p1 }); if (error) { $("#pw-err").textContent = errMsg(error); return; } $("#pw1").value = $("#pw2").value = ""; $("#pw-err").textContent = ""; toast("Mot de passe changé."); return; }
    if (a === "logout") { await sb.auth.signOut(); location.reload(); return; }
    const catName = c => c === "PDR" ? "PDR" : "Filtre";
    if (a === "xls-stock") return xls("Stock_" + (S.f.stockCat || "filtres_PDR") + "_" + today() + ".xlsx", "Stock actuel", VIEWS.stock.rows().map(l => ({ "Catégorie": catName(l.cat), "Affectation": l.engin || "Commun", "Engin": l.label, "Référence": l.ref, "Désignation / type": l.type, "Marque": l.marque, "Réf. équiv.": l.equiv, "Départ": l.dep, "Entrées": l.ent, "Sorties": l.sor, "Stock": l.stock, "Seuil": l.seuil, "Statut": l.statut, "Dernière entrée": fD(l.lastE), "Dernière sortie": fD(l.lastS) })));
    if (a === "xls-ent") return xls("Entrees_" + S.f.cat + "_" + today() + ".xlsx", "Entrées", VIEWS.entrees.rows().map(x => ({ "Catégorie": catName(x.cat), "Date": fD(x.date), "Référence": x.ref, "Désignation / type": x.type, "Marque": x.marque, "Réf. équivalentes": x.equiv, "Qté demandée (BC)": x.dem ?? "", "Qté livrée (BL)": x.liv ?? "", "Reste à livrer": x.reste || "", "N° BC": x.bc, "N° BL": x.bl, "Engin destinataire": x.engin || "", "Observations": x.obs, "Saisi par": x.createdBy ? nameOf(x.createdBy) : "Import" })));
    if (a === "xls-sor") return xls("Sorties_" + S.f.cat + "_" + today() + ".xlsx", "Sorties", VIEWS.sorties.rows().map(s => ({ "Catégorie": catName(s.cat), "Date": fD(s.date), "Code engin (monté sur)": s.engin, "Engin": s.label, "Engin initial": s.enginInit, "Compteur (h / km)": s.compteur ?? "", "Type d'intervention": s.intervention, "Référence": s.ref, "Désignation / type": s.type, "Quantité": s.qte, "Pris sur": mvtLabel(s), "Atelier": s.atelier, "Observations": s.obs, "Saisi par": s.createdBy ? nameOf(s.createdBy) : "Import" })));
  } catch (err) { toast(errMsg(err)); }
});
function xls(name, sheet, rows) { if (!window.XLSX) { toast("Export indisponible."); return; } const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheet); XLSX.writeFile(wb, name); }

/* ---------- chargement et temps réel ---------- */
async function fetchAll(table, order) { const out = []; for (let from = 0; ; from += 1000) { const data = await must(sb.from(table).select("*").order(order, { ascending: true }).range(from, from + 999)); out.push(...data); if (data.length < 1000) break; } return out; }
async function loadProfiles() { const r = await fetchAll("profiles", "created_at"); S.profiles = new Map(r.map(p => [p.id, p])); if (S.uid && S.profiles.get(S.uid)) S.me = S.profiles.get(S.uid); }
function applyRow(table, row) {
  if (table === "entrees") S.entrees.set(row.id, mapE(row)); else if (table === "sorties") S.sorties.set(row.id, mapS(row));
  else if (table === "stock_depart") S.depart.set(row.id, mapD(row)); else if (table === "engins") S.engins.set(String(row.code), mapG(row));
  schedule(table === "engins");
}
function applyHeader() { $("#app-chantier").textContent = S.params.nom_chantier || ""; }
let tmr = null, pFull = false;
function schedule(full) { pFull = pFull || !!full; if (tmr) return; tmr = setTimeout(() => { tmr = null; const f = pFull; pFull = false; if (!S.loaded) return; compute(); fillLists(); render(f); }, 120); }
function fillLists() {
  $("#dl-refs").innerHTML = C.refs.map(r => { const i = C.info(r); return '<option value="' + esc(r) + '">' + esc((i.cat === "PDR" ? "PDR · " : "") + i.type) + "</option>"; }).join("");
  $("#dl-engins").innerHTML = [...S.engins.values()].map(e => '<option value="' + esc(e.code) + '">' + esc([e.designation, e.marque, e.modele].filter(Boolean).join(" ")) + "</option>").join("");
  const t = new Set(S.params.types || []); C.lines.forEach(l => l.type && t.add(l.type)); $("#dl-types").innerHTML = [...t].map(x => '<option value="' + esc(x) + '">').join("");
  const m = new Set(); C.lines.forEach(l => l.marque && m.add(l.marque)); $("#dl-marques").innerHTML = [...m].map(x => '<option value="' + esc(x) + '">').join("");
}
function setSync(ok, txt) { $("#sync-dot").classList.toggle("on", ok); $("#sync-txt").textContent = txt; }
/* notifications groupées (un import de 200 lignes = un seul message) */
const pend = new Map(); let pendT = null;
function notifyInsert(row) { const k = row.user_id + "|" + row.table_name; const o = pend.get(k) || { n: 0, last: row }; o.n++; o.last = row; pend.set(k, o);
  clearTimeout(pendT); pendT = setTimeout(() => { for (const o of pend.values()) { const r = o.last, what = r.table_name === "entrees" ? "entrée" : "sortie";
    toast(nameOf(r.user_id) + (o.n > 1 ? " a ajouté " + o.n + " " + what + "s (import)" : " a ajouté une " + what + " : " + r.resume)); } pend.clear(); }, 1500); }

async function startApp() {
  $("#login").hidden = true; $("#app").hidden = false; setSync(false, "Chargement…");
  await loadProfiles(); const me = S.me;
  if (!me || !me.actif) { await sb.auth.signOut(); showLogin("Ce compte n'est pas actif. Contactez l'administrateur."); return; }
  S.role = me.role; S.isAdmin = me.role === "admin"; S.canWrite = S.isAdmin || me.role === "saisie" || me.role === "magasinier";
  S.canDA = ["admin", "gestionnaire", "magasinier"].includes(me.role); S.canCreateDA = ["admin", "gestionnaire"].includes(me.role); S.canNumDA = ["admin", "magasinier"].includes(me.role); S.lastSeen = me.last_seen || null;
  $("#me-box").innerHTML = '<span class="who">' + avatar(S.uid) + '<span class="nm">' + esc(me.nom || me.identifiant) + "</span></span>" + '<span class="role ' + (S.isAdmin ? "admin" : "") + '">' + esc(ROLE_FR[me.role]) + '</span><button class="btn small" data-act="logout">Déconnexion</button>';
  try { const v = localStorage.getItem("fc-view"); if (v && VIEWS[v] && (v !== "users" || S.isAdmin) && (!["da", "suivida"].includes(v) || S.canDA)) S.view = v; const c = localStorage.getItem("fc-cat"); if (c === "PDR" || c === "FILTRE") S.f.cat = c; } catch (_) {}
  const [eng, dep, ent, sor, par, jr] = await Promise.all([fetchAll("engins", "code"), fetchAll("stock_depart", "id"), fetchAll("entrees", "id"), fetchAll("sorties", "id"),
    must(sb.from("params").select("*").eq("id", 1).maybeSingle()), must(sb.from("journal").select("*").order("at", { ascending: false }).limit(1000))]);
  S.engins = new Map(eng.map(r => [String(r.code), mapG(r)])); S.depart = new Map(dep.map(r => [r.id, mapD(r)])); S.entrees = new Map(ent.map(r => [r.id, mapE(r)])); S.sorties = new Map(sor.map(r => [r.id, mapS(r)]));
  if (par) S.params = Object.assign(S.params, par); S.journal = jr; applyHeader();
  if (S.canDA) { const [da, dl] = await Promise.all([fetchAll("da", "id"), fetchAll("da_lignes", "id")]); S.da = new Map(da.map(r => [r.id, mapDA(r)])); S.daL = new Map(dl.map(r => [r.id, mapDL(r)])); }
  S.loaded = true; compute(); fillLists(); render(true);
  sb.channel("filtres").on("postgres_changes", { event: "*", schema: "public" }, p => {
    const t = p.table, row = p.new, old = p.old;
    if (t === "journal") { if (p.eventType === "INSERT") { S.journal.unshift(row); if (S.journal.length > 1500) S.journal.length = 1500; if (row.user_id !== S.uid && (row.table_name === "entrees" || row.table_name === "sorties") && row.action === "insert") notifyInsert(row); renderNav(); if (S.view === "dash" || S.view === "journal") schedule(); } return; }
    if (t === "profiles") { loadProfiles().then(() => schedule()); return; }
    if (t === "da") { if (S.canDA) onDaChange(p); return; }
    if (t === "da_lignes") { if (S.canDA) { if (p.eventType === "DELETE") S.daL.delete(old.id); else S.daL.set(row.id, mapDL(row)); schedule(); } return; }
    if (t === "params") { if (row) { S.params = Object.assign(S.params, row); applyHeader(); schedule(true); } return; }
    const maps = { entrees: [S.entrees, mapE], sorties: [S.sorties, mapS], stock_depart: [S.depart, mapD] };
    if (t === "engins") { if (p.eventType === "DELETE") S.engins.delete(String(old.code)); else S.engins.set(String(row.code), mapG(row)); schedule(true); return; }
    const mm = maps[t]; if (!mm) return;
    if (p.eventType === "DELETE") mm[0].delete(old.id); else mm[0].set(row.id, mm[1](row)); schedule();
  }).subscribe(st => setSync(st === "SUBSCRIBED", st === "SUBSCRIBED" ? "Synchronisé en direct" : "Reconnexion…"));
}
/* mémoriser la catégorie choisie */
document.addEventListener("click", e => { if (e.target.closest("[data-cat]")) { try { localStorage.setItem("fc-cat", S.f.cat); } catch (_) {} } });

function showLogin(msg) { $("#app").hidden = true; $("#login").hidden = false; $("#lg-err").textContent = msg || ""; }
$("#login-form").addEventListener("submit", async e => { e.preventDefault(); const id = $("#lg-id").value, pw = $("#lg-pw").value; if (!id || !pw) { $("#lg-err").textContent = "Saisissez l'identifiant et le mot de passe."; return; }
  $("#lg-btn").disabled = true; $("#lg-err").textContent = "";
  const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(id), password: pw }); $("#lg-btn").disabled = false;
  if (error) { $("#lg-err").textContent = errMsg(error); return; } S.uid = data.user.id; startApp().catch(err => showLogin(errMsg(err))); });

(async () => { const { data } = await sb.auth.getSession(); if (data && data.session) { S.uid = data.session.user.id; startApp().catch(err => showLogin(errMsg(err))); } else showLogin(); })();
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") showLogin(); });
})();
