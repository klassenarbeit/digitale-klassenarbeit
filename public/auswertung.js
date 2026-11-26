// Gemeinsame Logik für Server und Browser: Aufgabentypen, Zahlen lesen, Bewerten, Noten.
// Diese Datei enthält keine Lösungen – nur Regeln.

export const TYPEN = {
  mc: 'Multiple Choice',
  zahl: 'Zahleneingabe',
  lueckentext: 'Lückentext',
  zuordnung: 'Zuordnung',
  vokabeln: 'Vokabeln',
  offen: 'Offene Aufgabe (Freitext)',
};

export const STANDARD_NOTENSCHLUESSEL = [
  { note: 1, ab: 87 },
  { note: 2, ab: 73 },
  { note: 3, ab: 59 },
  { note: 4, ab: 45 },
  { note: 5, ab: 18 },
];

export function neueId(prefix = 'a') {
  return prefix + Math.random().toString(36).slice(2, 10);
}

const str = (x, max = 20000) => (x == null ? '' : String(x)).slice(0, max);

function zahlOder(x, ersatz) {
  const n = typeof x === 'number' ? x : parseZahl(x);
  return n == null || !Number.isFinite(n) ? ersatz : n;
}

// Bringt eine Aufgabe (aus der KI oder aus dem Editor) in eine saubere, vollständige Form.
export function normalisiereAufgabe(roh) {
  const a = roh && typeof roh === 'object' ? roh : {};
  const typ = Object.prototype.hasOwnProperty.call(TYPEN, a.typ) ? a.typ : 'offen';
  const aus = {
    id: /^[a-z0-9]{3,20}$/.test(a.id || '') ? a.id : neueId(),
    typ,
    titel: str(a.titel, 80),
    text: str(a.text),
    punkte: Math.max(0, Math.min(999, runde05(zahlOder(a.punkte, 1)))),
    hinweis: str(a.hinweis, 2000),
    loesungsweg: str(a.loesungsweg, 4000),
    minuten: Math.max(0, Math.min(300, Math.round(zahlOder(a.minuten, 0) * 2) / 2)),
    bild: /^[a-f0-9]{8,40}\.(jpg|png)$/.test(a.bild || '') ? a.bild : '',
    abbildungFehlt: str(a.abbildungFehlt, 300),
  };
  if (typ === 'mc') {
    aus.optionen = (Array.isArray(a.optionen) ? a.optionen : []).slice(0, 12).map((o) => ({
      text: str(o && typeof o === 'object' ? o.text : o, 1000),
      richtig: !!(o && o.richtig),
    }));
    if (aus.optionen.length < 2) while (aus.optionen.length < 2) aus.optionen.push({ text: '', richtig: false });
  } else if (typ === 'zahl') {
    aus.loesung = str(a.loesung, 100);
    aus.toleranz = Math.max(0, zahlOder(a.toleranz, 0));
    aus.einheit = str(a.einheit, 30);
  } else if (typ === 'lueckentext') {
    aus.lueckentext = str(a.lueckentext);
    aus.grossKlein = !!a.grossKlein;
  } else if (typ === 'zuordnung') {
    aus.paare = (Array.isArray(a.paare) ? a.paare : []).slice(0, 30).map((p) => ({
      links: str(p && p.links, 500),
      rechts: str(p && p.rechts, 500),
    }));
  } else if (typ === 'vokabeln') {
    aus.richtung = a.richtung === 'en-de' ? 'en-de' : 'de-en';
    aus.paare = (Array.isArray(a.paare) ? a.paare : []).slice(0, 60).map((p) => ({
      wort: str(p && p.wort, 300),
      loesung: str(p && p.loesung, 500),
    }));
  } else {
    aus.erwartung = str(a.erwartung);
  }
  return aus;
}

export function neueAufgabe(typ) {
  const basis = { typ, punkte: typ === 'offen' ? 4 : 1 };
  if (typ === 'mc') basis.optionen = [{ text: '', richtig: true }, { text: '', richtig: false }, { text: '', richtig: false }];
  if (typ === 'zuordnung') basis.paare = [{ links: '', rechts: '' }, { links: '', rechts: '' }];
  if (typ === 'vokabeln') basis.paare = [{ wort: '', loesung: '' }, { wort: '', loesung: '' }];
  return normalisiereAufgabe(basis);
}

// ---------- Zahlen ----------

// Liest "0,5", "0.5", "1/2", "1 1/2", "-3", "50 %", "x = 4", "12 cm" … Gibt eine Zahl oder null zurück.
export function parseZahl(roh, einheit) {
  if (roh == null) return null;
  if (typeof roh === 'number') return Number.isFinite(roh) ? roh : null;
  let s = String(roh).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/[−–—]/g, '-').replace(/[÷:]/g, '/').replace(/⁄/g, '/');
  s = s.replace(/^[a-z]\s*=\s*/, '');
  const e = einheit ? String(einheit).trim().toLowerCase() : '';
  if (e && s.endsWith(e)) s = s.slice(0, -e.length).trim();
  let prozent = false;
  if (s.endsWith('%')) {
    prozent = true;
    s = s.slice(0, -1).trim();
  }
  if (!s) return null;

  const dez = (t) => {
    t = t.replace(/\s/g, '');
    if (!/^[+-]?(\d+([.,]\d+)*|[.,]\d+)$/.test(t)) return null;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  let wert;
  const gemischt = s.match(/^([+-]?)\s*(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (gemischt) {
    const nenner = Number(gemischt[4]);
    if (!nenner) return null;
    wert = Number(gemischt[2]) + Number(gemischt[3]) / nenner;
    if (gemischt[1] === '-') wert = -wert;
  } else {
    const teile = s.split('/');
    if (teile.length === 2) {
      const z = dez(teile[0]);
      const n = dez(teile[1]);
      if (z == null || n == null || n === 0) return null;
      wert = z / n;
    } else if (teile.length === 1) {
      wert = dez(s);
    } else {
      return null;
    }
  }
  if (wert == null || !Number.isFinite(wert)) return null;
  return prozent ? wert / 100 : wert;
}

export function zahlGleich(a, b, toleranz = 0) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= Math.max(toleranz || 0, 1e-9 * Math.max(1, Math.abs(b)));
}

export function runde05(x) {
  return Math.round(x * 2) / 2;
}

// Deutsche Schreibweise: 3.5 -> "3,5"
export function zahlText(n, stellen = 2) {
  if (n == null || !Number.isFinite(n)) return '–';
  const f = Math.pow(10, stellen);
  return String(Math.round(n * f) / f).replace('.', ',');
}

// ---------- Texte ----------

export function normText(s, grossKlein = false) {
  let t = String(s == null ? '' : s).normalize('NFKC').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
  if (!grossKlein) t = t.toLowerCase();
  return t;
}

function textGleich(antwort, loesung, grossKlein) {
  const a = normText(antwort, grossKlein);
  const l = normText(loesung, grossKlein);
  if (!a) return false;
  if (a === l) return true;
  const za = parseZahl(a);
  const zl = parseZahl(l);
  return za != null && zl != null && zahlGleich(za, zl);
}

// "Paris ist die {{Hauptstadt|Kapitale}} von {{Frankreich}}" -> [["Hauptstadt","Kapitale"],["Frankreich"]]
export function lueckenAus(text) {
  const aus = [];
  const re = /\{\{(.*?)\}\}/g;
  let m;
  while ((m = re.exec(String(text || '')))) aus.push(m[1].split('|').map((x) => x.trim()).filter(Boolean));
  return aus;
}

function vokabelNorm(s) {
  return normText(s)
    .replace(/[()\[\].!?]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(to|the|a|an|der|die|das|ein|eine)\s+/, '');
}

function vokabelRichtig(antwort, loesung) {
  const varianten = String(loesung || '').split(/[;|\/,]/).map(vokabelNorm).filter(Boolean);
  if (!varianten.length) return false;
  const ganz = vokabelNorm(antwort);
  if (!ganz) return false;
  if (varianten.includes(ganz)) return true;
  const teile = String(antwort).split(/[;|\/,]/).map(vokabelNorm).filter(Boolean);
  return teile.length > 0 && teile.every((t) => varianten.includes(t));
}

// ---------- Was die SuS sehen (ohne Lösungen) ----------

export function fuerSuS(a) {
  const aus = { id: a.id, typ: a.typ, titel: a.titel, text: a.text, punkte: a.punkte, bild: a.bild };
  if (a.typ === 'mc') {
    aus.optionen = a.optionen.map((o) => o.text);
    aus.mehrfach = a.optionen.filter((o) => o.richtig).length > 1;
  } else if (a.typ === 'zahl') {
    aus.einheit = a.einheit;
  } else if (a.typ === 'lueckentext') {
    aus.lueckentext = String(a.lueckentext || '').replace(/\{\{.*?\}\}/g, '{{}}');
  } else if (a.typ === 'zuordnung') {
    aus.links = a.paare.map((p) => p.links);
    aus.rechts = [...new Set(a.paare.map((p) => p.rechts))].sort((x, y) => x.localeCompare(y, 'de'));
  } else if (a.typ === 'vokabeln') {
    aus.richtung = a.richtung;
    aus.woerter = a.paare.map((p) => p.wort);
  }
  return aus;
}

const gefuellt = (x) => x != null && String(x).trim() !== '';

// 'leer' | 'teilweise' | 'voll' – für Fortschritt und „noch offene Aufgaben“. Arbeitet mit der SuS-Fassung.
export function antwortStand(aufgabeSuS, antwort) {
  const a = aufgabeSuS;
  let soll = 1;
  let ist = 0;
  if (a.typ === 'mc') {
    ist = Array.isArray(antwort) && antwort.length ? 1 : 0;
  } else if (a.typ === 'zahl' || a.typ === 'offen') {
    ist = gefuellt(antwort) ? 1 : 0;
  } else {
    soll = a.typ === 'lueckentext' ? (String(a.lueckentext || '').match(/\{\{.*?\}\}/g) || []).length
      : a.typ === 'zuordnung' ? (a.links || []).length
      : (a.woerter || []).length;
    ist = Array.isArray(antwort) ? antwort.slice(0, soll).filter(gefuellt).length : 0;
    if (soll === 0) return 'voll';
  }
  return ist === 0 ? 'leer' : ist >= soll ? 'voll' : 'teilweise';
}

// ---------- Bewerten ----------

function teilpunkte(max, richtig, gesamt) {
  if (!gesamt || richtig <= 0) return 0;
  if (richtig >= gesamt) return max;
  let p = runde05((max * richtig) / gesamt);
  if (p >= max) p = Math.max(0, max - 0.5);
  return p;
}

// Ergebnis: { punkte (null bei offenen Aufgaben), max, status, antwortText, loesungText }
// status: 'richtig' | 'teilweise' | 'falsch' | 'leer' | 'offen'
export function bewerte(a, antwort) {
  const max = a.punkte;
  const fertig = (richtig, gesamt, leer, antwortText, loesungText) => {
    const punkte = teilpunkte(max, richtig, gesamt);
    const status = leer ? 'leer' : richtig >= gesamt && gesamt > 0 ? 'richtig' : punkte > 0 ? 'teilweise' : 'falsch';
    return { punkte, max, status, antwortText, loesungText };
  };

  if (a.typ === 'mc') {
    const gewaehlt = Array.isArray(antwort) ? antwort.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < a.optionen.length) : [];
    const richtige = a.optionen.map((o, i) => (o.richtig ? i : -1)).filter((i) => i >= 0);
    const treffer = gewaehlt.filter((i) => richtige.includes(i)).length;
    const fehler = gewaehlt.length - treffer;
    const wert = richtige.length <= 1 ? (treffer === 1 && fehler === 0 ? 1 : 0) : Math.max(0, treffer - fehler);
    return fertig(wert, Math.max(1, richtige.length), gewaehlt.length === 0,
      gewaehlt.map((i) => a.optionen[i].text).join(' · '),
      richtige.map((i) => a.optionen[i].text).join(' · '));
  }

  if (a.typ === 'zahl') {
    const soll = parseZahl(a.loesung, a.einheit);
    const ist = parseZahl(antwort, a.einheit);
    const ok = soll != null ? zahlGleich(ist, soll, a.toleranz) : textGleich(antwort, a.loesung);
    const eh = a.einheit ? ' ' + a.einheit : '';
    return fertig(ok ? 1 : 0, 1, !gefuellt(antwort), gefuellt(antwort) ? String(antwort).trim() : '', a.loesung + eh);
  }

  if (a.typ === 'lueckentext') {
    const luecken = lueckenAus(a.lueckentext);
    const ant = Array.isArray(antwort) ? antwort : [];
    let richtig = 0;
    luecken.forEach((varianten, i) => {
      if (varianten.some((v) => textGleich(ant[i], v, a.grossKlein))) richtig++;
    });
    return fertig(richtig, luecken.length, !ant.some(gefuellt),
      luecken.map((_, i) => `(${i + 1}) ${gefuellt(ant[i]) ? String(ant[i]).trim() : '–'}`).join('  '),
      luecken.map((v, i) => `(${i + 1}) ${v.join(' / ')}`).join('  '));
  }

  if (a.typ === 'zuordnung') {
    const ant = Array.isArray(antwort) ? antwort : [];
    let richtig = 0;
    a.paare.forEach((p, i) => {
      if (gefuellt(ant[i]) && normText(ant[i]) === normText(p.rechts)) richtig++;
    });
    return fertig(richtig, a.paare.length, !ant.some(gefuellt),
      a.paare.map((p, i) => `${p.links} → ${gefuellt(ant[i]) ? ant[i] : '–'}`).join('; '),
      a.paare.map((p) => `${p.links} → ${p.rechts}`).join('; '));
  }

  if (a.typ === 'vokabeln') {
    const ant = Array.isArray(antwort) ? antwort : [];
    let richtig = 0;
    a.paare.forEach((p, i) => {
      if (vokabelRichtig(ant[i], p.loesung)) richtig++;
    });
    return fertig(richtig, a.paare.length, !ant.some(gefuellt),
      a.paare.map((p, i) => `${p.wort} → ${gefuellt(ant[i]) ? String(ant[i]).trim() : '–'}`).join('; '),
      a.paare.map((p) => `${p.wort} → ${p.loesung}`).join('; '));
  }

  // offen
  const leer = !gefuellt(antwort);
  return { punkte: leer ? 0 : null, max, status: leer ? 'leer' : 'offen', antwortText: leer ? '' : String(antwort), loesungText: a.erwartung || '' };
}

// ---------- Noten ----------

export function noteAus(prozent, schluessel) {
  const sortiert = [...(schluessel || STANDARD_NOTENSCHLUESSEL)].sort((x, y) => y.ab - x.ab);
  for (const s of sortiert) if (prozent + 1e-9 >= s.ab) return s.note;
  return 6;
}

export function normalisiereSchluessel(roh) {
  const aus = [];
  for (let note = 1; note <= 5; note++) {
    const e = Array.isArray(roh) ? roh.find((x) => x && Number(x.note) === note) : null;
    const std = STANDARD_NOTENSCHLUESSEL[note - 1].ab;
    let ab = e ? zahlOder(e.ab, std) : std;
    ab = Math.max(0, Math.min(100, ab));
    aus.push({ note, ab });
  }
  return aus;
}
