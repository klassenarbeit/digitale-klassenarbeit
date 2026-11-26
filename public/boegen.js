// Einzelbögen: pro Nummer eine DIN-A4-Seite. Über „Drucken“ entsteht ein PDF mit allen Bögen.

import { h, leere, api, textEl, datumZeit } from './gemeinsam.js';
import { zahlText } from './auswertung.js';

const app = document.getElementById('app');
const testId = location.pathname.split('/').filter(Boolean).pop();

const kurz = (s, n) => {
  s = String(s || '').trim();
  return s.length > n ? s.slice(0, n).trimEnd() + ' …' : s;
};

function bogen(test, z) {
  const mitB = (test.aufgabenB || []).length > 0;
  const liste = mitB && z.gruppe === 'B' ? test.aufgabenB : test.aufgaben;
  const zeilen = liste.map((a) => {
    const e = z.aufgaben.find((x) => x.id === a.id) || {};
    const punkte = e.offen ? '– / ' + zahlText(a.punkte) : `${zahlText(e.punkte)} / ${zahlText(a.punkte)}`;
    return h('tr', null,
      h('td', { class: 'nr' }, String(a.nr)),
      h('td', null,
        textEl('span', { class: 'aufg' }, kurz(a.titel ? `(${a.titel}) ${a.text}` : a.text, 160)),
        e.antwortText ? textEl('span', { class: 'antwort' }, e.antwortText) : h('i', null, 'keine Antwort')),
      textEl('td', null, a.typ === 'offen' ? kurz(e.loesungText, 400) : e.loesungText || ''),
      h('td', { class: 'pkt status-' + (e.status || '') }, punkte),
      textEl('td', null, e.offen ? 'Noch nicht bewertet.' : e.feedback || ''));
  });
  return h('section', { class: 'bogen' },
    h('div', { class: 'bogen-kopf' },
      h('div', null, h('h2', null, test.titel || 'Test'), h('div', null, test.klasse ? `Klasse ${test.klasse} · ` : '', `abgegeben am ${datumZeit(z.abgegebenAm)}`,
        z.abgabeArt === 'zeit' ? ' (automatisch nach Zeitablauf)' : '')),
      h('div', { class: 'bogen-nr' }, `Nr. ${z.nummer}`, mitB ? h('small', { class: 'bogen-gruppe' }, ` Gruppe ${z.gruppe || 'A'}`) : null)),
    h('div', { class: 'bogen-ergebnis' },
      h('div', null, h('small', null, 'Punkte'), h('b', null, `${zahlText(z.punkte)} von ${zahlText(z.maxPunkte ?? test.maxPunkte)}`)),
      h('div', null, h('small', null, 'Prozent'), h('b', null, zahlText(z.prozent, 1) + ' %')),
      h('div', null, h('small', null, 'Note'), h('b', null, z.note != null ? String(z.note) : '–'), z.note == null ? h('small', null, 'noch nicht freigegeben') : null)),
    h('table', { class: 'bogen-tabelle' },
      h('thead', null, h('tr', null, h('th', null, 'Nr.'), h('th', null, 'Aufgabe und deine Antwort'), h('th', null, 'Richtige Lösung'), h('th', null, 'Punkte'), h('th', null, 'Rückmeldung'))),
      h('tbody', null, zeilen)),
    h('div', { class: 'bogen-fuss' }, 'Geschlossene Aufgaben wurden automatisch ausgewertet. Offene Aufgaben hat deine Lehrkraft bewertet.'));
}

async function start() {
  let daten;
  try {
    daten = await api(`/api/l/tests/${testId}/ergebnisse`);
  } catch (e) {
    return leere(app, h('div', { class: 'karte schmal' }, h('h1', null, 'Einzelbögen'), h('p', null, e.status === 401 ? 'Bitte melde dich zuerst an.' : e.message), h('a', { class: 'knopf', href: '/lehrer' }, 'Zum Lehrkraft-Bereich')));
  }
  const { test, zeilen } = daten;
  document.title = `Einzelbögen – ${test.titel}`;
  leere(app,
    h('div', { class: 'nicht-drucken' },
      h('h1', null, `Einzelbögen – ${test.titel}`),
      h('div', { class: 'werkzeug' },
        h('button', { class: 'knopf', onclick: () => window.print(), disabled: !zeilen.length }, 'Alle Bögen drucken / als PDF sichern'),
        h('a', { class: 'knopf zweit', href: `/lehrer#/test/${test.id}/ergebnisse` }, 'Zurück')),
      h('p', { class: 'klein' }, `${zeilen.length} Bögen, je eine Seite DIN A4. Im Druckdialog „Als PDF sichern“ wählen, um ein PDF mit allen Bögen zu erhalten. Kopf- und Fußzeilen des Browsers am besten ausschalten.`),
      test.notenFreigegeben ? null : h('p', { class: 'meldung warnung' }, daten.offen ? `Noch ${daten.offen} offene Antwort(en) unbewertet – die Bögen zeigen noch keine Noten.` : 'Die Noten sind noch nicht freigegeben – die Bögen zeigen nur Punkte.')),
    zeilen.length ? zeilen.map((z) => bogen(test, z)) : h('p', { class: 'nicht-drucken' }, 'Es gibt noch keine Abgaben.'));
}

start();
