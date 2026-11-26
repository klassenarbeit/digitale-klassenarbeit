// Klassenarbeit online – Server.
// Start:  node server.js      (Einstellungen über Umgebungsvariablen oder die Datei .env)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const WURZEL = path.dirname(fileURLToPath(import.meta.url));
if (typeof process.loadEnvFile === 'function' && fs.existsSync(path.join(WURZEL, '.env'))) {
  process.loadEnvFile(path.join(WURZEL, '.env'));
}

const sp = await import('./lib/speicher.js');
const ki = await import('./lib/ki.js');
const { bewerte, fuerSuS, antwortStand, noteAus, normalisiereAufgabe, normalisiereSchluessel, STANDARD_NOTENSCHLUESSEL, runde05 } =
  await import('./public/auswertung.js');

const PORT = Number(process.env.PORT) || 3000;
const KULANZ_MS = 90 * 1000; // so lange nach Zeitablauf wird eine Abgabe noch angenommen (WLAN-Hänger)
const TAG = 24 * 3600 * 1000;

// ---------- Lehrkraft-Passwort ----------

let PASSWORT = process.env.LEHRER_PASSWORT || sp.config.passwort;
if (!PASSWORT) {
  PASSWORT = sp.zufall(14, 'abcdefghjkmnpqrstuvwxyz23456789');
  sp.config.passwort = PASSWORT;
  sp.speichereConfig();
}
if (!process.env.LEHRER_PASSWORT) {
  console.log(`\nLehrkraft-Passwort (automatisch erzeugt): ${PASSWORT}\nEigenes Passwort: Umgebungsvariable LEHRER_PASSWORT setzen.\n`);
}

// ---------- kleine Helfer ----------

class HttpFehler extends Error {
  constructor(status, meldung) {
    super(meldung);
    this.status = status;
  }
}
const fehler = (status, meldung) => {
  throw new HttpFehler(status, meldung);
};

function sende(res, status, daten) {
  const body = JSON.stringify(daten);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function lesBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const teile = [];
    let groesse = 0;
    req.on('data', (c) => {
      groesse += c.length;
      if (groesse > maxBytes) {
        reject(new HttpFehler(413, 'Die Daten sind zu groß.'));
        req.destroy();
        return;
      }
      teile.push(c);
    });
    req.on('end', () => {
      if (!teile.length) return resolve({});
      try {
        const obj = JSON.parse(Buffer.concat(teile).toString('utf8'));
        resolve(obj && typeof obj === 'object' ? obj : {});
      } catch {
        reject(new HttpFehler(400, 'Ungültige Anfrage.'));
      }
    });
    req.on('error', reject);
  });
}

const gleich = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

const ipVon = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

// einfache Bremse gegen Durchprobieren (Passwort, Test-Code)
const zaehler = new Map();
function bremse(schluessel, max, fensterMs) {
  const jetzt = Date.now();
  let e = zaehler.get(schluessel);
  if (!e || e.bis < jetzt) {
    e = { n: 0, bis: jetzt + fensterMs };
    zaehler.set(schluessel, e);
  }
  return { gesperrt: e.n >= max, fehlversuch: () => e.n++ };
}
setInterval(() => {
  const jetzt = Date.now();
  for (const [k, e] of zaehler) if (e.bis < jetzt) zaehler.delete(k);
  for (const [k, j] of jobs) if (j.start < jetzt - 2 * 3600 * 1000) jobs.delete(k);
}, 60 * 1000).unref();

// ---------- Anmeldung Lehrkraft (signiertes Cookie) ----------

function signiere(wert) {
  return crypto.createHmac('sha256', sp.config.geheimnis).update(wert).digest('hex');
}
function cookieWert() {
  const ablauf = String(Date.now() + 14 * TAG);
  return `${ablauf}.${signiere(ablauf)}`;
}
function istLehrkraft(req) {
  const m = /(?:^|;\s*)lk=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [ablauf, sig] = m[1].split('.');
  if (!ablauf || !sig || Number(ablauf) < Date.now()) return false;
  return gleich(sig, signiere(ablauf));
}
function setzeCookie(req, res, wert, maxAlter) {
  const sicher = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `lk=${wert}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAlter}${sicher}`);
}

// ---------- Fachlogik ----------

const nta = (test, nummer) => Math.max(0, Number(test.nta?.[nummer]) || 0);
const dauerFuer = (test, nummer) => test.dauerMin + nta(test, nummer);
const endeFuer = (test, t) => (t.gestartetAm ? t.gestartetAm + dauerFuer(test, t.nummer) * 60000 : null);

function vorfall(test, nummer, art) {
  test.vorfaelle = test.vorfaelle || [];
  test.vorfaelle.push({ zeit: Date.now(), nummer, art });
  if (test.vorfaelle.length > 300) test.vorfaelle.splice(0, test.vorfaelle.length - 300);
  sp.speichereTest(test);
}

function gibAb(test, t, art, zeit) {
  if (t.abgegebenAm) return;
  t.abgegebenAm = zeit || Date.now();
  t.abgabeArt = art;
  sp.speichereTeilnahme(test.id, t);
}

// Wer die Zeit überschritten hat, wird automatisch abgegeben – mit dem zuletzt gespeicherten Stand.
function pruefeAblauf(test) {
  const jetzt = Date.now();
  for (const t of sp.alleTeilnahmen(test.id)) {
    if (!t.gestartetAm || t.abgegebenAm) continue;
    const ende = endeFuer(test, t);
    if (test.status === 'beendet') gibAb(test, t, 'lehrkraft');
    else if (jetzt > ende + KULANZ_MS) gibAb(test, t, 'zeit', ende);
  }
}

// Gruppe A/B: Gibt es eine B-Version, bekommen gerade Nummern Gruppe B (wird bei der Anmeldung festgelegt).
const hatB = (test) => Array.isArray(test.aufgabenB) && test.aufgabenB.length > 0;
const gruppeVon = (test, t) => (t.gruppe === 'B' && hatB(test) ? 'B' : 'A');
const aufgabenVon = (test, t) => (gruppeVon(test, t) === 'B' ? test.aufgabenB : test.aufgaben);

function saeubereAntworten(aufgaben, roh) {
  const aus = {};
  if (!roh || typeof roh !== 'object') return aus;
  for (const a of aufgaben) {
    const v = roh[a.id];
    if (v == null) continue;
    if (Array.isArray(v)) {
      aus[a.id] = v.slice(0, 100).map((x) => (x == null ? '' : typeof x === 'number' ? x : String(x).slice(0, 2000)));
    } else {
      aus[a.id] = String(v).slice(0, 20000);
    }
  }
  return aus;
}

function standFuer(test, t) {
  const liste = aufgabenVon(test, t);
  const aus = {
    titel: test.titel,
    klasse: test.klasse,
    nummer: t.nummer,
    dauerMin: dauerFuer(test, t.nummer),
    hilfsmittel: test.hilfsmittel,
    anzahlAufgaben: liste.length,
    maxPunkte: liste.reduce((s, a) => s + a.punkte, 0),
    jetzt: Date.now(),
    rev: t.rev || 0,
  };
  if (t.abgegebenAm) {
    aus.status = 'abgegeben';
    aus.abgabeArt = t.abgabeArt;
  } else if (t.gestartetAm) {
    aus.status = 'laeuft';
    aus.ende = endeFuer(test, t);
    aus.aufgaben = liste.map(fuerSuS);
    aus.antworten = t.antworten || {};
  } else if (test.status !== 'freigegeben') {
    aus.status = 'geschlossen';
  } else {
    aus.status = 'angemeldet';
  }
  return aus;
}

function susTeilnahme(body) {
  const test = sp.holTest(body.testId);
  if (!test) fehler(404, 'Diesen Test gibt es nicht.');
  const t = sp.holTeilnahme(test.id, body.nummer);
  if (!t || !body.token || !gleich(t.token, body.token)) fehler(403, 'Deine Anmeldung ist nicht mehr gültig. Bitte melde dich bei deiner Lehrkraft.');
  pruefeAblauf(test);
  return { test, t };
}

function testFuerLehrkraft(test) {
  return { ...test, link: `/t/${test.id}`, anzahlTeilnahmen: sp.alleTeilnahmen(test.id).length };
}

function holTestOderFehler(id) {
  const test = sp.holTest(id);
  if (!test) fehler(404, 'Diesen Test gibt es nicht (mehr).');
  return test;
}

const FEEDBACK = {
  richtig: 'Richtig.',
  teilweise: 'Teilweise richtig.',
  falsch: 'Leider nicht richtig.',
  leer: 'Nicht bearbeitet.',
};

const kurzAufgabe = (a, i) => ({
  id: a.id, nr: i + 1, titel: a.titel, typ: a.typ, text: a.text, punkte: a.punkte,
  erwartung: a.erwartung || '', lueckentext: a.lueckentext || '', bild: a.bild,
});

function ergebnisse(test) {
  pruefeAblauf(test);
  const maxPunkte = test.aufgaben.reduce((s, a) => s + a.punkte, 0);
  let offenGesamt = 0;
  const zeilen = [];
  for (const t of sp.alleTeilnahmen(test.id)) {
    if (!t.abgegebenAm) continue;
    let punkte = 0;
    let offen = 0;
    const liste = aufgabenVon(test, t);
    const max = liste.reduce((s, a) => s + a.punkte, 0);
    const aufgaben = liste.map((a) => {
      const auto = bewerte(a, (t.antworten || {})[a.id]);
      const b = (t.bewertung || {})[a.id] || {};
      const e = {
        id: a.id,
        antwortText: auto.antwortText,
        loesungText: auto.loesungText,
        max: a.punkte,
        status: auto.status,
        punkte: auto.punkte,
        feedback: '',
        offen: false,
        geaendert: false,
        kiPunkte: b.kiPunkte ?? null,
        kiBegruendung: b.kiBegruendung || '',
        kommentar: b.kommentar ?? b.kiFeedback ?? '',
      };
      if (b.bestaetigt) {
        e.punkte = b.punkte;
        e.geaendert = a.typ !== 'offen' && b.punkte !== auto.punkte;
        if (auto.status !== 'leer') e.status = b.punkte >= a.punkte ? 'richtig' : b.punkte > 0 ? 'teilweise' : 'falsch';
        e.feedback = b.kommentar || '';
      } else if (auto.punkte == null) {
        e.offen = true;
        offen++;
      }
      if (!e.feedback && !e.offen) {
        e.feedback = FEEDBACK[e.status] || '';
        if (e.status !== 'richtig' && a.hinweis) e.feedback += ' ' + a.hinweis;
      }
      punkte += e.punkte || 0;
      return e;
    });
    offenGesamt += offen;
    const prozent = max > 0 ? (punkte / max) * 100 : 0;
    zeilen.push({
      nummer: t.nummer,
      gruppe: gruppeVon(test, t),
      maxPunkte: max,
      abgegebenAm: t.abgegebenAm,
      abgabeArt: t.abgabeArt,
      aufgaben,
      punkte,
      prozent,
      offen,
      note: test.notenFreigegeben && offen === 0 ? noteAus(prozent, test.notenschluessel) : null,
    });
  }
  return {
    test: {
      id: test.id,
      titel: test.titel,
      klasse: test.klasse,
      status: test.status,
      notenFreigegeben: !!test.notenFreigegeben,
      notenschluessel: test.notenschluessel,
      maxPunkte,
      aufgaben: test.aufgaben.map(kurzAufgabe),
      aufgabenB: hatB(test) ? test.aufgabenB.map(kurzAufgabe) : [],
    },
    zeilen,
    offen: offenGesamt,
  };
}

// ---------- Hintergrund-Aufträge für die KI (dauern länger als eine normale Anfrage) ----------

const jobs = new Map();
function starteJob(arbeit) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = { status: 'laeuft', fortschritt: '', start: Date.now() };
  jobs.set(id, job);
  arbeit(job)
    .then((ergebnis) => {
      job.status = 'fertig';
      job.ergebnis = ergebnis;
    })
    .catch((e) => {
      job.status = 'fehler';
      job.fehler = e instanceof ki.KiFehler || e instanceof HttpFehler ? e.message : 'Unerwarteter Fehler: ' + e.message;
      if (!(e instanceof ki.KiFehler) && !(e instanceof HttpFehler)) console.error(e);
    });
  return id;
}

const MODUS_TEXT = {
  uebernehmen: 'Die KI liest die Arbeit und erstellt die Aufgaben …',
  parallel: 'Die KI erstellt eine Parallelversion mit neuen Zahlen und löst sie …',
  checkliste: 'Die KI erstellt eine neue Arbeit nach deiner Checkliste und löst sie …',
  vokabeln: 'Die KI liest die Vokabeln und erstellt den Vokabeltest …',
};

async function jobUmwandeln(job, dateienRoh, wunsch, klasse) {
  const modus = Object.prototype.hasOwnProperty.call(MODUS_TEXT, wunsch.modus) ? wunsch.modus : 'uebernehmen';
  const frei = modus === 'parallel' || modus === 'checkliste'; // nur hier bestimmt die Lehrkraft den Umfang
  const probe = frei && !!wunsch.probe;
  let zielMinuten = Math.round(Number(wunsch.zielMinuten)) || 0;
  zielMinuten = !frei ? 0 : Math.max(0, Math.min(300, zielMinuten));
  if (probe && !zielMinuten) zielMinuten = 30;

  const dateien = [];
  for (const d of dateienRoh) {
    const name = String(d.name || 'Datei').slice(0, 200);
    const rolle = ['arbeit', 'loesung', 'checkliste', 'material', 'vokabeln'].includes(d.rolle) ? d.rolle : 'arbeit';
    const mime = String(d.mime || '');
    const base64 = String(d.base64 || '').replace(/\s/g, '');
    if (!base64) continue;
    if (mime === 'application/pdf') dateien.push({ name, rolle, art: 'pdf', base64 });
    else if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) dateien.push({ name, rolle, art: 'bild', mime, base64 });
    else if (/\.docx$/i.test(name) || mime.includes('wordprocessingml')) {
      job.fortschritt = 'Word-Datei wird gelesen …';
      dateien.push({ name, rolle, art: 'text', text: await ki.docxZuText(Buffer.from(base64, 'base64')) });
    } else if (mime.startsWith('text/')) dateien.push({ name, rolle, art: 'text', text: Buffer.from(base64, 'base64').toString('utf8') });
    else throw new HttpFehler(400, `Die Datei „${name}“ hat ein Format, das nicht unterstützt wird. Möglich sind PDF, Word (.docx) und Fotos.`);
  }
  if (modus === 'checkliste') {
    if (!dateien.some((d) => d.rolle === 'checkliste')) throw new HttpFehler(400, 'Bitte lade die Checkliste hoch.');
  } else if (modus === 'vokabeln') {
    if (!dateien.some((d) => d.rolle === 'vokabeln')) throw new HttpFehler(400, 'Bitte lade die Vokabelliste hoch oder füge sie als Text ein.');
  } else if (!dateien.some((d) => d.rolle === 'arbeit')) {
    throw new HttpFehler(400, 'Bitte lade mindestens die Klassenarbeit hoch.');
  }
  job.fortschritt = MODUS_TEXT[modus] + ' (das dauert meist 1–3 Minuten)';
  const richtung = ['de-en', 'en-de', 'gemischt'].includes(wunsch.richtung) ? wunsch.richtung : 'de-en';
  const anzahl = Math.max(0, Math.min(200, Math.round(Number(wunsch.anzahl)) || 0));
  const e = await ki.wandleUm(dateien, { modus, probe, zielMinuten, klasse, richtung, anzahl, hatLoesung: dateien.some((d) => d.rolle === 'loesung') });

  const minuten = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.round(Number(x)) : null);
  const aufgaben = e.aufgaben.slice(0, 100).map((a) => normalisiereAufgabe({ ...a, id: undefined, bild: '' }));
  const summe = Math.round(aufgaben.reduce((s, a) => s + a.minuten, 0));
  const geschaetzt = minuten(e.geschaetzteMinuten) || (summe > 0 ? summe : null);
  // Vorschlag für die Bearbeitungszeit: bei übernommenen Arbeiten die Angabe der Vorlage, sonst die Schätzung der KI.
  const dauerMin = modus === 'uebernehmen' ? minuten(e.dauerLautVorlage) : geschaetzt;
  const hinweise0 = modus === 'vokabeln' && !aufgaben.every((a) => a.typ === 'vokabeln') ? ['Nicht alle Aufgaben sind Vokabelaufgaben – bitte prüfen.'] : [];
  // Vollständigkeit: Die KI zählt zuerst alle Aufgaben der Vorlage; hier wird verglichen, ob jede übernommen wurde.
  const vorlage = modus === 'uebernehmen' && Array.isArray(e.vorlageAufgaben) ? e.vorlageAufgaben.slice(0, 200).map((x) => String(x).trim().slice(0, 30)).filter(Boolean) : [];
  const kurzform = (s) => String(s).toLowerCase().replace(/aufgabe|nr\.?|teil/g, '').replace(/[^a-z0-9äöü]/g, '');
  const vorhanden = aufgaben.map((a) => kurzform(a.titel));
  const fehlend = vorlage.filter((v) => kurzform(v) && !vorhanden.some((t) => t.startsWith(kurzform(v))));
  if (vorlage.length) {
    hinweise0.unshift(fehlend.length
      ? `ACHTUNG – möglicherweise unvollständig: In der Vorlage hat die KI ${vorlage.length} Aufgaben gezählt (${vorlage.join(', ')}). Nicht wiedergefunden: ${fehlend.join(', ')}. Bitte mit der Vorlage vergleichen und fehlende Aufgaben ergänzen oder die Umwandlung wiederholen.`
      : `Vollständigkeit: Die KI hat in der Vorlage ${vorlage.length} Aufgaben gezählt (${vorlage.join(', ')}) und alle übernommen. Bitte trotzdem mit der Vorlage vergleichen.`);
  }
  return {
    modus,
    probe,
    zielMinuten,
    vorlageAufgaben: vorlage,
    fehlendeAufgaben: fehlend,
    titel: String(e.titel || '').slice(0, 200),
    hilfsmittel: String(e.hilfsmittel || '').slice(0, 500),
    dauerMin,
    geschaetzteMinuten: geschaetzt,
    bereiche: (Array.isArray(e.bereiche) ? e.bereiche : []).slice(0, 40).map((h) => String(h).slice(0, 200)),
    hinweise: [...hinweise0, ...(Array.isArray(e.hinweise) ? e.hinweise : []).slice(0, 30).map((h) => String(h).slice(0, 500))],
    aufgaben,
  };
}

// Gruppe B: zu jeder Aufgabe der Gruppe A eine gleich schwere Aufgabe mit anderen Zahlen.
async function jobGruppeB(aufgabenRoh, klasse) {
  const a = (Array.isArray(aufgabenRoh) ? aufgabenRoh : []).slice(0, 100).map(normalisiereAufgabe);
  if (!a.length) throw new HttpFehler(400, 'Gruppe A hat noch keine Aufgaben.');
  const e = await ki.erstelleGruppeB(a.map(({ bild, abbildungFehlt, id, ...rest }) => ({ ...rest, hatAbbildung: !!bild })), klasse);
  if (e.aufgaben.length !== a.length) throw new HttpFehler(502, 'Die KI hat nicht zu jeder Aufgabe eine B-Fassung geliefert. Bitte noch einmal versuchen.');
  // Stelle, Punkte, Bezeichnung und Abbildung bleiben wie in Gruppe A – so sind beide Gruppen vergleichbar.
  return {
    aufgaben: e.aufgaben.map((b, i) => normalisiereAufgabe({ ...b, id: undefined, typ: a[i].typ === 'offen' || b.typ === a[i].typ ? b.typ : a[i].typ, punkte: a[i].punkte, titel: a[i].titel, bild: a[i].bild, abbildungFehlt: '' })),
    hinweise: e.hinweise,
  };
}

async function jobAufgabeAendern(aufgabeRoh, anweisung, klasse) {
  const alt = normalisiereAufgabe(aufgabeRoh);
  const text = String(anweisung || '').trim().slice(0, 2000);
  if (!text) throw new HttpFehler(400, 'Bitte schreib kurz, was geändert werden soll.');
  const { bild, abbildungFehlt, ...ohneBild } = alt;
  const e = await ki.aendereAufgabe(ohneBild, text, klasse);
  // Kennung und Bild bleiben, damit schon gegebene Antworten und die Abbildung zur Aufgabe gehören.
  return { aufgabe: normalisiereAufgabe({ abbildungFehlt, ...e.aufgabe, id: alt.id, bild }), anmerkung: e.anmerkung };
}

async function jobBewerten(job, testId) {
  const test = holTestOderFehler(testId);
  pruefeAblauf(test);
  const offene = [...test.aufgaben.map((a) => [a, 'A']), ...(hatB(test) ? test.aufgabenB.map((a) => [a, 'B']) : [])].filter(([a]) => a.typ === 'offen');
  let anzahl = 0;
  for (let i = 0; i < offene.length; i++) {
    const [a, g] = offene[i];
    job.fortschritt = `Offene Aufgabe ${i + 1} von ${offene.length} wird ausgewertet …`;
    // Anonym: Die KI sieht nur zufällig gemischte Kennungen, keine Nummern.
    const kandidaten = sp.alleTeilnahmen(test.id)
      .filter((t) => t.abgegebenAm && gruppeVon(test, t) === g && !(t.bewertung?.[a.id]?.bestaetigt) && String((t.antworten || {})[a.id] || '').trim())
      .sort(() => Math.random() - 0.5);
    if (!kandidaten.length) continue;
    const antworten = kandidaten.map((t, k) => ({ kennung: 'A' + (k + 1), text: String(t.antworten[a.id]) }));
    const vorschlaege = await ki.bewerteOffen(a, antworten);
    kandidaten.forEach((t, k) => {
      const v = vorschlaege.get('A' + (k + 1));
      if (!v) return;
      t.bewertung = t.bewertung || {};
      t.bewertung[a.id] = { ...(t.bewertung[a.id] || {}), kiPunkte: v.punkte, kiBegruendung: v.begruendung, kiFeedback: v.feedback };
      sp.speichereTeilnahme(test.id, t);
      anzahl++;
    });
  }
  return { anzahl };
}

// ---------- Schnittstelle für SuS ----------

async function apiSuS(req, res, pfad) {
  if (req.method === 'GET') {
    const m = /^\/api\/s\/test\/([a-z0-9]+)$/.exec(pfad);
    if (!m) fehler(404, 'Nicht gefunden.');
    const test = sp.holTest(m[1]);
    if (!test || test.status === 'entwurf') fehler(404, 'Diesen Test gibt es nicht oder er ist noch nicht freigegeben.');
    return sende(res, 200, { titel: test.titel, klasse: test.klasse, anzahlNummern: test.anzahlNummern, offen: test.status === 'freigegeben' });
  }
  if (req.method !== 'POST') fehler(405, 'Nicht erlaubt.');
  const body = await lesBody(req, 1024 * 1024);

  if (pfad === '/api/s/anmelden') {
    const test = sp.holTest(body.testId);
    if (!test || test.status === 'entwurf') fehler(404, 'Diesen Test gibt es nicht oder er ist noch nicht freigegeben.');
    const br = bremse('code:' + test.id, 60, 60 * 1000);
    if (br.gesperrt) fehler(429, 'Zu viele Fehlversuche. Bitte warte eine Minute.');
    if (!gleich(String(body.code || '').trim().toUpperCase(), test.code)) {
      br.fehlversuch();
      fehler(403, 'Der Test-Code stimmt nicht.');
    }
    const nummer = Number(body.nummer);
    if (!Number.isInteger(nummer) || nummer < 1 || nummer > test.anzahlNummern) {
      fehler(400, `Bitte gib deine Nummer zwischen 1 und ${test.anzahlNummern} ein.`);
    }
    pruefeAblauf(test);
    let t = sp.holTeilnahme(test.id, nummer);
    if (!t) {
      if (test.status !== 'freigegeben') fehler(403, 'Dieser Test ist bereits beendet.');
      t = { nummer, gruppe: hatB(test) && nummer % 2 === 0 ? 'B' : 'A', token: crypto.randomBytes(24).toString('hex'), angemeldetAm: Date.now(), letzterKontakt: Date.now(), antworten: {}, rev: 0 };
      sp.speichereTeilnahme(test.id, t);
    } else if (body.token && gleich(t.token, body.token)) {
      // dasselbe Gerät kommt zurück – weiterarbeiten
    } else if (t.neuanmeldungErlaubt) {
      t.token = crypto.randomBytes(24).toString('hex');
      t.neuanmeldungErlaubt = false;
      sp.speichereTeilnahme(test.id, t);
      vorfall(test, nummer, 'Neu-Anmeldung auf anderem Gerät (von der Lehrkraft erlaubt)');
    } else {
      vorfall(test, nummer, 'Doppelte Anmeldung abgewiesen');
      fehler(409, `Mit der Nummer ${nummer} ist bereits jemand angemeldet. Prüfe deine Nummer oder melde dich bei deiner Lehrkraft.`);
    }
    return sende(res, 200, { token: t.token, ...standFuer(test, t) });
  }

  const { test, t } = susTeilnahme(body);
  t.letzterKontakt = Date.now();

  if (pfad === '/api/s/stand') {
    return sende(res, 200, standFuer(test, t));
  }

  if (pfad === '/api/s/starten') {
    if (!t.gestartetAm) {
      if (test.status !== 'freigegeben') fehler(403, 'Dieser Test ist nicht mehr geöffnet.');
      t.gestartetAm = Date.now();
      sp.speichereTeilnahme(test.id, t);
    }
    return sende(res, 200, standFuer(test, t));
  }

  if (pfad === '/api/s/speichern' || pfad === '/api/s/abgeben') {
    if (!t.gestartetAm) fehler(400, 'Der Test wurde noch nicht gestartet.');
    if (!t.abgegebenAm) {
      const rev = Number(body.rev) || 0;
      if (body.antworten && rev >= (t.rev || 0)) {
        t.antworten = saeubereAntworten(aufgabenVon(test, t), body.antworten);
        t.rev = rev;
      }
      if (pfad === '/api/s/abgeben') {
        const ende = endeFuer(test, t);
        const zuSpaet = Date.now() > ende;
        t.abgegebenAm = zuSpaet ? ende : Date.now();
        t.abgabeArt = zuSpaet || body.art === 'zeit' ? 'zeit' : 'selbst';
      }
      sp.speichereTeilnahme(test.id, t);
    }
    const s = standFuer(test, t);
    delete s.aufgaben;
    delete s.antworten;
    return sende(res, 200, s);
  }

  fehler(404, 'Nicht gefunden.');
}

// ---------- Schnittstelle für die Lehrkraft ----------

async function apiLehrkraft(req, res, pfad) {
  const methode = req.method;

  if (pfad === '/api/l/login' && methode === 'POST') {
    const br = bremse('login:' + ipVon(req), 10, 10 * 60 * 1000);
    if (br.gesperrt) fehler(429, 'Zu viele Fehlversuche. Bitte warte zehn Minuten.');
    const body = await lesBody(req, 10000);
    if (!gleich(body.passwort || '', PASSWORT)) {
      br.fehlversuch();
      fehler(403, 'Das Passwort stimmt nicht.');
    }
    setzeCookie(req, res, cookieWert(), 14 * 24 * 3600);
    return sende(res, 200, { ok: true });
  }
  if (pfad === '/api/l/ich' && methode === 'GET') {
    return sende(res, 200, { angemeldet: istLehrkraft(req) });
  }
  if (!istLehrkraft(req)) fehler(401, 'Bitte melde dich an.');
  // (Das Cookie ist „SameSite=Lax“: fremde Webseiten können damit keine Änderungen auslösen.)

  if (pfad === '/api/l/logout' && methode === 'POST') {
    setzeCookie(req, res, 'x', 0);
    return sende(res, 200, { ok: true });
  }
  if (pfad === '/api/l/ki-status' && methode === 'GET') {
    return sende(res, 200, { bereit: ki.kiBereit(), modell: ki.MODELL, speicherWarnung: sp.speicherWarnung });
  }

  let m = /^\/api\/l\/jobs\/([a-f0-9]+)$/.exec(pfad);
  if (m && methode === 'GET') {
    const job = jobs.get(m[1]);
    if (!job) fehler(404, 'Dieser Auftrag ist nicht mehr vorhanden (wurde der Server neu gestartet?). Bitte noch einmal starten.');
    return sende(res, 200, { status: job.status, fortschritt: job.fortschritt, ergebnis: job.ergebnis, fehler: job.fehler });
  }

  if (pfad === '/api/l/tests' && methode === 'GET') {
    return sende(res, 200, {
      tests: sp.alleTests().map((t) => ({
        id: t.id, titel: t.titel, klasse: t.klasse, status: t.status, erstellt: t.erstellt,
        anzahlAufgaben: t.aufgaben.length, anzahlTeilnahmen: sp.alleTeilnahmen(t.id).length,
      })),
    });
  }
  if (pfad === '/api/l/tests' && methode === 'POST') {
    const test = {
      id: sp.neueTestId(),
      code: sp.zufall(5, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'),
      titel: '', klasse: '', dauerMin: 45, hilfsmittel: '', anzahlNummern: 30,
      notenschluessel: STANDARD_NOTENSCHLUESSEL.map((x) => ({ ...x })),
      aufgaben: [], status: 'entwurf', notenFreigegeben: false, nta: {}, vorfaelle: [], erstellt: Date.now(),
    };
    sp.speichereTest(test);
    return sende(res, 200, { test: testFuerLehrkraft(test) });
  }

  m = /^\/api\/l\/tests\/([a-z0-9]+)(?:\/(.*))?$/.exec(pfad);
  if (!m) fehler(404, 'Nicht gefunden.');
  const test = holTestOderFehler(m[1]);
  const rest = m[2] || '';

  if (rest === '' && methode === 'GET') return sende(res, 200, { test: testFuerLehrkraft(test) });

  if (rest === '' && methode === 'DELETE') {
    sp.loescheTest(test.id);
    return sende(res, 200, { ok: true });
  }

  if (rest === '' && methode === 'PUT') {
    const b = await lesBody(req, 5 * 1024 * 1024);
    if (typeof b.titel === 'string') test.titel = b.titel.slice(0, 200);
    if (typeof b.klasse === 'string') test.klasse = b.klasse.slice(0, 50);
    if (typeof b.hilfsmittel === 'string') test.hilfsmittel = b.hilfsmittel.slice(0, 500);
    if (b.dauerMin != null) test.dauerMin = Math.max(1, Math.min(600, Math.round(Number(b.dauerMin)) || 45));
    if (b.anzahlNummern != null) test.anzahlNummern = Math.max(1, Math.min(200, Math.round(Number(b.anzahlNummern)) || 30));
    if (b.notenschluessel) test.notenschluessel = normalisiereSchluessel(b.notenschluessel);
    if (b.nta && typeof b.nta === 'object') {
      test.nta = {};
      for (const [nr, min] of Object.entries(b.nta)) {
        const n = Math.round(Number(nr));
        const z = Math.round(Number(min));
        if (n >= 1 && n <= 200 && z > 0 && z <= 600) test.nta[n] = z;
      }
    }
    if (Array.isArray(b.aufgaben)) {
      const ids = new Set();
      test.aufgaben = b.aufgaben.slice(0, 100).map((a) => {
        const n = normalisiereAufgabe(a);
        if (ids.has(n.id)) n.id = normalisiereAufgabe({}).id;
        ids.add(n.id);
        return n;
      });
    }
    if (b.aufgabenB === null) delete test.aufgabenB;
    else if (Array.isArray(b.aufgabenB)) {
      const ids = new Set(test.aufgaben.map((a) => a.id));
      test.aufgabenB = b.aufgabenB.slice(0, 100).map((a) => {
        const n = normalisiereAufgabe(a);
        if (ids.has(n.id)) n.id = normalisiereAufgabe({}).id;
        ids.add(n.id);
        return n;
      });
      if (!test.aufgabenB.length) delete test.aufgabenB;
    }
    sp.speichereTest(test);
    return sende(res, 200, { test: testFuerLehrkraft(test) });
  }

  if (rest === 'status' && methode === 'POST') {
    const b = await lesBody(req, 10000);
    if (b.status === 'freigegeben') {
      if (!test.aufgaben.length) fehler(400, 'Der Test hat noch keine Aufgaben.');
      if (!test.titel.trim()) fehler(400, 'Bitte gib dem Test zuerst einen Titel (Reiter „Einstellungen“).');
      test.status = 'freigegeben';
    } else if (b.status === 'beendet') {
      test.status = 'beendet';
    } else if (b.status === 'entwurf') {
      if (sp.alleTeilnahmen(test.id).length) fehler(400, 'Es gibt bereits Anmeldungen. Der Test kann nicht mehr zum Entwurf werden.');
      test.status = 'entwurf';
    } else fehler(400, 'Unbekannter Status.');
    sp.speichereTest(test);
    pruefeAblauf(test);
    return sende(res, 200, { test: testFuerLehrkraft(test) });
  }

  if (rest === 'live' && methode === 'GET') {
    pruefeAblauf(test);
    const jetzt = Date.now();
    const sus = { A: test.aufgaben.map(fuerSuS), B: hatB(test) ? test.aufgabenB.map(fuerSuS) : [] };
    const nummern = [];
    for (let n = 1; n <= test.anzahlNummern; n++) {
      const t = sp.holTeilnahme(test.id, n);
      const e = { nummer: n, zustand: 'frei', nta: nta(test, n) };
      if (t) {
        e.gruppe = gruppeVon(test, t);
        e.zustand = t.abgegebenAm ? 'abgegeben' : t.gestartetAm ? 'laeuft' : 'angemeldet';
        e.abgabeArt = t.abgabeArt;
        e.neuanmeldungErlaubt = !!t.neuanmeldungErlaubt;
        e.kontaktVorSek = Math.round((jetzt - (t.letzterKontakt || t.angemeldetAm)) / 1000);
        if (t.gestartetAm) {
          e.beantwortet = sus[e.gruppe].filter((a) => antwortStand(a, (t.antworten || {})[a.id]) !== 'leer').length;
          if (!t.abgegebenAm) e.restSek = Math.max(0, Math.round((endeFuer(test, t) - jetzt) / 1000));
        }
      }
      nummern.push(e);
    }
    return sende(res, 200, {
      status: test.status, anzahlAufgaben: test.aufgaben.length, gruppen: hatB(test), nummern,
      vorfaelle: (test.vorfaelle || []).slice(-50).reverse(),
    });
  }

  m = /^teilnahme\/(\d+)$/.exec(rest);
  if (m && methode === 'POST') {
    const b = await lesBody(req, 10000);
    const nummer = Number(m[1]);
    if (b.aktion === 'nta') {
      const min = Math.max(0, Math.min(600, Math.round(Number(b.minuten)) || 0));
      test.nta = test.nta || {};
      if (min > 0) test.nta[nummer] = min;
      else delete test.nta[nummer];
      sp.speichereTest(test);
      return sende(res, 200, { ok: true });
    }
    const t = sp.holTeilnahme(test.id, nummer);
    if (!t) fehler(404, 'Diese Nummer ist nicht angemeldet.');
    if (b.aktion === 'neuanmeldung') {
      t.neuanmeldungErlaubt = true;
      sp.speichereTeilnahme(test.id, t);
    } else if (b.aktion === 'wieder_oeffnen') {
      if (test.status !== 'freigegeben') fehler(400, 'Der Test ist beendet. Gib ihn zuerst wieder frei.');
      delete t.abgegebenAm;
      delete t.abgabeArt;
      sp.speichereTeilnahme(test.id, t);
      vorfall(test, nummer, 'Abgabe von der Lehrkraft wieder geöffnet');
    } else if (b.aktion === 'loeschen') {
      sp.loescheTeilnahme(test.id, nummer);
      vorfall(test, nummer, 'Anmeldung von der Lehrkraft gelöscht');
    } else fehler(400, 'Unbekannte Aktion.');
    return sende(res, 200, { ok: true });
  }

  if (rest === 'bild' && methode === 'POST') {
    const b = await lesBody(req, 12 * 1024 * 1024);
    const dm = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.daten || ''));
    if (!dm) fehler(400, 'Das Bild konnte nicht gelesen werden.');
    const name = sp.speichereBild(test.id, Buffer.from(dm[2], 'base64'), dm[1] === 'png' ? 'png' : 'jpg');
    return sende(res, 200, { bild: name });
  }

  if (rest === 'ki-umwandeln' && methode === 'POST') {
    const b = await lesBody(req, 45 * 1024 * 1024);
    if (!ki.kiBereit()) fehler(400, 'Es ist kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY). Du kannst Aufgaben trotzdem von Hand anlegen.');
    const dateien = Array.isArray(b.dateien) ? b.dateien.slice(0, 20) : [];
    const wunsch = { modus: b.modus, probe: b.probe, zielMinuten: b.zielMinuten, richtung: b.richtung, anzahl: b.anzahl };
    return sende(res, 200, { job: starteJob((job) => jobUmwandeln(job, dateien, wunsch, test.klasse)) });
  }

  if (rest === 'ki-gruppe-b' && methode === 'POST') {
    const b = await lesBody(req, 5 * 1024 * 1024);
    if (!ki.kiBereit()) fehler(400, 'Es ist kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY). Du kannst Gruppe B als Kopie anlegen und von Hand ändern.');
    const vorlage = Array.isArray(b.aufgaben) ? b.aufgaben : test.aufgaben;
    return sende(res, 200, { job: starteJob((job) => {
      job.fortschritt = 'Die KI erstellt Gruppe B mit anderen Zahlen und löst sie … (das dauert meist 1–3 Minuten)';
      return jobGruppeB(vorlage, test.klasse);
    }) });
  }

  if (rest === 'ki-aufgabe' && methode === 'POST') {
    const b = await lesBody(req, 1024 * 1024);
    if (!ki.kiBereit()) fehler(400, 'Es ist kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY). Du kannst die Aufgabe von Hand bearbeiten.');
    return sende(res, 200, { job: starteJob((job) => {
      job.fortschritt = 'Die KI ändert die Aufgabe …';
      return jobAufgabeAendern(b.aufgabe, b.anweisung, test.klasse);
    }) });
  }

  if (rest === 'ki-bewerten' && methode === 'POST') {
    if (!ki.kiBereit()) fehler(400, 'Es ist kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY). Du kannst die offenen Aufgaben trotzdem von Hand bewerten.');
    return sende(res, 200, { job: starteJob((job) => jobBewerten(job, test.id)) });
  }

  if (rest === 'ergebnisse' && methode === 'GET') return sende(res, 200, ergebnisse(test));

  if (rest === 'bewertung' && methode === 'POST') {
    const b = await lesBody(req, 1024 * 1024);
    const eintraege = Array.isArray(b.eintraege) ? b.eintraege.slice(0, 5000) : [];
    const geaendert = new Set();
    for (const e of eintraege) {
      const t = sp.holTeilnahme(test.id, e.nummer);
      const a = t ? aufgabenVon(test, t).find((x) => x.id === e.aufgabeId) : null;
      if (!t || !a) continue;
      t.bewertung = t.bewertung || {};
      const alt = t.bewertung[a.id] || {};
      if (e.bestaetigt === false) {
        t.bewertung[a.id] = { ...alt, bestaetigt: false };
      } else {
        const p = Number(String(e.punkte).replace(',', '.'));
        if (!Number.isFinite(p) || p < 0 || p > a.punkte) fehler(400, `Nummer ${t.nummer}: Die Punktzahl muss zwischen 0 und ${a.punkte} liegen.`);
        t.bewertung[a.id] = { ...alt, punkte: runde05(p), kommentar: String(e.kommentar || '').slice(0, 1000), bestaetigt: true };
      }
      geaendert.add(t);
    }
    for (const t of geaendert) sp.speichereTeilnahme(test.id, t);
    return sende(res, 200, ergebnisse(test));
  }

  if (rest === 'noten-freigeben' && methode === 'POST') {
    const b = await lesBody(req, 10000);
    if (b.freigegeben) {
      const e = ergebnisse(test);
      if (e.offen > 0) fehler(400, `Es sind noch ${e.offen} offene Antworten nicht bewertet. Noten gibt es erst, wenn du alles bestätigt hast.`);
    }
    test.notenFreigegeben = !!b.freigegeben;
    sp.speichereTest(test);
    return sende(res, 200, ergebnisse(test));
  }

  if (rest === 'export' && methode === 'GET') {
    const daten = JSON.stringify({ exportiertAm: new Date().toISOString(), test, teilnahmen: sp.alleTeilnahmen(test.id).map(({ token, ...r }) => r) }, null, 1);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="sicherung-${test.id}.json"`,
      'Cache-Control': 'no-store',
    });
    return res.end(daten);
  }

  fehler(404, 'Nicht gefunden.');
}

// ---------- Dateien ausliefern ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json',
  '.wasm': 'application/wasm',
};

function sendeDatei(res, datei, cache = 'no-cache') {
  fs.stat(datei, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nicht gefunden');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(datei).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    fs.createReadStream(datei).pipe(res);
  });
}

function ausOrdner(res, basis, rel, cache) {
  const ziel = path.resolve(basis, rel);
  if (ziel !== basis && !ziel.startsWith(basis + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  sendeDatei(res, ziel, cache);
}

const OEFFENTLICH = path.join(WURZEL, 'public');
const MODULE = path.join(WURZEL, 'node_modules');
const seite = (name) => path.join(OEFFENTLICH, name);

function statisch(req, res, pfad) {
  if (pfad === '/') {
    res.writeHead(302, { Location: '/lehrer' });
    return res.end();
  }
  if (/^\/t\/[a-z0-9]+\/?$/.test(pfad)) return sendeDatei(res, seite('test.html'));
  if (pfad === '/lehrer' || pfad === '/lehrer/') return sendeDatei(res, seite('lehrer.html'));
  if (/^\/lehrer\/boegen\/[a-z0-9]+$/.test(pfad)) return sendeDatei(res, seite('boegen.html'));
  if (/^\/lehrer\/tabelle\/[a-z0-9]+$/.test(pfad)) return sendeDatei(res, seite('tabelle.html'));
  if (pfad === '/info') return sendeDatei(res, seite('info.html'));
  if (pfad === '/hinweise') return sendeDatei(res, seite('hinweise.html'));
  if (pfad === '/richtlinien') return sendeDatei(res, seite('richtlinien.html'));
  if (pfad.startsWith('/static/')) return ausOrdner(res, OEFFENTLICH, pfad.slice(8));
  if (pfad.startsWith('/vendor/katex/')) return ausOrdner(res, path.join(MODULE, 'katex', 'dist'), pfad.slice(14), 'public, max-age=604800');
  if (pfad.startsWith('/vendor/pdfjs/')) return ausOrdner(res, path.join(MODULE, 'pdfjs-dist', 'build'), pfad.slice(14), 'public, max-age=604800');
  if (pfad === '/vendor/qrcode.js') return sendeDatei(res, path.join(MODULE, 'qrcode-generator', 'qrcode.js'), 'public, max-age=604800');
  const m = /^\/bild\/([a-z0-9]+)\/([a-f0-9]+\.(?:jpg|png))$/.exec(pfad);
  if (m) {
    const p = sp.bildPfad(m[1], m[2]);
    if (p) return sendeDatei(res, p, 'private, max-age=86400');
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Nicht gefunden');
}

// ---------- Server ----------

const server = http.createServer(async (req, res) => {
  let pfad = '/';
  try {
    pfad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pfad.startsWith('/api/s/')) return await apiSuS(req, res, pfad);
    if (pfad.startsWith('/api/l/')) return await apiLehrkraft(req, res, pfad);
    if (req.method !== 'GET' && req.method !== 'HEAD') fehler(405, 'Nicht erlaubt.');
    return statisch(req, res, pfad);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpFehler) return sende(res, e.status, { fehler: e.message });
    console.error(new Date().toISOString(), pfad, e);
    sende(res, 500, { fehler: 'Auf dem Server ist ein Fehler aufgetreten.' });
  }
});

server.listen(PORT, () => {
  console.log(`Klassenarbeit online läuft auf Port ${PORT}  –  Lehrkraft-Bereich: http://localhost:${PORT}/lehrer`);
  console.log(`Daten-Ordner: ${sp.DATEN}`);
  if (sp.speicherWarnung) console.log('WARNUNG: ' + sp.speicherWarnung);
  console.log(ki.kiBereit() ? `KI: bereit (${ki.MODELL})` : 'KI: kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY) – Aufgaben können nur von Hand angelegt werden.');
});
