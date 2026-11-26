// Lehrkraft-Bereich: Tests anlegen, Aufgaben bearbeiten, freigeben, live verfolgen, bewerten.

import { h, leere, api, setzeText, textEl, zeichneAufgabe, bildUrl, datumZeit, minSek } from './gemeinsam.js';
import { TYPEN, neueAufgabe, normalisiereAufgabe, fuerSuS, lueckenAus, zahlText, parseZahl, bewerte } from './auswertung.js';

const app = document.getElementById('app');

let test = null;          // der gerade geöffnete Test
let reiter = 'aufgaben';
let kiStatus = { bereit: false, modell: '' };
let kiHinweise = [];      // Hinweise der KI nach der Umwandlung
let vorlagen = [];        // hochgeladene Dateien (nur in diesem Browserfenster), für Bildausschnitte
let aufraeumen = [];      // Funktionen, die beim Verlassen eines Reiters laufen (Timer stoppen)

const STATUS = { entwurf: 'Entwurf', freigegeben: 'Freigegeben', beendet: 'Beendet' };

// ---------- Speichern ----------

let ungespeichert = false;
let speicherTimer = null;
let speicherEl = null;

function zeigeSpeicher(text, klasse) {
  if (speicherEl) {
    speicherEl.textContent = text;
    speicherEl.className = 'speicherstand ' + (klasse || '');
  }
}

function geaendert() {
  ungespeichert = true;
  zeigeSpeicher('Speichert …', 'wartet');
  clearTimeout(speicherTimer);
  speicherTimer = setTimeout(speichere, 1200);
}

async function speichere() {
  clearTimeout(speicherTimer);
  if (!ungespeichert || !test) return;
  ungespeichert = false;
  try {
    const { titel, klasse, dauerMin, hilfsmittel, anzahlNummern, notenschluessel, nta, aufgaben } = test;
    const aufgabenB = test.aufgabenB && test.aufgabenB.length ? test.aufgabenB : null;
    await api('/api/l/tests/' + test.id, { titel, klasse, dauerMin, hilfsmittel, anzahlNummern, notenschluessel, nta, aufgaben, aufgabenB }, 'PUT');
    if (!ungespeichert) zeigeSpeicher('Gespeichert', 'ok');
  } catch (e) {
    ungespeichert = true;
    zeigeSpeicher('Nicht gespeichert: ' + e.message, 'offline');
    if (e.status === 401) return zeigeLogin();
    speicherTimer = setTimeout(speichere, 5000);
  }
}

window.addEventListener('beforeunload', (ev) => {
  if (ungespeichert) ev.preventDefault();
});

// ---------- kleine Bausteine ----------

function feldMit(beschriftung, eingabe, hinweis) {
  return h('label', { class: 'feldgruppe' }, h('span', { class: 'beschriftung' }, beschriftung), eingabe, hinweis ? h('small', null, hinweis) : null);
}

function textfeld(wert, beiEingabe, attrs = {}) {
  const el = h('input', { type: 'text', class: 'feld', ...attrs, value: wert == null ? '' : wert });
  el.addEventListener('input', () => beiEingabe(el.value));
  return el;
}

function textbereich(wert, beiEingabe, attrs = {}) {
  const el = h('textarea', { class: 'feld', rows: '3', ...attrs });
  el.value = wert == null ? '' : wert;
  const anpassen = () => {
    el.style.height = 'auto';
    el.style.height = Math.min(600, el.scrollHeight + 4) + 'px';
  };
  el.addEventListener('input', () => {
    beiEingabe(el.value);
    anpassen();
  });
  setTimeout(anpassen, 0);
  return el;
}

function meldung(text, art = 'fehler') {
  return h('p', { class: 'meldung ' + art }, text);
}

async function mitFehler(el, fn) {
  try {
    if (el) el.hidden = true;
    return await fn();
  } catch (e) {
    if (e.status === 401) return zeigeLogin();
    if (el) {
      el.textContent = e.message;
      el.hidden = false;
    } else alert(e.message);
  }
}

async function warteAufJob(id, beiFortschritt) {
  let pannen = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    let job;
    try {
      job = await api('/api/l/jobs/' + id);
      pannen = 0;
    } catch (e) {
      if (e.status === 0 && ++pannen < 30) continue;
      throw e;
    }
    if (job.status === 'fertig') return job.ergebnis;
    if (job.status === 'fehler') throw new Error(job.fehler);
    if (beiFortschritt) beiFortschritt(job.fortschritt || '');
  }
}

// ---------- Anmeldung ----------

function zeigeLogin() {
  test = null;
  const pw = h('input', { type: 'password', class: 'feld', autocomplete: 'current-password', id: 'pw' });
  const fehlerEl = h('p', { class: 'meldung fehler', hidden: true });
  const form = h('form', { class: 'formular' }, h('label', { for: 'pw' }, 'Passwort'), pw, fehlerEl, h('button', { class: 'knopf', type: 'submit' }, 'Anmelden'));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    mitFehler(fehlerEl, async () => {
      await api('/api/l/login', { passwort: pw.value });
      route();
    });
  });
  leere(app, h('div', { class: 'karte schmal' }, h('h1', null, 'Klassenarbeit online'), h('p', null, 'Bereich für die Lehrkraft'), form,
    h('p', { class: 'klein' }, h('a', { href: '/info' }, 'Datenschutz, Anonymisierung und Rolle der KI'))));
  pw.focus();
}

// ---------- Übersicht aller Tests ----------

async function zeigeListe() {
  test = null;
  document.title = 'Klassenarbeit online – Lehrkraft';
  const { tests } = await api('/api/l/tests');
  const fehlerEl = h('p', { class: 'meldung fehler', hidden: true });
  leere(app,
    h('header', { class: 'seitenkopf' },
      h('h1', null, 'Meine Tests'),
      h('div', { class: 'kopf-aktionen' },
        h('a', { href: '/hinweise', class: 'knopf zweit klein' }, 'Hinweise zur Durchführung'),
        h('a', { href: '/richtlinien', class: 'knopf zweit klein' }, 'Richtlinien & Recht (NRW)'),
        h('a', { href: '/info', class: 'knopf zweit klein' }, 'Datenschutz in dieser Anwendung'),
        h('button', { class: 'knopf zweit klein', onclick: async () => { await api('/api/l/logout', {}); zeigeLogin(); } }, 'Abmelden'))),
    kiStatus.speicherWarnung ? meldung(kiStatus.speicherWarnung, 'fehler') : null,
    kiStatus.bereit ? null : meldung('Es ist kein KI-Schlüssel hinterlegt (ANTHROPIC_API_KEY). Du kannst Tests von Hand anlegen; das automatische Umwandeln und die Bewertungsvorschläge sind erst mit Schlüssel möglich.', 'warnung'),
    fehlerEl,
    h('button', { class: 'knopf', onclick: () => mitFehler(fehlerEl, async () => {
      const r = await api('/api/l/tests', {});
      location.hash = `#/test/${r.test.id}/erstellen`;
    }) }, '+ Neuen Test anlegen'),
    h('div', { class: 'testliste' }, tests.length ? tests.map((t) =>
      h('a', { class: 'karte testkarte', href: `#/test/${t.id}/${t.status === 'entwurf' ? 'aufgaben' : 'durchfuehrung'}` },
        h('div', null, h('b', null, t.titel || 'Ohne Titel'), t.klasse ? ` · Klasse ${t.klasse}` : ''),
        h('div', { class: 'klein' }, `${t.anzahlAufgaben} Aufgaben · ${t.anzahlTeilnahmen} Anmeldungen · angelegt am ${datumZeit(t.erstellt)}`),
        h('span', { class: 'marke ' + t.status }, STATUS[t.status] || t.status)))
      : h('p', { class: 'klein' }, 'Noch keine Tests. Lege deinen ersten Test an.')));
}

// ---------- Rahmen eines Tests ----------

const REITER = [
  ['erstellen', '1 · Hochladen'],
  ['aufgaben', '2 · Aufgaben'],
  ['einstellungen', '3 · Einstellungen'],
  ['durchfuehrung', '4 · Freigabe & Live'],
  ['bewertung', '5 · Bewertung'],
  ['ergebnisse', '6 · Ergebnisse'],
];

async function zeigeTest(id, gewaehlt) {
  if (!test || test.id !== id) {
    await speichere();
    test = (await api('/api/l/tests/' + id)).test;
    kiHinweise = [];
    vorlagen = [];
    offeneKarten.clear();
    kiAenderung.clear();
    gruppe = 'A';
    for (const dateien of Object.values(erstellDateien)) dateien.length = 0;
  } else if (!ungespeichert) {
    test = (await api('/api/l/tests/' + id)).test; // frischer Stand (Status, Anmeldungen)
  }
  reiter = REITER.some((r) => r[0] === gewaehlt) ? gewaehlt : 'aufgaben';
  document.title = (test.titel || 'Ohne Titel') + ' – Klassenarbeit online';
  speicherEl = h('span', { class: 'speicherstand ok' }, ungespeichert ? 'Speichert …' : '');
  const inhalt = h('section', { class: 'reiterinhalt' });
  leere(app,
    h('header', { class: 'seitenkopf' },
      h('div', null,
        h('a', { href: '#/', class: 'zurueck' }, '‹ Alle Tests'),
        h('h1', { id: 'testtitel' }, test.titel || 'Ohne Titel', ' ', h('span', { class: 'marke ' + test.status }, STATUS[test.status]))),
      speicherEl),
    kiStatus.speicherWarnung ? meldung(kiStatus.speicherWarnung, 'fehler') : null,
    h('nav', { class: 'reiter' }, REITER.map(([key, name]) =>
      h('a', { href: `#/test/${test.id}/${key}`, class: key === reiter ? 'aktiv' : '' }, name))),
    inhalt);
  const seiten = { erstellen: reiterErstellen, aufgaben: reiterAufgaben, einstellungen: reiterEinstellungen, durchfuehrung: reiterDurchfuehrung, bewertung: reiterBewertung, ergebnisse: reiterErgebnisse };
  await seiten[reiter](inhalt);
}

// ---------- Reiter 1: Hochladen und umwandeln ----------

function dateiZuBase64(datei) {
  return new Promise((resolve, reject) => {
    const leser = new FileReader();
    leser.onload = () => resolve(String(leser.result).split(',')[1] || '');
    leser.onerror = () => reject(new Error(`Die Datei „${datei.name}“ konnte nicht gelesen werden.`));
    leser.readAsDataURL(datei);
  });
}

function ladeBild(datei) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Das Bild „${datei.name}“ kann in diesem Browser nicht geöffnet werden (bei HEIC-Fotos bitte Safari nutzen oder als JPG speichern).`));
    };
    img.src = url;
  });
}

function aufLeinwand(quelle, maxKante) {
  const b = quelle.naturalWidth || quelle.width;
  const hoehe = quelle.naturalHeight || quelle.height;
  const f = Math.min(1, maxKante / Math.max(b, hoehe));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(b * f));
  c.height = Math.max(1, Math.round(hoehe * f));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(quelle, 0, 0, c.width, c.height);
  return c;
}

const istPdf = (d) => d.type === 'application/pdf' || /\.pdf$/i.test(d.name);
const istDocx = (d) => /\.docx$/i.test(d.name);
const istBild = (d) => d.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(d.name);

async function bereiteDateiVor(datei, rolle) {
  if (istPdf(datei)) return { name: datei.name, rolle, mime: 'application/pdf', base64: await dateiZuBase64(datei) };
  if (istDocx(datei)) return { name: datei.name, rolle, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64: await dateiZuBase64(datei) };
  if (istBild(datei)) {
    const c = aufLeinwand(await ladeBild(datei), 2000);
    return { name: datei.name, rolle, mime: 'image/jpeg', base64: c.toDataURL('image/jpeg', 0.88).split(',')[1] };
  }
  if (/\.doc$/i.test(datei.name)) throw new Error(`„${datei.name}“ ist ein altes Word-Format (.doc). Bitte als .docx oder PDF speichern.`);
  throw new Error(`„${datei.name}“: Dieses Format wird nicht unterstützt. Möglich sind PDF, Word (.docx) und Fotos.`);
}

const MODI = {
  uebernehmen: {
    titel: 'Meine Klassenarbeit digitalisieren',
    text: 'Die Arbeit wird eins zu eins übertragen: gleiche Aufgaben, gleiche Punkte.',
    knopf: 'Arbeit in digitale Aufgaben umwandeln',
  },
  parallel: {
    titel: 'Parallelversion mit anderen Zahlen',
    text: 'Gleicher Stoff und gleiche Aufgabenformate, aber neue Zahlen und Beispiele – als Übung, Nachschreibarbeit oder Gruppe B.',
    knopf: 'Parallelversion erstellen',
  },
  checkliste: {
    titel: 'Neue Arbeit aus einer Checkliste',
    text: 'Du lädst die Checkliste der Themen hoch. Die KI schreibt dazu passende Aufgaben mit Lösungen.',
    knopf: 'Arbeit nach Checkliste erstellen',
  },
  vokabeln: {
    titel: 'Vokabeltest',
    text: 'Du tippst die Vokabeln ein oder lädst die Liste hoch. Daraus wird ein Test Deutsch ↔ Englisch.',
    knopf: 'Vokabeltest erstellen',
  },
};

// Auswahl auf der Hochladen-Seite (bleibt beim Wechsel zwischen den Reitern erhalten)
const erstellWahl = { modus: 'uebernehmen', horizontKi: false, probe: false, probeMin: 30, vollMin: 45, gruppeB: false, richtung: 'de-en', anzahl: 0, vokabelText: '' };
const erstellDateien = { arbeit: [], loesung: [], checkliste: [], material: [], vokabeln: [] };

// ---------- Vokabeltest aus einer eingetippten Liste (ohne KI) ----------

// Eine Vokabel pro Zeile: „Deutsch = Englisch“. Als Trenner gelten auch Tabulator, Gedankenstrich und „ - “.
function vokabelnAusText(text) {
  const paare = [];
  const unklar = [];
  for (const roh of String(text).split(/\r?\n/)) {
    const zeile = roh.trim();
    if (!zeile) continue;
    const m = /^(.+?)\s*(?:=|\t|–|—|\s-\s|:)\s*(.+)$/.exec(zeile);
    if (m && m[1].trim() && m[2].trim()) paare.push({ de: m[1].trim(), en: m[2].trim() });
    else unklar.push(zeile.slice(0, 40));
  }
  return { paare, unklar };
}

function gemischt(liste) {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function baueVokabeltest(paare, richtung, anzahl) {
  let wahl = anzahl > 0 && anzahl < paare.length ? gemischt(paare).slice(0, anzahl) : [...paare];
  const teil = (liste, r) => {
    const aus = [];
    for (let i = 0; i < liste.length; i += 10) {
      const stueck = liste.slice(i, i + 10);
      aus.push(normalisiereAufgabe({
        typ: 'vokabeln', richtung: r, punkte: stueck.length, minuten: Math.ceil(stueck.length * 0.5),
        paare: stueck.map((p) => (r === 'en-de' ? { wort: p.en.split(';')[0].trim(), loesung: p.de } : { wort: p.de.split(';')[0].trim(), loesung: p.en })),
      }));
    }
    return aus;
  };
  if (richtung !== 'gemischt') return teil(wahl, richtung === 'en-de' ? 'en-de' : 'de-en');
  wahl = gemischt(wahl);
  const mitte = Math.ceil(wahl.length / 2);
  return [...teil(wahl.slice(0, mitte), 'de-en'), ...teil(wahl.slice(mitte), 'en-de')];
}

// Gruppe B eines Vokabeltests: dieselben Wörter, andere Reihenfolge.
function mischeVokabeltest(aufgaben) {
  return aufgaben.map((a) => normalisiereAufgabe({ ...JSON.parse(JSON.stringify(a)), id: undefined, paare: a.paare ? gemischt(a.paare) : undefined }));
}


async function reiterErstellen(el) {
  const fehlerEl = h('p', { class: 'meldung fehler', hidden: true });
  const fortschritt = h('p', { class: 'meldung info', hidden: true });
  const unten = h('div');

  const dateiFeld = (rolle, titel, text) => {
    const liste = h('ul', { class: 'dateiliste' });
    const zeige = () => leere(liste, erstellDateien[rolle].map((d, i) =>
      h('li', null, d.name, ' ', h('button', { class: 'linkknopf', onclick: () => { erstellDateien[rolle].splice(i, 1); zeige(); } }, 'entfernen'))));
    const eingabe = h('input', { type: 'file', multiple: true, accept: '.pdf,.docx,image/*,.heic' });
    eingabe.addEventListener('change', () => {
      erstellDateien[rolle].push(...eingabe.files);
      eingabe.value = '';
      zeige();
    });
    zeige();
    return h('div', { class: 'karte hochladen' }, h('h3', null, titel), h('p', { class: 'klein' }, text), eingabe, liste);
  };

  const minutenFeld = (schluessel) => {
    const feld = h('input', { type: 'text', class: 'feld winzig', inputmode: 'numeric', value: erstellWahl[schluessel] });
    feld.addEventListener('input', () => {
      const n = Math.round(parseZahl(feld.value) || 0);
      if (n >= 5 && n <= 300) erstellWahl[schluessel] = n;
    });
    return feld;
  };

  const umfangWahl = () => {
    const eintrag = (probe, inhalt) => {
      const knopf = h('input', { type: 'radio', name: 'umfang', checked: erstellWahl.probe === probe });
      knopf.addEventListener('change', () => { erstellWahl.probe = probe; });
      return h('label', { class: 'wahlzeile' }, knopf, h('span', null, inhalt));
    };
    return h('div', { class: 'karte' },
      h('h3', null, 'Umfang'),
      eintrag(false, erstellWahl.modus === 'parallel'
        ? [h('b', null, 'Gleicher Umfang wie die Vorlage')]
        : [h('b', null, 'Volle Klassenarbeit'), ' mit etwa ', minutenFeld('vollMin'), ' Minuten']),
      eintrag(true, [h('b', null, 'Kurze Testklassenarbeit zur Vorbereitung'), ' mit etwa ', minutenFeld('probeMin'), ' Minuten – jeder Bereich, der drankommen kann, wird einmal kurz abgefragt']),
      h('p', { class: 'klein' }, 'Die KI schätzt zu jeder Aufgabe die Bearbeitungszeit und sagt dir, wie lange die Arbeit insgesamt ungefähr dauert. Die Zeit kannst du danach im Reiter „Einstellungen“ ändern.'));
  };

  const knopf = h('button', { class: 'knopf', disabled: !kiStatus.bereit });

  const zeigeUnten = () => {
    const m = erstellWahl.modus;
    knopf.textContent = MODI[m].knopf;
    let felder;
    if (m === 'uebernehmen') {
      const haken = h('input', { type: 'checkbox', checked: erstellWahl.horizontKi });
      haken.addEventListener('change', () => { erstellWahl.horizontKi = haken.checked; zeigeUnten(); });
      felder = [
        h('div', { class: 'zweispaltig' },
          dateiFeld('arbeit', 'Klassenarbeit', 'Die Aufgaben, so wie die Klasse sie bekommt.'),
          erstellWahl.horizontKi
            ? h('div', { class: 'karte hochladen' }, h('h3', null, 'Erwartungshorizont'), h('p', null, 'Die KI löst jede Aufgabe selbst und schreibt Lösung, Lösungsweg und Punkteverteilung dazu. Du prüfst alles im Reiter „Aufgaben“ und kannst den Erwartungshorizont dort drucken.'))
            : dateiFeld('loesung', 'Erwartungshorizont / Lösungen', 'Mit Punkteverteilung, falls du einen hast.')),
        h('label', { class: 'wahlzeile' }, haken, h('span', null, h('b', null, 'Ich habe keinen Erwartungshorizont – die KI soll ihn mit allen Lösungen erstellen.'))),
      ];
    } else if (m === 'parallel') {
      felder = [
        h('div', { class: 'zweispaltig' },
          dateiFeld('arbeit', 'Klassenarbeit (Vorlage)', 'Die Arbeit, zu der es eine zweite Version geben soll.'),
          dateiFeld('loesung', 'Erwartungshorizont der Vorlage (optional)', 'Hilft der KI, Niveau und Punkteverteilung zu treffen. Die Lösungen der neuen Version erstellt sie immer selbst.')),
        umfangWahl(),
      ];
    } else if (m === 'checkliste') {
      felder = [
        h('div', { class: 'zweispaltig' },
          dateiFeld('checkliste', 'Checkliste', 'Die Liste der Themen und Kompetenzen, die drankommen können (z. B. „Das kann ich“-Liste).'),
          dateiFeld('material', 'Frühere Arbeit oder Material (optional)', 'Nur zur Orientierung für Stil und Niveau. Daraus wird nichts wörtlich übernommen.')),
        umfangWahl(),
      ];
    }
    if (m === 'vokabeln') {
      const text = h('textarea', { class: 'feld', rows: '8', placeholder: 'das Haus = house\ngehen = to go; to walk\nschön = beautiful' });
      text.value = erstellWahl.vokabelText;
      text.addEventListener('input', () => { erstellWahl.vokabelText = text.value; });
      const richtung = h('select', { class: 'feld schmal' },
        [['de-en', 'Deutsch → Englisch'], ['en-de', 'Englisch → Deutsch'], ['gemischt', 'gemischt (halb / halb)']].map(([k, v]) => h('option', { value: k, selected: erstellWahl.richtung === k }, v)));
      richtung.addEventListener('change', () => { erstellWahl.richtung = richtung.value; });
      const anzahl = h('input', { type: 'text', class: 'feld winzig', inputmode: 'numeric', value: erstellWahl.anzahl || '' });
      anzahl.addEventListener('input', () => { erstellWahl.anzahl = Math.max(0, Math.round(parseZahl(anzahl.value) || 0)); });
      felder = [
        h('div', { class: 'zweispaltig' },
          h('div', { class: 'karte hochladen' }, h('h3', null, 'Vokabeln eintippen oder einfügen'),
            h('p', { class: 'klein' }, 'Eine Vokabel pro Zeile: Deutsch = Englisch. Mehrere richtige Übersetzungen mit ; trennen. Dafür wird keine KI gebraucht.'), text),
          dateiFeld('vokabeln', '… oder Vokabelliste hochladen', 'Foto der Buchseite, PDF oder Word-Datei. Die KI liest die Wortpaare ab – bitte danach prüfen. Wird nur genutzt, wenn links nichts eingetippt ist.')),
        h('div', { class: 'karte' }, h('h3', null, 'Einstellungen'),
          h('label', { class: 'wahlzeile' }, h('span', null, 'Richtung: '), richtung),
          h('label', { class: 'wahlzeile' }, h('span', null, 'Nur ', anzahl, ' zufällig ausgewählte Vokabeln abfragen (leer = alle)')),
          h('p', { class: 'klein' }, 'Je 10 Vokabeln bilden eine Aufgabe, jede Vokabel zählt einen Punkt. Groß-/Kleinschreibung sowie „to“ und Artikel am Anfang werden nicht gewertet.')),
      ];
    }
    const hakenB = h('input', { type: 'checkbox', checked: erstellWahl.gruppeB });
    hakenB.addEventListener('change', () => { erstellWahl.gruppeB = hakenB.checked; });
    felder.push(h('label', { class: 'wahlzeile' }, hakenB, h('span', null, h('b', null, 'Zusätzlich eine Gruppe B erstellen. '),
      m === 'vokabeln' ? 'Jede zweite Nummer bekommt dieselben Vokabeln in anderer Reihenfolge.' : 'Jede zweite Nummer bekommt eine gleich schwere Fassung mit anderen Zahlen, damit Sitznachbarn nicht abschreiben können.')));
    knopf.disabled = !kiStatus.bereit && m !== 'vokabeln';
    leere(unten, felder);
  };

  const wahlKarten = h('div', { class: 'wahlkarten' }, Object.entries(MODI).map(([key, m]) => {
    const radio = h('input', { type: 'radio', name: 'modus', checked: erstellWahl.modus === key });
    radio.addEventListener('change', () => { erstellWahl.modus = key; zeigeUnten(); });
    return h('label', { class: 'wahlkarte' }, radio, h('span', null, h('b', null, m.titel), h('small', null, m.text)));
  }));

  knopf.addEventListener('click', () => mitFehler(fehlerEl, async () => {
    const m = erstellWahl.modus;
    const fertig = async () => {
      offeneKarten.clear();
      kiAenderung.clear();
      gruppe = 'A';
      geaendert();
      await speichere();
      location.hash = `#/test/${test.id}/aufgaben`;
    };
    const ersetzen = () => !test.aufgaben.length || confirm('Dieser Test hat schon Aufgaben. Sollen sie ersetzt werden?');

    // Vokabeltest aus eingetippter Liste: geht ohne KI
    if (m === 'vokabeln' && erstellWahl.vokabelText.trim()) {
      const { paare, unklar } = vokabelnAusText(erstellWahl.vokabelText);
      if (!paare.length) throw new Error('Ich konnte keine Vokabeln erkennen. Schreibe pro Zeile: Deutsch = Englisch.');
      if (!ersetzen()) return;
      test.aufgaben = baueVokabeltest(paare, erstellWahl.richtung, erstellWahl.anzahl);
      if (erstellWahl.gruppeB) test.aufgabenB = mischeVokabeltest(test.aufgaben);
      else delete test.aufgabenB;
      const anzahl = test.aufgaben.reduce((s, a) => s + a.paare.length, 0);
      if (!test.titel) test.titel = 'Vokabeltest';
      test.dauerMin = Math.max(5, Math.ceil(anzahl * 0.5) + 2);
      kiHinweise = [`${anzahl} Vokabeln übernommen. Vorgeschlagene Bearbeitungszeit: ${test.dauerMin} Minuten (änderbar im Reiter „Einstellungen“).`];
      if (unklar.length) kiHinweise.push(`${unklar.length} Zeile(n) ohne erkennbares Wortpaar wurden ausgelassen: ${unklar.slice(0, 5).join(' | ')}`);
      if (erstellWahl.gruppeB) kiHinweise.push('Gruppe B enthält dieselben Vokabeln in anderer Reihenfolge.');
      return fertig();
    }

    const rollen = m === 'vokabeln' ? ['vokabeln'] : m === 'checkliste' ? ['checkliste', 'material'] : m === 'uebernehmen' && erstellWahl.horizontKi ? ['arbeit'] : ['arbeit', 'loesung'];
    if (!erstellDateien[rollen[0]].length) {
      throw new Error(m === 'vokabeln' ? 'Bitte tippe die Vokabeln ein oder wähle eine Datei mit der Vokabelliste aus.' : m === 'checkliste' ? 'Bitte wähle zuerst die Checkliste aus.' : 'Bitte wähle zuerst die Klassenarbeit aus.');
    }
    if (!ersetzen()) return;
    knopf.disabled = true;
    fortschritt.hidden = false;
    fortschritt.textContent = 'Dateien werden vorbereitet …';
    try {
      const dateien = [];
      for (const rolle of rollen) for (const d of erstellDateien[rolle]) dateien.push(await bereiteDateiVor(d, rolle));
      vorlagen = rollen.flatMap((r) => erstellDateien[r]).filter((d) => istPdf(d) || istBild(d));
      fortschritt.textContent = 'Dateien werden hochgeladen …';
      const frei = m === 'parallel' || m === 'checkliste';
      const probe = frei && erstellWahl.probe;
      const zielMinuten = probe ? erstellWahl.probeMin : m === 'checkliste' ? erstellWahl.vollMin : 0;
      const { job } = await api(`/api/l/tests/${test.id}/ki-umwandeln`, { dateien, modus: m, probe, zielMinuten, richtung: erstellWahl.richtung, anzahl: erstellWahl.anzahl });
      const e = await warteAufJob(job, (t) => { fortschritt.textContent = t || 'Die KI arbeitet …'; });
      test.aufgaben = e.aufgaben;
      delete test.aufgabenB;
      if (e.titel && (!test.titel || m !== 'uebernehmen')) test.titel = e.titel;
      if (!test.hilfsmittel && e.hilfsmittel) test.hilfsmittel = e.hilfsmittel;
      if (e.dauerMin) test.dauerMin = e.dauerMin;
      kiHinweise = [];
      if (e.geschaetzteMinuten) {
        kiHinweise.push(`Die KI schätzt die Bearbeitungszeit auf etwa ${e.geschaetzteMinuten} Minuten.`
          + (e.zielMinuten ? ` Gewünscht waren etwa ${e.zielMinuten} Minuten.` : '')
          + ` Im Test eingestellt sind ${test.dauerMin} Minuten (änderbar im Reiter „Einstellungen“).`);
      }
      if (e.bereiche && e.bereiche.length) kiHinweise.push('Abgedeckte Bereiche: ' + e.bereiche.join(' · '));
      kiHinweise.push(...(e.hinweise || []));
      if (erstellWahl.gruppeB) {
        if (m === 'vokabeln' && test.aufgaben.every((a) => a.typ === 'vokabeln')) {
          test.aufgabenB = mischeVokabeltest(test.aufgaben);
          kiHinweise.push('Gruppe B enthält dieselben Vokabeln in anderer Reihenfolge.');
        } else {
          geaendert();
          fortschritt.textContent = 'Gruppe A ist fertig. Jetzt erstellt die KI Gruppe B mit anderen Zahlen …';
          try {
            await erstelleGruppeBMitKi((t) => { fortschritt.textContent = t || 'Die KI erstellt Gruppe B …'; });
          } catch (fehler) {
            kiHinweise.push('Gruppe B konnte nicht erstellt werden (' + fehler.message + '). Du kannst es im Reiter „Aufgaben“ noch einmal versuchen.');
          }
        }
      }
      await fertig();
    } finally {
      knopf.disabled = !kiStatus.bereit && erstellWahl.modus !== 'vokabeln';
      fortschritt.hidden = true;
    }
  }));

  zeigeUnten();
  leere(el,
    h('h2', null, 'Was möchtest du erstellen?'),
    wahlKarten,
    meldung('Lade nur leere Arbeiten, Musterlösungen und Checklisten hoch – keine Dateien mit Namen von Schülerinnen und Schülern. Möglich sind PDF, Word (.docx) und Fotos.', 'info'),
    test.anzahlTeilnahmen ? meldung('Achtung: Zu diesem Test gibt es schon Anmeldungen. Neue Aufgaben würden die bisherigen Antworten wertlos machen.', 'warnung') : null,
    unten,
    kiStatus.bereit ? null : meldung('Kein KI-Schlüssel hinterlegt. Du kannst die Aufgaben im Reiter „Aufgaben“ von Hand anlegen.', 'warnung'),
    fehlerEl, fortschritt, knopf,
    h('p', { class: 'klein' }, 'Danach prüfst und änderst du alles im Reiter „Aufgaben“, bevor du den Test freigibst. Ohne KI: Wechsle direkt dorthin und lege die Aufgaben selbst an.'));
}

// ---------- Reiter 2: Aufgaben bearbeiten ----------

let gruppe = 'A';                // welche Gruppe im Reiter „Aufgaben“ gerade bearbeitet wird
const aktListe = () => (gruppe === 'B' && test.aufgabenB ? test.aufgabenB : test.aufgaben);
const offeneKarten = new Set();   // Aufgaben, deren Bearbeitungsfelder aufgeklappt sind
const kiAenderung = new Map();    // Aufgaben-Kennung -> { vorher, anmerkung } für „Rückgängig“

function fehltEtwas(a) {
  if (!a.text.trim() && a.typ !== 'lueckentext' && a.typ !== 'vokabeln') return 'Die Aufgabenstellung fehlt.';
  if (a.typ === 'mc' && !a.optionen.some((o) => o.richtig)) return 'Es ist keine Antwort als richtig markiert.';
  if (a.typ === 'mc' && a.optionen.some((o) => !o.text.trim())) return 'Eine Antwortmöglichkeit ist leer.';
  if (a.typ === 'zahl' && !a.loesung.trim()) return 'Die Lösung fehlt.';
  if (a.typ === 'lueckentext' && !lueckenAus(a.lueckentext).length) return 'Der Text enthält noch keine Lücke.';
  if ((a.typ === 'zuordnung' || a.typ === 'vokabeln') && !a.paare.length) return 'Es sind noch keine Paare eingetragen.';
  if (a.typ === 'zuordnung' && a.paare.some((p) => !p.links.trim() || !p.rechts.trim())) return 'Ein Paar ist unvollständig.';
  if (a.typ === 'vokabeln' && a.paare.some((p) => !p.wort.trim() || !p.loesung.trim())) return 'Eine Vokabel ist unvollständig.';
  if (a.typ === 'offen' && !a.erwartung.trim()) return 'Der Erwartungshorizont fehlt – ohne ihn kann die KI keine guten Punktvorschläge machen.';
  return '';
}

function zeigeErwartungshorizont() {
  const maxPunkte = aktListe().reduce((s, a) => s + a.punkte, 0);
  const minuten = aktListe().reduce((s, a) => s + a.minuten, 0);
  const schliesse = () => {
    ansicht.remove();
    document.body.classList.remove('mit-druckansicht');
  };
  const ansicht = h('div', { class: 'druckansicht' },
    h('div', { class: 'werkzeug nicht-drucken' },
      h('button', { class: 'knopf', onclick: () => window.print() }, 'Drucken / als PDF sichern'),
      h('button', { class: 'knopf zweit', onclick: schliesse }, 'Schließen')),
    h('section', { class: 'bogen' },
      h('div', { class: 'bogen-kopf' },
        h('div', null, h('h2', null, 'Erwartungshorizont' + (test.aufgabenB ? ` – Gruppe ${gruppe}` : '')), h('div', null, test.titel || 'Ohne Titel', test.klasse ? ` · Klasse ${test.klasse}` : '')),
        h('div', null, `${zahlText(maxPunkte)} Punkte · ${test.dauerMin} Minuten`)),
      h('table', { class: 'bogen-tabelle' },
        h('thead', null, h('tr', null, h('th', null, 'Nr.'), h('th', null, 'Aufgabe'), h('th', null, 'Lösung'), h('th', null, 'Lösungsweg / Erwartung'), h('th', null, 'Punkte'))),
        h('tbody', null, aktListe().map((a, i) => h('tr', null,
          h('td', { class: 'nr' }, String(i + 1)),
          h('td', null, a.titel ? h('span', { class: 'aufg' }, a.titel) : null, textEl('span', null, a.typ === 'lueckentext' && !a.text ? a.lueckentext.replace(/\{\{.*?\}\}/g, '____') : a.text)),
          textEl('td', null, a.typ === 'offen' ? '' : bewerte(a, undefined).loesungText),
          textEl('td', null, [a.typ === 'offen' ? a.erwartung : '', a.loesungsweg].filter(Boolean).join('\n')),
          h('td', { class: 'pkt' }, zahlText(a.punkte)))))),
      h('div', { class: 'bogen-fuss' }, minuten ? `Geschätzte Bearbeitungszeit der Aufgaben: etwa ${zahlText(minuten)} Minuten. ` : '',
        'Notenschlüssel: ' + test.notenschluessel.map((s) => `Note ${s.note} ab ${zahlText(s.ab)} %`).join(' · '))));
  document.body.append(ansicht);
  document.body.classList.add('mit-druckansicht');
}

// Gruppe B von der KI erstellen lassen: zu jeder Aufgabe der Gruppe A eine gleich schwere mit anderen Zahlen.
async function erstelleGruppeBMitKi(beiFortschritt) {
  await speichere();
  const { job } = await api(`/api/l/tests/${test.id}/ki-gruppe-b`, { aufgaben: test.aufgaben });
  const e = await warteAufJob(job, beiFortschritt);
  test.aufgabenB = e.aufgaben;
  if (e.hinweise && e.hinweise.length) kiHinweise.push(...e.hinweise.map((t) => 'Gruppe B: ' + t));
  kiHinweise.push('Gruppe B stammt von der KI. Bitte prüfe jede Aufgabe und Lösung der Gruppe B.');
  geaendert();
  await speichere();
}

function gruppenLeiste(neuAlles) {
  const fehlerEl = h('p', { class: 'meldung fehler', hidden: true });
  const status = h('p', { class: 'meldung info', hidden: true });
  const mitKi = (knopf) => mitFehler(fehlerEl, async () => {
    if (test.aufgabenB && !confirm('Die bisherige Gruppe B wird ersetzt. Fortfahren?')) return;
    knopf.disabled = true;
    status.hidden = false;
    status.textContent = 'Die KI erstellt Gruppe B …';
    try {
      await erstelleGruppeBMitKi((t) => { status.textContent = t || 'Die KI erstellt Gruppe B …'; });
      gruppe = 'B';
      neuAlles();
    } finally {
      knopf.disabled = false;
      status.hidden = true;
    }
  });
  const kiKnopf = h('button', { class: 'knopf zweit klein', disabled: !kiStatus.bereit || !test.aufgaben.length }, test.aufgabenB ? 'Gruppe B neu von der KI erstellen' : 'Gruppe B von der KI erstellen (andere Zahlen)');
  kiKnopf.addEventListener('click', () => mitKi(kiKnopf));

  if (!test.aufgabenB) {
    return h('div', { class: 'karte gruppen' },
      h('h3', null, 'Gruppe A und B'),
      h('p', { class: 'klein' }, 'Bisher schreiben alle dieselbe Arbeit. Mit einer Gruppe B bekommt jede zweite Nummer (2, 4, 6 …) eine gleich schwere Fassung mit anderen Zahlen – so nützt der Blick zum Nachbarn nichts.'),
      h('div', { class: 'knopfzeile' }, kiKnopf,
        h('button', { class: 'knopf zweit klein', disabled: !test.aufgaben.length, onclick: () => {
          test.aufgabenB = test.aufgaben.map((a) => normalisiereAufgabe({ ...JSON.parse(JSON.stringify(a)), id: undefined }));
          gruppe = 'B';
          geaendert();
          neuAlles();
        } }, 'Gruppe B als Kopie anlegen und selbst ändern')),
      fehlerEl, status);
  }

  const punkte = (l) => l.reduce((s, a) => s + a.punkte, 0);
  const ungleich = test.aufgaben.length !== test.aufgabenB.length ? 'Die Gruppen haben unterschiedlich viele Aufgaben.'
    : punkte(test.aufgaben) !== punkte(test.aufgabenB) ? 'Die Gruppen haben unterschiedlich viele Punkte.' : '';
  const wahl = (g, text) => h('button', { class: 'knopf klein' + (gruppe === g ? '' : ' zweit'), onclick: () => { gruppe = g; neuAlles(); } }, text);
  return h('div', { class: 'karte gruppen' },
    h('div', { class: 'knopfzeile' },
      h('b', null, 'Du bearbeitest: '),
      wahl('A', 'Gruppe A (ungerade Nummern)'),
      wahl('B', 'Gruppe B (gerade Nummern)'),
      h('span', { class: 'spreizer' }),
      kiKnopf,
      h('button', { class: 'knopf zweit klein gefahr', onclick: () => {
        if (!confirm('Gruppe B wirklich entfernen? Dann schreiben wieder alle dieselbe Arbeit.')) return;
        delete test.aufgabenB;
        gruppe = 'A';
        geaendert();
        neuAlles();
      } }, 'Gruppe B entfernen')),
    ungleich ? meldung(ungleich + ' Für eine faire Bewertung sollten beide Gruppen gleich aufgebaut sein.', 'warnung') : null,
    test.anzahlTeilnahmen ? meldung('Es gibt schon Anmeldungen. Wer zu welcher Gruppe gehört, wurde bei der Anmeldung festgelegt.', 'info') : null,
    fehlerEl, status);
}

function reiterAufgaben(el) {
  if (gruppe === 'B' && !test.aufgabenB) gruppe = 'A';
  const neuAlles = () => reiterAufgaben(el);
  const karten = h('div', { class: 'aufgabenliste' });
  const summe = h('p', { class: 'summe' });
  const zeigeSumme = () => {
    const minuten = aktListe().reduce((s, a) => s + (Number(a.minuten) || 0), 0);
    summe.textContent = (test.aufgabenB ? `Gruppe ${gruppe}: ` : '')
      + `${aktListe().length} Aufgaben · ${zahlText(aktListe().reduce((s, a) => s + (Number(a.punkte) || 0), 0))} Punkte`
      + (minuten ? ` · Aufgaben zusammen etwa ${zahlText(minuten)} Minuten (eingestellt: ${test.dauerMin} Minuten)` : '');
  };
  const neu = () => {
    leere(karten, aktListe().map((a, i) => aufgabenKarte(a, i, neu, zeigeSumme)));
    zeigeSumme();
  };
  const typWahl = h('select', { class: 'feld schmal' }, Object.entries(TYPEN).map(([k, v]) => h('option', { value: k }, v)));
  neu();
  leere(el,
    h('h2', null, 'Aufgaben prüfen und ändern'),
    h('p', null, 'Du siehst jede Aufgabe so, wie die Klasse sie sieht, darunter die Lösung. Mit „Bearbeiten“ änderst du Text, Lösung und Punkte selbst. Mit „Mit KI ändern“ sagst du in einem Satz, was anders werden soll.'),
    kiHinweise.length ? h('div', { class: 'meldung ' + (kiHinweise.some((t) => /^(ACHTUNG|DEMO)/.test(t)) ? 'warnung' : 'info') }, h('b', null, 'Hinweise – bitte prüfen:'), h('ul', null, kiHinweise.map((t) => h('li', null, t)))) : null,
    test.status !== 'entwurf' ? meldung('Dieser Test ist bereits freigegeben. Lösungen und Punkte kannst du noch korrigieren (die Auswertung passt sich an). Lösche oder ergänze aber keine Aufgaben mehr.', 'warnung') : null,
    gruppenLeiste(neuAlles),
    h('div', { class: 'knopfzeile' },
      summe, h('span', { class: 'spreizer' }),
      h('button', { class: 'knopf zweit klein', disabled: !aktListe().length, onclick: zeigeErwartungshorizont }, 'Erwartungshorizont anzeigen / drucken'),
      h('button', { class: 'knopf zweit klein', disabled: !aktListe().length, onclick: () => {
        const alleOffen = aktListe().every((a) => offeneKarten.has(a.id));
        for (const a of aktListe()) offeneKarten.delete(a.id);
        if (!alleOffen) for (const a of aktListe()) offeneKarten.add(a.id);
        neu();
      } }, 'Alle auf-/zuklappen')),
    karten,
    h('div', { class: 'neu-zeile' }, typWahl, h('button', { class: 'knopf', onclick: () => {
      const a = neueAufgabe(typWahl.value);
      aktListe().push(a);
      offeneKarten.add(a.id);
      geaendert();
      neu();
      karten.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } }, '+ Aufgabe hinzufügen')));
}

// Feld „Mit KI ändern“: eine Anweisung in Worten, die KI schreibt die Aufgabe um.
function kiAendernFeld(a, neuZeichnen) {
  const fehlerEl = h('p', { class: 'meldung fehler', hidden: true });
  const status = h('p', { class: 'meldung info', hidden: true });
  const eingabe = h('textarea', { class: 'feld', rows: '2', placeholder: 'Was soll anders werden? Zum Beispiel: „andere Zahlen, aber wieder ein glattes Ergebnis“ oder „als Auswahlaufgabe mit vier Antworten“' });
  const knoepfe = [];
  const starte = (anweisung) => mitFehler(fehlerEl, async () => {
    if (!anweisung.trim()) throw new Error('Bitte schreib kurz, was geändert werden soll.');
    await speichere();
    knoepfe.forEach((k) => { k.disabled = true; });
    status.hidden = false;
    status.textContent = 'Die KI ändert die Aufgabe …';
    try {
      const { job } = await api(`/api/l/tests/${test.id}/ki-aufgabe`, { aufgabe: a, anweisung });
      const e = await warteAufJob(job, (t) => { status.textContent = t || 'Die KI ändert die Aufgabe …'; });
      const stelle = aktListe().findIndex((x) => x.id === a.id);
      if (stelle < 0) return;
      kiAenderung.set(a.id, { vorher: a, anmerkung: e.anmerkung });
      aktListe()[stelle] = e.aufgabe;
      geaendert();
      neuZeichnen();
    } finally {
      knoepfe.forEach((k) => { k.disabled = false; });
      status.hidden = true;
    }
  });
  const schnell = ['Andere Zahlen', 'Etwas leichter', 'Etwas schwerer', 'Klarer formulieren', 'Lösung und Lösungsweg prüfen und ergänzen'];
  knoepfe.push(...schnell.map((t) => h('button', { class: 'knopf zweit klein', onclick: () => starte(t) }, t)));
  const los = h('button', { class: 'knopf klein', onclick: () => starte(eingabe.value) }, 'Ändern lassen');
  knoepfe.push(los);
  return h('div', { class: 'ki-aendern', hidden: true },
    h('div', { class: 'vorschau-titel' }, 'Mit KI ändern'),
    kiStatus.bereit ? null : meldung('Kein KI-Schlüssel hinterlegt – bitte von Hand bearbeiten.', 'warnung'),
    h('div', { class: 'knopfzeile' }, knoepfe.slice(0, schnell.length)),
    eingabe, fehlerEl, status,
    h('div', { class: 'knopfzeile' }, los, h('span', { class: 'klein' }, 'Die bisherige Fassung kannst du danach mit „Rückgängig“ zurückholen.')));
}

function aufgabenKarte(a, i, neuZeichnen, zeigeSumme) {
  const offen = offeneKarten.has(a.id);
  const karte = h('article', { class: 'karte editor' + (offen ? ' offen' : '') });

  const verschiebe = (um) => {
    const ziel = i + um;
    if (ziel < 0 || ziel >= aktListe().length) return;
    aktListe().splice(ziel, 0, aktListe().splice(i, 1)[0]);
    geaendert();
    neuZeichnen();
  };
  const klappe = (auf) => {
    if (auf) offeneKarten.add(a.id);
    else offeneKarten.delete(a.id);
    neuZeichnen();
  };
  const kiFeld = kiAendernFeld(a, neuZeichnen);
  const werkzeuge = [
    h('button', { class: 'knopf zweit klein', onclick: () => { kiFeld.hidden = !kiFeld.hidden; } }, 'Mit KI ändern'),
    h('button', { class: 'knopf zweit klein', title: 'nach oben', disabled: i === 0, onclick: () => verschiebe(-1) }, '↑'),
    h('button', { class: 'knopf zweit klein', title: 'nach unten', disabled: i === aktListe().length - 1, onclick: () => verschiebe(1) }, '↓'),
    h('button', { class: 'knopf zweit klein', title: 'Kopie dieser Aufgabe anlegen', onclick: () => {
      const kopie = normalisiereAufgabe({ ...JSON.parse(JSON.stringify(a)), id: undefined });
      aktListe().splice(i + 1, 0, kopie);
      offeneKarten.add(kopie.id);
      geaendert();
      neuZeichnen();
    } }, 'Kopie'),
    h('button', { class: 'knopf zweit klein gefahr', onclick: () => {
      if (!confirm(`Aufgabe ${i + 1} wirklich löschen?`)) return;
      aktListe().splice(i, 1);
      geaendert();
      neuZeichnen();
    } }, 'Löschen'),
  ];

  const aend = kiAenderung.get(a.id);
  const kiMeldung = aend ? h('div', { class: 'meldung gut' }, 'Von der KI geändert. ', aend.anmerkung, ' ',
    h('button', { class: 'linkknopf', onclick: () => {
      const stelle = aktListe().findIndex((x) => x.id === a.id);
      if (stelle >= 0) aktListe()[stelle] = aend.vorher;
      kiAenderung.delete(a.id);
      geaendert();
      neuZeichnen();
    } }, 'Rückgängig'), ' · ',
    h('button', { class: 'linkknopf', onclick: () => { kiAenderung.delete(a.id); neuZeichnen(); } }, 'ausblenden')) : null;

  // ----- zugeklappt: Ansicht wie für die SuS, darunter die Lösung -----
  if (!offen) {
    const feld = h('div', { class: 'aufgabe-eingabe kompakt' });
    zeichneAufgabe(feld, fuerSuS(a), undefined, null, test.id);
    const mangel = fehltEtwas(a);
    const loesung = a.typ === 'offen' ? a.erwartung : bewerte(a, undefined).loesungText;
    leere(karte,
      h('div', { class: 'editor-kopf' },
        h('b', { class: 'nr' }, `Aufgabe ${i + 1}`),
        a.titel ? h('span', { class: 'untertitel' }, `(${a.titel})`) : null,
        h('span', { class: 'marke' }, TYPEN[a.typ]),
        h('span', { class: 'punkte' }, `${zahlText(a.punkte)} ${a.punkte === 1 ? 'Punkt' : 'Punkte'}${a.minuten ? ` · ca. ${zahlText(a.minuten)} Min.` : ''}`),
        h('span', { class: 'spreizer' }),
        h('button', { class: 'knopf klein', onclick: () => klappe(true) }, 'Bearbeiten'),
        werkzeuge),
      kiMeldung,
      mangel ? meldung('Bitte prüfen: ' + mangel, 'warnung') : null,
      a.abbildungFehlt ? meldung('Hier fehlt vermutlich eine Abbildung: ' + a.abbildungFehlt + ' (über „Bearbeiten“ einfügen)', 'warnung') : null,
      kiFeld,
      feld,
      h('div', { class: 'loesungszeile' }, h('b', null, a.typ === 'offen' ? 'Erwartung: ' : 'Lösung: '), textEl('span', null, loesung || '–')),
      a.loesungsweg ? h('div', { class: 'loesungszeile klein' }, h('b', null, 'Lösungsweg: '), textEl('span', null, a.loesungsweg)) : null);
    return karte;
  }

  // ----- aufgeklappt: alle Felder -----
  const vorschau = h('div', { class: 'vorschau', hidden: true });
  let probe;
  const zeigeVorschau = () => {
    if (vorschau.hidden) return;
    const feld = h('div', { class: 'aufgabe-eingabe' });
    const urteil = h('p', { class: 'meldung info' });
    const beurteile = () => {
      const r = bewerte(a, probe);
      urteil.textContent = r.status === 'offen' ? 'Offene Aufgabe: Die KI schlägt später Punkte vor, du bestätigst.'
        : r.status === 'leer' ? 'Gib eine Probe-Antwort ein, um die automatische Bewertung zu prüfen.'
        : `Diese Antwort bekäme ${zahlText(r.punkte)} von ${zahlText(r.max)} Punkten.`;
    };
    zeichneAufgabe(feld, fuerSuS(a), probe, (w) => { probe = w; beurteile(); }, test.id);
    beurteile();
    leere(vorschau, h('div', { class: 'vorschau-titel' }, 'Vorschau – so sehen es die SuS'), feld, urteil);
  };
  const aendere = () => {
    geaendert();
    zeigeVorschau();
  };

  const typWahl = h('select', { class: 'feld schmal' }, Object.entries(TYPEN).map(([k, v]) => h('option', { value: k, selected: k === a.typ }, v)));
  typWahl.addEventListener('change', () => {
    aktListe()[i] = normalisiereAufgabe({ ...a, typ: typWahl.value });
    geaendert();
    neuZeichnen();
  });
  const punkte = textfeld(zahlText(a.punkte), (v) => {
    const n = parseZahl(v);
    if (n != null && n >= 0) {
      a.punkte = n;
      zeigeSumme();
      aendere();
    }
  }, { class: 'feld winzig', inputmode: 'decimal' });

  const bildBereich = h('div', { class: 'bildbereich' });
  const zeigeBild = () => leere(bildBereich,
    a.abbildungFehlt ? meldung('Hier fehlt vermutlich eine Abbildung: ' + a.abbildungFehlt, 'warnung') : null,
    a.bild ? h('img', { class: 'aufgabenbild klein-bild', src: bildUrl(test.id, a.bild), alt: '' }) : null,
    h('div', { class: 'knopfzeile' },
      h('button', { class: 'knopf zweit klein', onclick: () => oeffneBildDialog(a, () => { zeigeBild(); aendere(); }) }, a.bild ? 'Bild ersetzen' : 'Bild hinzufügen'),
      a.bild ? h('button', { class: 'knopf zweit klein', onclick: () => { a.bild = ''; zeigeBild(); aendere(); } }, 'Bild entfernen') : null,
      a.abbildungFehlt ? h('button', { class: 'linkknopf', onclick: () => { a.abbildungFehlt = ''; zeigeBild(); aendere(); } }, 'Hinweis ausblenden') : null));
  zeigeBild();

  leere(karte,
    h('div', { class: 'editor-kopf' },
      h('b', { class: 'nr' }, `Aufgabe ${i + 1}`),
      textfeld(a.titel, (v) => { a.titel = v; aendere(); }, { class: 'feld kurz', placeholder: 'Bezeichnung, z. B. 1a', 'aria-label': 'Bezeichnung' }),
      typWahl,
      h('label', { class: 'punktefeld' }, punkte, ' Punkte'),
      h('span', { class: 'spreizer' }),
      h('button', { class: 'knopf klein', onclick: () => klappe(false) }, 'Fertig'),
      h('button', { class: 'knopf zweit klein', onclick: () => { vorschau.hidden = !vorschau.hidden; zeigeVorschau(); } }, 'Vorschau'),
      werkzeuge),
    kiMeldung,
    kiFeld,
    feldMit('Aufgabenstellung', textbereich(a.text, (v) => { a.text = v; aendere(); }), 'Formeln in LaTeX zwischen Dollarzeichen, z. B. $\\frac{3}{4}$ oder $x^2$.'),
    bildBereich,
    typEditor(a, aendere),
    a.typ === 'offen' ? null : feldMit('Lösungshinweis für die Rückmeldung (optional)', textfeld(a.hinweis, (v) => { a.hinweis = v; aendere(); }), 'Erscheint auf dem Einzelbogen, wenn die Antwort nicht voll richtig ist.'),
    h('div', { class: 'zweispaltig' },
      feldMit('Lösungsweg für den Erwartungshorizont (optional)', textbereich(a.loesungsweg, (v) => { a.loesungsweg = v; geaendert(); }, { rows: '2' }), 'Nur für dich; erscheint im gedruckten Erwartungshorizont.'),
      h('label', { class: 'feldgruppe' }, h('span', { class: 'beschriftung' }, 'Geschätzte Bearbeitungszeit'),
        h('span', null, textfeld(a.minuten ? zahlText(a.minuten) : '', (v) => { a.minuten = Math.max(0, parseZahl(v) || 0); zeigeSumme(); geaendert(); }, { class: 'feld winzig', inputmode: 'decimal' }), ' Minuten'))),
    vorschau);
  return karte;
}

function zeilenEditor(eintraege, spalten, leer, aendere, zusatz) {
  const kasten = h('div', { class: 'zeileneditor' });
  const neu = () => leere(kasten,
    eintraege.map((e, i) => h('div', { class: 'ezeile' },
      zusatz ? zusatz(e) : null,
      spalten.map(([feld, platzhalter]) => textfeld(e[feld], (v) => { e[feld] = v; aendere(); }, { placeholder: platzhalter, 'aria-label': platzhalter })),
      h('button', { class: 'knopf zweit klein', title: 'Zeile entfernen', onclick: () => { eintraege.splice(i, 1); aendere(); neu(); } }, '✕'))),
    h('button', { class: 'knopf zweit klein', onclick: () => { eintraege.push(leer()); aendere(); neu(); } }, '+ Zeile'));
  neu();
  return kasten;
}

function typEditor(a, aendere) {
  if (a.typ === 'mc') {
    return h('div', { class: 'feldgruppe' }, h('span', { class: 'beschriftung' }, 'Antwortmöglichkeiten (Haken = richtig; mehrere Haken = Mehrfachauswahl)'),
      zeilenEditor(a.optionen, [['text', 'Antwortmöglichkeit']], () => ({ text: '', richtig: false }), aendere, (o) => {
        const haken = h('input', { type: 'checkbox', class: 'haken-feld', checked: o.richtig, title: 'richtig' });
        haken.addEventListener('change', () => { o.richtig = haken.checked; aendere(); });
        return haken;
      }));
  }
  if (a.typ === 'zahl') {
    const pruef = h('small', null);
    const pruefe = () => {
      const n = parseZahl(a.loesung, a.einheit);
      pruef.textContent = n == null ? 'Achtung: Die Lösung ist keine lesbare Zahl – dann wird nur der genaue Text verglichen.' : `Gelesen als ${zahlText(n, 6)}. Gleichwertige Schreibweisen (Bruch, Dezimalzahl) zählen als richtig.`;
    };
    pruefe();
    return h('div', { class: 'dreispaltig' },
      h('label', { class: 'feldgruppe' }, h('span', { class: 'beschriftung' }, 'Lösung'), textfeld(a.loesung, (v) => { a.loesung = v; pruefe(); aendere(); }, { placeholder: 'z. B. 3,5 oder 7/2' }), pruef),
      feldMit('Toleranz (±)', textfeld(zahlText(a.toleranz, 6), (v) => { a.toleranz = Math.max(0, parseZahl(v) || 0); aendere(); }, { inputmode: 'decimal' }), '0 = genau. Bei gerundeten Ergebnissen z. B. 0,01.'),
      feldMit('Einheit (optional)', textfeld(a.einheit, (v) => { a.einheit = v; pruefe(); aendere(); }, { placeholder: 'z. B. cm' })));
  }
  if (a.typ === 'lueckentext') {
    const zahl = h('small', null);
    const zaehle = () => { zahl.textContent = `${lueckenAus(a.lueckentext).length} Lücken erkannt. Jede Lücke zählt gleich viel.`; };
    zaehle();
    const gk = h('input', { type: 'checkbox', checked: a.grossKlein });
    gk.addEventListener('change', () => { a.grossKlein = gk.checked; aendere(); });
    return h('div', null,
      h('label', { class: 'feldgruppe' }, h('span', { class: 'beschriftung' }, 'Text mit Lücken'),
        textbereich(a.lueckentext, (v) => { a.lueckentext = v; zaehle(); aendere(); }, { placeholder: 'Die Hauptstadt von Frankreich ist {{Paris}}. Ein Viertel ist {{0,25|1/4}}.' }),
        h('small', null, 'Lösungen in doppelte geschweifte Klammern: {{Lösung}}. Mehrere gültige Lösungen mit | trennen.'), zahl),
      h('label', { class: 'hakenzeile' }, gk, ' Groß-/Kleinschreibung beachten'));
  }
  if (a.typ === 'zuordnung') {
    return h('div', { class: 'feldgruppe' }, h('span', { class: 'beschriftung' }, 'Paare (links wird angezeigt, rechts wird aus einer Liste gewählt)'),
      zeilenEditor(a.paare, [['links', 'links'], ['rechts', 'passt zu …']], () => ({ links: '', rechts: '' }), aendere));
  }
  if (a.typ === 'vokabeln') {
    const richtung = h('select', { class: 'feld schmal' },
      h('option', { value: 'de-en', selected: a.richtung === 'de-en' }, 'Deutsch → Englisch'),
      h('option', { value: 'en-de', selected: a.richtung === 'en-de' }, 'Englisch → Deutsch'));
    richtung.addEventListener('change', () => { a.richtung = richtung.value; aendere(); });
    return h('div', { class: 'feldgruppe' }, h('span', { class: 'beschriftung' }, 'Vokabeln'), richtung,
      zeilenEditor(a.paare, [['wort', 'Wort'], ['loesung', 'Übersetzung (mehrere mit ; trennen)']], () => ({ wort: '', loesung: '' }), aendere),
      h('small', null, 'Groß-/Kleinschreibung, „to“ und Artikel am Anfang werden beim Vergleich nicht gewertet.'));
  }
  return feldMit('Erwartungshorizont (nur für dich und die KI)', textbereich(a.erwartung, (v) => { a.erwartung = v; aendere(); }, { rows: '4' }),
    'Je genauer mit Punkteverteilung, desto besser die Bewertungsvorschläge der KI. Die Punkte bestätigst immer du.');
}

// ---------- Bild hinzufügen (ganze Datei oder Ausschnitt aus der Vorlage) ----------

let pdfjs = null;
async function holPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  return pdfjs;
}

function oeffneBildDialog(a, fertig) {
  let quelle = null;       // Leinwand mit der aktuellen Seite / dem aktuellen Bild
  let pdf = null;
  let seiteNr = 1;
  let wahl = null;         // Auswahlrechteck in Anteilen (0..1)

  const fehlerEl = h('p', { class: 'meldung fehler', hidden: true });
  const rahmen = h('div', { class: 'ausschnitt-rahmen' });
  const auswahlEl = h('div', { class: 'auswahl', hidden: true });
  const seitenNav = h('div', { class: 'knopfzeile' });
  const uebernehmen = h('button', { class: 'knopf', disabled: true }, 'Ganzes Bild übernehmen');

  const zeigeQuelle = () => {
    wahl = null;
    auswahlEl.hidden = true;
    quelle.className = 'ausschnitt-bild';
    leere(rahmen, quelle, auswahlEl);
    uebernehmen.disabled = false;
    uebernehmen.textContent = 'Ganzes Bild übernehmen';
    leere(seitenNav, pdf && pdf.numPages > 1 ? [
      h('button', { class: 'knopf zweit klein', disabled: seiteNr <= 1, onclick: () => zeigeSeite(seiteNr - 1) }, '‹'),
      h('span', null, `Seite ${seiteNr} von ${pdf.numPages}`),
      h('button', { class: 'knopf zweit klein', disabled: seiteNr >= pdf.numPages, onclick: () => zeigeSeite(seiteNr + 1) }, '›'),
    ] : null);
  };

  const zeigeSeite = (nr) => mitFehler(fehlerEl, async () => {
    seiteNr = nr;
    const seite = await pdf.getPage(nr);
    const sicht = seite.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = Math.round(sicht.width);
    c.height = Math.round(sicht.height);
    await seite.render({ canvasContext: c.getContext('2d'), viewport: sicht }).promise;
    quelle = c;
    zeigeQuelle();
  });

  const oeffne = (datei) => mitFehler(fehlerEl, async () => {
    pdf = null;
    if (istPdf(datei)) {
      const lib = await holPdfjs();
      pdf = await lib.getDocument({ data: await datei.arrayBuffer() }).promise;
      await zeigeSeite(1);
    } else {
      quelle = aufLeinwand(await ladeBild(datei), 3000);
      zeigeQuelle();
    }
  });

  // Rechteck aufziehen (Maus oder Finger)
  let start = null;
  const punkt = (ev) => {
    const r = rahmen.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)) };
  };
  rahmen.addEventListener('pointerdown', (ev) => {
    if (!quelle) return;
    start = punkt(ev);
    rahmen.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  rahmen.addEventListener('pointermove', (ev) => {
    if (!start) return;
    const p = punkt(ev);
    wahl = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), b: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    auswahlEl.hidden = false;
    Object.assign(auswahlEl.style, { left: wahl.x * 100 + '%', top: wahl.y * 100 + '%', width: wahl.b * 100 + '%', height: wahl.h * 100 + '%' });
  });
  rahmen.addEventListener('pointerup', () => {
    start = null;
    if (wahl && (wahl.b < 0.02 || wahl.h < 0.02)) {
      wahl = null;
      auswahlEl.hidden = true;
    }
    uebernehmen.textContent = wahl ? 'Ausschnitt übernehmen' : 'Ganzes Bild übernehmen';
  });

  const schliesse = () => dialog.remove();
  uebernehmen.addEventListener('click', () => mitFehler(fehlerEl, async () => {
    const w = wahl || { x: 0, y: 0, b: 1, h: 1 };
    const sx = Math.round(w.x * quelle.width);
    const sy = Math.round(w.y * quelle.height);
    const sb = Math.max(1, Math.round(w.b * quelle.width));
    const sh = Math.max(1, Math.round(w.h * quelle.height));
    const f = Math.min(1, 1400 / Math.max(sb, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sb * f));
    c.height = Math.max(1, Math.round(sh * f));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(quelle, sx, sy, sb, sh, 0, 0, c.width, c.height);
    uebernehmen.disabled = true;
    try {
      const r = await api(`/api/l/tests/${test.id}/bild`, { daten: c.toDataURL('image/jpeg', 0.9) });
      a.bild = r.bild;
      a.abbildungFehlt = '';
      schliesse();
      fertig();
    } finally {
      uebernehmen.disabled = false;
    }
  }));

  const dateiwahl = h('input', { type: 'file', accept: 'image/*,.pdf,.heic' });
  dateiwahl.addEventListener('change', () => dateiwahl.files[0] && oeffne(dateiwahl.files[0]));

  const dialog = h('div', { class: 'dialog-hintergrund' },
    h('div', { class: 'dialog karte breit', role: 'dialog', 'aria-modal': 'true' },
      h('h2', null, 'Bild zur Aufgabe'),
      h('p', { class: 'klein' }, 'Wähle ein Bild oder eine Seite deiner Vorlage. Ziehe dann mit der Maus einen Rahmen um die Abbildung – oder übernimm das ganze Bild.'),
      h('div', { class: 'knopfzeile' },
        vorlagen.map((d) => h('button', { class: 'knopf zweit klein', onclick: () => oeffne(d) }, d.name)),
        h('label', { class: 'dateiknopf' }, 'Andere Datei: ', dateiwahl)),
      fehlerEl, seitenNav, rahmen,
      h('div', { class: 'dialog-knoepfe' }, h('button', { class: 'knopf zweit', onclick: schliesse }, 'Abbrechen'), uebernehmen)));
  document.body.append(dialog);
}

// ---------- Reiter 3: Einstellungen ----------

function reiterEinstellungen(el) {
  const zahlfeld = (wert, setze, attrs) => textfeld(wert, (v) => {
    const n = parseZahl(v);
    if (n != null) {
      setze(n);
      geaendert();
    }
  }, { class: 'feld winzig', inputmode: 'numeric', ...attrs });

  const schluessel = h('div', { class: 'schluessel' }, test.notenschluessel.map((s) =>
    h('label', { class: 'schluessel-zeile' }, h('b', null, `Note ${s.note}`), ' ab ', zahlfeld(zahlText(s.ab), (n) => { s.ab = Math.max(0, Math.min(100, n)); pruefeSchluessel(); }, { inputmode: 'decimal' }), ' %')),
    h('div', { class: 'schluessel-zeile klein' }, h('b', null, 'Note 6'), ' darunter'));
  const schluesselWarnung = h('p', { class: 'meldung warnung', hidden: true }, 'Die Grenzen müssen von Note 1 bis Note 5 kleiner werden.');
  const pruefeSchluessel = () => {
    schluesselWarnung.hidden = test.notenschluessel.every((s, i, alle) => i === 0 || s.ab < alle[i - 1].ab);
  };
  pruefeSchluessel();

  const ntaKasten = h('div', { class: 'zeileneditor' });
  const zeigeNta = () => {
    const eintraege = Object.entries(test.nta || {}).map(([nr, min]) => [Number(nr), min]).sort((x, y) => x[0] - y[0]);
    const nr = h('input', { type: 'text', class: 'feld winzig', inputmode: 'numeric', placeholder: 'Nr.' });
    const min = h('input', { type: 'text', class: 'feld winzig', inputmode: 'numeric', placeholder: 'Min.' });
    leere(ntaKasten,
      eintraege.length ? eintraege.map(([n, m]) => h('div', { class: 'ezeile' }, h('span', null, `Nummer ${n}: + ${m} Minuten`),
        h('button', { class: 'knopf zweit klein', onclick: () => { delete test.nta[n]; geaendert(); zeigeNta(); } }, '✕'))) : h('p', { class: 'klein' }, 'Noch keine Verlängerungen eingetragen.'),
      h('div', { class: 'ezeile' }, 'Nummer ', nr, ' bekommt ', min, ' Minuten zusätzlich ',
        h('button', { class: 'knopf zweit klein', onclick: () => {
          const n = Math.round(parseZahl(nr.value) || 0);
          const m = Math.round(parseZahl(min.value) || 0);
          if (n < 1 || n > test.anzahlNummern || m < 1) return alert('Bitte eine gültige Nummer und eine Minutenzahl eingeben.');
          test.nta = test.nta || {};
          test.nta[n] = m;
          geaendert();
          zeigeNta();
        } }, 'Eintragen')));
  };
  zeigeNta();

  leere(el,
    h('h2', null, 'Einstellungen'),
    h('div', { class: 'karte' },
      h('div', { class: 'zweispaltig' },
        feldMit('Titel', textfeld(test.titel, (v) => { test.titel = v; geaendert(); }, { placeholder: 'z. B. Klassenarbeit Nr. 2 – Bruchrechnung' })),
        feldMit('Klasse', textfeld(test.klasse, (v) => { test.klasse = v; geaendert(); }, { placeholder: 'z. B. 6b' }))),
      h('div', { class: 'zweispaltig' },
        h('label', { class: 'feldgruppe' }, h('span', { class: 'beschriftung' }, 'Bearbeitungszeit'), h('span', null, zahlfeld(test.dauerMin, (n) => { test.dauerMin = Math.max(1, Math.round(n)); }), ' Minuten'),
          h('small', null, 'Die Zeit läuft für jede Nummer ab dem Tippen auf „Test starten“.')),
        h('label', { class: 'feldgruppe' }, h('span', { class: 'beschriftung' }, 'Anzahl der SuS-Nummern'), h('span', null, '1 bis ', zahlfeld(test.anzahlNummern, (n) => { test.anzahlNummern = Math.max(1, Math.min(200, Math.round(n))); })),
          h('small', null, 'Wie in deiner Klassenliste. Die Zuordnung Nummer → Name bleibt bei dir.'))),
      feldMit('Erlaubte Hilfsmittel', textfeld(test.hilfsmittel, (v) => { test.hilfsmittel = v; geaendert(); }, { placeholder: 'z. B. Geodreieck, Zirkel, kein Taschenrechner' }), 'Wird den SuS vor dem Start angezeigt.')),
    h('div', { class: 'karte' }, h('h3', null, 'Notenschlüssel'), h('p', { class: 'klein' }, 'Prozent der erreichbaren Punkte, ab denen es die Note gibt.'), schluessel, schluesselWarnung),
    h('div', { class: 'karte' }, h('h3', null, 'Nachteilsausgleich: mehr Bearbeitungszeit'), h('p', { class: 'klein' }, 'Gilt nur für die eingetragenen Nummern. Lässt sich auch während des Tests noch ändern.'), ntaKasten),
    h('div', { class: 'karte' }, h('h3', null, 'Test löschen'), h('p', { class: 'klein' }, 'Löscht den Test mit allen Antworten und Ergebnissen unwiderruflich.'),
      h('button', { class: 'knopf zweit gefahr', onclick: async () => {
        if (!confirm('Diesen Test mit allen Antworten und Ergebnissen endgültig löschen?')) return;
        ungespeichert = false;
        await api('/api/l/tests/' + test.id, undefined, 'DELETE');
        location.hash = '#/';
      } }, 'Test endgültig löschen')));
}

// ---------- Reiter 4: Freigabe und Live-Übersicht ----------

function zeichneQr(canvas, text, groesse) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const rand = 3;
  const zelle = Math.max(2, Math.floor(groesse / (n + 2 * rand)));
  canvas.width = canvas.height = zelle * (n + 2 * rand);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + rand) * zelle, (r + rand) * zelle, zelle, zelle);
}

function qrLeinwand(text, groesse) {
  const c = h('canvas', { class: 'qr' });
  try {
    zeichneQr(c, text, groesse);
  } catch {
    return h('p', { class: 'meldung warnung' }, 'Der QR-Code konnte nicht erzeugt werden. Nutze den Link.');
  }
  return c;
}

function zeigeBeamer() {
  const link = location.origin + '/t/' + test.id;
  const groesse = Math.floor(Math.min(window.innerHeight * 0.62, window.innerWidth * 0.42));
  const ansicht = h('div', { class: 'beamer' },
    h('button', { class: 'knopf zweit beamer-zu', onclick: () => ansicht.remove() }, 'Schließen ✕'),
    h('div', { class: 'beamer-inhalt' },
      qrLeinwand(link, groesse),
      h('div', { class: 'beamer-text' },
        h('h1', null, test.titel),
        h('p', null, 'QR-Code scannen oder eingeben:'),
        h('p', { class: 'beamer-link' }, link.replace(/^https?:\/\//, '')),
        h('p', null, 'Test-Code:'),
        h('p', { class: 'beamer-code' }, test.code),
        h('p', { class: 'klein' }, 'Anmelden mit deiner Nummer – ohne Namen.'))));
  document.body.append(ansicht);
}

async function reiterDurchfuehrung(el) {
  await speichere();
  const link = location.origin + '/t/' + test.id;
  const fehlerEl = h('p', { class: 'meldung fehler', hidden: true });
  const setzeStatus = (status, frage) => mitFehler(fehlerEl, async () => {
    if (frage && !confirm(frage)) return;
    test = (await api(`/api/l/tests/${test.id}/status`, { status })).test;
    zeigeTest(test.id, 'durchfuehrung');
  });

  let kopf;
  if (test.status === 'entwurf') {
    kopf = h('div', { class: 'karte' },
      h('h3', null, 'Test freigeben'),
      h('p', null, `${test.aufgaben.length} Aufgaben · ${test.dauerMin} Minuten · Nummern 1–${test.anzahlNummern}. Nach der Freigabe können sich die SuS mit Nummer und Test-Code anmelden. Prüfe vorher die Aufgaben und Einstellungen.`),
      h('button', { class: 'knopf', onclick: () => setzeStatus('freigegeben') }, 'Test jetzt freigeben'));
  } else {
    kopf = h('div', { class: 'karte freigabe' },
      qrLeinwand(link, 220),
      h('div', null,
        h('p', null, h('span', { class: 'beschriftung' }, 'Link für die SuS'), h('a', { href: link, target: '_blank', rel: 'noopener', class: 'gross-link' }, link.replace(/^https?:\/\//, ''))),
        h('p', null, h('span', { class: 'beschriftung' }, 'Test-Code'), h('span', { class: 'code' }, test.code)),
        h('div', { class: 'knopfzeile' },
          h('button', { class: 'knopf', onclick: zeigeBeamer }, 'Groß anzeigen (Beamer)'),
          test.status === 'freigegeben'
            ? h('button', { class: 'knopf zweit gefahr', onclick: () => setzeStatus('beendet', 'Test für alle beenden? Wer noch arbeitet, wird sofort mit dem aktuellen Stand abgegeben.') }, 'Test für alle beenden')
            : h('button', { class: 'knopf zweit', onclick: () => setzeStatus('freigegeben') }, 'Wieder freigeben'),
          test.status === 'freigegeben' && !test.anzahlTeilnahmen ? h('button', { class: 'knopf zweit', onclick: () => setzeStatus('entwurf') }, 'Zurück zum Entwurf') : null),
        test.status === 'beendet' ? meldung('Der Test ist beendet. Es sind keine Anmeldungen und Abgaben mehr möglich.', 'info') : null));
  }

  const raster = h('div', { class: 'raster live' });
  const zaehler = h('p', { class: 'summe' });
  const detail = h('div', { class: 'karte', hidden: true });
  const vorfaelle = h('div');
  let gewaehlt = null;
  let letzte = [];

  const TEXT = { frei: 'nicht angemeldet', angemeldet: 'angemeldet', laeuft: 'arbeitet', abgegeben: 'abgegeben' };

  const zeigeDetail = () => {
    const n = letzte.find((x) => x.nummer === gewaehlt);
    if (!n) return (detail.hidden = true);
    detail.hidden = false;
    const aktion = (aktion, frage, extra) => mitFehler(fehlerEl, async () => {
      if (frage && !confirm(frage)) return;
      await api(`/api/l/tests/${test.id}/teilnahme/${n.nummer}`, { aktion, ...extra });
      if (aktion === 'nta') {
        test.nta = test.nta || {};
        if (extra.minuten > 0) test.nta[n.nummer] = extra.minuten;
        else delete test.nta[n.nummer];
      }
      await hole();
      zeigeDetail();
    });
    const min = h('input', { type: 'text', class: 'feld winzig', inputmode: 'numeric', value: n.nta || '' });
    leere(detail,
      h('h3', null, `Nummer ${n.nummer} – ${TEXT[n.zustand]}`,
        n.abgabeArt === 'zeit' ? ' (automatisch nach Zeitablauf)' : n.abgabeArt === 'lehrkraft' ? ' (durch Beenden des Tests)' : ''),
      h('div', { class: 'ezeile' }, 'Zusätzliche Bearbeitungszeit: ', min, ' Minuten ',
        h('button', { class: 'knopf zweit klein', onclick: () => aktion('nta', null, { minuten: Math.max(0, Math.round(parseZahl(min.value) || 0)) }) }, 'Speichern')),
      h('div', { class: 'knopfzeile' },
        n.zustand === 'angemeldet' || n.zustand === 'laeuft'
          ? h('button', { class: 'knopf zweit klein', disabled: n.neuanmeldungErlaubt, onclick: () => aktion('neuanmeldung') }, n.neuanmeldungErlaubt ? 'Neu-Anmeldung ist erlaubt' : 'Neu-Anmeldung auf anderem Gerät erlauben') : null,
        n.zustand === 'angemeldet'
          ? h('button', { class: 'knopf zweit klein gefahr', onclick: () => aktion('loeschen', `Anmeldung von Nummer ${n.nummer} löschen? Die Nummer ist danach wieder frei.`) }, 'Anmeldung löschen') : null,
        n.zustand === 'abgegeben' && test.status === 'freigegeben'
          ? h('button', { class: 'knopf zweit klein', onclick: () => aktion('wieder_oeffnen', `Abgabe von Nummer ${n.nummer} wieder öffnen? Die Zeit läuft seit dem ursprünglichen Start weiter – gib bei Bedarf zusätzliche Minuten.`) }, 'Abgabe wieder öffnen') : null),
      n.zustand === 'laeuft' || n.zustand === 'angemeldet' ? h('p', { class: 'klein' }, 'Neu-Anmeldung: wenn ein iPad ausfällt. Die bisherigen Antworten und die Zeit bleiben erhalten.') : null);
  };

  const hole = async () => {
    const live = await api(`/api/l/tests/${test.id}/live`);
    letzte = live.nummern;
    const anz = (zs) => letzte.filter((n) => n.zustand === zs).length;
    zaehler.textContent = `${anz('angemeldet')} angemeldet · ${anz('laeuft')} arbeiten · ${anz('abgegeben')} abgegeben · ${anz('frei')} fehlen`;
    leere(raster, letzte.map((n) => h('button', {
      class: `kachel ${n.zustand}${n.nummer === gewaehlt ? ' gewaehlt' : ''}${n.zustand === 'laeuft' && n.kontaktVorSek > 45 ? ' still' : ''}`,
      onclick: () => { gewaehlt = n.nummer; zeigeDetail(); hole().catch(() => {}); },
    },
      h('b', null, String(n.nummer)),
      live.gruppen ? h('small', { class: 'nta' }, 'Gruppe ' + (n.gruppe || (n.nummer % 2 === 0 ? 'B' : 'A'))) : null,
      h('small', null, n.zustand === 'laeuft' ? `${n.beantwortet}/${live.anzahlAufgaben} · ${minSek(n.restSek)}` : TEXT[n.zustand]),
      n.nta ? h('small', { class: 'nta' }, `+${n.nta} min`) : null,
      n.zustand === 'laeuft' && n.kontaktVorSek > 45 ? h('small', { class: 'nta' }, 'keine Verbindung') : null)));
    leere(vorfaelle, live.vorfaelle.length ? [h('h3', null, 'Auffälligkeiten'),
      h('ul', { class: 'vorfaelle' }, live.vorfaelle.map((v) => h('li', null, h('b', null, `Nummer ${v.nummer}: `), v.art, h('span', { class: 'klein' }, ' · ' + datumZeit(v.zeit)))))] : null);
  };

  leere(el, h('h2', null, 'Freigabe & Live-Übersicht'), fehlerEl,
    h('p', { class: 'meldung info' }, 'Vor dem Start: ', h('a', { href: '/hinweise', target: '_blank', rel: 'noopener' }, 'Hinweise zur Durchführung'), ' (iPads im Prüfungsmodus, WLAN, Reserve auf Papier).',
      test.aufgabenB && test.aufgabenB.length ? ' Dieser Test hat zwei Gruppen: ungerade Nummern schreiben Gruppe A, gerade Nummern Gruppe B.' : ''),
    kopf,
    test.status === 'entwurf' ? null : [
      h('h3', null, 'Wer ist angemeldet, wer hat abgegeben?'), zaehler, raster,
      h('p', { class: 'klein' }, 'Tippe auf eine Nummer für Zeitverlängerung oder Hilfe bei Geräteproblemen. Die Übersicht aktualisiert sich alle 3 Sekunden.'),
      detail, vorfaelle]);

  if (test.status !== 'entwurf') {
    await hole();
    const takt = setInterval(() => hole().catch(() => {}), 3000);
    aufraeumen.push(() => clearInterval(takt));
  }
}

// ---------- Reiter 5: Bewertung offener Aufgaben ----------

async function reiterBewertung(el) {
  await speichere();
  let daten = await api(`/api/l/tests/${test.id}/ergebnisse`);
  const fehlerEl = h('p', { class: 'meldung fehler', hidden: true });
  const fortschritt = h('p', { class: 'meldung info', hidden: true });
  const inhalt = h('div');

  const sende = (eintraege) => mitFehler(fehlerEl, async () => {
    daten = await api(`/api/l/tests/${test.id}/bewertung`, { eintraege });
    zeichne();
  });

  const zeichne = () => {
    const offeneAufgaben = [...daten.test.aufgaben.map((a) => ({ a, g: 'A' })), ...(daten.test.aufgabenB || []).map((a) => ({ a, g: 'B' }))].filter((x) => x.a.typ === 'offen');
    const mitB = (daten.test.aufgabenB || []).length > 0;
    const abgegeben = daten.zeilen.length;
    test.notenFreigegeben = daten.test.notenFreigegeben;

    const kiKnopf = h('button', { class: 'knopf', disabled: !kiStatus.bereit || !daten.offen, onclick: () => mitFehler(fehlerEl, async () => {
      kiKnopf.disabled = true;
      fortschritt.hidden = false;
      fortschritt.textContent = 'Die KI liest die Antworten …';
      try {
        const { job } = await api(`/api/l/tests/${test.id}/ki-bewerten`, {});
        await warteAufJob(job, (t) => { fortschritt.textContent = t || 'Die KI arbeitet …'; });
        daten = await api(`/api/l/tests/${test.id}/ergebnisse`);
      } finally {
        fortschritt.hidden = true;
        zeichne();
      }
    }) }, 'KI-Vorschläge für offene Antworten erzeugen');

    const abschnitte = offeneAufgaben.map(({ a, g }) => {
      const inGruppe = daten.zeilen.filter((z) => (z.gruppe || 'A') === g);
      const zeilen = inGruppe.map((z) => ({ z, e: z.aufgaben.find((x) => x.id === a.id) })).filter((x) => x.e && x.e.status !== 'leer');
      const leer = inGruppe.length - zeilen.length;
      const felder = [];
      const karten = zeilen.map(({ z, e }) => {
        const bestaetigt = !e.offen;
        const punkte = h('input', { type: 'text', class: 'feld winzig', inputmode: 'decimal', value: bestaetigt ? zahlText(e.punkte) : e.kiPunkte != null ? zahlText(e.kiPunkte) : '' });
        const kommentar = h('textarea', { class: 'feld', rows: '2', placeholder: 'Rückmeldung für den Einzelbogen (optional)' });
        kommentar.value = e.kommentar || '';
        const eintrag = () => ({ nummer: z.nummer, aufgabeId: a.id, punkte: punkte.value, kommentar: kommentar.value, bestaetigt: true });
        if (!bestaetigt) felder.push({ punkte, eintrag });
        return h('div', { class: 'antwortkarte ' + (bestaetigt ? 'bestaetigt' : 'unbestaetigt') },
          h('div', { class: 'antwort-kopf' }, h('b', null, `Nummer ${z.nummer}`), h('span', { class: 'marke ' + (bestaetigt ? 'freigegeben' : 'entwurf') }, bestaetigt ? 'bestätigt' : 'offen')),
          h('div', { class: 'antworttext' }, e.antwortText),
          e.kiPunkte != null ? h('p', { class: 'ki-vorschlag' }, h('b', null, `KI-Vorschlag: ${zahlText(e.kiPunkte)} von ${zahlText(e.max)} Punkten. `), e.kiBegruendung) : null,
          h('div', { class: 'bewertungszeile' },
            h('label', null, punkte, ` von ${zahlText(e.max)} Punkten`),
            kommentar,
            h('button', { class: 'knopf klein', onclick: () => {
              if (punkte.value.trim() === '') return alert('Bitte Punkte eintragen.');
              sende([eintrag()]);
            } }, bestaetigt ? 'Änderung speichern' : 'Bestätigen')));
      });
      return h('section', { class: 'karte' },
        h('h3', null, `${mitB ? 'Gruppe ' + g + ' · ' : ''}Aufgabe ${a.nr}${a.titel ? ' (' + a.titel + ')' : ''} · ${zahlText(a.punkte)} Punkte`),
        textEl('div', { class: 'aufgabentext' }, a.text),
        h('details', null, h('summary', null, 'Erwartungshorizont anzeigen'), textEl('div', { class: 'erwartung' }, a.erwartung || '(keiner hinterlegt)')),
        leer ? h('p', { class: 'klein' }, `${leer} Abgabe(n) ohne Antwort – automatisch 0 Punkte.`) : null,
        karten.length ? karten : h('p', { class: 'klein' }, 'Noch keine Antworten.'),
        felder.length > 1 ? h('button', { class: 'knopf zweit', onclick: () => {
          const voll = felder.filter((f) => f.punkte.value.trim() !== '');
          if (!voll.length) return alert('Es sind noch keine Punkte eingetragen. Erzeuge zuerst KI-Vorschläge oder trage Punkte ein.');
          if (confirm(`${voll.length} Bewertung(en) dieser Aufgabe mit den eingetragenen Punkten bestätigen?`)) sende(voll.map((f) => f.eintrag()));
        } }, 'Alle eingetragenen Punkte dieser Aufgabe bestätigen') : null);
    });

    const freigabe = h('div', { class: 'karte' },
      h('h3', null, 'Noten freigeben'),
      daten.test.notenFreigegeben
        ? [meldung('Die Noten sind freigegeben und erscheinen auf Einzelbögen und in der Tabelle.', 'gut'),
          h('button', { class: 'knopf zweit', onclick: () => mitFehler(fehlerEl, async () => { daten = await api(`/api/l/tests/${test.id}/noten-freigeben`, { freigegeben: false }); zeichne(); }) }, 'Freigabe zurücknehmen')]
        : [h('p', null, daten.offen ? `Noch ${daten.offen} offene Antwort(en) ohne bestätigte Punkte. Noten entstehen erst, wenn du alles bestätigt hast.` : abgegeben ? 'Alles ist bewertet. Mit der Freigabe werden die Noten nach deinem Notenschlüssel berechnet.' : 'Es gibt noch keine Abgaben.'),
          h('button', { class: 'knopf', disabled: daten.offen > 0 || !abgegeben, onclick: () => mitFehler(fehlerEl, async () => { daten = await api(`/api/l/tests/${test.id}/noten-freigeben`, { freigegeben: true }); zeichne(); }) }, 'Noten jetzt freigeben')]);

    leere(inhalt,
      h('p', null, `${abgegeben} Abgaben. Geschlossene Aufgaben sind bereits automatisch bewertet. Bei offenen Aufgaben schlägt die KI Punkte mit kurzer Begründung vor – du bestätigst oder änderst jeden Vorschlag.`),
      offeneAufgaben.length ? h('div', { class: 'knopfzeile' }, kiKnopf, kiStatus.bereit ? null : h('span', { class: 'klein' }, 'Kein KI-Schlüssel hinterlegt – bitte von Hand bewerten.')) : meldung('Dieser Test hat keine offenen Aufgaben. Du kannst die Noten direkt freigeben.', 'info'),
      abschnitte, freigabe);
  };

  leere(el, h('h2', null, 'Bewertung'), fehlerEl, fortschritt, inhalt);
  zeichne();
}

// ---------- Reiter 6: Ergebnisse ----------

async function reiterErgebnisse(el) {
  await speichere();
  const daten = await api(`/api/l/tests/${test.id}/ergebnisse`);
  const n = daten.zeilen.length;
  const schnitt = n ? daten.zeilen.reduce((s, z) => s + z.prozent, 0) / n : 0;
  leere(el,
    h('h2', null, 'Ergebnisse'),
    h('p', { class: 'summe' }, `${n} Abgaben · im Schnitt ${zahlText(schnitt, 1)} % der Punkte`),
    daten.test.notenFreigegeben ? meldung('Die Noten sind freigegeben.', 'gut')
      : meldung(daten.offen ? `Noch ${daten.offen} offene Antwort(en) im Reiter „Bewertung“. Bis zur Freigabe zeigen Bögen und Tabelle nur Punkte, keine Noten.` : 'Die Noten sind noch nicht freigegeben (Reiter „Bewertung“). Bis dahin zeigen Bögen und Tabelle nur Punkte.', 'warnung'),
    h('div', { class: 'zweispaltig' },
      h('a', { class: 'karte linkkarte', href: `/lehrer/boegen/${test.id}`, target: '_blank', rel: 'noopener' },
        h('h3', null, 'Einzelbögen ›'), h('p', null, 'Pro Nummer eine druckfertige DIN-A4-Seite mit Antworten, Lösungen, Punkten, Rückmeldung und Note. Alle Bögen zusammen als ein PDF druckbar.')),
      h('a', { class: 'karte linkkarte', href: `/lehrer/tabelle/${test.id}`, target: '_blank', rel: 'noopener' },
        h('h3', null, 'Übersichtstabelle ›'), h('p', null, 'Nummer, Punkte, Prozent, Note – sortierbar, mit Durchschnitt und Notenspiegel, Export als CSV für Excel und dein Notenprogramm.'))),
    h('div', { class: 'karte' }, h('h3', null, 'Sicherung'), h('p', { class: 'klein' }, 'Lädt den ganzen Test mit allen Antworten und Bewertungen als Datei herunter. Empfohlen direkt nach der Arbeit.'),
      h('a', { class: 'knopf zweit', href: `/api/l/tests/${test.id}/export` }, 'Sicherung herunterladen')));
}

// ---------- Navigation ----------

async function route() {
  for (const f of aufraeumen) f();
  aufraeumen = [];
  try {
    const { angemeldet } = await api('/api/l/ich');
    if (!angemeldet) return zeigeLogin();
    kiStatus = await api('/api/l/ki-status');
    const m = /^#\/test\/([a-z0-9]+)(?:\/([a-z]+))?/.exec(location.hash);
    if (m) await zeigeTest(m[1], m[2]);
    else {
      await speichere();
      await zeigeListe();
    }
  } catch (e) {
    if (e.status === 401) return zeigeLogin();
    leere(app, h('div', { class: 'karte schmal' }, h('h1', null, 'Das hat nicht geklappt'), h('p', null, e.message),
      h('a', { class: 'knopf', href: '#/', onclick: () => setTimeout(route, 0) }, 'Zur Übersicht')));
  }
}

window.addEventListener('hashchange', route);
route();
