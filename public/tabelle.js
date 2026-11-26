// Übersichtstabelle: Nummer | Punkte | Prozent | Note – sortierbar, mit Durchschnitt, Notenspiegel und CSV-Export.

import { h, leere, api } from './gemeinsam.js';
import { zahlText } from './auswertung.js';

const app = document.getElementById('app');
const testId = location.pathname.split('/').filter(Boolean).pop();

let daten;
let sortiert = { spalte: 'nummer', richtung: 1 };

const SPALTEN = [
  ['nummer', 'Nummer'],
  ['punkte', 'Punkte'],
  ['prozent', 'Prozent'],
  ['note', 'Note'],
];

const schnitt = (werte) => (werte.length ? werte.reduce((s, x) => s + x, 0) / werte.length : null);

function csv() {
  const { test, zeilen } = daten;
  const z = (x) => (x == null ? '' : String(x).replace('.', ','));
  const feld = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const mitB = (test.aufgabenB || []).length > 0;
  const kopf = ['Nummer', ...(mitB ? ['Gruppe'] : []), 'Punkte', 'Maximal', 'Prozent', 'Note', ...test.aufgaben.map((a) => feld(`A${a.nr}${a.titel ? ' ' + a.titel : ''} (${z(a.punkte)})`))];
  const reihen = [...zeilen].sort((a, b) => a.nummer - b.nummer).map((r) => [
    r.nummer, ...(mitB ? [r.gruppe || 'A'] : []), z(r.punkte), z(r.maxPunkte ?? test.maxPunkte), z(Math.round(r.prozent * 10) / 10), r.note ?? '',
    ...test.aufgaben.map((a, i) => {
      const e = r.aufgaben[i];
      return e && !e.offen ? z(e.punkte) : '';
    }),
  ]);
  const text = '﻿' + [kopf, ...reihen].map((r) => r.join(';')).join('\r\n') + '\r\n';
  const link = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: `ergebnisse-${(test.titel || test.id).replace(/[^\wäöüÄÖÜß-]+/g, '_')}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
}

function zeichne() {
  const { test, zeilen } = daten;
  const reihen = [...zeilen].sort((a, b) => {
    const x = a[sortiert.spalte] ?? Infinity;
    const y = b[sortiert.spalte] ?? Infinity;
    return (x - y) * sortiert.richtung || a.nummer - b.nummer;
  });
  const noten = zeilen.map((r) => r.note).filter((n) => n != null);
  const mitB = (test.aufgabenB || []).length > 0;
  const kopf = h('tr', null, SPALTEN.map(([key, name]) =>
    h('th', { class: sortiert.spalte === key ? 'aktiv' : '', title: 'Zum Sortieren klicken', onclick: () => {
      sortiert = { spalte: key, richtung: sortiert.spalte === key ? -sortiert.richtung : 1 };
      zeichne();
    } }, name, sortiert.spalte === key ? (sortiert.richtung > 0 ? ' ▲' : ' ▼') : '')));

  leere(app,
    h('h1', null, `${test.titel || 'Test'}${test.klasse ? ' · Klasse ' + test.klasse : ''}`),
    h('div', { class: 'werkzeug nicht-drucken' },
      h('button', { class: 'knopf', onclick: csv, disabled: !zeilen.length }, 'Als CSV für Excel exportieren'),
      h('button', { class: 'knopf zweit', onclick: () => window.print() }, 'Drucken'),
      h('a', { class: 'knopf zweit', href: `/lehrer#/test/${test.id}/ergebnisse` }, 'Zurück')),
    test.notenFreigegeben ? null : h('p', { class: 'meldung warnung' }, daten.offen ? `Noch ${daten.offen} offene Antwort(en) unbewertet – Punkte sind vorläufig, Noten gibt es erst nach deiner Freigabe.` : 'Die Noten sind noch nicht freigegeben.'),
    h('table', { class: 'daten' },
      h('thead', null, kopf),
      h('tbody', null, reihen.length ? reihen.map((r) => h('tr', null,
        h('td', null, String(r.nummer), mitB ? ` (${r.gruppe || 'A'})` : ''),
        h('td', null, `${zahlText(r.punkte)} / ${zahlText(r.maxPunkte ?? test.maxPunkte)}${r.offen ? ' *' : ''}`),
        h('td', null, zahlText(r.prozent, 1) + ' %'),
        h('td', null, r.note != null ? String(r.note) : '–')))
        : h('tr', null, h('td', { colspan: '4' }, 'Noch keine Abgaben.'))),
      h('tfoot', null, h('tr', null,
        h('td', null, `Durchschnitt (${zeilen.length})`),
        h('td', null, zahlText(schnitt(zeilen.map((r) => r.punkte)), 1)),
        h('td', null, zeilen.length ? zahlText(schnitt(zeilen.map((r) => r.prozent)), 1) + ' %' : '–'),
        h('td', null, noten.length ? zahlText(schnitt(noten), 2) : '–')))),
    zeilen.some((r) => r.offen) ? h('p', { class: 'klein' }, '* enthält noch unbewertete offene Antworten.') : null,
    h('h2', { style: 'margin-top:24px' }, 'Notenspiegel'),
    noten.length
      ? h('div', { class: 'spiegel' }, [1, 2, 3, 4, 5, 6].map((n) => h('div', null, h('small', null, `Note ${n}`), h('b', null, String(noten.filter((x) => x === n).length)))))
      : h('p', { class: 'klein' }, 'Der Notenspiegel erscheint, sobald die Noten freigegeben sind.'),
    h('p', { class: 'klein', style: 'margin-top:16px' }, 'Notenschlüssel: ' + test.notenschluessel.map((s) => `Note ${s.note} ab ${zahlText(s.ab)} %`).join(' · ')));
}

async function start() {
  try {
    daten = await api(`/api/l/tests/${testId}/ergebnisse`);
  } catch (e) {
    return leere(app, h('div', { class: 'karte schmal' }, h('h1', null, 'Übersichtstabelle'), h('p', null, e.status === 401 ? 'Bitte melde dich zuerst an.' : e.message), h('a', { class: 'knopf', href: '/lehrer' }, 'Zum Lehrkraft-Bereich')));
  }
  document.title = `Übersicht – ${daten.test.titel}`;
  zeichne();
}

start();
