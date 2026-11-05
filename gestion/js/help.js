// Bouton « Aide » : l'utilisateur décrit son problème, le propriétaire le voit dans sa console et répond.
import { help, session, memberName } from './db.js';
import { APP_VERSION } from './meta.js';
import { SUPPORT_CONTACT } from './config.js';
import { esc, modal, toast, fmtDate, fmtTime, chip } from './utils.js';

export async function openHelp() {
  let mine = [];
  try { mine = await help.mine(); } catch { /* la liste est un bonus */ }
  const c = SUPPORT_CONTACT || {};
  modal({
    title: '🆘 Demander de l\'aide',
    body: `
      <p class="mut small">Décris ce qui ne marche pas ou ce que tu cherches à faire. Le support Haksou reçoit ta demande avec l'écran où tu te trouves, et te répond ici.${c.phone ? ` Urgent ? Appelle le <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>.` : ''}</p>
      <label>Ton message *<textarea name="message" rows="4" required maxlength="4000" placeholder="Ex. Je n'arrive pas à émettre la facture du client Dupont, un message rouge s'affiche…"></textarea></label>
      ${mine.length ? `<h4>Mes demandes</h4><div class="list compact">${mine.slice(0, 10).map(t => `<div class="item small"><div class="grow">
        ${t.status === 'resolu' ? chip('Résolue', 'ok') : chip('En cours', 'warn')} <span class="mut">${fmtDate(t.created_at)} ${fmtTime(t.created_at)}${t.user_id !== session.profile.id ? ' · ' + esc(memberName(t.user_id)) : ''}</span>
        <div>${esc(t.message)}</div>${t.reply ? `<div class="reply">💬 <b>Support :</b> ${esc(t.reply)}</div>` : ''}</div></div>`).join('')}</div>` : ''}`,
    submit: 'Envoyer',
    onSubmit: async f => {
      await help.send(f.message, `${location.hash || '#/'} · v${APP_VERSION} · ${navigator.userAgent.slice(0, 120)}`);
      toast('Demande envoyée : le support te répond au plus vite 👍');
    },
  });
}
