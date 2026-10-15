// ── BarOS Table — langues (Français / English) ────────────────
// Traduit toute la page (textes fixes et messages qui apparaissent ensuite)
// avec un dictionnaire ; les noms des articles utilisent le champ "nom_en".
(function () {
  'use strict';
  var EN = {
    'Chargement de votre table…': 'Loading your table…',
    '● Libre': '● Free', '● Occupée': '● Occupied', '● Réservée': '● Reserved',
    'Appel envoyé': 'Call sent', "En attente d'une réponse…": 'Waiting for a reply…',
    'Que puis-je faire pour vous ?': 'How can we help you?',
    'Appeler une serveuse': 'Call a waitress', 'Assistance immédiate': 'Immediate help',
    "Demander l'addition": 'Ask for the bill', 'Paiement à table': 'Pay at the table',
    'Passer une commande': 'Place an order', 'Articles & boissons': 'Items & drinks',
    'Envoyer un message': 'Send a message', 'Demande spéciale': 'Special request',
    '💳 Payer ma commande': '💳 Pay my order', 'Par Mobile Money': 'By Mobile Money',
    'Propulsé par BarOS · Votre bar connecté': 'Powered by BarOS · Your connected bar',
    'Annuler': 'Cancel', '✓ Envoyer': '✓ Send', 'Fermer': 'Close',
    'Notre menu': 'Our menu', 'Tous': 'All', 'Autres': 'Other',
    'Chargement du menu…': 'Loading the menu…', 'Aucun article disponible.': 'No item available.',
    'Menu indisponible. Appelez une serveuse.': 'Menu unavailable. Please call a waitress.',
    '✓ Envoyer la commande': '✓ Send the order', 'Envoi…': 'Sending…',
    'Payer ma commande': 'Pay my order', 'Payer plus tard': 'Pay later',
    "✓ J'ai payé": '✓ I have paid', 'Choisissez votre moyen de paiement': 'Choose your payment method',
    'QR invalide': 'Invalid QR', 'Table introuvable': 'Table not found', 'Table inactive': 'Inactive table',
    "Ce lien ne contient pas d'identifiant de table.": 'This link has no table identifier.',
    'Ce QR code ne correspond à aucune table enregistrée.': 'This QR code does not match any registered table.',
    "Cette table n'est pas disponible pour le moment.": 'This table is not available right now.',
    'Appel envoyé ! 🔔': 'Call sent! 🔔', 'Appel terminé. Merci !': 'Call completed. Thank you!',
    'Cet appel a été annulé.': 'This call was cancelled.', 'Annulé': 'Cancelled',
    'Pris en charge ✓': 'Taken care of ✓', 'Traité ✅': 'Done ✅',
    'Un appel est déjà en cours': 'A call is already in progress',
    'Un appel est déjà en cours pour cette table': 'A call is already in progress for this table',
    'Une serveuse arrive bientôt…': 'A waitress is coming soon…', 'Une serveuse est en route !': 'A waitress is on her way!',
    '✅ Appel traité. Merci !': '✅ Call handled. Thank you!', '✓ Votre appel a été pris en charge !': '✓ Your call has been taken care of!',
    'Hors-ligne — reconnexion…': 'Offline — reconnecting…',
    'Votre panier est vide': 'Your basket is empty',
    'Envoi impossible — vérifiez votre connexion': 'Could not send — check your connection',
    'Menu indisponible — vérifiez votre connexion': 'Menu unavailable — check your connection',
    'Paiement envoyé — en attente de validation par la caisse ✅': 'Payment sent — waiting for the cashier to confirm ✅',
    'Aucune commande à payer': 'No order to pay',
    "Le paiement mobile n'est pas encore activé ici. Réglez auprès de la serveuse.": 'Mobile payment is not enabled here yet. Please pay the waitress.',
    'Entrez un numéro de téléphone valide': 'Enter a valid phone number',
    'Précision (ex : bien glacée, sans glaçon…)': 'Note (e.g. very cold, no ice…)',
    'Ex: 1 Heineken, 2 Fanta, 1 plateau fromages…': 'E.g. 1 Heineken, 2 Fanta, 1 cheese platter…',
    'Votre numéro de téléphone': 'Your phone number',
    'Référence de la transaction (reçue par SMS)': 'Transaction reference (received by SMS)',
    'Allergènes': 'Allergens',
    'Bienvenue !': 'Welcome!', 'Bienvenue': 'Welcome',
    'Présentez-vous pour profiter de votre niveau de fidélité et être servi plus vite.': 'Introduce yourself to enjoy your loyalty level and get served faster.',
    'Votre nom': 'Your name', 'Entrer': 'Enter', 'Un instant…': 'One moment…', 'Entrez votre nom': 'Enter your name',
    'Accéder à ma table': 'Go to my table', 'Changer': 'Change',
    'Remise 20 %': '20% discount', 'Boisson offerte': 'Free drink', 'Accès zone Platine': 'Platinum zone access',
    'Remise 10 %': '10% discount', 'Accès zone VIP': 'VIP zone access', 'Priorité service': 'Priority service',
    'Remise 5 %': '5% discount', 'Gagnez des points à chaque commande': 'Earn points with every order',
    'Platine': 'Platinum', 'Or': 'Gold', 'Argent': 'Silver'
  };
  var RX = [
    [/^(\d+) articles?$/, function (m) { return m[1] + (m[1] === '1' ? ' item' : ' items'); }],
    [/^Attente : (.*)$/, function (m) { return 'Waiting: ' + m[1]; }],
    [/^Merci de saisir votre (.*)$/, function (m) { return 'Please enter your ' + (m[1] === 'commande' ? 'order' : 'message'); }],
    [/^Commande envoyée ! Total (.*) ✅$/, function (m) { return 'Order sent! Total ' + m[1] + ' ✅'; }],
    [/^Envoyez (.*) au (.*) \((.*)\) depuis votre téléphone, puis saisissez votre numéro et la référence reçue\.$/,
      function (m) { return 'Send ' + m[1] + ' to ' + m[2] + ' (' + m[3] + ') from your phone, then enter your number and the reference you received.'; }],
    [/^✦ (.*)$/, function (m) { return '✦ ' + tr(m[1]); }],
    [/^(\d+) \/ (\d+) pts pour (.*)$/, function (m) { return m[1] + ' / ' + m[2] + ' pts to ' + tr(m[3]); }],
    [/^(\d+) pts · niveau maximum$/, function (m) { return m[1] + ' pts · top level'; }],
    [/^Total à payer : (.*)$/, function (m) { return 'Amount to pay: ' + m[1]; }]
  ];
  var LANG = 'fr', BUSY = false;

  function tr(fr) {
    if (LANG !== 'en' || !fr) return fr;
    var t = String(fr).trim(); if (!t) return fr;
    if (EN[t]) return String(fr).replace(t, EN[t]);
    for (var i = 0; i < RX.length; i++) { var m = t.match(RX[i][0]); if (m) return String(fr).replace(t, RX[i][1](m)); }
    return fr;
  }
  window.tr = tr;
  window.getLang = function () { return LANG; };

  function doText(n) {
    if (n.__en !== undefined && n.nodeValue === n.__en) {           // déjà traduit par nous
      if (LANG === 'fr') { n.nodeValue = n.__fr; n.__en = undefined; }
      return;
    }
    if (LANG !== 'en') return;
    var out = tr(n.nodeValue);
    if (out !== n.nodeValue) { n.__fr = n.nodeValue; n.__en = out; n.nodeValue = out; }
  }
  function doAttr(el) {
    ['placeholder'].forEach(function (a) {
      if (!el.hasAttribute || !el.hasAttribute(a)) return;
      var cur = el.getAttribute(a);
      if (el['__' + a + 'en'] !== undefined && cur === el['__' + a + 'en']) {
        if (LANG === 'fr') { el.setAttribute(a, el['__' + a + 'fr']); el['__' + a + 'en'] = undefined; }
        return;
      }
      if (LANG !== 'en') return;
      var out = tr(cur);
      if (out !== cur) { el['__' + a + 'fr'] = cur; el['__' + a + 'en'] = out; el.setAttribute(a, out); }
    });
  }
  function walk(root) {
    BUSY = true;
    try {
      if (root.nodeType === 3) { doText(root); return; }
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n;
      while ((n = w.nextNode())) { if (n.parentNode && /^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName)) continue; doText(n); }
      if (root.querySelectorAll) { doAttr(root); root.querySelectorAll('[placeholder]').forEach(doAttr); }
    } finally { BUSY = false; }
  }

  function apply(lang) {
    LANG = lang === 'en' ? 'en' : 'fr';
    try { localStorage.setItem('baros_lang', LANG); } catch (e) {}
    document.documentElement.lang = LANG;
    document.querySelectorAll('.lang-btn').forEach(function (b) { b.textContent = LANG === 'en' ? 'FR' : 'EN'; });
    walk(document.body);
    if (typeof cmRender === 'function' && typeof CM_ARTICLES !== 'undefined' && CM_ARTICLES.length) { try { cmRender(); } catch (e) {} }
  }
  window.toggleLang = function () { apply(LANG === 'en' ? 'fr' : 'en'); };

  var mo = new MutationObserver(function (list) {
    if (LANG !== 'en') return;
    list.forEach(function (m) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttr(m.target);
      else m.addedNodes.forEach(function (n) { if (n.nodeType === 1 || n.nodeType === 3) walk(n); });
    });
  });

  function init() {
    var saved = null; try { saved = localStorage.getItem('baros_lang'); } catch (e) {}
    var lang = saved || (/^en/i.test(navigator.language || '') ? 'en' : 'fr');
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder'] });
    apply(lang);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
