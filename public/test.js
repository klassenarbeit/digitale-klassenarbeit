// Testseite für Schülerinnen und Schüler (iPad).
// Ablauf: Anmelden (Nummer + Test-Code) -> Regeln -> Aufgaben -> Abgabe.
// Antworten werden sofort auf dem Gerät gesichert und laufend an den Server übertragen.

import { h, leere, api, zeichneAufgabe, minSek } from './gemeinsam.js';
import { antwortStand, zahlText } from './auswertung.js';

const app = document.getElementById('app');
const testId = location.pathname.split('/').filter(Boolean)[1] || '';
const LAGER = 'klassenarbeit:' + testId;

// Gerätespeicher: { nummer, token, antworten, rev }
function liesLager() {
  try {
    return JSON.parse(localStorage.getItem(LAGER)) || {};
  } catch {
    return {};
  }
}
function schreibLager() {
  try {
    localStorage.setItem(LAGER, JSON.stringify({ nummer: z.nummer, token: z.token, antworten: z.antworten, rev: z.rev }));
  } catch {}
}

const z = {
  nummer: null, token: null, antworten: {}, rev: 0,
  stand: null,          // letzte Auskunft des Servers
  uhrDiff: 0,           // Serverzeit minus Gerätezeit
  ende: 0,
  index: 0,             // aktuelle Aufgabe
  ansicht: 'aufgabe',   // 'aufgabe' | 'uebersicht'
  gesendeteRev: 0, sendet: false, online: true, abgabeLaeuft: false,
};
Object.assign(z, liesLager());
z.antworten = z.antworten || {};
z.rev = z.rev || 0;

const zugang = () => ({ testId, nummer: z.nummer, token: z.token });
const serverJetzt = () => Date.now() + z.uhrDiff;
const restSek = () => (z.ende - serverJetzt()) / 1000;

function uebernimm(stand) {
  z.stand = stand;
  if (stand.jetzt) z.uhrDiff = stand.jetzt - Date.now();
  if (stand.ende) z.ende = stand.ende;
}

function seite(...inhalt) {
  leere(app, h('div', { class: 'karte schmal' }, inhalt));
  window.scrollTo(0, 0);
}

// ---------- Start ----------

async function start() {
  if (!/^[a-z0-9]+$/.test(testId)) return seite(h('h1', null, 'Test nicht gefunden'), h('p', null, 'Bitte scanne den QR-Code noch einmal.'));
  if (z.token && z.nummer) {
    try {
      const stand = await api('/api/s/stand', zugang());
      return weiterMit(stand);
    } catch (e) {
      if (e.status === 0) return seite(h('h1', null, 'Keine Verbindung'), h('p', null, 'Bitte prüfe das WLAN.'), h('button', { class: 'knopf gross', onclick: () => location.reload() }, 'Noch einmal versuchen'));
      // Anmeldung ungültig (z. B. von der Lehrkraft zurückgesetzt): neu anmelden, Antworten auf dem Gerät bleiben erhalten
      z.token = null;
    }
  }
  zeigeAnmeldung();
}

function weiterMit(stand) {
  uebernimm(stand);
  if (stand.status === 'abgegeben') return zeigeFertig();
  if (stand.status === 'geschlossen') return seite(h('h1', null, 'Der Test ist beendet'), h('p', null, 'Es kann nicht mehr gestartet werden.'));
  if (stand.status === 'laeuft') {
    // Was neuer ist, gilt: der Stand auf dem Gerät oder der auf dem Server.
    if ((stand.rev || 0) > z.rev) {
      z.antworten = stand.antworten || {};
      z.rev = stand.rev;
    }
    z.gesendeteRev = stand.rev || 0;
    schreibLager();
    return starteTest();
  }
  zeigeRegeln();
}

// ---------- Anmeldung ----------

async function zeigeAnmeldung() {
  let info;
  try {
    info = await api('/api/s/test/' + testId);
  } catch (e) {
    return seite(h('h1', null, e.status === 0 ? 'Keine Verbindung' : 'Test nicht gefunden'), h('p', null, e.message),
      h('button', { class: 'knopf gross', onclick: () => location.reload() }, 'Noch einmal versuchen'));
  }
  document.title = info.titel || 'Test';
  if (!info.offen) return seite(h('h1', null, info.titel), h('p', null, 'Dieser Test ist beendet.'));

  const nummer = h('input', { class: 'feld riesig', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '3', autocomplete: 'off', id: 'nummer', value: z.nummer || '' });
  const code = h('input', { class: 'feld riesig', type: 'text', maxlength: '8', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'characters', spellcheck: 'false', id: 'code' });
  const meldung = h('p', { class: 'meldung fehler', hidden: true });
  const knopf = h('button', { class: 'knopf gross', type: 'submit' }, 'Anmelden');
  const formular = h('form', { class: 'formular' },
    h('label', { for: 'nummer' }, `Deine Nummer (1–${info.anzahlNummern})`), nummer,
    h('label', { for: 'code' }, 'Test-Code (steht an der Tafel)'), code,
    meldung, knopf);
  formular.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    meldung.hidden = true;
    knopf.disabled = true;
    try {
      const n = Number(nummer.value);
      const stand = await api('/api/s/anmelden', { testId, nummer: n, code: code.value, token: z.nummer === n ? z.token : null });
      if (z.nummer !== n) {
        z.antworten = {};
        z.rev = 0;
      }
      z.nummer = n;
      z.token = stand.token;
      schreibLager();
      weiterMit(stand);
    } catch (e) {
      meldung.textContent = e.message;
      meldung.hidden = false;
      knopf.disabled = false;
    }
  });
  seite(h('p', { class: 'ueberzeile' }, info.klasse ? 'Klasse ' + info.klasse : ''), h('h1', null, info.titel),
    h('p', null, 'Melde dich mit deiner Nummer an. Deinen Namen brauchst du nicht.'), formular);
}

// ---------- Regeln ----------

function zeigeRegeln() {
  const s = z.stand;
  document.title = s.titel || 'Test';
  const meldung = h('p', { class: 'meldung fehler', hidden: true });
  const knopf = h('button', { class: 'knopf gross', onclick: async () => {
    knopf.disabled = true;
    try {
      weiterMit(await api('/api/s/starten', zugang()));
    } catch (e) {
      meldung.textContent = e.message;
      meldung.hidden = false;
      knopf.disabled = false;
    }
  } }, 'Test starten');
  seite(
    h('p', { class: 'ueberzeile' }, `Nummer ${s.nummer}`),
    h('h1', null, s.titel),
    h('ul', { class: 'regeln' },
      h('li', null, h('b', null, `Bearbeitungszeit: ${s.dauerMin} Minuten. `), 'Die Zeit läuft, sobald du auf „Test starten“ tippst. Danach wird automatisch abgegeben.'),
      h('li', null, h('b', null, 'Erlaubte Hilfsmittel: '), s.hilfsmittel || 'keine'),
      h('li', null, h('b', null, `${s.anzahlAufgaben} Aufgaben, ${zahlText(s.maxPunkte)} Punkte. `), 'Du kannst zwischen den Aufgaben vor- und zurückgehen.'),
      h('li', null, h('b', null, 'Nur eine Abgabe. '), 'Nach dem Abgeben kannst du nichts mehr ändern.'),
      h('li', null, 'Deine Antworten werden automatisch gespeichert. Bleib auf dieser Seite und schließe sie nicht.'),
      h('li', null, 'Schreibe nirgends deinen Namen hin – deine Nummer genügt.')),
    meldung, knopf);
}

// ---------- Test ----------

let kopf, inhalt, fuss, uhrEl, speicherEl, balkenEl, fortschrittEl;
let uhrTakt, sendeTakt, sendeTimer;

function starteTest() {
  const s = z.stand;
  document.title = s.titel || 'Test';
  uhrEl = h('div', { class: 'uhr', 'aria-live': 'off' });
  speicherEl = h('div', { class: 'speicherstand' });
  balkenEl = h('div', { class: 'balken-fuellung' });
  fortschrittEl = h('span', null);
  kopf = h('header', { class: 'testkopf' },
    h('div', { class: 'testkopf-zeile' },
      h('div', { class: 'testtitel' }, h('b', null, s.titel), h('span', null, ` · Nr. ${s.nummer}`)),
      speicherEl, uhrEl),
    h('div', { class: 'balken' }, balkenEl));
  inhalt = h('section', { class: 'testinhalt' });
  fuss = h('footer', { class: 'testfuss' });
  leere(app, kopf, inhalt, fuss);
  document.body.classList.add('im-test');

  clearInterval(uhrTakt);
  clearInterval(sendeTakt);
  uhrTakt = setInterval(tick, 500);
  sendeTakt = setInterval(() => sende(true), 15000); // Lebenszeichen + Abgleich der Uhr
  window.addEventListener('online', () => sende(true));
  window.addEventListener('pagehide', () => sende(true));
  document.addEventListener('visibilitychange', () => sende(true));
  window.addEventListener('beforeunload', (ev) => {
    if (z.stand && z.stand.status === 'laeuft') ev.preventDefault();
  });
  zeichne();
  tick();
  zeigeSpeicherstand();
}

function tick() {
  if (!z.stand || z.stand.status !== 'laeuft') return;
  const rest = restSek();
  uhrEl.textContent = minSek(rest);
  uhrEl.classList.toggle('knapp', rest <= 300);
  uhrEl.classList.toggle('sehr-knapp', rest <= 60);
  if (rest <= 0 && !z.abgabeLaeuft) gibAb('zeit');
}

function staende() {
  return z.stand.aufgaben.map((a) => antwortStand(a, z.antworten[a.id]));
}

function zeichneFortschritt() {
  const st = staende();
  const fertig = st.filter((x) => x !== 'leer').length;
  balkenEl.style.width = (st.length ? (fertig / st.length) * 100 : 0) + '%';
  fortschrittEl.textContent = `${fertig} von ${st.length} bearbeitet`;
}

function geheZu(i) {
  z.index = Math.max(0, Math.min(z.stand.aufgaben.length - 1, i));
  z.ansicht = 'aufgabe';
  zeichne();
}

function zeichne() {
  if (z.ansicht === 'uebersicht') zeichneUebersicht();
  else zeichneAufgabenseite();
  zeichneFortschritt();
  window.scrollTo(0, 0);
}

function zeichneAufgabenseite() {
  const aufgaben = z.stand.aufgaben;
  const a = aufgaben[z.index];
  const feld = h('div', { class: 'aufgabe-eingabe' });
  zeichneAufgabe(feld, a, z.antworten[a.id], (wert) => {
    z.antworten[a.id] = wert;
    z.rev++;
    schreibLager();
    zeichneFortschritt();
    zeigeSpeicherstand();
    clearTimeout(sendeTimer);
    sendeTimer = setTimeout(() => sende(false), 1500);
  }, testId);
  leere(inhalt, h('article', { class: 'karte aufgabe' },
    h('div', { class: 'aufgabenkopf' },
      h('h2', null, `Aufgabe ${z.index + 1}`, a.titel ? h('span', { class: 'untertitel' }, ` (${a.titel})`) : null),
      h('span', { class: 'punkte' }, `${zahlText(a.punkte)} ${a.punkte === 1 ? 'Punkt' : 'Punkte'}`)),
    feld));
  const letzte = z.index === aufgaben.length - 1;
  leere(fuss,
    h('button', { class: 'knopf zweit', disabled: z.index === 0, onclick: () => geheZu(z.index - 1) }, '‹ Zurück'),
    h('button', { class: 'knopf zweit mitte', onclick: () => { z.ansicht = 'uebersicht'; zeichne(); } }, 'Übersicht · ', fortschrittEl),
    letzte
      ? h('button', { class: 'knopf', onclick: () => { z.ansicht = 'uebersicht'; zeichne(); } }, 'Zur Abgabe ›')
      : h('button', { class: 'knopf', onclick: () => geheZu(z.index + 1) }, 'Weiter ›'));
}

function zeichneUebersicht() {
  const aufgaben = z.stand.aufgaben;
  const st = staende();
  const offen = st.map((x, i) => (x === 'voll' ? null : i)).filter((i) => i != null);
  const raster = h('div', { class: 'raster' }, aufgaben.map((a, i) =>
    h('button', { class: 'kachel ' + st[i], onclick: () => geheZu(i), 'aria-label': `Aufgabe ${i + 1}` },
      h('b', null, String(i + 1)),
      h('small', null, st[i] === 'voll' ? 'bearbeitet' : st[i] === 'teilweise' ? 'unvollständig' : 'offen'))));
  leere(inhalt, h('article', { class: 'karte' },
    h('h2', null, 'Übersicht'),
    h('p', null, 'Tippe auf eine Aufgabe, um dorthin zu springen.'),
    raster,
    offen.length
      ? h('p', { class: 'meldung warnung' }, `Noch nicht vollständig bearbeitet: Aufgabe ${offen.map((i) => i + 1).join(', ')}.`)
      : h('p', { class: 'meldung gut' }, 'Du hast alle Aufgaben bearbeitet.'),
    h('button', { class: 'knopf gross abgabe', onclick: () => frageAbgabe(offen) }, 'Test abgeben')));
  leere(fuss,
    h('button', { class: 'knopf zweit', onclick: () => geheZu(z.index) }, '‹ Zurück zur Aufgabe'),
    h('span', { class: 'mitte fusstext' }, fortschrittEl));
}

function frageAbgabe(offen) {
  const dialog = h('div', { class: 'dialog-hintergrund' },
    h('div', { class: 'dialog karte', role: 'dialog', 'aria-modal': 'true' },
      h('h2', null, 'Wirklich abgeben?'),
      offen.length ? h('p', { class: 'meldung warnung' }, `Achtung: Aufgabe ${offen.map((i) => i + 1).join(', ')} ${offen.length === 1 ? 'ist' : 'sind'} noch nicht vollständig bearbeitet.`) : null,
      h('p', null, 'Nach der Abgabe kannst du nichts mehr ändern.'),
      h('div', { class: 'dialog-knoepfe' },
        h('button', { class: 'knopf zweit', onclick: () => dialog.remove() }, 'Nein, weiterarbeiten'),
        h('button', { class: 'knopf abgabe', onclick: () => { dialog.remove(); gibAb('selbst'); } }, 'Ja, abgeben'))));
  document.body.append(dialog);
}

// ---------- Speichern und Abgeben ----------

function zeigeSpeicherstand() {
  if (!speicherEl) return;
  const offenEnde = z.rev > z.gesendeteRev;
  speicherEl.className = 'speicherstand ' + (!z.online ? 'offline' : offenEnde ? 'wartet' : 'ok');
  speicherEl.textContent = !z.online ? 'Keine Verbindung – Antworten sind auf dem iPad gesichert' : offenEnde ? 'Speichert …' : 'Gespeichert';
}

async function sende(auchOhneAenderung) {
  if (z.sendet || z.abgabeLaeuft || !z.stand || z.stand.status !== 'laeuft') return;
  if (!auchOhneAenderung && z.rev <= z.gesendeteRev) return;
  z.sendet = true;
  const rev = z.rev;
  try {
    const stand = await api('/api/s/speichern', { ...zugang(), rev, antworten: rev > z.gesendeteRev ? z.antworten : undefined });
    z.online = true;
    z.gesendeteRev = Math.max(z.gesendeteRev, rev);
    if (stand.jetzt) z.uhrDiff = stand.jetzt - Date.now();
    if (stand.ende) z.ende = stand.ende; // z. B. nachträglich verlängerte Zeit
    if (stand.status === 'abgegeben') {
      z.stand.status = 'abgegeben';
      z.stand.abgabeArt = stand.abgabeArt;
      zeigeFertig();
    }
  } catch (e) {
    if (e.status === 0 || e.status >= 500) z.online = false;
    else if (e.status === 403) {
      z.stand.status = 'gesperrt';
      beendeTestansicht();
      seite(h('h1', null, 'Anmeldung nicht mehr gültig'), h('p', null, e.message), h('p', null, 'Deine Antworten sind auf diesem iPad gesichert.'));
    }
  } finally {
    z.sendet = false;
    zeigeSpeicherstand();
    if (z.stand && z.stand.status === 'laeuft' && z.rev > z.gesendeteRev && z.online) {
      clearTimeout(sendeTimer);
      sendeTimer = setTimeout(() => sende(false), 800);
    }
  }
}

async function gibAb(art) {
  if (z.abgabeLaeuft) return;
  z.abgabeLaeuft = true;
  clearTimeout(sendeTimer);
  beendeTestansicht();
  const status = h('p', null, 'Deine Antworten werden übertragen …');
  seite(h('h1', null, art === 'zeit' ? 'Die Zeit ist um' : 'Abgabe'), status);
  for (let versuch = 1; ; versuch++) {
    try {
      const stand = await api('/api/s/abgeben', { ...zugang(), rev: z.rev, antworten: z.antworten, art });
      z.stand.status = stand.status;
      z.stand.abgabeArt = stand.abgabeArt;
      return zeigeFertig();
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 0) {
        status.textContent = e.message;
        return;
      }
      status.textContent = `Keine Verbindung. Bitte lass diese Seite geöffnet – es wird automatisch weiter versucht (Versuch ${versuch}). Deine Antworten sind auf dem iPad gesichert. Gib deiner Lehrkraft Bescheid.`;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function beendeTestansicht() {
  clearInterval(uhrTakt);
  clearInterval(sendeTakt);
  document.body.classList.remove('im-test');
}

function zeigeFertig() {
  beendeTestansicht();
  if (z.stand) z.stand.status = 'abgegeben';
  const zeit = z.stand && z.stand.abgabeArt === 'zeit';
  const lk = z.stand && z.stand.abgabeArt === 'lehrkraft';
  seite(
    h('div', { class: 'haken', 'aria-hidden': 'true' }, '✓'),
    h('h1', null, 'Abgegeben'),
    h('p', null, zeit ? 'Die Zeit war um – dein Test wurde automatisch abgegeben.' : lk ? 'Der Test wurde von deiner Lehrkraft beendet und abgegeben.' : 'Dein Test ist abgegeben.'),
    h('p', null, `Nummer ${z.nummer}. Du kannst das iPad jetzt zuklappen.`));
}

start();
