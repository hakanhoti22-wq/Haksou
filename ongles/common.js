/* Ongles — code partagé entre la page de réservation (index.html) et l'espace pro (pro.html). */
const O = (() => {
  const O = {};
  const pad = n => String(n).padStart(2, '0');
  O.pad = pad;
  O.toMin = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  O.toHM = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  O.ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  O.parse = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  O.addDays = (s, n) => { const d = O.parse(s); d.setDate(d.getDate() + n); return O.ymd(d); };
  O.diffDays = (a, b) => Math.round((O.parse(b) - O.parse(a)) / 864e5);
  O.today = () => O.ymd(new Date());
  O.nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  O.JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  O.MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  O.MOIS_C = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  O.fmtDate = (s, year) => { const d = O.parse(s); return O.JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + O.MOIS[d.getMonth()] + (year ? ' ' + d.getFullYear() : ''); };
  O.fmtDay = s => { const t = O.today(); if (s === t) return "Aujourd'hui"; if (s === O.addDays(t, 1)) return 'Demain'; return O.fmtDate(s); };
  O.cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  O.fmtDur = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? h + ' h' + (r ? ' ' + pad(r) : '') : r + ' min'; };
  O.fmtPrix = (p, cfg) => { const n = Number(p) || 0; return (Number.isInteger(n) ? n : n.toFixed(2)) + ' ' + ((cfg && cfg.devise) || 'CHF'); };
  O.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  O.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  O.code = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };
  O.normTel = t => String(t || '').replace(/[^\d+]/g, '');
  /** Numéro au format international sans « + » (pour wa.me). */
  O.intl = (t, ind) => {
    let s = O.normTel(t);
    if (s.startsWith('+')) return s.slice(1);
    if (s.startsWith('00')) return s.slice(2);
    if (s.startsWith('0')) return (ind || '41') + s.slice(1);
    return s;
  };
  O.whatsapp = (tel, msg, ind) => 'https://wa.me/' + O.intl(tel, ind) + '?text=' + encodeURIComponent(msg || '');
  O.sms = (tel, msg) => 'sms:' + O.normTel(tel) + '&body=' + encodeURIComponent(msg || '');
  O.toast = (msg, ms) => {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), ms || 2600);
  };

  O.STATUTS = { attente: 'En attente', confirme: 'Confirmé', encours: 'En cours', termine: 'Terminé', absente: 'Absente', annule: 'Annulé' };

  O.DEFAULT_CONFIG = {
    nom: 'Mon Studio Ongles',
    slogan: 'Gel, semi-permanent & nail art 💅',
    adresse: '', telephone: '', instagram: '', devise: 'CHF', indicatif: '41',
    message: "Merci de venir avec des ongles propres, sans vernis. Au-delà de 15 min de retard, le rendez-vous peut être annulé.",
    horaires: { 0: [], 1: [], 2: [['09:00', '12:00'], ['13:30', '18:30']], 3: [['09:00', '12:00'], ['13:30', '18:30']], 4: [['09:00', '12:00'], ['13:30', '18:30']], 5: [['09:00', '12:00'], ['13:30', '18:30']], 6: [['09:00', '15:00']] },
    fermetures: [],
    pas: 15, tampon: 10, delaiMin: 12, joursMax: 45, validation: 'auto', annulationH: 24
  };
  O.DEFAULT_SERVICES = [
    { id: 's1', nom: 'Semi-permanent mains', categorie: 'Mains', duree: 45, prix: 40, description: 'Vernis semi-permanent, tient 2 à 3 semaines.', actif: true },
    { id: 's2', nom: 'Gel sur ongles naturels', categorie: 'Mains', duree: 75, prix: 60, description: 'Renforcement en gel, finition couleur ou naturelle.', actif: true },
    { id: 's3', nom: 'Pose capsules + gel', categorie: 'Mains', duree: 120, prix: 80, description: 'Rallongement avec capsules, forme au choix.', actif: true },
    { id: 's4', nom: 'Remplissage gel', categorie: 'Mains', duree: 90, prix: 55, description: 'Toutes les 3 à 4 semaines.', actif: true },
    { id: 's5', nom: 'Manucure classique', categorie: 'Mains', duree: 30, prix: 30, description: 'Limage, cuticules, soin, sans vernis.', actif: true },
    { id: 's6', nom: 'Semi-permanent pieds', categorie: 'Pieds', duree: 45, prix: 45, description: '', actif: true },
    { id: 's7', nom: 'Dépose', categorie: 'Options', duree: 20, prix: 15, description: 'Retrait du gel ou du semi-permanent.', actif: true },
    { id: 's8', nom: 'Nail art (2 ongles)', categorie: 'Options', duree: 15, prix: 10, description: 'Déco, strass, french, baby boomer…', actif: true }
  ];

  O.withDefaults = cfg => {
    const c = Object.assign({}, O.DEFAULT_CONFIG, cfg || {});
    c.horaires = Object.assign({}, O.DEFAULT_CONFIG.horaires, (cfg && cfg.horaires) || {});
    return c;
  };
  O.isClosed = (cfg, date) => (cfg.fermetures || []).some(f => f.du && date >= f.du && date <= (f.au || f.du));

  /**
   * Créneaux libres pour une durée donnée.
   * busy = [{date, debut, fin}] (RDV non annulés). Même calcul côté Google (apps-script.gs).
   */
  O.slots = (cfg, busy, date, duree, today, nowMin) => {
    const dd = O.diffDays(today, date);
    if (dd < 0 || dd > (Number(cfg.joursMax) || 60) || O.isClosed(cfg, date) || !duree) return [];
    const plages = (cfg.horaires || {})[O.parse(date).getDay()] || [];
    const pas = Number(cfg.pas) || 15, tampon = Number(cfg.tampon) || 0;
    const limite = nowMin + (Number(cfg.delaiMin) || 0) * 60;
    const b = busy.filter(x => x.date === date).map(x => [O.toMin(x.debut), O.toMin(x.fin)]);
    const res = [];
    for (const [s, e] of plages) {
      const S = O.toMin(s), E = O.toMin(e);
      for (let t = S; t + duree <= E; t += pas) {
        if (dd * 1440 + t < limite) continue;
        if (b.some(([bs, be]) => t < be + tampon && bs < t + duree + tampon)) continue;
        res.push(O.toHM(t));
      }
    }
    return res;
  };

  /** Fichier .ics pour ajouter le RDV à l'agenda du téléphone. */
  O.ics = (r, cfg) => {
    const e = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const dt = (d, t) => d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ongles//FR', 'BEGIN:VEVENT',
      'UID:' + r.code + '@ongles', 'DTSTAMP:' + now, 'DTSTART:' + dt(r.date, r.debut), 'DTEND:' + dt(r.date, r.fin),
      'SUMMARY:' + e('💅 ' + cfg.nom), 'DESCRIPTION:' + e(r.prestations + (cfg.message ? '\n\n' + cfg.message : '')),
      'LOCATION:' + e(cfg.adresse),
      'BEGIN:VALARM', 'TRIGGER:-PT3H', 'ACTION:DISPLAY', 'DESCRIPTION:' + e('Rendez-vous ongles à ' + r.debut), 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  };
  O.download = (name, text, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/calendar' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };

  /* ---------- Connexion ---------- */
  O.Api = function (url, token) { this.url = url || ''; this.token = token || ''; this.demo = !this.url; };
  O.Api.prototype.call = async function (action, params) {
    const p = Object.assign({ action, token: this.token }, params || {});
    let j;
    if (this.demo) {
      await new Promise(r => setTimeout(r, 150));
      j = Demo.handle(JSON.parse(JSON.stringify(p)));
    } else {
      let r;
      try {
        r = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(p) });
      } catch (e) { throw new Error('Pas de connexion internet (ou adresse Google incorrecte).'); }
      try { j = await r.json(); } catch (e) { throw new Error("Réponse illisible : vérifie l'adresse /exec et l'accès « Tout le monde »."); }
    }
    if (!j.ok) throw new Error(j.error || 'Erreur');
    return j;
  };

  /* ---------- Mode démo : tout est stocké dans ce navigateur ---------- */
  const Demo = (() => {
    const KEY = 'ongles-demo-v1';
    const load = () => {
      try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.rdv) return d; } catch (e) { }
      return seed();
    };
    const save = d => localStorage.setItem(KEY, JSON.stringify(d));
    const seed = () => {
      const t = O.today(), s = O.DEFAULT_SERVICES;
      const mk = (date, debut, ids, nom, tel, statut, extra) => {
        const ch = ids.map(i => s.find(x => x.id === i));
        const duree = ch.reduce((a, x) => a + x.duree, 0);
        return Object.assign({ id: O.uid(), code: O.code(), date, debut, fin: O.toHM(O.toMin(debut) + duree), services: ids, prestations: ch.map(x => x.nom).join(' + '), duree, prix: ch.reduce((a, x) => a + x.prix, 0), nom, tel, email: '', note: '', statut, source: 'en ligne', cree: new Date().toISOString(), notes: '', paye: false, modePaiement: '', debutReel: '', finReel: '' }, extra || {});
      };
      const d = {
        config: O.withDefaults({ nom: 'Studio Ongles (démo)' }),
        services: s,
        taches: [
          { id: O.uid(), texte: 'Désinfecter les outils', fait: false, date: t },
          { id: O.uid(), texte: 'Commander du gel builder rose', fait: false, date: O.addDays(t, 2) },
          { id: O.uid(), texte: 'Photographier les poses pour Instagram', fait: false, date: '' }
        ],
        clientes: { '41791234567': { notes: 'Aime les formes amande. Peau sensible autour des cuticules.' } },
        rdv: [
          mk(O.addDays(t, -14), '10:00', ['s2'], 'Sarah M.', '079 123 45 67', 'termine', { paye: true, modePaiement: 'twint', debutReel: '10:05', finReel: '11:35' }),
          mk(O.addDays(t, -7), '14:00', ['s1'], 'Léa B.', '078 555 11 22', 'termine', { paye: true, modePaiement: 'especes', debutReel: '14:00', finReel: '15:00' }),
          mk(O.addDays(t, -3), '09:00', ['s7', 's1'], 'Inès K.', '076 222 33 44', 'absente'),
          mk(t, '10:00', ['s4', 's8'], 'Sarah M.', '079 123 45 67', 'confirme'),
          mk(t, '14:00', ['s1'], 'Camille R.', '077 888 99 00', 'confirme'),
          mk(t, '16:30', ['s6'], 'Nora T.', '079 444 55 66', 'attente'),
          mk(O.addDays(t, 1), '09:30', ['s3'], 'Léa B.', '078 555 11 22', 'confirme')
        ]
      };
      save(d); return d;
    };
    const busy = d => d.rdv.filter(r => r.statut !== 'annule' && r.date >= O.addDays(O.today(), -1)).map(r => ({ date: r.date, debut: r.debut, fin: r.fin }));
    const pubRdv = r => ({ code: r.code, date: r.date, debut: r.debut, fin: r.fin, prestations: r.prestations, prix: r.prix, nom: r.nom, statut: r.statut });
    const canCancel = (d, r) => r.statut !== 'annule' && (O.diffDays(O.today(), r.date) * 1440 + O.toMin(r.debut) - O.nowMin()) >= (Number(d.config.annulationH) || 0) * 60;
    return {
      reset: () => localStorage.removeItem(KEY),
      handle: p => {
        const d = load();
        switch (p.action) {
          case 'public': return { ok: true, config: d.config, services: d.services.filter(s => s.actif !== false), busy: busy(d), today: O.today(), nowMin: O.nowMin() };
          case 'book': {
            const ch = (p.services || []).map(id => d.services.find(s => s.id === id && s.actif !== false)).filter(Boolean);
            if (!ch.length) return { ok: false, error: 'Choisis au moins une prestation.' };
            if (!String(p.nom || '').trim() || O.normTel(p.tel).length < 8) return { ok: false, error: 'Nom et téléphone obligatoires.' };
            const duree = ch.reduce((a, x) => a + Number(x.duree), 0);
            if (!O.slots(d.config, busy(d), p.date, duree, O.today(), O.nowMin()).includes(p.debut)) return { ok: false, error: "Ce créneau vient d'être pris, choisis-en un autre." };
            const r = { id: O.uid(), code: O.code(), date: p.date, debut: p.debut, fin: O.toHM(O.toMin(p.debut) + duree), services: ch.map(x => x.id), prestations: ch.map(x => x.nom).join(' + '), duree, prix: ch.reduce((a, x) => a + Number(x.prix), 0), nom: String(p.nom).trim(), tel: String(p.tel).trim(), email: String(p.email || '').trim(), note: String(p.note || '').trim(), statut: d.config.validation === 'manuelle' ? 'attente' : 'confirme', source: 'en ligne', cree: new Date().toISOString(), notes: '', paye: false, modePaiement: '', debutReel: '', finReel: '' };
            d.rdv.push(r); save(d); return { ok: true, rdv: pubRdv(r) };
          }
          case 'lookup': { const r = d.rdv.find(x => x.code === String(p.code || '').toUpperCase()); return r ? { ok: true, rdv: pubRdv(r), canCancel: canCancel(d, r), config: d.config } : { ok: false, error: 'Rendez-vous introuvable.' }; }
          case 'cancel': {
            const r = d.rdv.find(x => x.code === String(p.code || '').toUpperCase());
            if (!r) return { ok: false, error: 'Rendez-vous introuvable.' };
            if (!canCancel(d, r)) return { ok: false, error: "Il est trop tard pour annuler en ligne : contacte-moi directement." };
            r.statut = 'annule'; save(d); return { ok: true, rdv: pubRdv(r) };
          }
          case 'ping': return { ok: true };
          case 'all': return { ok: true, config: d.config, services: d.services, taches: d.taches, clientes: d.clientes, rdv: d.rdv };
          case 'saveConfig': d.config = p.config; save(d); return { ok: true };
          case 'saveServices': d.services = p.services; save(d); return { ok: true };
          case 'saveTaches': d.taches = p.taches; save(d); return { ok: true };
          case 'saveClientes': d.clientes = p.clientes; save(d); return { ok: true };
          case 'saveRdv': {
            const r = p.rdv; r.fin = O.toHM(O.toMin(r.debut) + Number(r.duree));
            const i = d.rdv.findIndex(x => x.id === r.id);
            if (i >= 0) d.rdv[i] = Object.assign(d.rdv[i], r);
            else d.rdv.push(Object.assign({ id: O.uid(), code: O.code(), source: 'manuel', cree: new Date().toISOString() }, r));
            save(d); return { ok: true, rdv: i >= 0 ? d.rdv[i] : d.rdv[d.rdv.length - 1] };
          }
          case 'deleteRdv': d.rdv = d.rdv.filter(x => x.id !== p.id); save(d); return { ok: true };
        }
        return { ok: false, error: 'Action inconnue' };
      }
    };
  })();
  O.Demo = Demo;
  return O;
})();
