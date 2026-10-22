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
  da: new Map(), daL: new Map(), bc: new Map(), bcl: new Map(), bl: new Map(), bll: new Map(), hEnt: new Map(), hSor: new Map(), hCon: new Map(),
  engins: new Map(), depart: new Map(), entrees: new Map(), sorties: new Map(), profiles: new Map(), journal: [],
  params: { nom_chantier: "", types: [], huiles: [], interventions: [], ateliers: [], unites: [], seuil: 1, seuil_pdr: 1 },
  f: { cat: "FILTRE", stockCat: "", depCat: "", stockQ: "", stockSt: "", entQ: "", entSt: "", entFrom: "", entTo: "", sorQ: "", sorFrom: "", sorTo: "", engQ: "", depQ: "", jQ: "", jUser: "", jTab: "", daQ: "", sdaQ: "", sdaFrom: "", sdaTo: "", sbcQ: "", sbcFrom: "", sbcTo: "", sbcSt: "", sdaAll: false, hTab: "", hPer: "annee", hHuile: "", hQ: "", hFrom: "", hTo: "", hLastAt: "" },
  selEngin: "", selRef: "", loaded: false
};
let C = null;

/* ---------- correspondance base <-> application ---------- */
const mapE = r => ({ id: r.id, fourn: r.fournisseur || "", cat: catOf(r.categorie), date: r.date, ref: r.ref, type: r.type || "", marque: r.marque || "", equiv: r.equiv || "", dem: r.qte_bc, liv: r.qte_bl, bc: r.num_bc || "", bl: r.num_bl || "", engin: r.engin || "", obs: r.obs || "", source: r.source, createdAt: r.created_at, createdBy: r.created_by, updatedAt: r.updated_at, updatedBy: r.updated_by });
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
    l.seuil = l.cat === "PDR" ? 0 : (l.hasMin ? l.minSum : (maxMinRef.has(ck) ? maxMinRef.get(ck) : defSeuil));  // PDR : pas de seuil (RUPTURE ou OK)
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
  ["Pilotage", [["dash", "Tableau de bord", true], ["hdash", "Gestion huiles", true], ["journal", "Journal d'activité", true]]],
  ["Magasin", [["stock", "Stock actuel"], ["entrees", "Entrées (BC / BL)"], ["sorties", "Sorties"]]],
  ["Huiles", [["huiles", "Suivi huiles"]]],
  ["Achats", [["da", "Création DA", "da"], ["suivida", "Suivi DA", "da"], ["suivibc", "Suivi BC", "da"]]],
  ["Recherche", [["engin", "Suivi par engin"], ["ref", "Recherche référence"]]],
  ["Référentiel", [["engins", "Engins", true], ["depart", "Stock de départ", true], ["params", "Paramètres", true]]],
  ["Administration", [["users", "Utilisateurs", true], ["compte", "Mon compte"]]]
];
let navHtml = "";
const ADMIN_VIEWS = new Set(NAV.flatMap(([, items]) => items.filter(i => i[2] === true).map(i => i[0])));
const canSee = v => !!VIEWS[v] && (!ADMIN_VIEWS.has(v) || S.isAdmin) && (!["da", "suivida", "suivibc"].includes(v) || S.canDA);
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
function go(v) { if (!canSee(v)) return; S.view = v; try { localStorage.setItem("fc-view", v); } catch (_) {} $("#side").classList.remove("open"); render(true); }
/* onglets de catégorie */
document.addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b || !$("#view-tools").contains(b)) return; const c = b.dataset.cat;
  if (S.view === "stock") S.f.stockCat = c; else if (S.view === "depart") S.f.depCat = c; else S.f.cat = c || "FILTRE"; render(true); });

let lastView = null;
function render(full) {
  if (!C) return;
  renderNav();
  if (!canSee(S.view)) S.view = S.isAdmin ? "dash" : "stock";
  const v = VIEWS[S.view];
  $("#page-title").textContent = typeof v.title === "function" ? v.title() : v.title;
  if (full || lastView !== S.view) { $("#view-tools").innerHTML = v.tools ? v.tools() : ""; lastView = S.view; v.bind && v.bind(); }
  const vb = $("#view-body"), keep = [...vb.querySelectorAll(".tw")].map(t => [t.scrollTop, t.scrollLeft]), same = lastBody === S.view;
  vb.innerHTML = v.body(); lastBody = S.view; fitTables();
  if (same) vb.querySelectorAll(".tw").forEach((t, i) => { if (keep[i]) { t.scrollTop = keep[i][0]; t.scrollLeft = keep[i][1]; } });
}
/* en-tête de page et noms de colonnes fixes : seules les lignes des tableaux défilent */
let lastBody = null;
function fitTables() {
  const top = $(".topbar").offsetHeight;
  document.querySelectorAll("#view-body .tw").forEach(t => {
    const y = t.getBoundingClientRect().top + window.scrollY, foot = t.nextElementSibling && t.nextElementSibling.classList.contains("more") ? 34 : 0;
    t.style.maxHeight = Math.max(280, window.innerHeight - y - foot - 24) + "px"; });
  const all = document.querySelectorAll("#view-body .tw"), last = all[all.length - 1], over = document.documentElement.scrollHeight - window.innerHeight;
  if (last && over > 0 && last.scrollHeight > last.clientHeight) last.style.maxHeight = Math.max(280, last.clientHeight - over) + "px";
}
window.addEventListener("resize", () => { clearTimeout(fitTables.t); fitTables.t = setTimeout(fitTables, 120); });
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
const TABLE_FR = { entrees: "Entrée", sorties: "Sortie", stock_depart: "Stock de départ", engins: "Engin", params: "Paramètres", da: "Demande d'achat", huile_entrees: "Huile – entrée fûts", huile_sorties: "Huile – bon de sortie", huile_conso: "Huile – consommation" };
const ACT_FR = { insert: "a ajouté", update: "a modifié", delete: "a supprimé" };
const jText = j => (ACT_FR[j.action] || j.action) + " · " + (TABLE_FR[j.table_name] || j.table_name) + " : " + (j.resume || "");
function newsList() { if (!S.loaded) return []; const since = S.lastSeen || new Date(Date.now() - 7 * 864e5).toISOString(); return S.journal.filter(j => j.at > since && j.user_id !== S.uid); }
function feed(list) { if (!list.length) return '<div class="empty">Rien pour l\'instant.</div>';
  return '<ul class="feed">' + list.map(j => { const isNew = S.lastSeen && j.at > S.lastSeen && j.user_id !== S.uid;
    return "<li>" + (isNew ? '<i class="new" title="Nouveau"></i>' : "") + avatar(j.user_id) + "<div><b>" + esc(nameOf(j.user_id)) + "</b> " + esc(jText(j)) + '</div><span class="t">' + fDT(j.at) + "</span></li>"; }).join("") + "</ul>"; }

/* lignes de BC (Suivi BC) pas encore livrées : comptées dans « Commandés non livrés » (les BL déjà reçus sont dans les entrées) */
function bcAttente() { if (!S.canDA || !S.bc) return [];
  const out = []; for (const x of S.bcl.values()) { const b = S.bc.get(x.bc); if (!b || b.solde) continue; const liv = livreBcl(x.id), reste = x.qte - liv; if (reste <= 0) continue;
    const l = S.daL.get(x.dal) || {}, d = S.da.get(b.da) || {}, i = (C && l.ref ? C.info(l.ref) : null) || {};
    out.push({ fromBc: b.id, cat: (d.type === "FILTRE" || d.type === "PDR" ? d.type : i.cat) || (d.type === "CONSOMMABLE" ? "PDR" : "FILTRE"), date: b.date || d.date, ref: l.ref || l.designation, type: l.designation, engin: l.engin || "", dem: x.qte, liv, reste, bc: b.num, bl: blsOf(b.id).map(y => y.num).join(", ") }); }
  return out; }
const attActs = x => x.fromBc ? '<div class="rowact"><button class="btn small" data-act="bc-view" data-id="' + x.fromBc + '">Voir BC</button></div>' : rowActs("entree", x);

/* lignes de DA d'un engin encore à commander (DA en attente du N° ou numérotées, non clôturées) */
function daNonTraitees(code) { const out = [];
  for (const l of S.daL.values()) { const d = S.da.get(l.da); if (!d || d.cloture) continue; if (String(l.engin || d.engin || "") !== code) continue;
    const cmd = commandeDal(l.id), reste = Math.max(0, N(l.qte) - cmd); if (reste > 0) out.push({ d, l, cmd, reste }); }
  return out.sort((a, b) => (b.d.date || "").localeCompare(a.d.date || "") || b.d.id - a.d.id || a.l.id - b.l.id); }
/* dernière visite du site : enregistrée à l'ouverture puis toutes les 5 minutes tant que la page est affichée */
let visitT = 0;
function touchVisit() { if (!S.uid || Date.now() - visitT < 60e3) return; visitT = Date.now(); sb.rpc("touch_visit").then(() => {}, () => {}); }
setInterval(() => { if (!document.hidden) { visitT = 0; touchVisit(); } }, 5 * 60e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden) touchVisit(); });

/* ---------- vues ---------- */
const VIEWS = {};
VIEWS.dash = { title: "Tableau de bord", body() {
  const att = C.ent.filter(e => e.reste > 0).concat(bcAttente()), news = newsList(), m0 = monthStart();
  const row = cat => { const L = C.lines.filter(l => l.cat === cat), rup = L.filter(l => l.statut === "RUPTURE").length, al = L.filter(l => l.statut === "ALERTE").length;
    const reste = att.filter(e => e.cat === cat).reduce((t, e) => t + e.reste, 0), mois = C.sor.filter(s => s.cat === cat && (s.date || "") >= m0).reduce((t, s) => t + N(s.qte), 0);
    return '<h3 class="kpi-title">' + catPill(cat) + " " + CATS[cat].label + '</h3><div class="kpis">' + kpi(CATS[cat].label + " en stock", nb(sumStock(L))) + kpi("Lignes de stock", nb(L.length)) + kpi("En rupture", nb(rup), "crit") +
      (cat === "PDR" ? "" : kpi("En alerte", nb(al), "warn")) + kpi("Commandés non livrés", nb(reste), "acc") + kpi("Sortis ce mois", nb(mois)) + "</div>"; };
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
    { h: "Stock", n: 1, f: l => "<b>" + nb(l.stock) + "</b>" },
    { h: "Statut", f: l => pill(l.statut) }, { h: "Dern. entrée", f: l => fD(l.lastE) }, { h: "Dern. sortie", f: l => fD(l.lastS) }], r, { empty: "Aucune ligne." }); } };

VIEWS.entrees = { title: () => "Entrées – " + CATS[S.f.cat].label,
  tools: () => catTabs(S.f.cat) + '<div class="tools">' + searchF("en-q", S.f.entQ, "Réf., BC, BL, fournisseur, engin…") + field("en-s", "Livraison", '<select id="en-s"><option value="">Toutes</option><option value="att">Non livrées (reste &gt; 0)</option><option value="liv">Livrées</option></select>') +
    field("en-f", "Du", '<input id="en-f" type="date" value="' + esc(S.f.entFrom) + '">') + field("en-t", "Au", '<input id="en-t" type="date" value="' + esc(S.f.entTo) + '">') + '<span class="grow"></span><button class="btn" data-act="xls-ent">Exporter Excel</button>' +
    (S.canWrite ? '<button class="btn" data-act="imp-entrees">Importer Excel</button><button class="btn primary" data-act="new-entree">+ Nouvelle entrée</button>' : "") + "</div>",
  bind() { $("#en-s").value = S.f.entSt; ["en-q", "en-s", "en-f", "en-t"].forEach(id => $("#" + id).addEventListener(id === "en-q" ? "input" : "change", () => { S.f.entQ = $("#en-q").value; S.f.entSt = $("#en-s").value; S.f.entFrom = $("#en-f").value; S.f.entTo = $("#en-t").value; render(); })); },
  rows() { const q = norm(S.f.entQ); return C.ent.filter(e => e.cat === S.f.cat && inPeriod(e.date, S.f.entFrom, S.f.entTo) && (!S.f.entSt || (S.f.entSt === "att" ? e.reste > 0 : e.livre)) && (!q || norm([e.ref, e.type, e.marque, e.bc, e.bl, e.fourn, e.engin, e.obs].join(" ")).includes(q))).reverse(); },
  body() { const r = this.rows(), K = CATS[S.f.cat]; return '<div class="more">' + r.length + " ligne(s) · " + nb(r.reduce((t, e) => t + N(e.liv), 0)) + " " + K.many + " livré(e)s · reste à livrer " + nb(r.reduce((t, e) => t + e.reste, 0)) + ". Seule la quantité livrée (BL) entre dans le stock.</div>" + table([
    { h: "Date", f: e => fD(e.date) }, { h: "Référence", f: e => mono(e.ref) }, { h: K.type, f: e => esc(e.type) }, { h: "Marque", f: e => esc(e.marque) }, { h: "Qté BC", n: 1, f: e => nb(e.dem) }, { h: "Qté BL", n: 1, f: e => nb(e.liv) },
    { h: "Reste", n: 1, f: e => e.reste > 0 ? '<span class="reste">' + nb(e.reste) + "</span>" : "" }, { h: "N° BC", f: e => mono(e.bc) }, { h: "N° BL", f: e => mono(e.bl) }, { h: "Fournisseur", f: e => esc(e.fourn) }, { h: "Engin destinataire", f: e => esc(e.engin || "Stock commun") },
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
    const e = C.engDer.get(code), L = C.lines.filter(l => l.engin === code), att = C.ent.filter(x => x.reste > 0 && String(x.engin || "") === code).concat(bcAttente().filter(x => x.engin === code));
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
      { h: "Reste", n: 1, f: x => '<span class="reste">' + nb(x.reste) + "</span>" }, { h: "N° BC", f: x => esc(x.bc) }, { h: "N° BL", f: x => esc(x.bl) || (x.fromBc ? '<span class="muted">en attente</span>' : "") }, { h: "", f: attActs }], att, { empty: "Aucune commande en attente." }) + "</div>";
    if (S.canDA) { const dn = daNonTraitees(code);
      h += '<div class="panel"><h3>DA non traitées <small>demandes d\'achat de cet engin pas encore commandées</small></h3>' + table([{ h: "Date DA", f: x => fD(x.d.date) }, { h: "N° DA", f: x => x.d.numero ? "<b>" + mono(x.d.numero) + "</b>" : '<span class="pill p-warn">En attente du N°</span>' },
        { h: "Type", f: x => daType(x.d) }, { h: "Objet DA", f: x => esc(x.d.objet) || '<span class="muted">–</span>' }, { h: "N° Poste", f: x => esc(x.l.poste) }, { h: "Désignation", f: x => esc(x.l.designation) }, { h: "Référence", f: x => mono(x.l.ref) },
        { h: "Qté DA", n: 1, f: x => nb(x.l.qte) }, { h: "Commandé", n: 1, f: x => nb(x.cmd) }, { h: "Reste à commander", n: 1, f: x => '<span class="reste">' + nb(x.reste) + "</span>" }, { h: "Unité", f: x => esc(x.l.unite) },
        { h: "Statut", f: x => !x.d.numero ? '<span class="pill p-warn">À numéroter</span>' : (x.cmd > 0 ? '<span class="pill p-acc">Partiellement commandée</span>' : '<span class="pill p-warn">À commander</span>') },
        { h: "", f: x => '<div class="rowact"><button class="btn small" data-act="da-view" data-id="' + x.d.id + '">Voir DA</button></div>' }], dn, { empty: "Aucune DA en cours pour cet engin." }) + "</div>"; }
    const mv = s => s.mvt === "sans" ? "Sans entrée en magasin" : (s.engin === code ? (s.stockEng === code ? "Propre stock" : (s.stockEng === "" ? "Stock commun" : "Emprunté au " + s.stockEng)) : "Prêté au " + s.engin);
    h += '<div class="panel"><h3>Sorties liées à cet engin <small>filtres et PDR montés sur lui ou pris sur son stock</small></h3>' + table([{ h: "Cat.", f: s => catPill(s.cat) }, { h: "Date", f: s => fD(s.date) }, { h: "Référence", f: s => mono(s.ref) }, { h: "Désignation / type", f: s => esc(s.type) }, { h: "Qté", n: 1, f: s => nb(s.qte) },
      { h: "Monté sur", f: s => esc(s.engin) }, { h: "Mouvement", f: s => esc(mv(s)) }, { h: "Intervention", f: s => esc(s.intervention) }, { h: "Compteur", n: 1, f: s => nb(s.compteur) }, { h: "Saisi par", f: s => who(s.createdBy) }], so, { limit: 80, empty: "Aucune sortie." }) + "</div>";
    h += '<div class="panel"><h3>Entrées pour cet engin</h3>' + table([{ h: "Cat.", f: x => catPill(x.cat) }, { h: "Date", f: x => fD(x.date) }, { h: "Référence", f: x => mono(x.ref) }, { h: "Désignation / type", f: x => esc(x.type) }, { h: "Qté BC", n: 1, f: x => nb(x.dem) }, { h: "Qté BL", n: 1, f: x => nb(x.liv) },
      { h: "N° BC", f: x => esc(x.bc) }, { h: "N° BL", f: x => esc(x.bl) }, { h: "Saisi par", f: x => who(x.createdBy) }], en, { limit: 60, empty: "Aucune entrée." }) + "</div>";
    const hc = [...S.hCon.values()].filter(c => c.engin === code).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    h += '<div class="panel"><h3>Huiles consommées <small>' + L_(hc.reduce((t, c) => t + c.qte, 0)) + " · " + hc.length + " intervention(s)</small></h3>" + table([{ h: "Date", f: c => fD(c.date) }, { h: "Huile", f: c => esc(c.huile) }, { h: "Entretien", f: c => esc(c.entretien) }, { h: "Qté", n: 1, f: c => L_(c.qte) }, { h: "Atelier", f: c => esc(c.atelier) }, { h: "Compteur", n: 1, f: c => nb(c.compteur) }], hc, { limit: 60, empty: "Aucune consommation d'huile enregistrée." }) + "</div>";
    return h; } };

VIEWS.ref = { title: "Recherche référence",
  tools: () => '<div class="tools">' + field("rf-q", "Référence (filtre ou PDR)", '<input id="rf-q" list="dl-refs" placeholder="ex. P550820" value="' + esc(S.selRef) + '">') + "</div>",
  bind() { $("#rf-q").addEventListener("change", e => { S.selRef = e.target.value.trim(); render(); }); },
  body() { const ref = S.selRef; if (!ref) return '<div class="empty">Choisissez une référence de filtre ou de pièce (PDR) pour voir son stock total, sa répartition par engin et les engins qui l\'ont reçue.</div>';
    const L = C.lines.filter(l => l.ref === ref), tot = L.reduce((t, l) => t + l.stock, 0), seuil = L.reduce((t, l) => t + l.seuil, 0), st = !L.length ? "–" : (tot <= 0 ? "RUPTURE" : (tot <= seuil ? "ALERTE" : "OK")), i = C.info(ref);
    const att = C.ent.filter(x => x.reste > 0 && String(x.ref) === ref).concat(bcAttente().filter(x => String(x.ref) === ref)), reste = att.reduce((t, x) => t + x.reste, 0), so = C.sor.filter(s => String(s.ref) === ref), prev = [...S.engins.values()].filter(e => Object.values(e.refs || {}).includes(ref));
    let h = '<div class="card-head">' + catPill(i.cat) + '<span class="code" style="font-family:var(--f-mono);font-size:26px">' + esc(ref) + '</span><span class="desc">' + esc(i.type || "Désignation non renseignée") + '</span><span class="muted">' + esc([i.marque, i.equiv && ("équiv. " + i.equiv)].filter(Boolean).join(" · ")) + "</span></div>";
    h += reste > 0 ? '<div class="banner crit">⚠ ' + nb(reste) + " article(s) de cette référence commandé(s) non livré(s) · " + att.length + " ligne(s) de BC en attente</div>" : '<div class="banner ok">✔ Aucune commande de cette référence en attente de livraison</div>';
    h += '<div class="kpis">' + kpi("Stock actuel total", nb(tot)) + '<div class="kpi"><b>' + (st === "–" ? "–" : pill(st)) + "</b><span>Statut global</span></div>" + kpi("Lignes d'affectation", nb(L.length)) + kpi("Entrés (livrés)", nb(L.reduce((t, l) => t + l.ent, 0))) +
      kpi("Sortis", nb(so.reduce((t, s) => t + N(s.qte), 0))) + (i.cat === "FILTRE" ? kpi("Engins qui la prévoient", nb(prev.length)) : "") + "</div>";
    h += '<div class="panel"><h3>Affectation du stock</h3>' + table([{ h: "Cat.", f: l => catPill(l.cat) }, { h: "Code engin", f: l => esc(l.engin || "Commun") }, { h: "Engin d'affectation", f: l => esc(l.label) }, { h: "Entrées", n: 1, f: l => nb(l.ent) }, { h: "Sorties", n: 1, f: l => nb(l.sor) },
      { h: "Stock", n: 1, f: l => "<b>" + nb(l.stock) + "</b>" }, { h: "Statut", f: l => pill(l.statut) }, { h: "Dern. entrée", f: l => fD(l.lastE) }, { h: "Dern. sortie", f: l => fD(l.lastS) }], L, { empty: "Cette référence n'a aucune ligne de stock." }) + "</div>";
    h += '<div class="panel"><h3>Commandes non livrées <small>toutes dates</small></h3>' + table([{ h: "Date", f: x => fD(x.date) }, { h: "Engin destinataire", f: x => esc(x.engin ? x.engin + " – " + C.label(x.engin) : "Stock commun") }, { h: "Qté BC", n: 1, f: x => nb(x.dem) }, { h: "Qté BL", n: 1, f: x => nb(x.liv || 0) },
      { h: "Reste", n: 1, f: x => '<span class="reste">' + nb(x.reste) + "</span>" }, { h: "N° BC", f: x => esc(x.bc) }, { h: "N° BL", f: x => esc(x.bl) || (x.fromBc ? '<span class="muted">en attente</span>' : "") }, { h: "", f: attActs }], att, { empty: "Aucune commande en attente." }) + "</div>";
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

VIEWS.params = { title: "Paramètres", body() { const P = S.params, ro = S.isAdmin ? "" : " readonly"; if (!P.huiles || !P.huiles.length) P.huiles = huilesList();
  const lst = (k, l) => '<div class="field full"><label for="pa-' + k + '">' + l + ' (une valeur par ligne)</label><textarea id="pa-' + k + '"' + ro + ">" + esc((P[k] || []).join("\n")) + "</textarea></div>";
  return '<div class="panel"><div class="fgrid">' + '<div class="field full"><label for="pa-nom">Nom du chantier</label><input id="pa-nom" value="' + esc(P.nom_chantier) + '"' + ro + "></div>" + lst("types", "Types de filtre") + lst("huiles", "Types d'huile") + lst("interventions", "Types d'intervention") + lst("ateliers", "Ateliers") + lst("unites", "Unités compteur") +
    '<div class="field"><label for="pa-seuil">Seuil d\'alerte par défaut – filtres</label><input id="pa-seuil" type="number" min="0" step="1" value="' + esc(P.seuil ?? 1) + '"' + ro + "></div>" +
    '<div class="field"><label for="pa-seuilh">Seuil d\'alerte huiles (fûts)</label><input id="pa-seuilh" type="number" min="0" step="1" value="' + esc(P.seuil_huile ?? 4) + '"' + ro + "></div>" +
    '<div class="field"><label for="pa-seuilsh">Seuils d\'alerte par huile (un par ligne : Huile = fûts)</label><textarea id="pa-seuilsh" rows="4"' + ro + ">" + esc(Object.entries(P.seuils_huile || {}).map(([k, v]) => k + " = " + v).join("\n")) + '</textarea><div class="hint">Les huiles absentes de la liste utilisent le seuil général.</div></div>' +
    '<div class="hint full">Une ligne de filtre passe en ALERTE quand stock ≤ seuil, sauf seuil propre saisi dans le stock de départ. Les PDR n\'ont pas de seuil : RUPTURE quand stock ≤ 0, sinon OK.</div></div>' +
    (S.isAdmin ? '<div class="actions"><button class="btn primary" data-act="save-params">Enregistrer les paramètres</button></div>' : '<p class="hint">Modification réservée aux administrateurs.</p>') + "</div>"; } };

const ROLE_FR = { admin: "Administrateur", gestionnaire: "Gestionnaire", magasinier: "Magasinier", saisie: "Saisie", consultation: "Consultation" };
VIEWS.users = { title: "Utilisateurs",
  tools: () => '<div class="tools"><span class="grow muted">Créez les comptes de l\'équipe : identifiant + mot de passe, et le rôle de chacun.</span><button class="btn primary" data-act="new-user">+ Nouveau compte</button></div>',
  body() { if (!S.isAdmin) return '<div class="empty">Réservé aux administrateurs.</div>';
    const act = new Map(); for (const j of S.journal) { if (!j.user_id) continue; const o = act.get(j.user_id) || { n: 0, last: "" }; o.n++; if (j.at > o.last) o.last = j.at; act.set(j.user_id, o); }
    const r = [...S.profiles.values()].sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
    return '<div class="panel"><h3>Rôles</h3><p class="muted" style="margin:0"><b>Administrateur</b> : tout (comptes, engins, stock de départ, paramètres, saisies de tous, demandes d\'achat) · <b>Gestionnaire</b> : crée les demandes d\'achat (DA) et consulte le stock · <b>Magasinier</b> : crée les DA, saisit le N° des DA, entrées et sorties · <b>Saisie</b> : entrées et sorties (filtres et PDR), modifie les siennes · <b>Consultation</b> : lecture seule (sans les DA).</p></div>' + table([
      { h: "Nom", f: p => who(p.id) }, { h: "Identifiant", f: p => mono(p.identifiant) }, { h: "Fonction", f: p => esc(p.fonction) }, { h: "Rôle", f: p => '<span class="role ' + (p.role === "admin" ? "admin" : "") + '">' + esc(ROLE_FR[p.role] || p.role) + "</span>" },
      { h: "État", f: p => p.actif ? '<span class="pill p-ok">Actif</span>' : '<span class="pill p-crit">Désactivé</span>' }, { h: "Actions (récentes)", n: 1, f: p => nb((act.get(p.id) || {}).n || 0) }, { h: "Dernière action", f: p => fDT((act.get(p.id) || {}).last) },
      { h: "Dernière entrée", f: p => p.last_visit ? fDT(p.last_visit) + ((Date.now() - Date.parse(p.last_visit)) < 6 * 60e3 ? ' <span class="pill p-ok">en ligne</span>' : "") : '<span class="muted">pas encore d\x27entrée</span>' }, { h: "", f: p => '<div class="rowact"><button class="btn small" data-act="edit-user" data-id="' + esc(p.id) + '">Modifier</button><button class="btn small" data-act="pw-user" data-id="' + esc(p.id) + '">Mot de passe</button></div>' }], r, { empty: "Aucun compte." }); } };

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
    F("f-bc", "N° BC", '<input id="f-bc" value="' + esc(d.bc) + '">') + F("f-bl", "N° BL", '<input id="f-bl" value="' + esc(d.bl) + '">') + F("f-fourn", "Fournisseur", '<input id="f-fourn" list="dl-fourn" value="' + esc(d.fourn) + '">') + F("f-obs", "Observations", '<input id="f-obs" value="' + esc(d.obs) + '">', "full") + '<div class="hint full" id="f-info"></div></div>';
  const ov = modal(isNew ? "Nouvelle entrée" : (recv ? "Réception (BL)" : "Modifier l'entrée"), html, async ov => {
    const ref = fv(ov, "f-ref"); if (!ref) return "Saisissez la référence."; if (!fv(ov, "f-date")) return "Saisissez la date.";
    const dem = fnum(ov, "f-dem"), liv = fnum(ov, "f-liv"); if (dem === null && liv === null) return "Saisissez au moins la quantité demandée (BC) ou livrée (BL).";
    if ((dem !== null && dem < 0) || (liv !== null && liv < 0)) return "Les quantités ne peuvent pas être négatives.";
    const eng = fv(ov, "f-engin"); if (eng && !C.engMap.has(eng)) return "Code engin inconnu : choisissez-le dans la liste (ou laissez vide pour le stock commun).";
    const row = { categorie: fv(ov, "f-cat"), date: fv(ov, "f-date"), ref, type: fv(ov, "f-type") || null, marque: fv(ov, "f-marque") || null, equiv: fv(ov, "f-equiv") || null, qte_bc: dem, qte_bl: liv, num_bc: fv(ov, "f-bc") || null, num_bl: fv(ov, "f-bl") || null, fournisseur: fv(ov, "f-fourn") || null, engin: eng || null, obs: fv(ov, "f-obs") || null };
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
    F("s-at", "Atelier", '<select id="s-at"><option value=""></option>' + opts(d.atelier && !S.params.ateliers.includes(d.atelier) ? S.params.ateliers.concat([d.atelier]) : S.params.ateliers, d.atelier) + "</select>") + F("s-obs", "Observations", '<input id="s-obs" value="' + esc(d.obs) + '">', "full") + '<div class="hint full" id="s-info"></div></div>';
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
    F("d-eq", "Réf. équivalentes", '<input id="d-eq" value="' + esc(l.equiv) + '">') + F("d-qte", "Quantité en stock", '<input id="d-qte" type="number" min="0" step="any" value="' + esc(l.qte ?? 0) + '">') + F("d-min", "Stock minimum (seuil, filtres uniquement)", '<input id="d-min" type="number" min="0" step="any" value="' + esc(l.min ?? "") + '">') +
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
      ["bc", "N° BC", ["nbc", "numbc", "numerobc", "bc", "bondecommande", "nbondecommande"]], ["bl", "N° BL", ["nbl", "numbl", "numerobl", "bl", "bondelivraison", "nbondelivraison"]], ["fourn", "Fournisseur", ["fournisseur", "fournisseurs", "frs", "fourn", "nomfournisseur"]],
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
    example: [["PDR", "09/10/2026", "", "4130000418", "COURROIE ALTERNATEUR", "SDLG", "", 4, 1, "Rayon B2", "Exemple – à supprimer"]] },
  h_ent: { table: "huile_entrees", title: "Importer des entrées de fûts d'huile", need: "write", oil: true, req: ["huile"],
    cols: [["date", "Date", ["date", "datebl", "datereception"]], ["huile", "Type d'huile", ["typedhuile", "typehuile", "huile", "produit", "designation"]], ["bc", "Fûts demandés (BC)", ["futsdemandesbc", "futsdemandes", "futsbc", "qtebc", "qtedemandee", "nbfutsbc"]],
      ["bl", "Fûts livrés (BL)", ["futslivresbl", "futslivres", "futsbl", "qtebl", "qtelivree", "nbfutsbl", "futs", "nbfuts", "quantite"]], ["cont", "Litres par fût", ["litresparfut", "contenance", "contenancedunfut", "litres", "capacite"]],
      ["nbc", "N° BC", ["nbc", "numbc", "numerobc", "bc", "bondecommande"]], ["nbl", "N° BL", ["nbl", "numbl", "numerobl", "bl", "bondelivraison"]], ["fourn", "Fournisseur", ["fournisseur", "frs"]], ["obs", "Observations", ["observations", "observation", "obs", "remarque"]]],
    example: [["20/10/2026", "AW68", 4, 4, 208, "4400050001", "BL-500", "FOURNISSEUR X", "Exemple – à supprimer"]],
    help: ["1. Une ligne par livraison (ou commande). Gardez la ligne d'en-têtes.", "2. Type d'huile : exactement un type de la liste des Paramètres (ex. LA-3 15W40, AW68, ATF…).", "3. Fûts livrés (BL) vides = commande pas encore livrée. Litres par fût vide = 208.", "4. Supprimez la ligne d'exemple avant l'import."] },
  h_sor: { table: "huile_sorties", title: "Importer des bons de sortie d'huile", need: "write", oil: true, req: ["huile", "futs", "atelier"],
    cols: [["date", "Date", ["date", "datesortie"]], ["nbs", "N° bon de sortie", ["nbondesortie", "bondesortie", "nbs", "numbs", "numerobs", "bs"]], ["huile", "Type d'huile", ["typedhuile", "typehuile", "huile", "produit"]],
      ["atelier", "Atelier", ["atelier", "destination"]], ["futs", "Nombre de fûts", ["nombredefuts", "nbfuts", "futs", "quantite", "qte"]], ["cont", "Litres par fût", ["litresparfut", "contenance", "litres"]], ["obs", "Observations", ["observations", "observation", "obs", "remarque"]]],
    example: [["20/10/2026", "BS-0001", "AW68", "ATELIER FIXE", 1, 208, "Exemple – à supprimer"]],
    help: ["1. Une ligne par bon de sortie (fût(s) sorti(s) du magasin vers un atelier).", "2. Atelier : ATELIER FIXE ou ATELIER MOBILE (liste des Paramètres).", "3. Litres par fût vide = 208.", "4. Supprimez la ligne d'exemple avant l'import."] },
  h_con: { table: "huile_conso", title: "Importer des consommations d'huile", need: "write", oil: true, req: ["engin", "huile", "entretien", "qte", "atelier"],
    cols: [["date", "Date", ["date", "dateintervention"]], ["engin", "Code engin", ["codeengin", "engin", "code"]], ["huile", "Type d'huile", ["typedhuile", "typehuile", "huile", "produit"]],
      ["entretien", "Type d'entretien", ["typedentretien", "typeentretien", "entretien", "intervention", "motif"]], ["qte", "Quantité (litres)", ["quantitelitres", "quantite", "qte", "litres", "qtel"]],
      ["atelier", "Atelier", ["atelier"]], ["compteur", "Compteur (h / km)", ["compteurhkm", "compteur", "heures", "km", "index"]], ["obs", "Observations", ["observations", "observation", "obs", "remarque"]]],
    example: [["20/10/2026", "31500", "LA-3 15W40", "Vidange", 18, "ATELIER FIXE", 1250, "Exemple – à supprimer"]],
    help: ["1. Une ligne par ajout d'huile sur un engin.", "2. Type d'entretien : Vidange, Fuite ou Remise à niveau.", "3. Code engin : celui de la liste des engins. Atelier : ATELIER FIXE ou ATELIER MOBILE.", "4. Supprimez la ligne d'exemple avant l'import."] }
};
const matchHuile = v => { const k = nh(v); if (!k) return ""; return huilesList().find(h => nh(h) === k) || huilesList().find(h => nh(h).replace(/^la3/, "") === k.replace(/^la3/, "")) || null; };
const matchAtelier = v => { const k = nh(v), L = S.params.ateliers || ["ATELIER FIXE", "ATELIER MOBILE G", "ATELIER MOBILE S"]; if (!k) return ""; return L.find(a => nh(a) === k) || L.find(a => nh(a).includes(k) || k.includes(nh(a).replace(/^atelier/, ""))) || null; };
const matchEntretien = v => { const k = nh(v); if (!k) return ""; if (k.startsWith("vid")) return "Vidange"; if (k.startsWith("fui")) return "Fuite"; if (k.includes("niveau") || k.startsWith("appoint") || k.startsWith("remise")) return "Remise à niveau"; return null; };
function buildOilRow(kind, g) {
  const errs = [], warns = [], dt = pDate(g("date")); if (dt.err) errs.push(dt.err); if (dt.warn) warns.push(dt.warn);
  const hu = matchHuile(g("huile")); if (!hu) errs.push(hu === "" ? "type d'huile vide" : "huile « " + pStr(g("huile")) + " » inconnue");
  let row;
  if (kind === "h_ent") { const bc = pNum(g("bc")), bl = pNum(g("bl")), cont = pNum(g("cont"));
    if (Number.isNaN(bc) || Number.isNaN(bl)) errs.push("nombre de fûts non numérique"); else if (bc === null && bl === null) errs.push("aucun nombre de fûts (BC ou BL)"); else if ((bc ?? 0) < 0 || (bl ?? 0) < 0) errs.push("nombre négatif");
    if (Number.isNaN(cont) || (cont !== null && cont <= 0)) errs.push("litres par fût invalide");
    row = { date: dt.v, huile: hu, futs_bc: Number.isNaN(bc) ? null : bc, futs_bl: Number.isNaN(bl) ? null : bl, contenance: cont > 0 ? cont : 208, num_bc: pStr(g("nbc")) || null, num_bl: pStr(g("nbl")) || null, fournisseur: pStr(g("fourn")) || null, obs: pStr(g("obs")) || null };
    if (!errs.length && [...S.hEnt.values()].some(e => e.date === dt.v && e.huile === hu && N(e.bl) === N(bl) && (e.numBl || "") === (row.num_bl || ""))) warns.push("doublon possible (déjà saisi)");
    return { row, errs, warns, ref: hu, info: nb(bc) + " / " + nb(bl) + " fût(s)" }; }
  if (kind === "h_sor") { const n = pNum(g("futs")), cont = pNum(g("cont")), at = matchAtelier(g("atelier"));
    if (n === null || Number.isNaN(n) || n <= 0) errs.push("nombre de fûts invalide"); if (!at) errs.push(at === "" ? "atelier vide" : "atelier « " + pStr(g("atelier")) + " » inconnu"); if (Number.isNaN(cont) || (cont !== null && cont <= 0)) errs.push("litres par fût invalide");
    row = { date: dt.v, huile: hu, atelier: at, futs: n, contenance: cont > 0 ? cont : 208, num_bs: pStr(g("nbs")) || null, obs: pStr(g("obs")) || null };
    if (!errs.length && [...S.hSor.values()].some(x => x.date === dt.v && x.huile === hu && x.futs === n && x.atelier === at && (x.numBs || "") === (row.num_bs || ""))) warns.push("doublon possible (déjà saisi)");
    return { row, errs, warns, ref: hu, info: nb(n) + " fût(s) → " + (at || "?") }; }
  const eng = pStr(g("engin")), q = pNum(g("qte")), en = matchEntretien(g("entretien")), at = matchAtelier(g("atelier")), cpt = pNum(g("compteur"));
  if (!eng) errs.push("code engin vide"); else if (!C.engMap.has(eng)) errs.push("engin " + eng + " inconnu");
  if (!en) errs.push(en === "" ? "type d'entretien vide" : "entretien « " + pStr(g("entretien")) + " » inconnu (Vidange, Fuite, Remise à niveau)");
  if (q === null || Number.isNaN(q) || q <= 0) errs.push("quantité invalide"); if (!at) errs.push(at === "" ? "atelier vide" : "atelier « " + pStr(g("atelier")) + " » inconnu"); if (Number.isNaN(cpt)) errs.push("compteur non numérique");
  row = { date: dt.v, engin: eng, huile: hu, entretien: en, qte: q, atelier: at, compteur: Number.isNaN(cpt) ? null : cpt, obs: pStr(g("obs")) || null };
  if (!errs.length && [...S.hCon.values()].some(c => c.date === dt.v && c.engin === eng && c.huile === hu && c.qte === q && c.entretien === en)) warns.push("doublon possible (déjà saisi)");
  return { row, errs, warns, ref: hu, info: eng + " · " + (en || "?") + " · " + nb(q) + " L" };
}
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
  if (IMPORT[kind].oil) return buildOilRow(kind, g);
  const cat = pCat(g("cat"), defCat); if (!cat) errs.push("catégorie inconnue (Filtre ou PDR)");
  const dt = pDate(g("date")); if (dt.err) errs.push(dt.err); if (dt.warn) warns.push(dt.warn);
  const ref = pStr(g("ref")); if (!ref) errs.push("référence vide");
  const eng = pStr(g("engin"));
  let row;
  if (kind === "entrees") {
    const dem = pNum(g("dem")), liv = pNum(g("liv"));
    if (Number.isNaN(dem) || Number.isNaN(liv)) errs.push("quantité non numérique"); else if (dem === null && liv === null) errs.push("aucune quantité (BC ou BL)"); else if ((dem ?? 0) < 0 || (liv ?? 0) < 0) errs.push("quantité négative");
    if (eng && !C.engMap.has(eng)) errs.push("engin " + eng + " inconnu");
    row = { categorie: cat, date: dt.v, ref, type: pStr(g("type")) || null, marque: pStr(g("marque")) || null, equiv: pStr(g("equiv")) || null, qte_bc: Number.isNaN(dem) ? null : dem, qte_bl: Number.isNaN(liv) ? null : liv, num_bc: pStr(g("bc")) || null, num_bl: pStr(g("bl")) || null, fournisseur: pStr(g("fourn")) || null, engin: eng || null, obs: pStr(g("obs")) || null };
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
  const help = K.help ? XLSX.utils.aoa_to_sheet([["Mode d'emploi"], ...K.help.map(x => [x])]) : XLSX.utils.aoa_to_sheet([["Mode d'emploi"], ["1. Une ligne par mouvement. Gardez la ligne d'en-têtes telle quelle."], ["2. Catégorie : « Filtre » ou « PDR ». Vide = la catégorie choisie dans la fenêtre d'import."],
    ["3. Date au format jj/mm/aaaa. Codes engin : ceux de la liste des engins de l'application."], ["4. Supprimez les lignes d'exemple avant l'import."]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Import"); XLSX.utils.book_append_sheet(wb, help, "Mode d'emploi"); XLSX.writeFile(wb, "Modele_import_" + ({ h_ent: "huiles_entrees", h_sor: "huiles_bons_sortie", h_con: "huiles_consommation" }[kind] || kind) + ".xlsx"); }
function importDialog(kind) {
  const K = IMPORT[kind]; if (K.need === "admin" ? !S.isAdmin : !S.canWrite) { toast("Vos droits ne permettent pas cet import."); return; }
  const defCat = kind === "depart" ? (S.f.depCat || "FILTRE") : S.f.cat; let parsed = [];
  const html = '<p class="muted" style="margin-top:0">Choisissez un fichier Excel (.xlsx, .xls) ou CSV : la première feuille est lue, la première ligne doit contenir les en-têtes. Les colonnes sont reconnues par leur nom (voir le modèle).</p>' +
    '<div class="tools" style="margin-bottom:8px">' + (K.oil ? '<input type="hidden" id="imp-cat" value="">' : F("imp-cat", "Catégorie par défaut", catSel("imp-cat", defCat))) + F("imp-file", "Fichier", '<input id="imp-file" type="file" accept=".xlsx,.xls,.xlsm,.csv">') +
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
      const missing = K.oil ? K.cols.filter(c => K.req.includes(c[0]) && !(c[0] in map)).map(c => c[1]) : K.cols.filter(c => ["ref", "qte", "engin"].includes(c[0]) && !(c[0] in map) && !(kind !== "sorties" && c[0] === "engin") && !(kind === "entrees" && c[0] === "qte")).map(c => c[1]);
      if (kind === "h_ent" && !("bc" in map) && !("bl" in map)) missing.push("Fûts demandés (BC) ou Fûts livrés (BL)");
      if (kind === "entrees" && !("dem" in map) && !("liv" in map)) missing.push("Qté demandée (BC) ou Qté livrée (BL)");
      const recon = K.cols.filter(c => c[0] in map).map(c => c[1] + " ← « " + headers[map[c[0]]] + " »");
      parsed = aoa.slice(hIdx + 1).filter(r => r.some(c => String(c).trim() !== "")).map((cells, i) => Object.assign(buildRow(kind, cells, map, dcat), { line: hIdx + 2 + i }));
      if (missing.length) { box.innerHTML = '<div class="banner crit">Colonne(s) obligatoire(s) introuvable(s) : ' + esc(missing.join(", ")) + ". Utilisez le modèle ou renommez les en-têtes.</div>"; parsed = []; return; }
      const skipDup = ov.querySelector("#imp-dup").checked;
      const nErr = parsed.filter(p => p.errs.length).length, nDup = parsed.filter(p => !p.errs.length && p.warns.some(w => w.startsWith("doublon"))).length, nOk = parsed.length - nErr - (skipDup ? nDup : 0);
      const nF = parsed.filter(p => !p.errs.length && p.cat === "FILTRE").length, nP = parsed.filter(p => !p.errs.length && p.cat === "PDR").length;
      box.innerHTML = '<div class="banner ' + (nErr ? "crit" : "ok") + '">' + parsed.length + " ligne(s) lue(s) · <b>" + nOk + " à importer</b>" + (K.oil ? "" : " (" + nF + " filtre(s), " + nP + " PDR)") + (nErr ? " · " + nErr + " avec erreur (ignorées)" : "") + (nDup ? " · " + nDup + " doublon(s) possible(s)" : "") + "</div>" +
        '<p class="hint">Colonnes reconnues : ' + esc(recon.join(" · ")) + "</p>" +
        table(K.oil ? [{ h: "Ligne", n: 1, f: p => p.line }, { h: "État", f: p => p.errs.length ? '<span class="pill p-crit">Erreur</span>' : (p.warns.length ? '<span class="pill p-warn">À vérifier</span>' : '<span class="pill p-ok">OK</span>') },
          { h: "Date", f: p => fD(p.row.date) }, { h: "Huile", f: p => esc(p.ref || "") }, { h: "Détail", f: p => esc(p.info) }, { h: "Remarque", f: p => esc(p.errs.concat(p.warns).join(" · ")) }] :
          [{ h: "Ligne", n: 1, f: p => p.line }, { h: "État", f: p => p.errs.length ? '<span class="pill p-crit">Erreur</span>' : (p.warns.length ? '<span class="pill p-warn">À vérifier</span>' : '<span class="pill p-ok">OK</span>') },
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
const mapDA = r => ({ id: r.id, date: r.date_da || "", engin: r.engin || "", objet: r.objet || "", statut: r.statut, numero: r.numero_da || "", numAt: r.numero_at, numBy: r.numero_by, createdAt: r.created_at, createdBy: r.created_by, devisPath: r.devis_path || "", devisNom: r.devis_nom || "", type: r.type_da || "", cloture: r.cloture_motif || "", clotAt: r.cloture_at, clotBy: r.cloture_by });
const mapDL = r => ({ id: r.id, da: r.da_id, poste: r.poste || "", designation: r.designation || "", ref: r.ref || "", qte: r.qte, qteBc: r.qte_bc, qteBl: r.qte_bl, equiv: r.equiv || "", marque: r.marque || "", unite: r.unite || "", engin: r.engin || "", obs: r.obs || "" });
const daLines = id => [...S.daL.values()].filter(l => l.da === id).sort((a, b) => a.id - b.id);
const daLabel = d => d.numero ? "DA " + d.numero : "Demande #" + d.id;
const canEditDA = d => d.statut === "en_attente" && (S.isAdmin || (["gestionnaire", "magasinier", "saisie"].includes(S.role) && d.createdBy === S.uid));
const daPending = () => [...S.da.values()].filter(d => d.statut === "en_attente");
const enginTxt = code => { if (!code) return ""; const e = S.engins.get(String(code)); return e ? [e.designation, e.marque, e.modele].filter(Boolean).join(" ") : ""; };
const canViewDevis = d => !!d.devisPath && (S.isAdmin || S.role === "magasinier" || d.createdBy === S.uid);
async function openDevis(d) { const w = window.open("", "_blank");
  const { data, error } = await sb.storage.from("devis").createSignedUrl(d.devisPath, 600); if (error) { if (w) w.close(); throw error; }
  if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl; }
async function uploadDevis(daId, file, oldPath) {
  const path = daId + "/" + Date.now() + "_" + fileSafe(file.name.replace(/\.pdf$/i, "")).slice(-60) + ".pdf";
  const { error } = await sb.storage.from("devis").upload(path, file, { contentType: "application/pdf", upsert: false }); if (error) throw error;
  const r = await must(sb.from("da").update({ devis_path: path, devis_nom: file.name }).eq("id", daId).select().single());
  if (oldPath) sb.storage.from("devis").remove([oldPath]).catch(() => {}); return r; }
const devisCheck = f => !f ? "" : (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") ? "Le devis doit être un fichier PDF." : (f.size > 10 * 1024 * 1024 ? "Le devis dépasse 10 Mo." : "");
const DA_TYPES = { FILTRE: "Filtre", PDR: "PDR", CONSOMMABLE: "Consommable" };
const daTypeTxt = d => DA_TYPES[d.type] || "-";
const daType = d => d.type ? '<span class="pill ' + (d.type === "PDR" ? "p-acc" : d.type === "CONSOMMABLE" ? "p-warn" : "p-info") + '">' + esc(daTypeTxt(d)) + "</span>" : '<span class="muted">–</span>';
const daPill = d => d.statut === "numerotee" ? '<span class="pill p-ok">N° ' + esc(d.numero) + "</span>" : '<span class="pill p-warn">En attente du N° DA</span>';


VIEWS.da = { title: "Création DA",
  tools: () => '<div class="tools">' + searchF("da-q", S.f.daQ, "N°, engin, référence, désignation…") + '<span class="grow"></span>' +
    (("Notification" in window) && Notification.permission === "default" && S.canNumDA ? '<button class="btn" data-act="da-notif">Activer les notifications</button>' : "") +
    (S.canCreateDA ? '<button class="btn" data-act="da-tpl">Télécharger le canevas DA</button><button class="btn" data-act="da-imp">Importer Excel</button><button class="btn primary" data-act="da-new">+ Nouvelle demande d\'achat</button>' : "") + "</div>",
  bind() { $("#da-q").oninput = e => { S.f.daQ = e.target.value; render(); }; },
  body() { if (!S.canDA) return '<div class="empty">Réservé aux administrateurs, gestionnaires, magasiniers et comptes de saisie.</div>';
    const q = norm(S.f.daQ), pend = daPending().filter(d => daMatch(d, q)).sort((a, b) => b.id - a.id);
    let h = "";
    if (S.canNumDA) h += pend.length ? '<div class="banner crit">🔔 ' + pend.length + " demande(s) d'achat en attente de votre numéro de DA. Cliquez « Saisir N° DA » : la demande passe alors dans « Suivi DA ».</div>" : '<div class="banner ok">✔ Aucune demande d\'achat en attente de numéro.</div>';
    else h += '<div class="banner info">Créez la demande (ou importez votre tableau) : le magasinier et l\'administrateur sont notifiés, puis le magasinier saisit le N° de DA et la demande passe dans « Suivi DA ».</div>';
    h += '<div class="panel"><h3>Demandes en attente du N° DA <small>' + pend.length + "</small></h3>" + table(daCols("crea"), pend, { empty: "Aucune demande en attente." }) + "</div>";
    if (S.role === "gestionnaire" || S.role === "saisie") { const mine = [...S.da.values()].filter(d => d.createdBy === S.uid && d.statut === "numerotee").sort((a, b) => (b.numAt || "").localeCompare(a.numAt || "")).slice(0, 10);
      h += '<div class="panel"><h3>Mes dernières demandes numérotées</h3>' + table([{ h: "N° DA", f: d => "<b>" + mono(d.numero) + "</b>" }, { h: "Date DA", f: d => fD(d.date) }, { h: "Engin", f: d => mono(d.engin) }, { h: "Numérotée le", f: d => fDT(d.numAt) }, { h: "", f: d => daActs(d, "suivi") }], mine, { empty: "Aucune pour l'instant." }) + "</div>"; }
    return h; } };

/* =====================================================================
   BC et BL multiples : une DA → plusieurs BC (lignes partielles) ; un BC → plusieurs BL (livraisons partielles)
   ===================================================================== */
const mapBC = r => ({ id: r.id, da: r.da_id, num: r.num_bc || "", fourn: r.fournisseur || "", date: r.date_bc || "", solde: r.solde_motif || "", soldeAt: r.solde_at, soldeBy: r.solde_by, createdAt: r.created_at, createdBy: r.created_by });
const mapBCL = r => ({ id: r.id, bc: r.bc_id, dal: r.dal_id, qte: N(r.qte_bc) });
const mapBL = r => ({ id: r.id, bc: r.bc_id, num: r.num_bl || "", date: r.date_bl || "", createdAt: r.created_at, createdBy: r.created_by });
const mapBLL = r => ({ id: r.id, bl: r.bl_id, bcl: r.bcl_id, qte: N(r.qte_bl), cat: r.categorie || "", equiv: r.equiv || "", marque: r.marque || "", entree: r.entree_id });
const byId = (a, b) => a.id - b.id;
const bcsOf = daId => [...S.bc.values()].filter(b => b.da === daId).sort(byId);
const bclOf = bcId => [...S.bcl.values()].filter(x => x.bc === bcId).sort(byId);
const blsOf = bcId => [...S.bl.values()].filter(x => x.bc === bcId).sort(byId);
const bllOf = blId => [...S.bll.values()].filter(x => x.bl === blId).sort(byId);
const livreBcl = bclId => [...S.bll.values()].reduce((t, x) => t + (x.bcl === bclId ? x.qte : 0), 0);
const bclEffectif = x => { const b = S.bc.get(x.bc); return b && b.solde ? Math.min(x.qte, livreBcl(x.id)) : x.qte; };  // BC soldé : seul le livré reste « commandé »
const commandeDal = (dalId, exceptBc) => [...S.bcl.values()].reduce((t, x) => t + (x.dal === dalId && x.bc !== exceptBc ? bclEffectif(x) : 0), 0);
const resteCmd = (l, exceptBc) => Math.max(0, N(l.qte) - commandeDal(l.id, exceptBc));
const daAcommander = d => d.statut === "numerotee" && !d.cloture && daLines(d.id).some(l => resteCmd(l) > 0);
function daCmdState(d) { if (d.cloture) return ["Clôturée", "p-info"]; const n = bcsOf(d.id).length, reste = daLines(d.id).some(l => resteCmd(l) > 0);
  if (!n) return ["À commander", "p-warn"]; return reste ? ["Partiellement commandée · " + n + " BC", "p-acc"] : ["Commandée · " + n + " BC", "p-ok"]; }
function bcState(b) { if (b.solde) return ["Soldé", "p-info"]; const L = bclOf(b.id); let reste = 0, liv = 0; for (const x of L) { const v = livreBcl(x.id); liv += v; reste += Math.max(0, x.qte - v); }
  if (L.length && reste <= 0) return ["Livré", "p-ok"]; return liv > 0 ? ["Partiellement livré", "p-acc"] : ["Non livré", "p-warn"]; }
const bcOuvert = b => { const s = bcState(b)[0]; return s === "Non livré" || s === "Partiellement livré"; };
const bcEngins = b => [...new Set(bclOf(b.id).map(x => (S.daL.get(x.dal) || {}).engin).filter(Boolean))];
const codesHtml = codes => codes.length ? codes.map(mono).join(" ") : '<span class="muted">–</span>';

/* ---------- Suivi DA ---------- */
function daActs(d, where) {
  let h = '<button class="btn small" data-act="da-view" data-id="' + d.id + '">Voir</button>' + (canViewDevis(d) ? '<button class="btn small" data-act="da-devis" data-id="' + d.id + '" title="' + esc(d.devisNom) + '">📄 Devis</button>' : "");
  if (where === "suivi") h += '<button class="btn small" data-act="da-pdf" data-id="' + d.id + '">PDF</button><button class="btn small" data-act="da-xls" data-id="' + d.id + '">Excel</button>';
  if (S.canNumDA && d.statut === "en_attente") h += '<button class="btn small primary" data-act="da-num" data-id="' + d.id + '">Saisir N° DA</button>';
  if (S.canNumDA && d.statut === "numerotee" && where === "suivi" && !bcsOf(d.id).length && !d.cloture) h += '<button class="btn small" data-act="da-num" data-id="' + d.id + '">Corriger N°</button>';
  if (S.canNumDA && where === "suivi" && !d.cloture && daAcommander(d)) h += '<button class="btn small" data-act="da-clot" data-id="' + d.id + '" title="Les articles restants ne seront pas commandés">Clôturer</button>';
  if (S.canNumDA && where === "suivi" && d.cloture) h += '<button class="btn small" data-act="da-reopen" data-id="' + d.id + '">Rouvrir</button>';
  if (canEditDA(d)) h += '<button class="btn small" data-act="da-edit" data-id="' + d.id + '">Modifier</button><button class="btn small danger" data-act="da-del" data-id="' + d.id + '">Suppr.</button>';
  return '<div class="rowact">' + h + "</div>";
}
function daCols(where) {
  if (where === "suivi") return [{ h: "Date DA", f: d => fD(d.date) }, { h: "N° DA", f: d => "<b>" + mono(d.numero) + "</b>" },
    { h: "Code engin", f: d => { const c = [...new Set(daLines(d.id).map(l => l.engin).filter(Boolean))]; return c.length ? codesHtml(c) : (d.engin ? mono(d.engin) : codesHtml([])); } },
    { h: "Type", f: daType }, { h: "Objet DA", f: d => esc(d.objet) || '<span class="muted">–</span>' }, { h: "Lignes", n: 1, f: d => nb(daLines(d.id).length) }, { h: "Activer BC", f: d => S.canNumDA && daAcommander(d) ? '<button class="btn small primary bc-go" data-act="bc-start" data-id="' + d.id + '" title="Saisir un N° de BC">➜ BC</button>' : '<span class="muted">–</span>' }, { h: "", f: d => daActs(d, where) }];
  return [{ h: "Réf. interne", f: d => mono("#" + d.id) }, { h: "Date DA", f: d => fD(d.date) },
    { h: "Engin", f: d => d.engin ? mono(d.engin) + ' <span class="muted">' + esc(enginTxt(d.engin)) + "</span>" : '<span class="muted">Plusieurs</span>' },
    { h: "Type", f: daType }, { h: "Objet DA", f: d => esc(d.objet) || '<span class="muted">–</span>' }, { h: "Lignes", n: 1, f: d => nb(daLines(d.id).length) }, { h: "Qté totale", n: 1, f: d => nb(daLines(d.id).reduce((t, l) => t + N(l.qte), 0)) },
    { h: "Demandeur", f: d => who(d.createdBy) }, { h: "Créée le", f: d => fDT(d.createdAt) }, { h: "Statut", f: d => daPill(d) }, { h: "", f: d => daActs(d, where) }];
}
const daMatch = (d, q) => !q || norm([d.id, d.numero, d.engin, enginTxt(d.engin), d.objet, nameOf(d.createdBy), ...daLines(d.id).map(l => l.ref + " " + l.designation + " " + l.engin), ...bcsOf(d.id).map(b => b.num + " " + b.fourn)].join(" ")).includes(q);

VIEWS.suivida = { title: "Suivi DA",
  tools: () => '<div class="tools">' + searchF("sda-q", S.f.sdaQ, "N° DA, engin, référence…") + field("sda-f", "Du", '<input id="sda-f" type="date" value="' + esc(S.f.sdaFrom) + '">') + field("sda-t", "Au", '<input id="sda-t" type="date" value="' + esc(S.f.sdaTo) + '">') +
    '<span class="grow"></span><button class="btn" data-act="da-xls-all">Exporter la liste (Excel)</button></div>',
  bind() { ["sda-q", "sda-f", "sda-t"].forEach(id => $("#" + id).addEventListener(id === "sda-q" ? "input" : "change", () => { S.f.sdaQ = $("#sda-q").value; S.f.sdaFrom = $("#sda-f").value; S.f.sdaTo = $("#sda-t").value; render(); })); },
  rows() { const q = norm(S.f.sdaQ); return [...S.da.values()].filter(d => d.statut === "numerotee" && daAcommander(d) && inPeriod(d.date, S.f.sdaFrom, S.f.sdaTo) && daMatch(d, q)).sort((a, b) => (b.numAt || "").localeCompare(a.numAt || "") || b.id - a.id); },
  body() { if (!S.canDA) return '<div class="empty">Réservé aux administrateurs, gestionnaires, magasiniers et comptes de saisie.</div>';
    const r = this.rows(); return '<div class="more">' + r.length + " demande(s) · cliquez « ➜ BC » pour créer un bon de commande (une DA peut en avoir plusieurs). La DA reste ici tant qu'il reste des articles à commander ; « Clôturer » marque les articles restants comme non traités.</div>" + table(daCols("suivi"), r, { empty: "Aucune demande à commander." }); } };

/* ---------- Suivi BC (une ligne par bon de commande) ---------- */
function bcActs(b) { const d = S.da.get(b.da) || {}, hasBl = blsOf(b.id).length > 0;
  let h = '<button class="btn small" data-act="bc-view" data-id="' + b.id + '">Voir</button>' + (d.id && canViewDevis(d) ? '<button class="btn small" data-act="da-devis" data-id="' + d.id + '">📄 Devis</button>' : "") +
    '<button class="btn small" data-act="bc-pdf" data-id="' + b.id + '">PDF</button><button class="btn small" data-act="bc-xls" data-id="' + b.id + '">Excel</button>';
  if (S.canNumDA && !hasBl && !b.solde) h += '<button class="btn small" data-act="bc-edit" data-id="' + b.id + '">Modifier BC</button>';
  if (S.canNumDA && bcOuvert(b)) h += '<button class="btn small" data-act="bc-solde" data-id="' + b.id + '" title="Le reste ne sera pas livré">Solder</button>';
  if (S.canNumDA && !hasBl) h += '<button class="btn small danger" data-act="bc-del" data-id="' + b.id + '">Suppr.</button>';
  return '<div class="rowact">' + h + "</div>"; }
VIEWS.suivibc = { title: "Suivi BC",
  tools: () => '<div class="tools">' + searchF("sbc-q", S.f.sbcQ, "N° BC, N° DA, fournisseur, référence…") + field("sbc-s", "Statut", '<select id="sbc-s"><option value="">Tous</option><option>Non livré</option><option>Partiellement livré</option><option>Livré</option><option>Soldé</option></select>') +
    field("sbc-f", "Du", '<input id="sbc-f" type="date" value="' + esc(S.f.sbcFrom) + '">') + field("sbc-t", "Au", '<input id="sbc-t" type="date" value="' + esc(S.f.sbcTo) + '">') +
    '<span class="grow"></span><button class="btn" data-act="bc-xls-all">Exporter la liste (Excel)</button></div>',
  bind() { $("#sbc-s").value = S.f.sbcSt || ""; ["sbc-q", "sbc-s", "sbc-f", "sbc-t"].forEach(id => $("#" + id).addEventListener(id === "sbc-q" ? "input" : "change", () => { S.f.sbcQ = $("#sbc-q").value; S.f.sbcSt = $("#sbc-s").value; S.f.sbcFrom = $("#sbc-f").value; S.f.sbcTo = $("#sbc-t").value; render(); })); },
  rows() { const q = norm(S.f.sbcQ); return [...S.bc.values()].filter(b => { const d = S.da.get(b.da); if (!d) return false;
      return (!S.f.sbcSt || bcState(b)[0] === S.f.sbcSt) && inPeriod(d.date, S.f.sbcFrom, S.f.sbcTo) && (!q || norm([b.num, b.fourn, d.numero, ...bclOf(b.id).map(x => { const l = S.daL.get(x.dal) || {}; return (l.ref || "") + " " + (l.designation || "") + " " + (l.engin || ""); }), ...blsOf(b.id).map(x => x.num)].join(" ")).includes(q)); })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || b.id - a.id); },
  body() { if (!S.canDA) return '<div class="empty">Réservé aux administrateurs, gestionnaires, magasiniers et comptes de saisie.</div>';
    const r = this.rows(), cnt = s => r.filter(b => bcState(b)[0] === s).length;
    return '<div class="more">' + r.length + " BC · " + cnt("Non livré") + " non livré(s) · " + cnt("Partiellement livré") + " partiellement livré(s) · " + cnt("Livré") + " livré(s) · " + cnt("Soldé") + " soldé(s)</div>" + table([
      { h: "Date DA", f: b => fD((S.da.get(b.da) || {}).date) }, { h: "N° DA", f: b => "<b>" + mono((S.da.get(b.da) || {}).numero) + "</b>" }, { h: "N° BC", f: b => '<b class="mono">' + esc(b.num) + "</b>" }, { h: "Objet DA", f: b => esc((S.da.get(b.da) || {}).objet) || '<span class="muted">–</span>' },
      { h: "Code engin", f: b => codesHtml(bcEngins(b)) }, { h: "Lignes", n: 1, f: b => nb(bclOf(b.id).length) }, { h: "Fournisseur", f: b => esc(b.fourn) || '<span class="muted">–</span>' },
      { h: "Statut", f: b => { const [t, c] = bcState(b); return '<span class="pill ' + c + '"' + (b.solde ? ' title="' + esc(b.solde) + '"' : "") + ">" + t + "</span>"; } },
      { h: "Livrée", f: b => blsOf(b.id).map(x => '<span class="pill p-ok" title="Reçu le ' + esc(fD(x.date)) + '">✔ BL ' + esc(x.num) + "</span>").join(" ") + (S.canNumDA && bcOuvert(b) ? ' <button class="btn small primary bc-go" data-act="bl-start" data-id="' + b.id + '" title="Saisir un N° de BL">➜ BL</button>' : (blsOf(b.id).length ? "" : '<span class="muted">–</span>')) },
      { h: "", f: b => bcActs(b) }], r, { empty: "Aucun BC." }); } };

/* ---------- création / modification d'un BC ---------- */
function bcStart(d) {
  if (!S.canNumDA || !daAcommander(d)) return;
  modal("Saisir le N° de BC – DA " + d.numero, '<div class="fgrid">' + F("bc-num", "N° de BC *", '<input id="bc-num" placeholder="ex. 4400012345" autocomplete="off">') +
    F("bc-f", "Fournisseur", '<input id="bc-f" list="dl-fourn" autocomplete="off">') + "</div>" + (bcsOf(d.id).length ? '<p class="hint">Cette DA a déjà ' + bcsOf(d.id).length + " BC : " + bcsOf(d.id).map(b => esc(b.num)).join(", ") + ". Le nouveau BC portera sur les articles restants.</p>" : ""),
    async ov => { const num = fv(ov, "bc-num"); if (!num) return "Saisissez le N° de BC."; const fo = fv(ov, "bc-f"); setTimeout(() => bcForm(d, null, num, fo), 0); }, "Valider le N° BC");
}
function bcForm(d, b, num, fourn) {
  const edit = !!b, L = daLines(d.id), cur = new Map(edit ? bclOf(b.id).map(x => [x.dal, x.qte]) : []);
  const codes = [...new Set(L.map(l => l.engin).filter(Boolean))];
  const head = '<div class="bc-head">' + codes.map(c => '<div class="chip"><b class="mono">' + esc(c) + "</b> " + esc(enginTxt(c)) + "</div>").join("") + "</div>";
  const html = head + '<div class="fgrid">' + F("bq-num", "N° BC *", '<input id="bq-num" value="' + esc(edit ? b.num : num) + '">') + F("bq-da", "N° DA", '<input id="bq-da" value="' + esc(d.numero) + '" readonly>') +
    F("bq-f", "Fournisseur", '<input id="bq-f" list="dl-fourn" value="' + esc(edit ? b.fourn : fourn) + '">') + "</div>" +
    '<div class="tw le"><table><thead><tr><th>N° Poste</th><th>Désignation Catalogue</th><th>Référence</th><th>Unité</th><th class="n">Qté DA</th><th class="n">Déjà commandé</th><th class="n">Reste</th><th class="n" style="width:110px">Qté BC</th></tr></thead><tbody>' +
    L.map(l => { const deja = commandeDal(l.id, edit ? b.id : null), reste = Math.max(0, N(l.qte) - deja), v = edit ? (cur.get(l.id) || 0) : reste, off = reste <= 0 && !cur.get(l.id);
      return '<tr data-l="' + l.id + '" data-r="' + reste + '"' + (off ? ' class="muted"' : "") + "><td>" + esc(l.poste) + "</td><td>" + esc(l.designation) + "</td><td>" + mono(l.ref) + "</td><td>" + esc(l.unite) + '</td><td class="n"><b>' + nb(l.qte) + '</b></td><td class="n">' + nb(deja) +
        '</td><td class="n">' + (reste > 0 ? '<span class="reste">' + nb(reste) + "</span>" : "0") + '</td><td><input class="bq-q" type="number" min="0" step="any" value="' + esc(v) + '"' + (off ? " disabled" : "") + "></td></tr>"; }).join("") +
    '</tbody></table></div><p class="hint">Mettez <b>0</b> pour un article qui ne fait pas partie de ce BC : il restera « à commander » sur la DA (pour un autre BC, ou à clôturer).</p>';
  const ov = modal((edit ? "Modifier le BC " : "BC ") + (edit ? b.num : num), html, async ov => {
    const n2 = fv(ov, "bq-num"); if (!n2) return "Saisissez le N° de BC.";
    const vals = [...ov.querySelectorAll("tr[data-l]")].map(tr => ({ dal: +tr.dataset.l, reste: +tr.dataset.r, s: tr.querySelector(".bq-q").value.trim(), poste: tr.children[0].textContent || tr.children[2].textContent }));
    for (const v of vals) { const q = v.s === "" ? 0 : +v.s.replace(",", "."); if (!(q >= 0)) return "Quantité BC invalide."; if (q > v.reste + 1e-9) return "Qté BC supérieure au reste à commander (ligne " + (v.poste || "?") + " : reste " + nb(v.reste) + ")."; v.q = q; }
    const lines = vals.filter(v => v.q > 0); if (!lines.length) return "Saisissez au moins une quantité BC.";
    if (!edit) { const r = await must(sb.from("bc").insert({ da_id: d.id, num_bc: n2, fournisseur: fv(ov, "bq-f") || null, date_bc: today() }).select().single());
      try { const ls = await must(sb.from("bc_lignes").insert(lines.map(v => ({ bc_id: r.id, dal_id: v.dal, qte_bc: v.q }))).select()); S.bc.set(r.id, mapBC(r)); ls.forEach(x => S.bcl.set(x.id, mapBCL(x))); }
      catch (e) { await sb.from("bc").delete().eq("id", r.id); throw e; }
      schedule(); toast("BC " + n2 + " créé (" + lines.length + " article(s)) – il est dans « Suivi BC »." + (daAcommander(d) ? " La DA reste dans Suivi DA pour les articles restants." : "")); return; }
    const r = await must(sb.from("bc").update({ num_bc: n2, fournisseur: fv(ov, "bq-f") || null }).eq("id", b.id).select().single());
    await must(sb.from("bc_lignes").delete().eq("bc_id", b.id)); bclOf(b.id).forEach(x => S.bcl.delete(x.id));
    const ls = await must(sb.from("bc_lignes").insert(lines.map(v => ({ bc_id: b.id, dal_id: v.dal, qte_bc: v.q }))).select()); S.bc.set(r.id, mapBC(r)); ls.forEach(x => S.bcl.set(x.id, mapBCL(x))); schedule(); toast("BC " + n2 + " modifié."); }, "Valider", true);
  const f = ov.querySelector(".bq-q:not([disabled])"); if (f) { f.focus(); f.select(); }
}
function daClotForm(d) {
  const L = daLines(d.id).filter(l => resteCmd(l) > 0);
  modal("Clôturer la DA " + d.numero, '<p class="muted" style="margin-top:0">Les articles suivants ne seront pas commandés et la DA quittera « Suivi DA ». Les BC déjà créés ne changent pas.</p>' +
    table([{ h: "N° Poste", f: l => esc(l.poste) }, { h: "Désignation", f: l => esc(l.designation) }, { h: "Référence", f: l => mono(l.ref) }, { h: "Non traité", n: 1, f: l => '<span class="reste">' + nb(resteCmd(l)) + "</span>" }], L) +
    F("cl-m", "Motif *", '<input id="cl-m" list="dl-motifs-da" placeholder="ex. Article non disponible, annulé par le demandeur…"><datalist id="dl-motifs-da"><option value="Article non disponible"><option value="Annulé par le demandeur"><option value="Remplacé par une autre référence"><option value="Déjà en stock"><option value="Hors budget"></datalist>'),
    async ov => { const m = fv(ov, "cl-m"); if (!m) return "Saisissez le motif."; const r = await must(sb.from("da").update({ cloture_motif: m }).eq("id", d.id).select().single()); S.da.set(r.id, mapDA(r)); schedule(); toast("DA " + d.numero + " clôturée : " + m); }, "Clôturer la DA", true);
}

/* ---------- réception : N° BL → quantités livrées → entrées magasin ---------- */
function blStart(b) {
  if (!S.canNumDA || !bcOuvert(b)) return;
  modal("Saisir le N° de BL – BC " + b.num, '<div class="fgrid">' + F("bl-num", "N° de BL *", '<input id="bl-num" autocomplete="off">') + F("bl-f", "Fournisseur", '<input id="bl-f" value="' + esc(b.fourn || "–") + '" readonly>') + "</div>" +
    (blsOf(b.id).length ? '<p class="hint">Déjà reçu sur ce BC : ' + blsOf(b.id).map(x => "BL " + esc(x.num) + " (" + fD(x.date) + ")").join(", ") + ".</p>" : ""),
    async ov => { const num = fv(ov, "bl-num"); if (!num) return "Saisissez le N° de BL."; setTimeout(() => blForm(b, num), 0); }, "Valider le N° BL");
}
function blForm(b, num) {
  const d = S.da.get(b.da) || {}, L = bclOf(b.id).map(x => ({ x, l: S.daL.get(x.dal) || {}, liv: livreBcl(x.id) })), codes = bcEngins(b);
  const head = '<div class="bc-head">' + codes.map(c => '<div class="chip"><b class="mono">' + esc(c) + "</b> " + esc(enginTxt(c)) + "</div>").join("") + '<div class="chip">BC <b>' + esc(b.num) + "</b></div>" + (b.fourn ? '<div class="chip">Fournisseur <b>' + esc(b.fourn) + "</b></div>" : "") + "</div>";
  const info = l => (C && l.ref ? C.info(l.ref) : null) || {};
  const html = head + '<div class="fgrid">' + F("bl-n2", "N° BL *", '<input id="bl-n2" value="' + esc(num) + '">') + F("bl-date", "Date de réception", '<input id="bl-date" type="date" value="' + today() + '">') + "</div>" +
    '<div class="tw le"><table><thead><tr><th style="width:105px">Catégorie</th><th>N° Poste</th><th>Désignation Catalogue</th><th>Référence</th><th style="width:120px">Référence équi.</th><th style="width:110px">Marque</th><th>Unité</th><th class="n">Qté BC</th><th class="n">Déjà livré</th><th class="n">Reste</th><th class="n" style="width:95px">Qté BL</th><th>Code_Engin</th></tr></thead><tbody>' +
    L.map(({ x, l, liv }) => { const i = info(l), reste = Math.max(0, x.qte - liv), off = reste <= 0;
      return '<tr data-x="' + x.id + '" data-r="' + reste + '"' + (off ? ' class="muted"' : "") + '><td><select class="bl-cat"' + (off ? " disabled" : "") + '><option value="FILTRE"' + ((i.cat || (d.type === "CONSOMMABLE" ? "PDR" : d.type) || "FILTRE") !== "PDR" ? " selected" : "") + '>Filtre</option><option value="PDR"' + ((i.cat || (d.type === "CONSOMMABLE" ? "PDR" : d.type) || "FILTRE") === "PDR" ? " selected" : "") + '>PDR</option></select></td><td>' + esc(l.poste) + "</td><td>" + esc(l.designation) + "</td><td>" + mono(l.ref) +
        '</td><td><input class="bl-eq" value="' + esc(i.equiv || "") + '"' + (off ? " disabled" : "") + '></td><td><input class="bl-ma" list="dl-marques" value="' + esc(i.marque || "") + '"' + (off ? " disabled" : "") + "></td><td>" + esc(l.unite) + '</td><td class="n"><b>' + nb(x.qte) + '</b></td><td class="n">' + nb(liv) +
        '</td><td class="n">' + (reste > 0 ? '<span class="reste">' + nb(reste) + "</span>" : "0") + '</td><td><input class="bl-q" type="number" min="0" step="any" value="' + reste + '"' + (off ? " disabled" : "") + "></td><td>" + mono(l.engin) + "</td></tr>"; }).join("") +
    '</tbody></table></div><p class="hint">Saisissez la quantité réellement livrée (0 si l\'article manque). Chaque ligne livrée est ajoutée dans <b>Entrées (BC / BL)</b>. Le reste reste attendu sur ce BC : un autre BL pourra le recevoir, ou « Solder » le BC s\'il ne sera jamais livré.</p>';
  const ov = modal("BL " + num + " – réception du BC " + b.num, html, async ov => {
    const nbl = fv(ov, "bl-n2"), date = fv(ov, "bl-date") || today(); if (!nbl) return "Saisissez le N° de BL.";
    const vals = [...ov.querySelectorAll("tr[data-x]")].map(tr => ({ x: S.bcl.get(+tr.dataset.x), reste: +tr.dataset.r, cat: tr.querySelector(".bl-cat").value, eq: tr.querySelector(".bl-eq").value.trim(), ma: tr.querySelector(".bl-ma").value.trim(), s: tr.querySelector(".bl-q").value.trim() }));
    for (const v of vals) { const q = v.s === "" ? 0 : +v.s.replace(",", "."); if (!(q >= 0)) return "Quantité BL invalide."; if (q > v.reste + 1e-9) return "Qté BL supérieure au reste à livrer (reste " + nb(v.reste) + ")."; v.q = q; v.l = S.daL.get(v.x.dal) || {}; }
    const lines = vals.filter(v => v.q > 0); if (!lines.length) return "Saisissez au moins une quantité livrée.";
    if (lines.some(v => !v.l.ref && !v.l.designation)) return "Une ligne livrée n'a ni référence ni désignation.";
    const r = await must(sb.from("bl").insert({ bc_id: b.id, num_bl: nbl, date_bl: date }).select().single()); S.bl.set(r.id, mapBL(r)); let n = 0;
    try { for (const v of lines) {
        const e = await must(sb.from("entrees").insert({ categorie: v.cat, date, ref: v.l.ref || v.l.designation, type: v.l.designation || null, marque: v.ma || null, equiv: v.eq || null, qte_bc: v.q, qte_bl: v.q,
          num_bc: b.num, num_bl: nbl, fournisseur: b.fourn || null, engin: v.l.engin && S.engins.has(v.l.engin) ? v.l.engin : null, obs: "DA " + (d.numero || "") }).select().single()); applyRow("entrees", e);
        const y = await must(sb.from("bl_lignes").insert({ bl_id: r.id, bcl_id: v.x.id, qte_bl: v.q, categorie: v.cat, equiv: v.eq || null, marque: v.ma || null, entree_id: e.id }).select().single()); S.bll.set(y.id, mapBLL(y)); n++; } }
    catch (e) { schedule(); throw new Error("Réception interrompue après " + n + " article(s) : " + errMsg(e)); }
    schedule(); const st = bcState(b)[0]; toast("BL " + nbl + " reçu : " + n + " article(s) ajouté(s) dans Entrées. BC " + b.num + " : " + st.toLowerCase() + "."); }, "Valider", true);
  const f = ov.querySelector(".bl-q:not([disabled])"); if (f) { f.focus(); f.select(); }
}
function bcSoldeForm(b) {
  const L = bclOf(b.id).map(x => ({ x, l: S.daL.get(x.dal) || {}, reste: Math.max(0, x.qte - livreBcl(x.id)) })).filter(o => o.reste > 0);
  modal("Solder le BC " + b.num, '<p class="muted" style="margin-top:0">Les quantités restantes ne seront pas livrées : le BC passe en « Soldé ». Les BL déjà reçus et les entrées ne changent pas. Les articles non livrés redeviennent « à commander » sur la DA (dans Suivi DA) : vous pourrez les commander chez un autre fournisseur ou clôturer la DA.</p>' +
    table([{ h: "Désignation", f: o => esc(o.l.designation) }, { h: "Référence", f: o => mono(o.l.ref) }, { h: "Qté BC", n: 1, f: o => nb(o.x.qte) }, { h: "Non livré", n: 1, f: o => '<span class="reste">' + nb(o.reste) + "</span>" }], L) +
    F("so-m", "Motif *", '<input id="so-m" list="dl-motifs-bc" placeholder="ex. Indisponible chez le fournisseur"><datalist id="dl-motifs-bc"><option value="Indisponible chez le fournisseur"><option value="Rupture fournisseur"><option value="Annulé"><option value="Remplacé par un autre BC"></datalist>'),
    async ov => { const m = fv(ov, "so-m"); if (!m) return "Saisissez le motif."; const r = await must(sb.from("bc").update({ solde_motif: m }).eq("id", b.id).select().single()); S.bc.set(r.id, mapBC(r)); schedule(); toast("BC " + b.num + " soldé : " + m); }, "Solder le BC", true);
}
function bcView(b) {
  const d = S.da.get(b.da) || {}, [st] = bcState(b), L = bclOf(b.id).map(x => ({ x, l: S.daL.get(x.dal) || {}, liv: livreBcl(x.id) })), B = blsOf(b.id);
  const html = '<div class="bc-head">' + bcEngins(b).map(c => '<div class="chip"><b class="mono">' + esc(c) + "</b> " + esc(enginTxt(c)) + "</div>").join("") + '<div class="chip">DA <b>' + esc(d.numero) + "</b></div>" + (b.fourn ? '<div class="chip">Fournisseur <b>' + esc(b.fourn) + "</b></div>" : "") + '<div class="chip">Statut <b>' + esc(st) + "</b></div></div>" +
    (b.solde ? '<div class="banner info">BC soldé : ' + esc(b.solde) + " (" + esc(nameOf(b.soldeBy)) + ", " + fDT(b.soldeAt) + ")</div>" : "") +
    table([{ h: "N° Poste", f: o => esc(o.l.poste) }, { h: "Désignation Catalogue", f: o => esc(o.l.designation) }, { h: "Référence", f: o => mono(o.l.ref) }, { h: "Unité", f: o => esc(o.l.unite) }, { h: "Qté BC", n: 1, f: o => "<b>" + nb(o.x.qte) + "</b>" },
      { h: "Livré", n: 1, f: o => nb(o.liv) }, { h: "Reste", n: 1, f: o => { const r = Math.max(0, o.x.qte - o.liv); return r > 0 ? '<span class="' + (b.solde ? "muted" : "reste") + '">' + nb(r) + "</span>" : "0"; } }, { h: "Code_Engin", f: o => mono(o.l.engin) }], L) +
    "<h4>Bons de livraison reçus</h4>" + table([{ h: "N° BL", f: x => mono(x.num) }, { h: "Date", f: x => fD(x.date) }, { h: "Articles", n: 1, f: x => nb(bllOf(x.id).length) }, { h: "Quantité", n: 1, f: x => nb(bllOf(x.id).reduce((t, y) => t + y.qte, 0)) }, { h: "Saisi par", f: x => who(x.createdBy) }], B, { empty: "Aucun BL reçu." }) +
    '<div class="actions" style="justify-content:flex-start"><button type="button" class="btn" data-act="bc-pdf" data-id="' + b.id + '">Télécharger PDF</button><button type="button" class="btn" data-act="bc-xls" data-id="' + b.id + '">Télécharger Excel</button>' +
    (S.canNumDA && bcOuvert(b) ? '<button type="button" class="btn primary" data-act="bl-start" data-id="' + b.id + '">➜ BL</button>' : "") + "</div>";
  const ov = modal("BC " + b.num, html, async () => {}, "Fermer", true); ov.querySelector("#mf-cancel").hidden = true;
  ov.addEventListener("click", e => { if (e.target.closest("[data-act]")) ov.remove(); });
}

/* ---------- exports BC ---------- */
async function bcExcel(list, name) {
  await loadScript("vendor/exceljs.min.js");
  const wb = new ExcelJS.Workbook(); wb.creator = APPNAME; const one = list.length === 1;
  const ws = wb.addWorksheet(fileSafe(one ? "BC " + list[0].num : "Suivi BC").slice(0, 31), { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 11 }, { width: 13 }, { width: 13 }, { width: 20 }, { width: 10 }, { width: 32 }, { width: 17 }, { width: 9 }, { width: 9 }, { width: 10 }, { width: 9 }, { width: 8 }, { width: 13 }, { width: 18 }];
  const thin = { style: "thin" }, bd = { top: thin, left: thin, bottom: thin, right: thin };
  const hr = ws.addRow(["Date", "DA", "N° BC", "Fournisseur", "N° Poste", "Désignation Catalogue", "Référance", "Qté DA", "Qté BC", "Qté livrée", "Reste", "Unité", "Code_Engin", "Statut BC"]); hr.height = 18.9;
  hr.eachCell(c => { c.font = { name: "Arial", size: 9, bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } }; c.border = bd; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
  const numv = v => /^\d{1,15}$/.test(v || "") ? +v : (v || "");
  for (const b of list) { const d = S.da.get(b.da) || {}, st = bcState(b)[0];
    for (const x of bclOf(b.id)) { const l = S.daL.get(x.dal) || {}, liv = livreBcl(x.id);
      const r = ws.addRow([isoToDate(d.date), numv(d.numero), numv(b.num), b.fourn, numv(l.poste), l.designation, l.ref, N(l.qte), x.qte, liv, Math.max(0, x.qte - liv), l.unite, numv(l.engin), st]);
      r.eachCell({ includeEmpty: true }, (c, col) => { c.font = { name: "Arial", size: 10, bold: [9, 10, 13].includes(col) }; c.border = bd; c.alignment = { horizontal: [4, 6, 7].includes(col) ? "left" : "center", vertical: "middle" }; });
      r.getCell(1).numFmt = "dd/mm/yyyy"; } }
  ws.autoFilter = { from: "A1", to: { row: Math.max(1, ws.rowCount), column: 14 } }; ws.views = [{ state: "frozen", ySplit: 1 }];
  saveBlob(new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
}
async function bcPdf(b) {
  await loadScript("vendor/jspdf.umd.min.js"); await loadScript("vendor/jspdf.plugin.autotable.min.js");
  const d = S.da.get(b.da) || {}, { jsPDF } = window.jspdf, doc = new jsPDF({ unit: "mm", format: "a4" }), W = 210, [st] = bcState(b), sp = v => nb(v).replace(/[  ]/g, " ");
  doc.setFillColor(15, 76, 92); doc.rect(0, 0, W, 24, "F"); doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("BON DE COMMANDE", 14, 11);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(S.params.nom_chantier || "", 14, 18);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text("N° BC : " + b.num, W - 14, 11, { align: "right" }); doc.setFontSize(10.5); doc.text("N° DA : " + (d.numero || "-"), W - 14, 18.5, { align: "right" });
  doc.setTextColor(30); const codes = bcEngins(b), eg = c => S.engins.get(String(c)) || {};
  const info = [["Date de la DA", fD(d.date)], ["Type de demande", daTypeTxt(d)], ["Objet", d.objet || "-"], ["Fournisseur", b.fourn || "-"], ["Statut", st + (b.solde ? " (" + b.solde + ")" : "")]];
  if (codes.length <= 1) { const c = codes[0] || "", e = eg(c); info.push(["Code engin", c || "-"], ["Désignation", e.designation || "-"], ["Marque", e.marque || "-"], ["Type", e.modele || "-"], ["N° de série", e.serie || "-"]); }
  doc.autoTable({ startY: 30, body: info, theme: "plain", styles: { fontSize: 9.5, cellPadding: 1.2 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 38, textColor: [15, 76, 92] } }, margin: { left: 14, right: 14 } });
  if (codes.length > 1) doc.autoTable({ startY: doc.lastAutoTable.finalY + 2, head: [["Code engin", "Désignation", "Marque", "Type", "N° de série"]], body: codes.map(c => { const e = eg(c); return [c, e.designation || "-", e.marque || "-", e.modele || "-", e.serie || "-"]; }),
    theme: "grid", margin: { left: 14, right: 14 }, styles: { fontSize: 9, cellPadding: 1.6, lineColor: [160, 160, 160], lineWidth: 0.1, textColor: 20 }, headStyles: { fillColor: [222, 234, 237], textColor: [15, 76, 92], fontStyle: "bold" } });
  doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, head: [["N° Poste", "Désignation Catalogue", "Référence", "Qté BC", "Livré", "Reste", "Unité", "Code_Engin"]],
    body: bclOf(b.id).map(x => { const l = S.daL.get(x.dal) || {}, liv = livreBcl(x.id); return [l.poste, l.designation, l.ref, sp(x.qte), sp(liv), sp(Math.max(0, x.qte - liv)), l.unite, l.engin]; }),
    theme: "grid", margin: { left: 14, right: 14 }, styles: { fontSize: 9.5, cellPadding: 2, lineColor: [120, 120, 120], lineWidth: 0.1, textColor: 20 }, headStyles: { fillColor: [255, 255, 0], textColor: 0, fontStyle: "bold", halign: "center" },
    columnStyles: { 0: { halign: "center", cellWidth: 17 }, 2: { cellWidth: 30 }, 3: { halign: "center", cellWidth: 15, fontStyle: "bold" }, 4: { halign: "center", cellWidth: 14 }, 5: { halign: "center", cellWidth: 14 }, 6: { halign: "center", cellWidth: 14 }, 7: { halign: "center", cellWidth: 25, fontStyle: "bold" } } });
  const B = blsOf(b.id); if (B.length) doc.autoTable({ startY: doc.lastAutoTable.finalY + 6, head: [["Bons de livraison reçus", "Date", "Articles", "Quantité"]], body: B.map(x => ["BL " + x.num, fD(x.date), String(bllOf(x.id).length), sp(bllOf(x.id).reduce((t, y) => t + y.qte, 0))]),
    theme: "grid", margin: { left: 14, right: 14 }, styles: { fontSize: 9, cellPadding: 1.6, lineColor: [160, 160, 160], lineWidth: 0.1, textColor: 20 }, headStyles: { fillColor: [222, 234, 237], textColor: [15, 76, 92], fontStyle: "bold" } });
  const pages = doc.getNumberOfPages(); for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120); doc.text("page " + p + "/" + pages, W / 2, 290, { align: "center" }); }
  doc.save("BC_" + fileSafe(b.num) + "_DA_" + fileSafe(d.numero || "") + ".pdf");
}
function onBcChange(t, p) {
  const row = p.new, old = p.old, M = { bc: [S.bc, mapBC], bc_lignes: [S.bcl, mapBCL], bl: [S.bl, mapBL], bl_lignes: [S.bll, mapBLL] }[t];
  if (p.eventType === "DELETE") M[0].delete(old.id); else M[0].set(row.id, M[1](row));
  if (p.eventType === "INSERT" && t === "bc" && row.created_by !== S.uid) { const d = S.da.get(row.da_id); if (d && (d.createdBy === S.uid || S.isAdmin)) daNotify("✔ BC créé", "DA " + d.numero + " : BC " + row.num_bc + (row.fournisseur ? " (" + row.fournisseur + ")" : "") + ". Il est dans « Suivi BC »."); }
  if (p.eventType === "INSERT" && t === "bl" && row.created_by !== S.uid) { const b = S.bc.get(row.bc_id), d = b && S.da.get(b.da); if (d && (d.createdBy === S.uid || S.isAdmin)) daNotify("📦 Livraison reçue", "BC " + b.num + " : BL " + row.num_bl + " réceptionné."); }
  schedule();
}

/* ---------- formulaire DA ---------- */
const lineRow = (l, i) => '<tr data-i="' + i + '"><td><input class="dl-poste" value="' + esc(l.poste) + '"></td><td><input class="dl-des" list="dl-types" value="' + esc(l.designation) + '"></td><td><input class="dl-ref" list="dl-refs" value="' + esc(l.ref) + '"></td>' +
  '<td><input class="dl-qte" type="number" min="0" step="any" value="' + esc(l.qte ?? "") + '"></td><td><input class="dl-uni" list="dl-unites" value="' + esc(l.unite) + '"></td><td><input class="dl-eng" list="dl-engins" value="' + esc(l.engin) + '"></td><td><button type="button" class="btn small danger dl-del" title="Retirer la ligne">×</button></td></tr>';
function daForm(d) {
  const isNew = !d; d = d || { date: today(), engin: "", objet: "" };
  const L = isNew ? [] : daLines(d.id); while (L.length < (isNew ? 5 : Math.max(1, L.length))) L.push({ poste: "", designation: "", ref: "", qte: "", unite: "", engin: "" });
  const html = '<div class="fgrid">' + F("d-date", "Date de la DA *", '<input id="d-date" type="date" value="' + esc(d.date) + '">') +
    F("d-type", "Type de demande *", '<select id="d-type"><option value="">– choisir –</option><option value="FILTRE"' + (d.type === "FILTRE" ? " selected" : "") + '>Filtre</option><option value="PDR"' + (d.type === "PDR" ? " selected" : "") + '>PDR (pièces de rechange)</option><option value="CONSOMMABLE"' + (d.type === "CONSOMMABLE" ? " selected" : "") + ">Consommable</option></select>") +
    F("d-objet", "Objet DA *", '<input id="d-objet" value="' + esc(d.objet) + '" maxlength="200" placeholder="ex. Entretien 500 h, réparation freins…">', "full") +
    F("d-devis", "Devis (PDF, facultatif, 10 Mo max)", '<input id="d-devis" type="file" accept="application/pdf,.pdf">' + (d.devisPath ? '<div class="hint">Devis joint : <b>' + esc(d.devisNom) + '</b> · <label class="chk" style="display:inline-flex"><input type="checkbox" id="d-devis-del"> retirer</label> · un nouveau fichier le remplace</div>' : '<div class="hint">Visible par le magasinier et l\'administrateur.</div>'), "full") + "</div>" +
    '<div class="tw le"><table><thead><tr><th style="width:90px">N° Poste</th><th>Désignation Catalogue</th><th style="width:150px">Référence</th><th style="width:90px">Quantité *</th><th style="width:90px">Unité</th><th style="width:110px">Code_Engin</th><th style="width:40px"></th></tr></thead><tbody id="dl-body">' + L.map(lineRow).join("") + "</tbody></table></div>" + '<datalist id="dl-unites">' + ["U", "PCS", "JEU", "KIT", "L", "KG", "M", "PAIRE", "BOITE"].map(u => '<option value="' + u + '">').join("") + "</datalist>" +
    '<div class="actions" style="justify-content:flex-start;margin-top:8px"><button type="button" class="btn small" id="dl-add">+ Ajouter une ligne</button><span class="hint">Une ligne = un article. Les lignes vides sont ignorées.</span></div>';
  const ov = modal(isNew ? "Nouvelle demande d'achat" : "Modifier la demande #" + d.id, html, async ov => {
    const date = fv(ov, "d-date"); if (!date) return "Saisissez la date de la DA."; const typ = fv(ov, "d-type"); if (!typ) return "Choisissez le type de demande (Filtre, PDR ou Consommable)."; const obj = fv(ov, "d-objet"); if (!obj) return "Saisissez l'objet de la DA.";
    const file = ov.querySelector("#d-devis").files[0], fErr = devisCheck(file); if (fErr) return fErr; const delDevis = !!(ov.querySelector("#d-devis-del") || {}).checked;
    const rows = [], errs = [];
    ov.querySelectorAll("#dl-body tr").forEach((tr, k) => { const g = c => tr.querySelector(c).value.trim(); const poste = g(".dl-poste"), des = g(".dl-des"), ref = g(".dl-ref"), qs = g(".dl-qte"), un = g(".dl-uni"), le = g(".dl-eng");
      if (!poste && !des && !ref && !qs && !un && !le) return; const q = +qs.replace(",", ".");
      if (!des && !ref) errs.push("ligne " + (k + 1) + " : désignation ou référence manquante"); if (!(q > 0)) errs.push("ligne " + (k + 1) + " : quantité invalide"); if (le && !S.engins.has(le)) errs.push("ligne " + (k + 1) + " : engin " + le + " inconnu");
      rows.push({ poste: poste || null, designation: des || null, ref: ref || null, qte: q, unite: un || null, engin: le || null }); });
    if (errs.length) return errs.slice(0, 4).join(" · "); if (!rows.length) return "Ajoutez au moins une ligne.";
    const engs = [...new Set(rows.map(x => x.engin).filter(Boolean))], eng = engs.length === 1 ? engs[0] : null;  // engin de la DA = Code_Engin des lignes
    if (isNew) { const r = await must(sb.from("da").insert({ date_da: date, engin: eng, type_da: typ, objet: obj }).select().single());
      try { const ls = await must(sb.from("da_lignes").insert(rows.map(x => Object.assign({ da_id: r.id }, x))).select()); S.da.set(r.id, mapDA(r)); ls.forEach(l => S.daL.set(l.id, mapDL(l))); }
      catch (e) { await sb.from("da").delete().eq("id", r.id); throw e; }
      let msg = "Demande d'achat #" + r.id + " créée (" + rows.length + " ligne(s))" + (file ? " avec devis" : "") + ". Les personnes chargées du N° DA sont notifiées.";
      if (file) { try { S.da.set(r.id, mapDA(await uploadDevis(r.id, file))); } catch (e) { msg = "Demande #" + r.id + " créée, mais le devis n'a pas pu être joint (" + errMsg(e) + "). Utilisez « Modifier » pour réessayer."; } }
      schedule(); toast(msg); return; }
    const r = await must(sb.from("da").update({ date_da: date, engin: eng, type_da: typ, objet: obj }).eq("id", d.id).select().single());
    await must(sb.from("da_lignes").delete().eq("da_id", d.id)); daLines(d.id).forEach(l => S.daL.delete(l.id));
    const ls = await must(sb.from("da_lignes").insert(rows.map(x => Object.assign({ da_id: d.id }, x))).select());
    S.da.set(r.id, mapDA(r)); ls.forEach(l => S.daL.set(l.id, mapDL(l)));
    if (file) S.da.set(d.id, mapDA(await uploadDevis(d.id, file, d.devisPath)));
    else if (delDevis && d.devisPath) { const r2 = await must(sb.from("da").update({ devis_path: null, devis_nom: null }).eq("id", d.id).select().single()); sb.storage.from("devis").remove([d.devisPath]).catch(() => {}); S.da.set(d.id, mapDA(r2)); }
    schedule(); toast("Demande #" + d.id + " modifiée."); }, isNew ? "Créer la demande" : "Enregistrer", true);
  const body = ov.querySelector("#dl-body"); let n = L.length;
  ov.querySelector("#dl-add").onclick = () => { body.insertAdjacentHTML("beforeend", lineRow({ poste: "", designation: "", ref: "", qte: "", unite: "", engin: "" }, n++)); };
  body.addEventListener("click", e => { const b = e.target.closest(".dl-del"); if (b) { if (body.children.length > 1) b.closest("tr").remove(); else b.closest("tr").querySelectorAll("input").forEach(i => i.value = ""); } });
  body.addEventListener("change", e => { if (!e.target.classList.contains("dl-ref")) return; const tr = e.target.closest("tr"), des = tr.querySelector(".dl-des"); if (!des.value.trim() && C) { const i = C.info(e.target.value.trim()); if (i && i.type) des.value = i.type; } });
}

function daNumForm(d) {
  modal((d.numero ? "Corriger le N° de DA – " : "Saisir le N° de DA – ") + "demande #" + d.id, '<p class="muted" style="margin-top:0">' + esc([fD(d.date), d.engin && ("engin " + d.engin), d.objet && ("objet : " + d.objet), daLines(d.id).length + " ligne(s)", "demandeur : " + nameOf(d.createdBy)].filter(Boolean).join(" · ")) + "</p>" +
    F("n-num", "N° de DA *", '<input id="n-num" value="' + esc(d.numero) + '" placeholder="ex. 4500012345" autocomplete="off">') + '<div class="hint">Après validation, la demande passe dans « Suivi DA » et le demandeur est notifié.</div>',
    async ov => { const num = fv(ov, "n-num"); if (!num) return "Saisissez le numéro de DA.";
      const dup = [...S.da.values()].find(x => x.numero === num && x.id !== d.id); if (dup) return "Ce N° de DA est déjà utilisé (demande #" + dup.id + ").";
      const r = await must(sb.from("da").update({ numero_da: num }).eq("id", d.id).select().single()); S.da.set(r.id, mapDA(r)); schedule(); toast("N° DA " + num + " enregistré : la demande est dans « Suivi DA »."); }, "Valider le N° DA");
}

function daView(d) {
  const L = daLines(d.id);
  const html = '<div class="kpis">' + kpi("Statut", d.statut === "numerotee" ? "N° " + esc(d.numero) : "En attente", d.statut === "numerotee" ? "txt" : "warn") + kpi("Date DA", fD(d.date), "txt") + kpi("Type", d.type ? daTypeTxt(d) : "–", "txt") + kpi("Lignes", nb(L.length)) + kpi("Qté totale", nb(L.reduce((t, l) => t + N(l.qte), 0))) + "</div>" +
    '<p class="muted">' + (d.engin ? "Engin principal : <b>" + esc(d.engin) + "</b> " + esc(enginTxt(d.engin)) + " · " : "") + (d.objet ? "Objet : " + esc(d.objet) + " · " : "") + "Demandeur : " + esc(nameOf(d.createdBy)) + " · créée le " + fDT(d.createdAt) + (d.numAt ? " · N° saisi par " + esc(nameOf(d.numBy)) + " le " + fDT(d.numAt) : "") + "</p>" +
    (d.cloture ? '<div class="banner info">DA clôturée : ' + esc(d.cloture) + " (" + esc(nameOf(d.clotBy)) + ", " + fDT(d.clotAt) + ")</div>" : "") +
    (bcsOf(d.id).length ? '<div class="banner ok">Bons de commande : ' + bcsOf(d.id).map(b => "<b>" + esc(b.num) + "</b>" + (b.fourn ? " (" + esc(b.fourn) + ")" : "") + " · " + esc(bcState(b)[0])).join(" ; ") + "</div>" : "") +
    table([{ h: "N° Poste", f: l => esc(l.poste) }, { h: "Désignation Catalogue", f: l => esc(l.designation) }, { h: "Référence", f: l => mono(l.ref) }, { h: "Qté DA", n: 1, f: l => "<b>" + nb(l.qte) + "</b>" }].concat(d.statut === "numerotee" ? [
      { h: "Commandé", n: 1, f: l => nb(commandeDal(l.id)) }, { h: "Reste à commander", n: 1, f: l => { const r = resteCmd(l); return r > 0 ? '<span class="' + (d.cloture ? "muted" : "reste") + '">' + nb(r) + (d.cloture ? " (non traité)" : "") + "</span>" : "0"; } },
      { h: "BC", f: l => [...S.bcl.values()].filter(x => x.dal === l.id).map(x => mono((S.bc.get(x.bc) || {}).num) + " ×" + nb(x.qte)).join("<br>") || '<span class="muted">–</span>' }] : [], [{ h: "Unité", f: l => esc(l.unite) }, { h: "Code_Engin", f: l => mono(l.engin) }]), L, { empty: "Aucune ligne." }) +
    '<div class="actions" style="justify-content:flex-start">' + (canViewDevis(d) ? '<button type="button" class="btn" data-act="da-devis" data-id="' + d.id + '">📄 Voir le devis</button>' : "") + '<button type="button" class="btn" data-act="da-pdf" data-id="' + d.id + '">Télécharger PDF</button><button type="button" class="btn" data-act="da-xls" data-id="' + d.id + '">Télécharger Excel</button>' +
    (S.canNumDA && d.statut === "en_attente" ? '<button type="button" class="btn primary" data-act="da-num" data-id="' + d.id + '">Saisir N° DA</button>' : "") + "</div>";
  const ov = modal(daLabel(d), html, async () => {}, "Fermer", true); ov.querySelector("#mf-cancel").hidden = true;
  ov.addEventListener("click", e => { if (e.target.closest("[data-act]")) ov.remove(); });
}

/* ---------- import d'un tableau de DA (canevas : Date | DA | N° Poste | Désignation Catalogue | Référance | Quantité | Code_Engin) ---------- */
const DA_COLS = [["date", "Date", ["date", "datedemande", "dateda"]], ["num", "DA", ["da", "nda", "numda", "numeroda", "nodemandeachat", "demandeachat"]], ["poste", "N° Poste", ["nposte", "poste", "numeroposte", "noposte", "item"]],
  ["designation", "Désignation Catalogue", ["designationcatalogue", "designation", "libelle", "article", "description"]], ["ref", "Référance", ["referance", "reference", "ref", "codearticle", "refpiece", "referencefiltre"]],
  ["qte", "Quantité", ["quantite", "qte", "qtedemandee", "quantitedemandee"]], ["unite", "Unité", ["unite", "unites", "um", "udm", "uniteqte", "unitedemesure"]], ["engin", "Code_Engin", ["codeengin", "engin", "codeengins", "enginconcerne"]]];
function daImportDialog() {
  if (!S.canCreateDA) { toast("Les comptes Consultation ne créent pas de demandes d'achat."); return; }
  let groups = [];
  const html = '<p class="muted" style="margin-top:0">Choisissez votre tableau de demande d\'achat (.xlsx, .xls ou .csv) au format du canevas : <b>Date · DA · N° Poste · Désignation Catalogue · Référance · Quantité · Unité · Code_Engin</b> (la colonne Unité est facultative). Chaque feuille devient une demande ; si la colonne DA contient plusieurs numéros, une demande est créée par numéro.</p>' +
    '<div class="fgrid">' + F("di-type", "Type de demande *", '<select id="di-type"><option value="">– choisir –</option><option value="FILTRE">Filtre</option><option value="PDR">PDR (pièces de rechange)</option><option value="CONSOMMABLE">Consommable</option></select>') +
    F("di-objet", "Objet DA *", '<input id="di-objet" maxlength="200" placeholder="ex. Entretien 500 h, réparation freins…">') + '</div><p class="hint" style="margin-top:0">Le type et l\'objet s\'appliquent à toutes les demandes créées par cet import.</p>' +
    '<div class="tools" style="margin-bottom:8px">' + F("di-file", "Fichier", '<input id="di-file" type="file" accept=".xlsx,.xls,.xlsm,.csv">') + '<span class="grow"></span><button type="button" class="btn" data-act="da-tpl">Télécharger le canevas DA</button></div><div id="di-prev" class="imp-prev"></div>';
  const ov = modal("Importer un tableau de demande d'achat", html, async ov => {
    const typ = fv(ov, "di-type"), obj = fv(ov, "di-objet"); if (!typ) return "Choisissez le type de demande (Filtre, PDR ou Consommable)."; if (!obj) return "Saisissez l'objet de la DA.";
    const ok = groups.filter(g => g.ok.length && !g.err); if (!ok.length) return "Aucune demande importable : corrigez le fichier.";
    const btn = ov.querySelector("#mf-save"); let n = 0;
    for (const g of ok) { btn.textContent = "Import… " + n + "/" + ok.length;
      const head = { date_da: g.date, engin: g.engin || null, source: "import", type_da: typ, objet: obj }; if (g.num && S.canNumDA) head.numero_da = g.num;
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
  const bc = false;
  ws.columns = bc ? [{ width: 11 }, { width: 13 }, { width: 13 }, { width: 11 }, { width: 32.45 }, { width: 17.73 }, { width: 8.09 }, { width: 8.09 }, { width: 8 }, { width: 15 }] : [{ width: 11 }, { width: 13 }, { width: 11 }, { width: 32.45 }, { width: 17.73 }, { width: 8.09 }, { width: 8 }, { width: 15 }];
  const thin = { style: "thin" }, bd = { top: thin, left: thin, bottom: thin, right: thin };
  const hr = ws.addRow(bc ? ["Date", "DA", "N° BC", "N° Poste", "Désignation Catalogue", "Référance", "Qté DA", "Qté BC", "Unité", "Code_Engin"] : ["Date", "DA", "N° Poste", "Désignation Catalogue", "Référance", "Quantité", "Unité", "Code_Engin"]); hr.height = 18.9;
  hr.eachCell(c => { c.font = { name: "Arial", size: 9, bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } }; c.border = bd; c.alignment = { horizontal: "center", vertical: "middle" }; });
  for (const d of list) for (const l of daLines(d.id)) {
    const num = /^\d{1,15}$/.test(d.numero) ? +d.numero : (d.numero || ""), poste = /^\d{1,9}$/.test(l.poste) ? +l.poste : l.poste, eng = /^\d{1,9}$/.test(l.engin) ? +l.engin : l.engin;
    const nbc = "";
    const r = ws.addRow(bc ? [isoToDate(d.date), num, nbc, poste, l.designation, l.ref, N(l.qte), l.qteBc ?? "", l.unite, eng] : [isoToDate(d.date), num, poste, l.designation, l.ref, N(l.qte), l.unite, eng]);
    const left = bc ? [5, 6] : [4, 5], bold = bc ? [7, 8, 10] : [6, 8];
    r.eachCell({ includeEmpty: true }, (c, col) => { c.font = { name: "Arial", size: 10, bold: bold.includes(col) }; c.border = bd; c.alignment = { horizontal: left.includes(col) ? "left" : "center", vertical: "middle" }; });
    r.getCell(1).numFmt = "dd/mm/yyyy"; }
  ws.autoFilter = { from: "A1", to: { row: Math.max(1, ws.rowCount), column: bc ? 10 : 8 } };
  saveBlob(new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
}
async function daPdf(d) {
  await loadScript("vendor/jspdf.umd.min.js"); await loadScript("vendor/jspdf.plugin.autotable.min.js");
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" }), W = 210, L = daLines(d.id);
  doc.setFillColor(15, 76, 92); doc.rect(0, 0, W, 24, "F"); doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("DEMANDE D'ACHAT", 14, 11);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(S.params.nom_chantier || "", 14, 18);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(d.numero ? "N° DA : " + d.numero : "N° DA : en attente", W - 14, 11, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text("Réf. interne #" + d.id, W - 14, 18.5, { align: "right" });
  doc.setTextColor(30);
  // engin(s) : le code saisi dans Code_Engin des lignes → désignation, marque, type (modèle), série de la fiche engin
  const codes = [...new Set(L.map(l => l.engin).filter(Boolean))], eg = c => S.engins.get(String(c)) || {};
  if (codes.length <= 1) { const c = codes[0] || "", e = eg(c);
    doc.autoTable({ startY: 30, body: [["Date de la DA", fD(d.date)], ["Type de demande", daTypeTxt(d)], ["Objet", d.objet || "-"], ["Code engin", c || "-"], ["Désignation", e.designation || "-"], ["Marque", e.marque || "-"], ["Type", e.modele || "-"], ["N° de série", e.serie || "-"]],
      theme: "plain", styles: { fontSize: 9.5, cellPadding: 1.2 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 38, textColor: [15, 76, 92] } }, margin: { left: 14, right: 14 } });
  } else {
    doc.autoTable({ startY: 30, body: [["Date de la DA", fD(d.date)], ["Type de demande", daTypeTxt(d)], ["Objet", d.objet || "-"]], theme: "plain", styles: { fontSize: 9.5, cellPadding: 1.2 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 38, textColor: [15, 76, 92] } }, margin: { left: 14, right: 14 } });
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 2, head: [["Code engin", "Désignation", "Marque", "Type", "N° de série"]], body: codes.map(c => { const e = eg(c); return [c, e.designation || "-", e.marque || "-", e.modele || "-", e.serie || "-"]; }),
      theme: "grid", margin: { left: 14, right: 14 }, styles: { fontSize: 9, cellPadding: 1.6, lineColor: [160, 160, 160], lineWidth: 0.1, textColor: 20 }, headStyles: { fillColor: [222, 234, 237], textColor: [15, 76, 92], fontStyle: "bold" } }); }
  const sp = v => nb(v).replace(/[\u202f\u00a0]/g, " ");
  doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, head: [["N° Poste", "Désignation Catalogue", "Référence", "Quantité", "Unité", "Code_Engin"]],
    body: L.map(l => [l.poste, l.designation, l.ref, sp(l.qte), l.unite, l.engin]),
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

/* =====================================================================
   GESTION DES HUILES : fûts (BC/BL) → magasin → bon de sortie → atelier → consommation par engin
   ===================================================================== */
const ENTRETIENS = ["Vidange", "Fuite", "Remise à niveau"];
const huilesList = () => (S.params.huiles && S.params.huiles.length ? S.params.huiles : ["LA-3 15W40", "LA-3 10W", "AW68", "AW46", "ATF", "SAE 80W90", "Liquide antigel"]);
const mapHE = r => ({ id: r.id, date: r.date, huile: r.huile, bc: r.futs_bc, bl: r.futs_bl, cont: N(r.contenance) || 208, numBc: r.num_bc || "", numBl: r.num_bl || "", fourn: r.fournisseur || "", obs: r.obs || "", depart: r.source === "depart", createdBy: r.created_by });
const mapHS = r => ({ id: r.id, date: r.date, huile: r.huile, atelier: r.atelier || "", futs: N(r.futs), cont: N(r.contenance) || 208, numBs: r.num_bs || "", obs: r.obs || "", depart: r.source === "depart", litres: N(r.litres), createdBy: r.created_by });
const hsLit = s => s.depart ? s.litres * s.futs : s.futs * s.cont;  // litres apportés à l'atelier (fût ouvert avant l'application : litres restants déclarés)
const mapHC = r => ({ id: r.id, date: r.date, engin: String(r.engin || ""), huile: r.huile, entretien: r.entretien, qte: N(r.qte), atelier: r.atelier || "", compteur: r.compteur, obs: r.obs || "", createdBy: r.created_by });
const L_ = v => nb(Math.round(N(v) * 10) / 10) + " L";
const lastCont = huile => { const e = [...S.hEnt.values()].filter(x => x.huile === huile).sort((a, b) => b.id - a.id)[0]; return e ? e.cont : 208; };

function hCompute() {
  const H = new Map(); const get = h => { if (!H.has(h)) H.set(h, { huile: h, futsIn: 0, litIn: 0, futsOut: 0, litOut: 0, futsAtt: 0, futsDep: 0, conso: 0, at: new Map(), lastIn: "", lastOut: "" }); return H.get(h); };
  huilesList().forEach(get);
  for (const e of S.hEnt.values()) { const o = get(e.huile), bl = N(e.bl); o.futsIn += bl; o.litIn += bl * e.cont; o.futsAtt += Math.max(0, N(e.bc) - bl); if (e.depart) { o.futsDep += bl; continue; } if (bl > 0 && (e.date || "") > o.lastIn) o.lastIn = e.date; }
  const atOf = (o, a) => { a = a || "Non précisé"; if (!o.at.has(a)) o.at.set(a, { atelier: a, recu: 0, conso: 0, futs: 0 }); return o.at.get(a); };
  for (const s of S.hSor.values()) { const o = get(s.huile), a = atOf(o, s.atelier); a.recu += hsLit(s); a.futs += s.futs; if (s.depart) continue; o.futsOut += s.futs; o.litOut += s.futs * s.cont; if ((s.date || "") > o.lastOut) o.lastOut = s.date; }
  for (const c of S.hCon.values()) { const o = get(c.huile); o.conso += c.qte; atOf(o, c.atelier).conso += c.qte; }
  for (const o of H.values()) { o.futsMag = o.futsIn - o.futsOut; o.litMag = o.litIn - o.litOut; o.reste = [...o.at.values()].reduce((t, a) => t + a.recu, 0) - o.conso; }
  return H;
}
const hSeuilG = () => N(S.params.seuil_huile ?? 4) || 4;
const hSeuils = () => S.params.seuils_huile && typeof S.params.seuils_huile === "object" ? S.params.seuils_huile : {};
const hSeuil = h => { const v = h != null ? hSeuils()[h] : undefined; return v != null && v !== "" ? N(v) : hSeuilG(); };   // seuil propre à l'huile, sinon seuil général
const hSeuilTxt = () => nb(hSeuilG()) + " fûts" + (Object.keys(hSeuils()).length ? " (" + Object.entries(hSeuils()).map(([k, v]) => k + " : " + nb(v)).join(", ") + ")" : "");
const hStatut = o => o.futsMag <= 0 ? "RUPTURE" : (o.futsMag <= hSeuil(o.huile) ? "ALERTE" : "OK");
/* période du tableau de bord : préréglages + dates libres */
const H_PER = [["mois", "Ce mois"], ["moisprec", "Mois précédent"], ["3mois", "3 derniers mois"], ["annee", "Cette année"], ["tout", "Tout l'historique"], ["perso", "Personnalisée"]];
const hFilterPeriod = () => { const p = S.f.hPer || "annee", t = today(), d = new Date();
  if (p === "perso") return [S.f.hDu || "", S.f.hAu || ""];
  if (p === "tout") return ["", ""]; if (p === "mois") return [monthStart(), t];
  if (p === "moisprec") { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 0); return [ymd(a), ymd(b)]; }
  if (p === "3mois") { d.setMonth(d.getMonth() - 2, 1); return [ymd(d), t]; } return [t.slice(0, 4) + "-01-01", t]; };
const hPerLabel = (f, to) => !f && !to ? "Tout l'historique" : (f && to ? "du " + fD(f) + " au " + fD(to) : (f ? "depuis le " + fD(f) : "jusqu'au " + fD(to)));
const MOIS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS_LONG = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

/* toutes les données du tableau de bord / du rapport pour une période */
function hDashData(f, to, hu) {
  const inP = d => inPeriod(d, f, to), H = hCompute();
  const cons = [...S.hCon.values()].filter(c => inP(c.date) && (!hu || c.huile === hu)), sors = [...S.hSor.values()].filter(s => !s.depart && inP(s.date) && (!hu || s.huile === hu));
  const ents = [...S.hEnt.values()].filter(e => !e.depart && inP(e.date) && (!hu || e.huile === hu));
  const Hs = [...H.values()].filter(o => !hu || o.huile === hu);
  const tot = cons.reduce((s, c) => s + c.qte, 0);
  const byH = huilesList().filter(x => !hu || x === hu).map(x => { const L = cons.filter(c => c.huile === x); return { huile: x, v: L.reduce((s, c) => s + c.qte, 0), n: L.length }; }).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
  const byE = ENTRETIENS.map(x => { const L = cons.filter(c => c.entretien === x); return { type: x, n: L.length, v: L.reduce((s, c) => s + c.qte, 0) }; });
  const be = new Map(); for (const c of cons) { const o = be.get(c.engin) || { engin: c.engin, v: 0, n: 0, fuites: 0, vid: 0, niv: 0, last: "" }; o.v += c.qte; o.n++; if (c.entretien === "Fuite") o.fuites++; else if (c.entretien === "Vidange") o.vid++; else o.niv++; if ((c.date || "") > o.last) o.last = c.date; be.set(c.engin, o); }
  const top = [...be.values()].sort((a, b) => b.v - a.v), fuites = top.filter(o => o.fuites >= 2).sort((a, b) => b.fuites - a.fuites || b.v - a.v);
  // mois de la période (12 derniers mois si période ouverte, 24 au maximum)
  let start = f, end = to || today(); if (!start) { const dmin = cons.map(c => c.date).filter(Boolean).sort()[0]; const d = new Date(); d.setMonth(d.getMonth() - 11, 1); start = dmin && dmin > ymd(d) ? dmin : ymd(d); }
  const months = []; let y = +start.slice(0, 4), m = +start.slice(5, 7); const ye = +end.slice(0, 4), me = +end.slice(5, 7);
  while ((y < ye || (y === ye && m <= me)) && months.length < 240) { months.push(y + "-" + String(m).padStart(2, "0")); m++; if (m > 12) { m = 1; y++; } }
  const mSlice = months.slice(-24), monthly = mSlice.map(k => ({ k, label: MOIS_FR[+k.slice(5) - 1] + " " + k.slice(2, 4), long: MOIS_LONG[+k.slice(5) - 1] + " " + k.slice(0, 4), v: cons.filter(c => (c.date || "").slice(0, 7) === k).reduce((s, c) => s + c.qte, 0), n: cons.filter(c => (c.date || "").slice(0, 7) === k).length }));
  const mvt = Hs.map(o => ({ huile: o.huile, recus: ents.filter(e => e.huile === o.huile).reduce((s, e) => s + N(e.bl), 0), sortis: sors.filter(s => s.huile === o.huile).reduce((s, x) => s + x.futs, 0), litres: cons.filter(c => c.huile === o.huile).reduce((s, c) => s + c.qte, 0) }));
  const ecarts = Hs.flatMap(o => [...o.at.values()].filter(a => a.recu - a.conso < 0).map(a => ({ huile: o.huile, atelier: a.atelier, ec: a.recu - a.conso })));
  const alertes = Hs.filter(o => hStatut(o) !== "OK");
  return { f, to, hu, cons, sors, ents, Hs, tot, byH, byE, top, fuites, monthly, mvt, ecarts, alertes, engins: new Set(cons.map(c => c.engin)).size, futsSortis: sors.reduce((s, x) => s + x.futs, 0), futsRecus: ents.reduce((s, e) => s + N(e.bl), 0), futsMag: Hs.reduce((s, o) => s + o.futsMag, 0) };
}
function hMonthsBars(monthly) { const max = Math.max(1, ...monthly.map(x => x.v));
  return '<div class="vbars" style="grid-template-columns:repeat(' + Math.max(monthly.length, 1) + ',1fr)">' + monthly.map(x => '<div class="vb" title="' + esc(x.long + " : " + L_(x.v) + " · " + x.n + " interv.") + '"><span class="vb-v">' + (x.v ? esc(nb(Math.round(x.v))) : "") + '</span><span class="vb-t"><i style="height:' + (x.v ? Math.max(2, x.v / max * 100) : 0).toFixed(1) + '%"></i></span><span class="vb-l">' + esc(x.label) + "</span></div>").join("") + "</div>"; }

VIEWS.hdash = { title: "Gestion huiles – tableau de bord",
  tools() { const [f, to] = hFilterPeriod();
    return '<div class="tools">' + field("hd-per", "Période", '<select id="hd-per">' + H_PER.map(([k, l]) => '<option value="' + k + '"' + ((S.f.hPer || "annee") === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select>") +
      field("hd-du", "Du", '<input id="hd-du" type="date" value="' + esc(f) + '">') + field("hd-au", "Au", '<input id="hd-au" type="date" value="' + esc(to) + '">') +
      field("hd-h", "Huile", '<select id="hd-h"><option value="">Toutes les huiles</option>' + huilesList().map(x => "<option" + (x === S.f.hHuile ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select>") +
      '<span class="grow"></span><button class="btn" data-act="h-rap-xls">Rapport Excel</button><button class="btn primary" data-act="h-rap-pdf">Rapport PDF</button></div>'; },
  bind() { $("#hd-per").onchange = e => { S.f.hPer = e.target.value; if (S.f.hPer === "perso" && !S.f.hDu) { const [a, b] = [$("#hd-du").value, $("#hd-au").value]; S.f.hDu = a; S.f.hAu = b; } render(true); };
    const dates = () => { S.f.hPer = "perso"; S.f.hDu = $("#hd-du").value; S.f.hAu = $("#hd-au").value; render(true); };
    $("#hd-du").onchange = dates; $("#hd-au").onchange = dates; $("#hd-h").onchange = e => { S.f.hHuile = e.target.value; render(); }; },
  body() { if (!S.isAdmin) return '<div class="empty">Réservé aux administrateurs.</div>';
    const [f, to] = hFilterPeriod(), D = hDashData(f, to, S.f.hHuile), nAl = D.alertes.length;
    let h = '<div class="more">Période : <b>' + esc(hPerLabel(f, to)) + "</b>" + (D.hu ? " · huile : <b>" + esc(D.hu) + "</b>" : "") + " · seuil d'alerte stock : " + esc(hSeuilTxt()) + "</div>";
    h += '<div class="kpis">' + kpi("Litres consommés", esc(nb(Math.round(D.tot)))) + kpi("Interventions", nb(D.cons.length)) + kpi("Engins servis", nb(D.engins)) + kpi("Fûts reçus (BL)", nb(D.futsRecus)) +
      kpi("Fûts sortis vers ateliers", nb(D.futsSortis)) + kpi("Huiles en alerte / rupture", nb(nAl), nAl ? "crit" : "") + "</div>";
    if (nAl) h += '<div class="banner crit">⚠ Stock à réapprovisionner : ' + D.alertes.map(o => esc(o.huile) + " (" + nb(o.futsMag) + " fût" + (Math.abs(o.futsMag) > 1 ? "s" : "") + ")").join(" · ") + "</div>";
    h += '<div class="grid2"><div class="panel"><h3>Litres consommés par type d\'huile</h3>' + hBars(D.byH.map(r => ({ label: r.huile, labelHtml: esc(r.huile), v: r.v, sub: r.n + " interv." })), { fmt: L_ }) +
      '</div><div class="panel"><h3>Nombre d\'entretiens par type</h3>' + hBars(D.byE.filter(r => r.n).map(r => ({ label: r.type, labelHtml: esc(r.type), v: r.n, sub: L_(r.v) })), { fmt: v => nb(v) + " fois" }) + "</div></div>";
    h += '<div class="panel"><h3>Engins les plus consommateurs <small>top 10</small></h3>' + hBars(D.top.slice(0, 10).map(o => ({ label: o.engin + " " + C.label(o.engin), labelHtml: mono(o.engin) + ' <span class="muted">' + esc(C.label(o.engin)) + "</span>", v: o.v, sub: o.n + " interv." + (o.fuites ? " · " + o.fuites + " fuite(s)" : "") })), { fmt: L_ }) + "</div>";
    h += '<div class="panel"><h3>Consommation mensuelle <small>' + (D.monthly.length ? esc(D.monthly[0].long + " – " + D.monthly[D.monthly.length - 1].long) : "") + "</small></h3>" + hMonthsBars(D.monthly) + "</div>";
    h += '<div class="grid2"><div class="panel"><h3>Fuites répétées <small>2 fuites ou plus sur la période</small></h3>' + table([{ h: "Code engin", f: o => mono(o.engin) }, { h: "Engin", f: o => esc(C.label(o.engin)) }, { h: "Fuites", n: 1, f: o => '<span class="reste">' + nb(o.fuites) + "</span>" }, { h: "Litres", n: 1, f: o => L_(o.v) }, { h: "Dernière", f: o => fD(o.last) }], D.fuites, { empty: "Aucune fuite répétée : rien à signaler." }) + "</div>";
    h += '<div class="panel"><h3>Stock magasin et contrôle atelier</h3>' + table([{ h: "Huile", f: o => esc(o.huile) }, { h: "Fûts en stock", n: 1, f: o => "<b>" + nb(o.futsMag) + "</b>" }, { h: "Statut", f: o => pill(hStatut(o)) }], D.Hs) +
      (D.ecarts.length ? '<div class="banner crit" style="margin-top:10px">⚠ ' + D.ecarts.length + " écart(s) atelier : " + D.ecarts.map(a => esc(a.atelier + " · " + a.huile + " " + L_(a.ec))).join(" ; ") + "</div>" : '<div class="banner ok" style="margin-top:10px">✔ Consommations couvertes par les fûts sortis du magasin.</div>') + "</div></div>";
    return h; } };

/* ---------- rapports PDF / Excel ---------- */
const H_PETROL = [15, 76, 92];
const pnb = v => nb(v).replace(/[\u202f\u00a0]/g, " ");
async function hReportPdf() {
  await loadScript("vendor/jspdf.umd.min.js"); await loadScript("vendor/jspdf.plugin.autotable.min.js");
  const [f, to] = hFilterPeriod(), D = hDashData(f, to, S.f.hHuile), { jsPDF } = window.jspdf, doc = new jsPDF({ unit: "mm", format: "a4" }), W = 210, M = 14, CW = W - 2 * M;
  const head = () => { doc.setFillColor(...H_PETROL); doc.rect(0, 0, W, 26, "F"); doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text("RAPPORT – GESTION DES HUILES", M, 11);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text((S.params.nom_chantier || "") + "   |   Période : " + hPerLabel(f, to) + (D.hu ? "   |   Huile : " + D.hu : ""), M, 19); doc.setTextColor(30); };
  head(); let y = 33;
  // indicateurs
  const K = [["Litres consommés", pnb(Math.round(D.tot))], ["Interventions", pnb(D.cons.length)], ["Engins servis", pnb(D.engins)], ["Fûts reçus (BL)", pnb(D.futsRecus)], ["Fûts sortis", pnb(D.futsSortis)], ["Alertes stock", pnb(D.alertes.length)]];
  const kw = (CW - 5 * 3) / 6; K.forEach(([l, v], i) => { const x = M + i * (kw + 3); doc.setDrawColor(210); doc.setFillColor(244, 248, 249); doc.roundedRect(x, y, kw, 18, 1.5, 1.5, "FD"); doc.setFillColor(...(i === 5 && D.alertes.length ? [184, 50, 42] : H_PETROL)); doc.rect(x, y, kw, 1.2, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...(i === 5 && D.alertes.length ? [184, 50, 42] : [20, 30, 35])); doc.text(String(v), x + 3, y + 9); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(90); doc.text(l, x + 3, y + 14.5); });
  y += 25; doc.setTextColor(30);
  const section = (t) => { if (y > 262) { doc.addPage(); head(); y = 33; } doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.setTextColor(...H_PETROL); doc.text(t.toUpperCase(), M, y); doc.setDrawColor(...H_PETROL); doc.setLineWidth(0.4); doc.line(M, y + 1.5, M + CW, y + 1.5); doc.setLineWidth(0.2); doc.setTextColor(30); y += 4; };
  const tbl = (headRow, body, opt = {}) => { doc.autoTable(Object.assign({ startY: y, head: [headRow], body, theme: "grid", margin: { left: M, right: M, top: 32 }, styles: { fontSize: 8.6, cellPadding: 1.6, lineColor: [205, 214, 217], lineWidth: 0.1, textColor: 25 },
      headStyles: { fillColor: H_PETROL, textColor: 255, fontStyle: "bold" }, alternateRowStyles: { fillColor: [247, 250, 250] }, didDrawPage: d => { if (d.pageNumber > 1) head(); } }, opt)); y = doc.lastAutoTable.finalY + 8; };
  const barCell = (col, max) => ({ didDrawCell: d => { if (d.section !== "body" || d.column.index !== col) return; const v = d.cell.raw && d.cell.raw.v; if (!v) return; const w = (d.cell.width - 4) * v / max; doc.setFillColor(...H_PETROL); doc.rect(d.cell.x + 2, d.cell.y + d.cell.height / 2 - 1.6, Math.max(0.6, w), 3.2, "F"); } });
  // 1. par huile
  section("1. Consommation par type d'huile");
  const maxH = Math.max(1, ...D.byH.map(r => r.v));
  tbl(["Huile", "Litres", "Interventions", "Part", "Répartition"], D.byH.length ? D.byH.map(r => [r.huile, pnb(Math.round(r.v)) + " L", pnb(r.n), D.tot ? Math.round(r.v / D.tot * 100) + " %" : "", { content: "", v: r.v }]) : [["Aucune consommation sur la période", "", "", "", ""]],
    Object.assign({ columnStyles: { 1: { halign: "right", fontStyle: "bold", cellWidth: 24 }, 2: { halign: "right", cellWidth: 24 }, 3: { halign: "right", cellWidth: 16 }, 4: { cellWidth: 62 } } }, barCell(4, maxH)));
  // 2. par entretien
  section("2. Entretiens réalisés par type");
  tbl(["Type d'entretien", "Nombre", "Litres", "Litres / intervention"], D.byE.map(r => [r.type, pnb(r.n), pnb(Math.round(r.v)) + " L", r.n ? pnb(Math.round(r.v / r.n * 10) / 10) + " L" : "–"]), { columnStyles: { 1: { halign: "right" }, 2: { halign: "right", fontStyle: "bold" }, 3: { halign: "right" } } });
  // 3. top engins
  section("3. Engins les plus consommateurs (top 15)");
  const maxE = Math.max(1, ...D.top.map(o => o.v));
  tbl(["#", "Code", "Engin", "Litres", "Interv.", "Vidanges", "Fuites", ""], D.top.length ? D.top.slice(0, 15).map((o, i) => [i + 1, o.engin, C.label(o.engin), pnb(Math.round(o.v)) + " L", pnb(o.n), pnb(o.vid), o.fuites ? pnb(o.fuites) : "", { content: "", v: o.v }]) : [["", "", "Aucune consommation", "", "", "", "", ""]],
    Object.assign({ columnStyles: { 0: { cellWidth: 7, halign: "center" }, 1: { cellWidth: 16, fontStyle: "bold" }, 3: { halign: "right", fontStyle: "bold", cellWidth: 18 }, 4: { halign: "right", cellWidth: 13 }, 5: { halign: "right", cellWidth: 19 }, 6: { halign: "right", cellWidth: 14, textColor: [184, 50, 42], fontStyle: "bold" }, 7: { cellWidth: 34 } } }, barCell(7, maxE)));
  // 4. mensuel (graphique)
  section("4. Consommation mensuelle");
  if (y > 220) { doc.addPage(); head(); y = 33; section("4. Consommation mensuelle (suite)"); }
  const ch = 46, mx = Math.max(1, ...D.monthly.map(x => x.v)), n = Math.max(1, D.monthly.length), bw = CW / n;
  doc.setDrawColor(200); doc.line(M, y + ch, M + CW, y + ch);
  D.monthly.forEach((x, i) => { const hgt = x.v / mx * (ch - 8), bx = M + i * bw + bw * 0.18; if (x.v) { doc.setFillColor(...H_PETROL); doc.rect(bx, y + ch - hgt, bw * 0.64, hgt, "F"); doc.setFontSize(6.8); doc.setTextColor(60); doc.text(pnb(Math.round(x.v)), bx + bw * 0.32, y + ch - hgt - 1.2, { align: "center" }); }
    doc.setFontSize(6.8); doc.setTextColor(100); doc.text(x.label, bx + bw * 0.32, y + ch + 4, { align: "center" }); });
  y += ch + 11; doc.setTextColor(30);
  // 5. fuites
  section("5. Fuites répétées (2 fuites ou plus)");
  tbl(["Code", "Engin", "Fuites", "Litres (toutes interventions)", "Dernière intervention"], D.fuites.length ? D.fuites.map(o => [o.engin, C.label(o.engin), pnb(o.fuites), pnb(Math.round(o.v)) + " L", fD(o.last)]) : [["", "Aucune fuite répétée sur la période", "", "", ""]], { columnStyles: { 2: { halign: "right", fontStyle: "bold", textColor: [184, 50, 42] }, 3: { halign: "right" } } });
  // 6. stock et mouvements
  section("6. Stock magasin (état actuel) et mouvements de la période");
  tbl(["Huile", "Fûts en stock", "Litres en stock", "Statut", "Fûts reçus", "Fûts sortis", "Litres consommés"], D.Hs.map(o => { const m = D.mvt.find(x => x.huile === o.huile) || {}; return [o.huile, pnb(o.futsMag), pnb(Math.round(o.litMag)) + " L", hStatut(o), pnb(m.recus || 0), pnb(m.sortis || 0), pnb(Math.round(m.litres || 0)) + " L"]; }),
    { columnStyles: { 1: { halign: "right", fontStyle: "bold" }, 2: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } }, didParseCell: d => { if (d.section === "body" && d.column.index === 3) { const v = d.cell.raw; d.cell.styles.fontStyle = "bold"; d.cell.styles.textColor = v === "RUPTURE" ? [184, 50, 42] : v === "ALERTE" ? [176, 110, 0] : [44, 122, 75]; } } });
  // 7. contrôle
  section("7. Contrôle magasin / atelier");
  tbl(["Atelier", "Huile", "Écart (consommé au-delà de l'huile sortie)"], D.ecarts.length ? D.ecarts.map(a => [a.atelier, a.huile, pnb(Math.round(a.ec)) + " L"]) : [["Aucun écart", "", "Les consommations déclarées sont couvertes par les fûts sortis du magasin"]], { columnStyles: { 2: { fontStyle: D.ecarts.length ? "bold" : "normal" } } });
  const pages = doc.getNumberOfPages(); for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(130); doc.text((S.params.nom_chantier || "") + " – Rapport gestion des huiles", M, 290); doc.text("page " + p + "/" + pages, W - M, 290, { align: "right" }); }
  doc.save("Rapport_huiles_" + (f || "debut") + "_" + (to || today()) + ".pdf");
}
async function hReportXls() {
  await loadScript("vendor/exceljs.min.js");
  const [f, to] = hFilterPeriod(), D = hDashData(f, to, S.f.hHuile), wb = new ExcelJS.Workbook(); wb.creator = APPNAME;
  const PET = "FF0F4C5C", thin = { style: "thin", color: { argb: "FFC9D3D6" } }, bd = { top: thin, left: thin, bottom: thin, right: thin };
  const hdr = (ws, r, cols) => { const row = ws.getRow(r); cols.forEach((t, i) => { const c = row.getCell(i + 1); c.value = t; c.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 10 }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PET } }; c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; c.border = bd; }); row.height = 30; };
  const put = (ws, r, vals, fmts = {}) => { const row = ws.getRow(r); vals.forEach((v, i) => { const c = row.getCell(i + 1); c.value = v; c.font = { name: "Arial", size: 10 }; c.border = bd; if (fmts[i]) c.numFmt = fmts[i]; if (typeof v === "number") c.alignment = { horizontal: "right" }; }); };
  const title = (ws, t, span) => { ws.mergeCells(1, 1, 1, span); const c = ws.getCell(1, 1); c.value = t; c.font = { name: "Arial", bold: true, size: 15, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PET } }; c.alignment = { vertical: "middle", indent: 1 }; ws.getRow(1).height = 28;
    ws.mergeCells(2, 1, 2, span); const s = ws.getCell(2, 1); s.value = (S.params.nom_chantier || "") + "  ·  Période : " + hPerLabel(f, to) + (D.hu ? "  ·  Huile : " + D.hu : "") + "  ·  édité le " + new Date().toLocaleDateString("fr-FR"); s.font = { name: "Arial", italic: true, size: 10, color: { argb: "FF5B6B73" } }; };
  const sec = (ws, r, t, span) => { ws.mergeCells(r, 1, r, span); const c = ws.getCell(r, 1); c.value = t.toUpperCase(); c.font = { name: "Arial", bold: true, size: 11, color: { argb: PET } }; c.border = { bottom: { style: "medium", color: { argb: PET } } }; ws.getRow(r).height = 20; };
  const L = "#,##0.0\" L\"", I = "#,##0";
  // --- Synthèse
  const ws = wb.addWorksheet("Synthèse", { views: [{ showGridLines: false }], pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
  ws.columns = [{ width: 24 }, { width: 42 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 16 }, { width: 16 }];
  title(ws, "RAPPORT – GESTION DES HUILES", 7); let r = 4;
  const K = [["Litres consommés", D.tot, L], ["Interventions", D.cons.length, I], ["Engins servis", D.engins, I], ["Fûts reçus (BL)", D.futsRecus, I], ["Fûts sortis vers ateliers", D.futsSortis, I], ["Huiles en alerte / rupture", D.alertes.length, I]];
  sec(ws, r++, "Indicateurs clés", 7); K.forEach(([l, v, fm]) => { const a = ws.getCell(r, 1), b = ws.getCell(r, 3); ws.mergeCells(r, 1, r, 2); a.value = l; a.font = { name: "Arial", size: 10 }; b.value = v; b.numFmt = fm; b.font = { name: "Arial", bold: true, size: 11, color: { argb: PET } }; [a, b].forEach(c => c.border = bd); r++; }); r++;
  sec(ws, r++, "1. Consommation par type d'huile", 7); hdr(ws, r++, ["Huile", "", "Litres", "Interventions", "Part"]); ws.mergeCells(r - 1, 1, r - 1, 2); const r1 = r;
  D.byH.forEach(x => { put(ws, r, [x.huile, "", x.v, x.n, D.tot ? x.v / D.tot : 0], { 2: L, 3: I, 4: "0%" }); ws.mergeCells(r, 1, r, 2); r++; }); if (!D.byH.length) { put(ws, r, ["Aucune consommation sur la période"]); r++; }
  if (D.byH.length) ws.addConditionalFormatting({ ref: "C" + r1 + ":C" + (r - 1), rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF9CC9D3" }, gradient: false }] }); r++;
  sec(ws, r++, "2. Entretiens réalisés par type", 7); hdr(ws, r++, ["Type d'entretien", "", "Nombre", "Litres", "L / intervention"]); ws.mergeCells(r - 1, 1, r - 1, 2);
  D.byE.forEach(x => { put(ws, r, [x.type, "", x.n, x.v, x.n ? x.v / x.n : 0], { 2: I, 3: L, 4: L }); ws.mergeCells(r, 1, r, 2); r++; }); r++;
  sec(ws, r++, "3. Engins les plus consommateurs (top 15)", 7); hdr(ws, r++, ["Code engin", "Engin", "Litres", "Interventions", "Vidanges", "Fuites", "Remises à niveau"]); const r3 = r;
  D.top.slice(0, 15).forEach(o => { put(ws, r, [o.engin, C.label(o.engin), o.v, o.n, o.vid, o.fuites, o.niv], { 2: L, 3: I, 4: I, 5: I, 6: I }); if (o.fuites >= 2) ws.getCell(r, 6).font = { name: "Arial", bold: true, color: { argb: "FFB8322A" } }; r++; });
  if (D.top.length) ws.addConditionalFormatting({ ref: "C" + r3 + ":C" + (r - 1), rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF9CC9D3" }, gradient: false }] }); r++;
  sec(ws, r++, "4. Consommation mensuelle", 7); hdr(ws, r++, ["Mois", "", "Litres", "Interventions"]); ws.mergeCells(r - 1, 1, r - 1, 2); const r4 = r;
  D.monthly.forEach(x => { put(ws, r, [x.long, "", x.v, x.n], { 2: L, 3: I }); ws.mergeCells(r, 1, r, 2); r++; });
  if (D.monthly.length) ws.addConditionalFormatting({ ref: "C" + r4 + ":C" + (r - 1), rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF9CC9D3" }, gradient: false }] }); r++;
  sec(ws, r++, "5. Fuites répétées (2 fuites ou plus)", 7); hdr(ws, r++, ["Code engin", "Engin", "Fuites", "Litres", "Dernière"]);
  if (D.fuites.length) D.fuites.forEach(o => { put(ws, r, [o.engin, C.label(o.engin), o.fuites, o.v, isoToDate(o.last)], { 2: I, 3: L, 4: "dd/mm/yyyy" }); r++; }); else { put(ws, r, ["Aucune fuite répétée"]); r++; } r++;
  sec(ws, r++, "6. Stock magasin (état actuel) – seuil d'alerte " + hSeuilTxt().replace(/[\u202f\u00a0]/g, " "), 7); hdr(ws, r++, ["Huile", "", "Fûts en stock", "Litres en stock", "Statut", "Fûts reçus (période)", "Fûts sortis (période)"]); ws.mergeCells(r - 1, 1, r - 1, 2);
  D.Hs.forEach(o => { const m = D.mvt.find(x => x.huile === o.huile) || {}, st = hStatut(o); put(ws, r, [o.huile, "", o.futsMag, o.litMag, st, m.recus || 0, m.sortis || 0], { 2: I, 3: L, 5: I, 6: I }); ws.mergeCells(r, 1, r, 2);
    const c = ws.getCell(r, 5); c.alignment = { horizontal: "center" }; c.font = { name: "Arial", bold: true, color: { argb: st === "RUPTURE" ? "FFB8322A" : st === "ALERTE" ? "FFB06E00" : "FF2C7A4B" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: st === "RUPTURE" ? "FFFBE3E1" : st === "ALERTE" ? "FFFFF1D6" : "FFE3F2E8" } }; r++; }); r++;
  sec(ws, r++, "7. Contrôle magasin / atelier", 7); hdr(ws, r++, ["Atelier", "Huile", "Écart (L)"]);
  if (D.ecarts.length) D.ecarts.forEach(a => { put(ws, r, [a.atelier, a.huile, a.ec], { 2: L }); ws.getCell(r, 3).font = { name: "Arial", bold: true, color: { argb: "FFB8322A" } }; r++; }); else { put(ws, r, ["Aucun écart", "Consommations couvertes par les fûts sortis"]); r++; }
  // --- feuilles de détail
  const detail = (name, cols, rows, widths) => { const s = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }], pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    s.columns = widths.map(w => ({ width: w })); hdr(s, 1, cols.map(c => c[0])); rows.forEach((v, i) => put(s, i + 2, v, Object.fromEntries(cols.map((c, j) => [j, c[1]]).filter(x => x[1])))); s.autoFilter = { from: "A1", to: { row: Math.max(1, rows.length + 1), column: cols.length } }; };
  detail("Consommation", [["Date", "dd/mm/yyyy"], ["Code engin"], ["Engin"], ["Huile"], ["Entretien"], ["Quantité", L], ["Atelier"], ["Compteur", I], ["Observations"]],
    D.cons.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(c => [isoToDate(c.date), c.engin, C.label(c.engin), c.huile, c.entretien, c.qte, c.atelier, c.compteur ?? null, c.obs]), [12, 12, 34, 16, 16, 12, 18, 11, 30]);
  detail("Entrées fûts", [["Date", "dd/mm/yyyy"], ["Huile"], ["Fûts BC", I], ["Fûts BL", I], ["L / fût", I], ["Litres livrés", L], ["N° BC"], ["N° BL"], ["Fournisseur"]],
    D.ents.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(e => [isoToDate(e.date), e.huile, e.bc ?? null, e.bl ?? null, e.cont, N(e.bl) * e.cont, e.numBc, e.numBl, e.fourn]), [12, 16, 10, 10, 9, 14, 16, 16, 22]);
  detail("Bons de sortie", [["Date", "dd/mm/yyyy"], ["N° bon de sortie"], ["Huile"], ["Atelier"], ["Fûts", I], ["Litres", L], ["Observations"]],
    D.sors.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(s => [isoToDate(s.date), s.numBs, s.huile, s.atelier, s.futs, s.futs * s.cont, s.obs]), [12, 18, 16, 18, 9, 12, 30]);
  saveBlob(new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Rapport_huiles_" + (f || "debut") + "_" + (to || today()) + ".xlsx");
}


/* petites barres horizontales (une seule série, une teinte) */
function hBars(rows, opt) { const max = Math.max(1, ...rows.map(r => r.v));
  if (!rows.length) return '<div class="empty">' + esc(opt.empty || "Aucune donnée sur la période.") + "</div>";
  return '<div class="hbars">' + rows.map(r => '<div class="hb" title="' + esc(r.label + " : " + opt.fmt(r.v) + (r.tip ? " · " + r.tip : "")) + '"><span class="hb-l">' + r.labelHtml + '</span><span class="hb-t"><i style="width:' + Math.max(1.5, r.v / max * 100).toFixed(1) + '%"></i></span><span class="hb-v">' + esc(opt.fmt(r.v)) + (r.sub ? ' <small>' + esc(r.sub) + "</small>" : "") + "</span></div>").join("") + "</div>"; }
function hMonths(cons) { const now = new Date(), ms = []; for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); ms.push(ymd(d).slice(0, 7)); }
  const v = ms.map(m => cons.filter(c => (c.date || "").slice(0, 7) === m).reduce((t, c) => t + c.qte, 0)), max = Math.max(1, ...v);
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  return '<div class="vbars">' + ms.map((m, i) => '<div class="vb" title="' + esc(MOIS[+m.slice(5) - 1] + " " + m.slice(0, 4) + " : " + L_(v[i])) + '"><span class="vb-v">' + (v[i] ? esc(nb(Math.round(v[i]))) : "") + '</span><span class="vb-t"><i style="height:' + (v[i] ? Math.max(2, v[i] / max * 100) : 0).toFixed(1) + '%"></i></span><span class="vb-l">' + MOIS[+m.slice(5) - 1] + "</span></div>").join("") + "</div>"; }

const H_TABS = () => [["stock", "Stock"], ["ent", "Entrées fûts (BC / BL)"], ["sor", "Sorties (bon de sortie)"], ["conso", "Consommation engins"], S.isAdmin && ["alim", "Alimentation atelier"]].filter(Boolean);
const hTab = () => { const t = S.f.hTab || "stock"; return H_TABS().some(x => x[0] === t) ? t : "stock"; };
VIEWS.huiles = { title: () => "Suivi huiles – " + (H_TABS().find(t => t[0] === hTab()) || [, ""])[1],
  tools() { const t = hTab();
    let h = '<div class="subtabs">' + H_TABS().map(([k, l]) => '<button class="btn" data-htab="' + k + '" aria-pressed="' + (k === t) + '">' + l + "</button>").join("") + "</div>";
    const hSel = '<select id="h-h"><option value="">Toutes les huiles</option>' + (t === "conso" || t === "alim" ? huilesConso() : huilesList()).map(x => '<option' + (x === S.f.hHuile ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select>";
    if (t === "ent") h += '<div class="tools">' + searchF("h-q", S.f.hQ, "BC, BL, fournisseur…") + field("h-h", "Huile", hSel) + '<span class="grow"></span><button class="btn" data-act="h-xls" data-k="ent">Exporter Excel</button>' + (S.canWrite ? '<button class="btn" data-act="imp-h_ent">Importer Excel</button><button class="btn primary" data-act="h-new-ent">+ Entrée de fûts</button>' : "") + "</div>";
    if (t === "sor") h += '<div class="tools">' + searchF("h-q", S.f.hQ, "N° bon de sortie, atelier…") + field("h-h", "Huile", hSel) + '<span class="grow"></span><button class="btn" data-act="h-xls" data-k="sor">Exporter Excel</button>' + (S.canWrite ? '<button class="btn" data-act="imp-h_sor">Importer Excel</button><button class="btn primary" data-act="h-new-sor">+ Bon de sortie</button>' : "") + "</div>";
    if (t === "conso") h += '<div class="tools">' + searchF("h-q", S.f.hQ, "Code engin, entretien…") + field("h-h", "Huile", hSel) + field("h-f", "Du", '<input id="h-f" type="date" value="' + esc(S.f.hFrom) + '">') + field("h-t", "Au", '<input id="h-t" type="date" value="' + esc(S.f.hTo) + '">') +
      '<span class="grow"></span><button class="btn" data-act="h-xls" data-k="conso">Exporter Excel</button>' + (S.canWrite ? '<button class="btn" data-act="imp-h_con">Importer Excel</button><button class="btn primary" data-act="h-new-con">+ Consommation</button>' : "") + "</div>";
    if (t === "alim") h += '<div class="tools">' + field("h-h", "Huile", hSel) +
      '<label class="chk" style="align-self:flex-end;margin-bottom:8px"><input type="checkbox" id="h-vides"' + (S.f.hVides ? " checked" : "") + '> Afficher les fûts vides</label><span class="grow"></span><button class="btn" data-act="h-xls" data-k="alim">Exporter Excel</button><button class="btn primary" data-act="h-new-dep">+ Fût déjà ouvert en atelier</button></div>';
    if (t === "stock") h += '<div class="tools"><span class="grow muted">Magasin : fûts livrés (BL) − fûts sortis (bons de sortie). Atelier : litres reçus − litres consommés.</span><button class="btn" data-act="h-xls" data-k="stock">Exporter Excel</button></div>';
    return h; },
  bind() { const hh = $("#h-h"); if (hh) hh.onchange = e => { S.f.hHuile = e.target.value; render(); };
    const hv = $("#h-vides"); if (hv) hv.onchange = e => { S.f.hVides = e.target.checked; render(); };
    const q = $("#h-q"); if (q) q.oninput = e => { S.f.hQ = e.target.value; render(); };
    ["h-f", "h-t"].forEach(id => { const el = $("#" + id); if (el) el.onchange = () => { S.f.hFrom = $("#h-f").value; S.f.hTo = $("#h-t").value; render(); }; }); },
  rows(k) { const q = norm(S.f.hQ), hu = S.f.hHuile;
    if (k === "ent") return [...S.hEnt.values()].filter(e => !e.depart && (!hu || e.huile === hu) && (!q || norm([e.numBc, e.numBl, e.fourn, e.obs, e.huile].join(" ")).includes(q))).sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
    if (k === "sor") return [...S.hSor.values()].filter(s => !s.depart && (!hu || s.huile === hu) && (!q || norm([s.numBs, s.atelier, s.obs, s.huile].join(" ")).includes(q))).sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
    return [...S.hCon.values()].filter(c => (!hu || c.huile === hu) && inPeriod(c.date, S.f.hFrom, S.f.hTo) && (!q || norm([c.engin, C.label(c.engin), c.entretien, c.atelier, c.obs, c.huile].join(" ")).includes(q))).sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id); },
  body() { const t = hTab(), H = hCompute();
    const acts = (k, d) => (S.isAdmin || (S.canWrite && d.createdBy === S.uid)) ? '<div class="rowact"><button class="btn small" data-act="h-edit" data-k="' + k + '" data-id="' + d.id + '">Modifier</button><button class="btn small danger" data-act="h-del" data-k="' + k + '" data-id="' + d.id + '">Suppr.</button></div>' : "";
    if (t === "stock") { const rows = [...H.values()];
      let h = '<div class="panel"><h3>Stock magasin <small>par type d\'huile</small></h3>' + table([{ h: "Huile", f: o => "<b>" + esc(o.huile) + "</b>" }, { h: "Stock de départ", n: 1, f: o => nb(o.futsDep) }, { h: "Fûts en stock", n: 1, f: o => '<b class="' + (hStatut(o) !== "OK" ? "reste" : "") + '">' + nb(o.futsMag) + "</b>" }, { h: "Litres en stock", n: 1, f: o => L_(o.litMag) },
        { h: "Statut", f: o => pill(hStatut(o)) }], rows) + '<p class="hint">ALERTE quand il reste ' + esc(hSeuilTxt()) + " ou moins (seuils réglables dans Paramètres), RUPTURE à 0.</p></div>";
      return h; }
    if (t === "alim") return S.isAdmin ? hAlimBody() : "";
    if (t === "ent") { const r = this.rows("ent"); return '<div class="more">' + r.length + " ligne(s) · " + nb(r.reduce((s, e) => s + N(e.bl), 0)) + " fût(s) livré(s). Seuls les fûts livrés (BL) entrent en stock.</div>" + table([{ h: "Date", f: e => fD(e.date) }, { h: "Huile", f: e => "<b>" + esc(e.huile) + "</b>" },
      { h: "Fûts BC", n: 1, f: e => nb(e.bc) }, { h: "Fûts BL", n: 1, f: e => nb(e.bl) }, { h: "Reste", n: 1, f: e => { const x = N(e.bc) - N(e.bl); return x > 0 ? '<span class="reste">' + nb(x) + "</span>" : ""; } }, { h: "L / fût", n: 1, f: e => nb(e.cont) }, { h: "Litres livrés", n: 1, f: e => L_(N(e.bl) * e.cont) },
      { h: "N° BC", f: e => mono(e.numBc) }, { h: "N° BL", f: e => mono(e.numBl) }, { h: "Fournisseur", f: e => esc(e.fourn) }, { h: "Observations", f: e => esc(e.obs) }, { h: "Saisi par", f: e => who(e.createdBy) }, { h: "", f: e => acts("ent", e) }], r, { empty: "Aucune entrée de fûts." }); }
    if (t === "sor") { const r = this.rows("sor"); return '<div class="more">' + r.length + " bon(s) de sortie · " + nb(r.reduce((s, x) => s + x.futs, 0)) + " fût(s) sorti(s) vers les ateliers.</div>" + table([{ h: "Date", f: s => fD(s.date) }, { h: "N° bon de sortie", f: s => mono(s.numBs) }, { h: "Huile", f: s => "<b>" + esc(s.huile) + "</b>" },
      { h: "Atelier", f: s => esc(s.atelier) }, { h: "Fûts", n: 1, f: s => "<b>" + nb(s.futs) + "</b>" }, { h: "Litres", n: 1, f: s => L_(s.futs * s.cont) }, { h: "Observations", f: s => esc(s.obs) }, { h: "Saisi par", f: s => who(s.createdBy) }, { h: "", f: s => acts("sor", s) }], r, { empty: "Aucun bon de sortie." }); }
    if (t === "conso") { const r = this.rows("conso"); return '<div class="more">' + r.length + " intervention(s) · " + L_(r.reduce((s, c) => s + c.qte, 0)) + " consommé(s)</div>" + table([{ h: "Date", f: c => fD(c.date) }, { h: "Code engin", f: c => mono(c.engin) }, { h: "Engin", f: c => esc(C.label(c.engin)) },
      { h: "Huile", f: c => "<b>" + esc(c.huile) + "</b>" }, { h: "Entretien", f: c => '<span class="pill ' + (c.entretien === "Fuite" ? "p-crit" : c.entretien === "Vidange" ? "p-info" : "p-warn") + '">' + esc(c.entretien) + "</span>" }, { h: "Qté", n: 1, f: c => "<b>" + L_(c.qte) + "</b>" },
      { h: "Atelier", f: c => esc(c.atelier) }, { h: "Compteur", n: 1, f: c => nb(c.compteur) }, { h: "Observations", f: c => esc(c.obs) }, { h: "Saisi par", f: c => who(c.createdBy) }, { h: "", f: c => acts("con", c) }], r, { empty: "Aucune consommation." }); }
    return ""; } };
document.addEventListener("change", e => { if (e.target.id === "h-at") { S.f.hAt = e.target.value; render(); } if (e.target.id === "h-eng-h") { S.f.hEngH = e.target.value; render(); } if (e.target.id === "h-eng") { S.f.hEng = e.target.value.trim().split(/\s+[–-]\s+/)[0]; render(); const i = $("#h-eng"); if (i) i.focus(); } });
document.addEventListener("click", e => { const b = e.target.closest("[data-htab]"); if (!b) return; S.f.hTab = b.dataset.htab; S.f.hQ = ""; render(true); });

/* ---------- alimentation atelier : fûts sortis du magasin (ou déjà ouverts) et leur consommation, fût par fût ---------- */
const hAteliers = () => { const L = (S.params.ateliers || []).slice(); for (const s of S.hSor.values()) if (s.atelier && !L.includes(s.atelier)) L.push(s.atelier); return L; };
const daysBetween = (a, b) => a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 864e5)) : 0;
/* chaque bon de sortie de n fûts = n fûts ; la consommation de l'atelier est imputée aux fûts dans l'ordre de mise en service (premier entré, premier consommé) */
function hFuts() {
  const G = new Map(), g = (at, h) => { const k = at + "|" + h; if (!G.has(k)) G.set(k, { atelier: at, huile: h, futs: [], depasse: 0, cons: [] }); return G.get(k); };
  const sors = [...S.hSor.values()].sort((a, b) => (b.depart - a.depart) || (a.date || "").localeCompare(b.date || "") || a.id - b.id);
  for (const s of sors) { if (isGraisse(s.huile)) continue; const o = g(s.atelier || "Non précisé", s.huile), cap1 = s.depart ? s.litres : s.cont; let n = s.futs, i = 0;
    while (n > 1e-9) { const part = Math.min(1, n); i++; o.futs.push({ src: s, atelier: o.atelier, huile: o.huile, date: s.date, cap: cap1 * part, cont: s.cont * part, cons: 0, engins: new Set(), n: 0, last: "",
      label: s.depart ? "Fût ouvert (avant l'application)" : "BS " + (s.numBs || "#" + s.id) + (s.futs > 1 ? " · fût " + i + "/" + Math.ceil(s.futs) : "") }); n -= part; } }
  const cons = [...S.hCon.values()].sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id - b.id);
  for (const c of cons) { if (isGraisse(c.huile)) continue; const o = g(c.atelier || "Non précisé", c.huile); o.cons.push(c); let q = c.qte;
    for (const u of o.futs) { if (q <= 1e-9) break; const r = u.cap - u.cons; if (r <= 1e-9) continue; const t = Math.min(r, q); u.cons += t; q -= t; u.engins.add(c.engin); u.n++; if ((c.date || "") > u.last) u.last = c.date; }
    if (q > 1e-9) o.depasse += q; }
  const t = today(), d30 = ymd(new Date(Date.now() - 30 * 864e5)), futs = [];
  for (const o of G.values()) { o.reste = 0; o.actifs = 0; o.pleins = 0; o.vides = 0;
    for (const u of o.futs) { u.grp = o; u.reste = Math.max(0, u.cap - u.cons); u.pct = u.cont ? Math.min(100, u.reste / u.cont * 100) : 0; /* niveau réel : reste ÷ contenance */ u.statut = u.reste <= 0.5 ? "Vide" : (u.cons > 0 || u.src.depart ? "En cours" : "Plein (non entamé)"); /* un fût déjà ouvert est entamé */
      u.jours = daysBetween(u.date, u.statut === "Vide" ? (u.last || t) : t); o.reste += u.reste; if (u.statut === "Vide") o.vides++; else if (u.statut === "En cours") o.actifs++; else o.pleins++; futs.push(u); }
    o.c30 = o.cons.filter(c => (c.date || "") >= d30).reduce((s, c) => s + c.qte, 0); o.moyJ = o.c30 / 30; o.autonomie = o.moyJ > 0 ? o.reste / o.moyJ : null;
    const vid = o.futs.filter(u => u.statut === "Vide" && u.jours > 0); o.dureeMoy = vid.length ? vid.reduce((s, u) => s + u.jours, 0) / vid.length : null; }
  return { groups: [...G.values()].sort((a, b) => a.atelier.localeCompare(b.atelier) || a.huile.localeCompare(b.huile)), futs };
}
const hAlimFilter = u => (!S.f.hAt || u.atelier === S.f.hAt) && (!S.f.hHuile || u.huile === S.f.hHuile) && (S.f.hVides || u.statut !== "Vide");
const hBar = pct => '<span class="fbar" title="' + Math.round(pct) + ' % restant"><i style="width:' + Math.max(0, Math.min(100, pct)).toFixed(0) + "%;background:" + (pct <= 15 ? "var(--crit)" : pct <= 40 ? "var(--warn, #d89614)" : "var(--ok, #2e8b57)") + '"></i></span> ' + Math.round(pct) + " %";
function hAlimBody() {
  const { groups, futs } = hFuts(), Gs = groups.filter(o => !S.f.hHuile || o.huile === S.f.hHuile), U = futs.filter(hAlimFilter);
  const actifs = Gs.reduce((t, o) => t + o.actifs, 0), pleins = Gs.reduce((t, o) => t + o.pleins, 0), reste = Gs.reduce((t, o) => t + o.reste, 0), c30 = Gs.reduce((t, o) => t + o.c30, 0), dep = Gs.filter(o => o.depasse > 0.5);
  let h = '<div class="kpis">' + kpi("Fûts entamés", nb(actifs), "acc") + kpi("Fûts pleins en atelier", nb(pleins)) + kpi("Litres restants en atelier", L_(reste), "txt") + kpi("Consommé (30 derniers jours)", L_(c30), "txt") + kpi("Fûts vidés", nb(Gs.reduce((t, o) => t + o.vides, 0))) + "</div>";
  h += dep.length ? '<div class="banner crit">⚠ Consommation non couverte par des fûts : ' + dep.map(o => esc(o.atelier) + " · " + esc(o.huile) + " : " + L_(o.depasse)).join(" ; ") + ". Il manque un bon de sortie ou un fût ouvert, ou une consommation est mal saisie.</div>"
    : (Gs.length ? '<div class="banner ok">✔ Toute la consommation déclarée est couverte par les fûts sortis vers les ateliers.</div>' : '<div class="banner info">Aucun fût en atelier. Saisissez les fûts déjà ouverts (bouton « + Fût déjà ouvert en atelier »), puis les bons de sortie et les consommations.</div>');
  const low = Gs.filter(o => o.autonomie !== null && o.autonomie < 7 && o.reste > 0); if (low.length) h += '<div class="banner crit">⏱ Bientôt à court (moins de 7 jours au rythme des 30 derniers jours) : ' + low.map(o => esc(o.atelier) + " · " + esc(o.huile) + " (≈ " + nb(Math.round(o.autonomie)) + " j)").join(" ; ") + ". Prévoir un bon de sortie.</div>";
  const atList = hAteliers(); if (S.f.hAt && !atList.includes(S.f.hAt)) S.f.hAt = "";
  const atSel = '<select id="h-at" style="width:auto;min-width:220px"><option value="">Tous les ateliers</option>' + atList.map(x => "<option" + (x === S.f.hAt ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select>";
  h += '<div class="panel"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px"><h3 style="margin:0">Fûts en atelier <small>' + U.length + " fût(s) · " + L_(U.reduce((t, u) => t + u.reste, 0)) + ' restant(s)</small></h3><span class="grow"></span><label class="muted" for="h-at" style="font-size:12px;text-transform:uppercase;letter-spacing:.05em">Atelier</label>' + atSel + "</div>" +
    table([].concat(S.f.hAt ? [] : [{ h: "Atelier", f: u => "<b>" + esc(u.atelier) + "</b>" }], [{ h: "Huile", f: u => "<b>" + esc(u.huile) + "</b>" }, { h: "Mis en service", f: u => fD(u.date) },
      { h: "Consommé", n: 1, f: u => L_(u.cons) }, { h: "Reste", n: 1, f: u => "<b>" + L_(u.reste) + "</b>" }, { h: "Niveau", f: u => hBar(u.pct) },
      { h: "Engins servis", n: 1, f: u => '<span title="' + esc([...u.engins].join(", ")) + '">' + nb(u.engins.size) + "</span>" },
      { h: "Moyenne / jour", n: 1, f: u => u.grp.moyJ ? L_(u.grp.moyJ) : '<span class="muted">–</span>' }, { h: "Durée moy. d'un fût", n: 1, f: u => u.grp.dureeMoy === null ? '<span class="muted">–</span>' : nb(Math.round(u.grp.dureeMoy)) + " j" }]),
      U.slice().sort((a, b) => a.atelier.localeCompare(b.atelier) || a.huile.localeCompare(b.huile) || (a.date || "").localeCompare(b.date || "")), { empty: "Aucun fût en cours" + (S.f.hAt ? " à l'" + S.f.hAt.toLowerCase() : "") + (S.f.hVides ? "" : " (cochez « Afficher les fûts vides » pour l'historique)") + "." }) + "</div>";
  h += hDepartPanel(futs);
  h += hEnginConsoPanel();
  return h + '<p class="hint">La consommation de chaque atelier est imputée aux fûts dans l\'ordre de mise en service : les fûts déjà ouverts d\'abord, puis les bons de sortie par date. Niveau = reste ÷ contenance du fût. Un fût est vide quand il reste moins de 0,5 L. Les fûts déjà ouverts ne sont pas comptés dans le stock magasin. Moyenne / jour = consommation de cette huile dans l\'atelier sur les 30 derniers jours ÷ 30. Durée moy. d\'un fût = nombre de jours moyen entre la mise en service et la dernière consommation des fûts vidés. Autonomie = litres restants ÷ moyenne / jour.</p>';
}
/* stock de départ : fûts déjà entamés en atelier au démarrage, valeurs modifiables */
function hDepartPanel(futs) {
  const D = futs.filter(u => u.src.depart && (!S.f.hAt || u.atelier === S.f.hAt) && (!S.f.hHuile || u.huile === S.f.hHuile))
    .sort((a, b) => a.atelier.localeCompare(b.atelier) || a.huile.localeCompare(b.huile) || a.src.id - b.src.id);
  const tot = D.reduce((t, u) => t + u.cap, 0);
  return '<div class="panel"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px"><h3 style="margin:0">Stock de départ – fûts entamés <small>' + D.length + " fût(s) · " + L_(tot) + " au départ" + (S.f.hAt ? " · " + esc(S.f.hAt) : "") + '</small></h3><span class="grow"></span><button class="btn small primary" data-act="h-new-dep">+ Fût déjà ouvert</button></div>' +
    table([{ h: "Atelier", f: u => "<b>" + esc(u.atelier) + "</b>" }, { h: "Huile", f: u => "<b>" + esc(u.huile) + "</b>" }, { h: "Date de saisie", f: u => fD(u.date) },
      { h: "Contenance (L)", n: 1, f: u => '<input class="dep-cont" data-id="' + u.src.id + '" type="number" min="1" step="any" value="' + esc(u.src.cont) + '" style="width:85px;text-align:right">' },
      { h: "Quantité au départ (L)", n: 1, f: u => '<input class="dep-l" data-id="' + u.src.id + '" type="number" min="0" step="any" value="' + esc(u.src.litres) + '" style="width:95px;text-align:right">' },
      { h: "Consommé depuis", n: 1, f: u => L_(u.cons) }, { h: "Reste actuel", n: 1, f: u => "<b>" + L_(u.reste) + "</b>" },
      { h: "", f: u => '<div class="rowact"><button class="btn small primary" data-act="dep-save" data-id="' + u.src.id + '">Enregistrer</button><button class="btn small" data-act="h-edit" data-k="dep" data-id="' + u.src.id + '">Modifier</button><button class="btn small danger" data-act="h-del" data-k="dep" data-id="' + u.src.id + '">Suppr.</button></div>' }],
      D, { empty: "Aucun fût entamé saisi au départ." }) + '<p class="hint">Corrigez la contenance ou la quantité au départ puis cliquez « Enregistrer » ; « Modifier » permet aussi de changer l\'atelier, l\'huile ou la date. Le reste et le niveau sont recalculés aussitôt.</p></div>';
}
async function depSave(id) { const s0 = S.hSor.get(id); if (!s0) return;
  const c = +String($('.dep-cont[data-id="' + id + '"]').value).replace(",", "."), l = +String($('.dep-l[data-id="' + id + '"]').value).replace(",", ".");
  if (!(c > 0)) { toast("Contenance invalide."); return; } if (!(l > 0)) { toast("Quantité au départ invalide."); return; } if (l > c) { toast("La quantité au départ dépasse la contenance du fût."); return; }
  const r = await must(sb.from("huile_sorties").update({ contenance: c, litres: l }).eq("id", id).select()); if (!r.length) { toast("Modification refusée."); return; }
  S.hSor.set(id, mapHS(r[0])); schedule(); toast("Fût " + s0.huile + " (" + s0.atelier + ") : " + nb(l) + " L sur " + nb(c) + " L enregistrés."); }
/* consommation d'un engin : totaux par huile, nombre d'interventions par type, historique */
function hEnginConsoPanel() {
  const all = [...S.hCon.values()], codes = [...new Set(all.map(c => c.engin).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const sel = '<input id="h-eng" list="dl-h-eng" value="' + esc(S.f.hEng || "") + '" placeholder="Écrire ou choisir le code engin" autocomplete="off" style="width:auto;min-width:260px"><datalist id="dl-h-eng">' + codes.map(c => '<option value="' + esc(c) + '">' + esc(C.label(c) || "") + "</option>").join("") + "</datalist>";
  let h = '<div class="panel"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px"><h3 style="margin:0">Consommation par engin</h3><span class="grow"></span><label class="muted" for="h-eng" style="font-size:12px;text-transform:uppercase;letter-spacing:.05em">Engin</label>' + sel + "</div>";
  if (!codes.length) return h + '<div class="empty">Aucune consommation saisie pour l\'instant.</div></div>';
  if (!S.f.hEng) return h + '<div class="empty">Écrivez ou choisissez un code engin pour voir sa consommation d\'huile et son historique.</div></div>';
  if (!codes.includes(S.f.hEng)) return h + '<div class="empty">' + (C.engMap.has(S.f.hEng) ? "Aucune consommation d'huile saisie pour l'engin " + esc(S.f.hEng) + " (" + esc(C.label(S.f.hEng)) + ")." : "Code engin « " + esc(S.f.hEng) + " » inconnu.") + "</div></div>";
  h = h.replace('<h3 style="margin:0">Consommation par engin</h3>', '<h3 style="margin:0">Consommation par engin <small>' + esc(S.f.hEng + (C.label(S.f.hEng) ? " – " + C.label(S.f.hEng) : "")) + "</small></h3>");
  const L = all.filter(c => c.engin === S.f.hEng).sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id), cnt = t => L.filter(c => c.entretien === t).length;
  h += '<div class="kpis">' + kpi("Total consommé", L_(L.reduce((t, c) => t + c.qte, 0)), "txt") + kpi("Vidanges", nb(cnt("Vidange"))) + kpi("Fuites", nb(cnt("Fuite")), cnt("Fuite") ? "crit" : "") + kpi("Remises à niveau", nb(cnt("Remise à niveau"))) + kpi("Interventions", nb(L.length)) + "</div>";
  const byH = [...new Set(L.map(c => c.huile))].map(hu => { const X = L.filter(c => c.huile === hu), n = t => X.filter(c => c.entretien === t).length; return { huile: hu, tot: X.reduce((t, c) => t + c.qte, 0), vid: n("Vidange"), fui: n("Fuite"), niv: n("Remise à niveau"), last: X[0].date }; }).sort((a, b) => b.tot - a.tot);
  h += "<h4>Total par huile</h4>" + table([{ h: "Huile", f: o => "<b>" + esc(o.huile) + "</b>" }, { h: "Total consommé", n: 1, f: o => "<b>" + L_(o.tot) + "</b>" }, { h: "Vidange", n: 1, f: o => nb(o.vid) }, { h: "Fuite", n: 1, f: o => o.fui ? '<span class="reste">' + nb(o.fui) + "</span>" : "0" }, { h: "Remise à niveau", n: 1, f: o => nb(o.niv) }, { h: "Dernière conso", f: o => fD(o.last) }], byH);
  const hus = [...new Set(L.map(c => c.huile))].sort(); if (S.f.hEngH && !hus.includes(S.f.hEngH)) S.f.hEngH = "";
  const LH = S.f.hEngH ? L.filter(c => c.huile === S.f.hEngH) : L;
  h += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:14px 0 6px"><h4 style="margin:0">Historique de consommation <small class="muted">' + LH.length + " intervention(s) · " + L_(LH.reduce((t, c) => t + c.qte, 0)) + '</small></h4><span class="grow"></span><label class="muted" for="h-eng-h" style="font-size:12px;text-transform:uppercase;letter-spacing:.05em">Type d\'huile</label><select id="h-eng-h" style="width:auto;min-width:180px"><option value="">Toutes les huiles</option>' +
    hus.map(x => "<option" + (x === S.f.hEngH ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select></div>" + table([{ h: "Date", f: c => fD(c.date) }, { h: "Huile", f: c => "<b>" + esc(c.huile) + "</b>" }, { h: "Entretien", f: c => '<span class="pill ' + (c.entretien === "Fuite" ? "p-crit" : c.entretien === "Vidange" ? "p-info" : "p-warn") + '">' + esc(c.entretien) + "</span>" },
    { h: "Quantité", n: 1, f: c => "<b>" + L_(c.qte) + "</b>" }, { h: "Atelier", f: c => esc(c.atelier) || '<span class="muted">–</span>' }, { h: "Compteur", n: 1, f: c => nb(c.compteur) }, { h: "Observations", f: c => esc(c.obs) }, { h: "Saisi par", f: c => who(c.createdBy) }], LH, { limit: 500 });
  return h + "</div>";
}
function hDepForm(d) { const isNew = !d; d = d || { date: today(), huile: S.f.hHuile || huilesList()[0], atelier: S.f.hAt || (S.params.ateliers || [])[0], cont: 208, litres: "" };
  const ov = modal(isNew ? "Fût déjà ouvert en atelier" : "Modifier le fût ouvert", '<p class="muted" style="margin-top:0">Pour un fût déjà entamé avant l\'utilisation de l\'application. Il n\'est pas déduit du stock magasin ; la consommation des engins sera imputée sur ce fût en premier.</p><div class="fgrid">' +
    F("hd-date", "Date de la saisie", '<input id="hd-date" type="date" value="' + esc(d.date) + '">') + F("hd-at", "Atelier *", atelierSel("hd-at", d.atelier)) + F("hd-h", "Type d'huile *", huileSel("hd-h", d.huile)) +
    F("hd-cont", "Contenance du fût (litres)", '<input id="hd-cont" type="number" min="1" step="any" value="' + esc(d.cont) + '">') + F("hd-l", "Litres restants dans le fût *", '<input id="hd-l" type="number" min="0" step="any" value="' + esc(d.litres || "") + '" placeholder="estimation, ex. 120">') +
    (isNew ? F("hd-n", "Nombre de fûts identiques", '<input id="hd-n" type="number" min="1" step="1" value="1"><div class="hint">Plusieurs fûts de la même huile avec le même reste.</div>') : "") + F("hd-obs", "Observations", '<input id="hd-obs" value="' + esc(d.obs || "") + '">', "full") + "</div>",
    async ov => { const l = fnum(ov, "hd-l"), cont = fnum(ov, "hd-cont") || 208, n = isNew ? Math.round(fnum(ov, "hd-n") || 1) : 1;
      if (!(l > 0)) return "Saisissez les litres restants dans le fût."; if (l > cont) return "Les litres restants dépassent la contenance du fût."; if (!(n >= 1)) return "Nombre de fûts invalide.";
      const row = { date: fv(ov, "hd-date") || today(), atelier: fv(ov, "hd-at"), huile: fv(ov, "hd-h"), futs: 1, contenance: cont, litres: l, source: "depart", obs: fv(ov, "hd-obs") || "Fût ouvert avant l'application" };
      if (!isNew) return hSave("huile_sorties", mapHS, S.hSor, d, row, "Fût ouvert");
      const r = await must(sb.from("huile_sorties").insert(Array.from({ length: n }, () => Object.assign({}, row))).select()); r.forEach(x => S.hSor.set(x.id, mapHS(x))); schedule(); toast(n + " fût(s) ouvert(s) enregistré(s) à l'" + row.atelier.toLowerCase() + "."); }, isNew ? "Enregistrer" : "Enregistrer");
}

/* ---------- formulaires huiles ---------- */
const isGraisse = h => /^EP\s*\d/i.test(String(h || "").trim());   // EP0, EP2 : graisses, sans suivi de consommation par engin ni fûts en atelier
const huilesConso = () => huilesList().filter(h => !isGraisse(h));
const huileSel = (id, v, list) => '<select id="' + id + '">' + (list || huilesList()).map(x => "<option" + (x === v ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select>";
const atelierSel = (id, v) => { const L = (S.params.ateliers || ["ATELIER FIXE", "ATELIER MOBILE G", "ATELIER MOBILE S"]).slice(); if (v && !L.includes(v)) L.push(v); return '<select id="' + id + '">' + L.map(x => "<option" + (x === v ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select>"; };
async function hSave(table, map, store, d, row, label) {
  if (!d.id) { const r = await must(sb.from(table).insert(row).select().single()); store.set(r.id, map(r)); toast(label + " enregistré(e)."); }
  else { const r = await must(sb.from(table).update(row).eq("id", d.id).select()); if (!r.length) return "Modification refusée : vos droits ne le permettent pas."; store.set(r[0].id, map(r[0])); toast(label + " modifié(e)."); }
  schedule(); }
function hEntForm(d) { d = d || { date: today(), huile: S.f.hHuile || huilesList()[0] }; if (!d.id) d.cont = lastCont(d.huile);
  const ov = modal(d.id ? "Modifier l'entrée de fûts" : "Entrée de fûts au magasin", '<div class="fgrid">' + F("he-date", "Date", '<input id="he-date" type="date" value="' + esc(d.date) + '">') + F("he-h", "Type d'huile *", huileSel("he-h", d.huile)) +
    F("he-bc", "Fûts demandés (BC)", '<input id="he-bc" type="number" min="0" step="any" value="' + esc(d.bc ?? "") + '">') + F("he-bl", "Fûts livrés (BL)", '<input id="he-bl" type="number" min="0" step="any" value="' + esc(d.bl ?? "") + '"><div class="hint">Vide = pas encore livré.</div>') +
    F("he-cont", "Contenance d'un fût (litres) *", '<input id="he-cont" type="number" min="1" step="any" value="' + esc(d.cont) + '">') + F("he-nbc", "N° BC", '<input id="he-nbc" value="' + esc(d.numBc) + '">') + F("he-nbl", "N° BL", '<input id="he-nbl" value="' + esc(d.numBl) + '">') +
    F("he-f", "Fournisseur", '<input id="he-f" list="dl-fourn" value="' + esc(d.fourn) + '">') + F("he-obs", "Observations", '<input id="he-obs" value="' + esc(d.obs) + '">', "full") + "</div>",
    async ov => { const bc = fnum(ov, "he-bc"), bl = fnum(ov, "he-bl"), cont = fnum(ov, "he-cont"); if (bc === null && bl === null) return "Saisissez les fûts demandés (BC) ou livrés (BL)."; if ((bc ?? 0) < 0 || (bl ?? 0) < 0) return "Quantités négatives impossibles."; if (!(cont > 0)) return "Saisissez la contenance d'un fût.";
      return hSave("huile_entrees", mapHE, S.hEnt, d, { date: fv(ov, "he-date"), huile: fv(ov, "he-h"), futs_bc: bc, futs_bl: bl, contenance: cont, num_bc: fv(ov, "he-nbc") || null, num_bl: fv(ov, "he-nbl") || null, fournisseur: fv(ov, "he-f") || null, obs: fv(ov, "he-obs") || null }, "Entrée de fûts"); });
  ov.querySelector("#he-h").addEventListener("change", e => { if (!d.id) ov.querySelector("#he-cont").value = lastCont(e.target.value); }); }
function hSorForm(d) { d = d || { date: today(), huile: S.f.hHuile || huilesList()[0], atelier: (S.params.ateliers || [])[0], futs: 1 }; if (!d.id) d.cont = lastCont(d.huile);
  const ov = modal(d.id ? "Modifier le bon de sortie" : "Bon de sortie magasin → atelier", '<div class="fgrid">' + F("hs-date", "Date", '<input id="hs-date" type="date" value="' + esc(d.date) + '">') + F("hs-num", "N° bon de sortie", '<input id="hs-num" value="' + esc(d.numBs) + '">') +
    F("hs-h", "Type d'huile *", huileSel("hs-h", d.huile)) + F("hs-at", "Atelier *", atelierSel("hs-at", d.atelier)) + F("hs-n", "Nombre de fûts *", '<input id="hs-n" type="number" min="0" step="any" value="' + esc(d.futs) + '">') +
    F("hs-cont", "Contenance d'un fût (litres) *", '<input id="hs-cont" type="number" min="1" step="any" value="' + esc(d.cont) + '">') + F("hs-obs", "Observations", '<input id="hs-obs" value="' + esc(d.obs) + '" placeholder="ex. fût précédent vide">', "full") + '<div class="hint full" id="hs-info"></div></div>',
    async ov => { const n = fnum(ov, "hs-n"), cont = fnum(ov, "hs-cont"); if (!(n > 0)) return "Saisissez le nombre de fûts."; if (!(cont > 0)) return "Saisissez la contenance d'un fût.";
      return hSave("huile_sorties", mapHS, S.hSor, d, { date: fv(ov, "hs-date"), huile: fv(ov, "hs-h"), atelier: fv(ov, "hs-at"), futs: n, contenance: cont, num_bs: fv(ov, "hs-num") || null, obs: fv(ov, "hs-obs") || null }, "Bon de sortie"); });
  const upd = () => { const h = ov.querySelector("#hs-h").value, o = hCompute().get(h) || { futsMag: 0 }, n = N(ov.querySelector("#hs-n").value) - (d.id && d.huile === h ? d.futs : 0);
    ov.querySelector("#hs-info").innerHTML = "Stock magasin " + esc(h) + " : <b>" + nb(o.futsMag) + " fût(s)</b>" + (n > o.futsMag ? ' – <span class="reste">⚠ sortie supérieure au stock (entrée BL manquante ?)</span>' : ""); if (!d.id) ov.querySelector("#hs-cont").value = lastCont(h); };
  ["hs-h", "hs-n"].forEach(id => ov.querySelector("#" + id).addEventListener("input", upd)); ov.querySelector("#hs-h").addEventListener("change", upd); upd(); }
function hConForm(d) { d = d || { date: today(), huile: S.f.hHuile || huilesList()[0], entretien: "Vidange", atelier: S.f.hLastAt || (S.params.ateliers || [])[0] };
  const ov = modal(d.id ? "Modifier la consommation" : "Consommation d'huile sur un engin", '<div class="fgrid">' + F("hc-date", "Date", '<input id="hc-date" type="date" value="' + esc(d.date) + '">') + F("hc-eng", "Code engin *", '<input id="hc-eng" list="dl-engins" value="' + esc(d.engin) + '">') +
    F("hc-h", "Type d'huile *", huileSel("hc-h", isGraisse(d.huile) ? huilesConso()[0] : d.huile, huilesConso())) + F("hc-e", "Type d'entretien *", '<select id="hc-e">' + ENTRETIENS.map(x => "<option" + (x === d.entretien ? " selected" : "") + ">" + x + "</option>").join("") + "</select>") +
    F("hc-q", "Quantité (litres) *", '<input id="hc-q" type="number" min="0" step="any" value="' + esc(d.qte ?? "") + '">') + F("hc-at", "Atelier *", atelierSel("hc-at", d.atelier)) + F("hc-cpt", "Compteur (h / km)", '<input id="hc-cpt" type="number" min="0" step="any" value="' + esc(d.compteur ?? "") + '">') +
    F("hc-obs", "Observations", '<input id="hc-obs" value="' + esc(d.obs) + '">', "full") + '<div class="hint full" id="hc-info"></div></div>',
    async ov => { const eng = fv(ov, "hc-eng"), q = fnum(ov, "hc-q"); if (!eng) return "Saisissez le code engin."; if (!C.engMap.has(eng)) return "Code engin inconnu : choisissez-le dans la liste."; if (!(q > 0)) return "Saisissez la quantité en litres.";
      S.f.hLastAt = fv(ov, "hc-at");
      return hSave("huile_conso", mapHC, S.hCon, d, { date: fv(ov, "hc-date"), engin: eng, huile: fv(ov, "hc-h"), entretien: fv(ov, "hc-e"), qte: q, atelier: fv(ov, "hc-at"), compteur: fnum(ov, "hc-cpt"), obs: fv(ov, "hc-obs") || null }, "Consommation"); });
  const upd = () => { const h = ov.querySelector("#hc-h").value, a = ov.querySelector("#hc-at").value, o = hCompute().get(h), x = o && o.at.get(a), eng = ov.querySelector("#hc-eng").value.trim();
    ov.querySelector("#hc-info").innerHTML = (eng && C.engMap.has(eng) ? esc(eng + " – " + C.label(eng)) + " · " : "") + "Reste estimé " + esc(h) + " à l'" + esc(a.toLowerCase()) + " : <b>" + L_(x ? x.recu - x.conso : 0) + "</b>"; };
  ["hc-h", "hc-at", "hc-eng"].forEach(id => ov.querySelector("#" + id).addEventListener("change", upd)); upd(); }
const H_KIND = { dep: ["huile_sorties", () => S.hSor, hDepForm, "ce fût ouvert"], ent: ["huile_entrees", () => S.hEnt, hEntForm, "cette entrée de fûts"], sor: ["huile_sorties", () => S.hSor, hSorForm, "ce bon de sortie"], con: ["huile_conso", () => S.hCon, hConForm, "cette consommation"] };
function hExport(k) { const R = VIEWS.huiles.rows.bind(VIEWS.huiles);
  if (k === "ent") return xls("Huiles_entrees_" + today() + ".xlsx", "Entrées fûts", R("ent").map(e => ({ "Date": fD(e.date), "Huile": e.huile, "Fûts BC": e.bc ?? "", "Fûts BL": e.bl ?? "", "L / fût": e.cont, "Litres livrés": N(e.bl) * e.cont, "N° BC": e.numBc, "N° BL": e.numBl, "Fournisseur": e.fourn, "Observations": e.obs, "Saisi par": nameOf(e.createdBy) })));
  if (k === "sor") return xls("Huiles_bons_sortie_" + today() + ".xlsx", "Bons de sortie", R("sor").map(s => ({ "Date": fD(s.date), "N° bon de sortie": s.numBs, "Huile": s.huile, "Atelier": s.atelier, "Fûts": s.futs, "Litres": s.futs * s.cont, "Observations": s.obs, "Saisi par": nameOf(s.createdBy) })));
  if (k === "alim") { const F_ = hFuts(); return xls("Huiles_alimentation_ateliers_" + today() + ".xlsx", "Fûts en atelier", F_.futs.filter(hAlimFilter).map(u => ({ "Atelier": u.atelier, "Huile": u.huile, "Fût": u.label, "Mis en service le": fD(u.date), "Contenance (L)": u.cont, "Quantité au départ": u.cap, "Consommé (L)": u.cons, "Reste (L)": u.reste, "Reste (%)": Math.round(u.pct), "Statut": u.statut, "Engins servis": u.engins.size, "Interventions": u.n, "Dernière conso": fD(u.last), "Durée (jours)": u.jours }))); }
  if (k === "conso") return xls("Huiles_consommation_" + today() + ".xlsx", "Consommation", R("conso").map(c => ({ "Date": fD(c.date), "Code engin": c.engin, "Engin": C.label(c.engin), "Huile": c.huile, "Entretien": c.entretien, "Quantité (L)": c.qte, "Atelier": c.atelier, "Compteur": c.compteur ?? "", "Observations": c.obs, "Saisi par": nameOf(c.createdBy) })));
  const H = hCompute(); return xls("Huiles_stock_" + today() + ".xlsx", "Stock huiles", [...H.values()].map(o => ({ "Huile": o.huile, "Fûts en stock magasin": o.futsMag, "Litres en stock magasin": o.litMag, "Fûts commandés non livrés": o.futsAtt, "Litres en atelier (estimé)": o.reste, "Litres consommés (total)": o.conso }))); }

/* ---------- actions ---------- */
document.addEventListener("click", async e => { const b = e.target.closest("[data-act]"); if (!b) return; const a = b.dataset.act, id = b.dataset.id;
  try {
    if (a === "new-entree") return entreeForm();
    if (a === "da-new") return daForm(null);
    if (a === "h-new-ent") return hEntForm(null);
    if (a === "h-new-sor") return hSorForm(null);
    if (a === "h-new-con") return hConForm(null);
    if (a === "h-new-dep") return S.isAdmin && hDepForm(null);
    if (a === "dep-save") return S.isAdmin && await depSave(+id);
    if (a === "h-xls") return hExport(b.dataset.k);
    if (a === "h-rap-pdf") { toast("Préparation du rapport PDF…"); return await hReportPdf(); }
    if (a === "h-rap-xls") return await hReportXls();
    if (a === "imp-h_ent" || a === "imp-h_sor" || a === "imp-h_con") return importDialog(a.slice(4));
    if (a === "h-edit" || a === "h-del") { const K = H_KIND[b.dataset.k], d = K && K[1]().get(+id); if (!d) return;
      if (a === "h-edit") return K[2](Object.assign({}, d));
      return confirmBox("Supprimer " + K[3] + " du " + fD(d.date) + " ?", async () => { const r = await must(sb.from(K[0]).delete().eq("id", d.id).select()); if (!r.length) throw new Error("permission denied"); K[1]().delete(d.id); schedule(); toast("Ligne supprimée."); }); }
    if (a === "da-imp") return daImportDialog();
    if (a === "da-tpl") { const l = document.createElement("a"); l.href = "modeles/Canevas_DA.xlsx"; l.download = "Canevas_DA.xlsx"; document.body.appendChild(l); l.click(); l.remove(); return; }
    if (a === "da-notif") { await Notification.requestPermission(); render(true); return; }
    if (a === "bc-xls-all") { const r = VIEWS.suivibc.rows(); if (!r.length) { toast("Aucun BC à exporter."); return; } return await bcExcel(r, "Suivi_BC_" + today() + ".xlsx"); }
    if (["bc-view", "bc-pdf", "bc-xls", "bc-edit", "bc-solde", "bc-del", "bl-start"].includes(a)) { const b = S.bc.get(+id); if (!b) return; const d = S.da.get(b.da) || {};
      if (a === "bc-view") return bcView(b);
      if (a === "bc-pdf") return await bcPdf(b);
      if (a === "bc-xls") return await bcExcel([b], "BC_" + fileSafe(b.num) + "_DA_" + fileSafe(d.numero || "") + ".xlsx");
      if (!S.canNumDA) return;
      if (a === "bl-start") return blStart(b);
      if (a === "bc-edit") return blsOf(b.id).length ? toast("Ce BC a déjà des livraisons : il ne peut plus être modifié.") : bcForm(d, b);
      if (a === "bc-solde") return bcSoldeForm(b);
      if (a === "bc-del") { if (blsOf(b.id).length) { toast("Ce BC a déjà des livraisons : il ne peut pas être supprimé."); return; }
        return confirmBox("Supprimer le BC " + b.num + " ? Les articles redeviennent « à commander » sur la DA " + (d.numero || "") + ".", async () => {
          const r = await must(sb.from("bc").delete().eq("id", b.id).select()); if (!r.length) throw new Error("permission denied"); bclOf(b.id).forEach(x => S.bcl.delete(x.id)); S.bc.delete(b.id); schedule(); toast("BC " + b.num + " supprimé."); }); } }
    if ((a.startsWith("da-") || a === "bc-start") && a !== "da-xls-all") { const d = S.da.get(+id); if (!d) return;
      if (a === "da-view") return daView(d);
      if (a === "bc-start") return bcStart(d);
      if (a === "da-clot") return S.canNumDA && daClotForm(d);
      if (a === "da-reopen") return S.canNumDA && modal("Rouvrir la DA " + d.numero, "<p>Les articles non commandés redeviennent « à commander » et la DA revient dans « Suivi DA ».</p>", async () => {
        const r = await must(sb.from("da").update({ cloture_motif: null }).eq("id", d.id).select().single()); S.da.set(r.id, mapDA(r)); schedule(); toast("DA " + d.numero + " rouverte."); }, "Rouvrir");
      if (a === "da-devis") return canViewDevis(d) && await openDevis(d);
      if (a === "da-edit") return canEditDA(d) && daForm(d);
      if (a === "da-num") return S.canNumDA && daNumForm(d);
      if (a === "da-del") return confirmBox("Supprimer la demande d'achat #" + d.id + " (" + daLines(d.id).length + " ligne(s)) ?", async () => { const r = await must(sb.from("da").delete().eq("id", d.id).select()); if (!r.length) throw new Error("permission denied"); if (d.devisPath) sb.storage.from("devis").remove([d.devisPath]).catch(() => {}); S.da.delete(d.id); daLines(d.id).forEach(l => S.daL.delete(l.id)); schedule(); toast("Demande supprimée."); });
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
    if (a === "save-params") { const P = { nom_chantier: $("#pa-nom").value.trim() }; ["types", "huiles", "interventions", "ateliers", "unites"].forEach(k => P[k] = $("#pa-" + k).value.split("\n").map(s => s.trim()).filter(Boolean)); P.seuil = N($("#pa-seuil").value); P.seuil_huile = N($("#pa-seuilh").value); P.seuils_huile = {}; for (const ln of $("#pa-seuilsh").value.split("\n")) { const m = ln.match(/^(.+?)\s*[=:]\s*(\d+(?:[.,]\d+)?)\s*$/); if (m) P.seuils_huile[m[1].trim()] = +m[2].replace(",", "."); }
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
    if (a === "xls-ent") return xls("Entrees_" + S.f.cat + "_" + today() + ".xlsx", "Entrées", VIEWS.entrees.rows().map(x => ({ "Catégorie": catName(x.cat), "Date": fD(x.date), "Référence": x.ref, "Désignation / type": x.type, "Marque": x.marque, "Réf. équivalentes": x.equiv, "Qté demandée (BC)": x.dem ?? "", "Qté livrée (BL)": x.liv ?? "", "Reste à livrer": x.reste || "", "N° BC": x.bc, "N° BL": x.bl, "Fournisseur": x.fourn, "Engin destinataire": x.engin || "", "Observations": x.obs, "Saisi par": x.createdBy ? nameOf(x.createdBy) : "Import" })));
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
  else if (table === "huile_entrees") S.hEnt.set(row.id, mapHE(row)); else if (table === "huile_sorties") S.hSor.set(row.id, mapHS(row)); else if (table === "huile_conso") S.hCon.set(row.id, mapHC(row));
  schedule(table === "engins");
}
function applyHeader() { $("#app-chantier").textContent = S.params.nom_chantier || ""; }
let tmr = null, pFull = false;
function schedule(full) { pFull = pFull || !!full; if (tmr) return; tmr = setTimeout(() => { tmr = null; const f = pFull; pFull = false; if (!S.loaded) return; compute(); fillLists(); render(f); }, 120); }
function fillLists() {
  $("#dl-refs").innerHTML = C.refs.map(r => { const i = C.info(r); return '<option value="' + esc(r) + '">' + esc((i.cat === "PDR" ? "PDR · " : "") + i.type) + "</option>"; }).join("");
  $("#dl-engins").innerHTML = [...S.engins.values()].map(e => '<option value="' + esc(e.code) + '">' + esc([e.designation, e.marque, e.modele].filter(Boolean).join(" ")) + "</option>").join("");
  const t = new Set(S.params.types || []); C.lines.forEach(l => l.type && t.add(l.type)); $("#dl-types").innerHTML = [...t].map(x => '<option value="' + esc(x) + '">').join("");
  const fo = new Set(); C.ent.forEach(e => e.fourn && fo.add(e.fourn)); $("#dl-fourn").innerHTML = [...fo].sort().map(x => '<option value="' + esc(x) + '">').join("");
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
  S.canDA = ["admin", "gestionnaire", "magasinier", "saisie"].includes(me.role); S.canCreateDA = S.canDA; S.canNumDA = ["admin", "magasinier"].includes(me.role); S.lastSeen = me.last_seen || null; touchVisit();
  $("#me-box").innerHTML = '<span class="who">' + avatar(S.uid) + '<span class="nm">' + esc(me.nom || me.identifiant) + "</span></span>" + '<span class="role ' + (S.isAdmin ? "admin" : "") + '">' + esc(ROLE_FR[me.role]) + '</span><button class="btn small" data-act="logout">Déconnexion</button>';
  try { const v = localStorage.getItem("fc-view"); if (v && canSee(v)) S.view = v; else if (!S.isAdmin) S.view = "stock"; const c = localStorage.getItem("fc-cat"); if (c === "PDR" || c === "FILTRE") S.f.cat = c; } catch (_) {}
  const [eng, dep, ent, sor, par, jr] = await Promise.all([fetchAll("engins", "code"), fetchAll("stock_depart", "id"), fetchAll("entrees", "id"), fetchAll("sorties", "id"),
    must(sb.from("params").select("*").eq("id", 1).maybeSingle()), must(sb.from("journal").select("*").order("at", { ascending: false }).limit(1000))]);
  S.engins = new Map(eng.map(r => [String(r.code), mapG(r)])); S.depart = new Map(dep.map(r => [r.id, mapD(r)])); S.entrees = new Map(ent.map(r => [r.id, mapE(r)])); S.sorties = new Map(sor.map(r => [r.id, mapS(r)]));
  if (par) S.params = Object.assign(S.params, par); S.journal = jr; applyHeader();
  { const [he, hs, hc] = await Promise.all([fetchAll("huile_entrees", "id"), fetchAll("huile_sorties", "id"), fetchAll("huile_conso", "id")]);
    S.hEnt = new Map(he.map(r => [r.id, mapHE(r)])); S.hSor = new Map(hs.map(r => [r.id, mapHS(r)])); S.hCon = new Map(hc.map(r => [r.id, mapHC(r)])); }
  if (S.canDA) { const [da, dl] = await Promise.all([fetchAll("da", "id"), fetchAll("da_lignes", "id")]); S.da = new Map(da.map(r => [r.id, mapDA(r)])); S.daL = new Map(dl.map(r => [r.id, mapDL(r)]));
    const [bc, bcl, bl, bll] = await Promise.all(["bc", "bc_lignes", "bl", "bl_lignes"].map(t => fetchAll(t, "id")));
    S.bc = new Map(bc.map(r => [r.id, mapBC(r)])); S.bcl = new Map(bcl.map(r => [r.id, mapBCL(r)])); S.bl = new Map(bl.map(r => [r.id, mapBL(r)])); S.bll = new Map(bll.map(r => [r.id, mapBLL(r)])); }
  S.loaded = true; compute(); fillLists(); render(true);
  sb.channel("filtres").on("postgres_changes", { event: "*", schema: "public" }, p => {
    const t = p.table, row = p.new, old = p.old;
    if (t === "journal") { if (p.eventType === "INSERT") { S.journal.unshift(row); if (S.journal.length > 1500) S.journal.length = 1500; if (row.user_id !== S.uid && (row.table_name === "entrees" || row.table_name === "sorties") && row.action === "insert") notifyInsert(row); renderNav(); if (S.view === "dash" || S.view === "journal") schedule(); } return; }
    if (t === "profiles") { loadProfiles().then(() => schedule()); return; }
    if (t === "da") { if (S.canDA) onDaChange(p); return; }
    if (["bc", "bc_lignes", "bl", "bl_lignes"].includes(t)) { if (S.canDA) onBcChange(t, p); return; }
    if (t === "da_lignes") { if (S.canDA) { if (p.eventType === "DELETE") S.daL.delete(old.id); else S.daL.set(row.id, mapDL(row)); schedule(); } return; }
    if (t === "params") { if (row) { S.params = Object.assign(S.params, row); applyHeader(); schedule(true); } return; }
    const maps = { entrees: [S.entrees, mapE], sorties: [S.sorties, mapS], stock_depart: [S.depart, mapD], huile_entrees: [S.hEnt, mapHE], huile_sorties: [S.hSor, mapHS], huile_conso: [S.hCon, mapHC] };
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
