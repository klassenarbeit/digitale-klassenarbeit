// Gemeinsame Bausteine für alle Seiten: kleine DOM-Helfer, Server-Anfragen, Formelsatz, Aufgaben-Darstellung.

// h('div', {class:'x', onclick: fn}, 'Text', kindElement, …)
export function h(tag, attrs, ...kinder) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  anhaengen(el, kinder);
  return el;
}

function anhaengen(el, kinder) {
  for (const k of kinder.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export function leere(el, ...kinder) {
  el.replaceChildren();
  anhaengen(el, kinder);
  return el;
}

export class ApiFehler extends Error {
  constructor(meldung, status) {
    super(meldung);
    this.status = status;
  }
}

// Anfrage an den Server. Wirft ApiFehler mit deutscher Meldung; status 0 = keine Verbindung.
export async function api(pfad, daten, methode) {
  let antwort;
  try {
    antwort = await fetch(pfad, {
      method: methode || (daten === undefined ? 'GET' : 'POST'),
      headers: daten === undefined ? {} : { 'Content-Type': 'application/json' },
      body: daten === undefined ? undefined : JSON.stringify(daten),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiFehler('Keine Verbindung zum Server.', 0);
  }
  let json = null;
  try {
    json = await antwort.json();
  } catch {}
  if (!antwort.ok) throw new ApiFehler((json && json.fehler) || `Fehler ${antwort.status}`, antwort.status);
  return json || {};
}

const maskiere = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Setzt Text mit Zeilenumbrüchen, **fett** und Formeln ($…$ in LaTeX) in ein Element.
export function setzeText(el, text) {
  el.innerHTML = maskiere(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\r?\n/g, '<br>');
  if (window.renderMathInElement && /\$|\\\(/.test(String(text))) {
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    } catch {}
  }
  return el;
}

export const textEl = (tag, attrs, text) => setzeText(h(tag, attrs), text);

export const bildUrl = (testId, bild) => `/bild/${testId}/${bild}`;

const OHNE_KORREKTUR = { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' };

// Zeichnet die Eingabefelder einer Aufgabe (SuS-Fassung, ohne Lösungen).
// antwort: bisherige Antwort; beiAenderung(neueAntwort) wird bei jeder Eingabe aufgerufen.
export function zeichneAufgabe(el, a, antwort, beiAenderung, testId) {
  const melde = beiAenderung || (() => {});
  leere(el);
  if (a.text) el.append(textEl('div', { class: 'aufgabentext' }, a.text));
  if (a.bild && testId) el.append(h('img', { class: 'aufgabenbild', src: bildUrl(testId, a.bild), alt: 'Abbildung zur Aufgabe' }));

  if (a.typ === 'mc') {
    const gewaehlt = new Set(Array.isArray(antwort) ? antwort.map(Number) : []);
    el.append(h('p', { class: 'eingabehinweis' }, a.mehrfach ? 'Mehrere Antworten können richtig sein.' : 'Wähle eine Antwort.'));
    const liste = h('div', { class: 'optionen' });
    a.optionen.forEach((text, i) => {
      const feld = h('input', { type: a.mehrfach ? 'checkbox' : 'radio', name: 'mc-' + a.id, checked: gewaehlt.has(i) });
      feld.addEventListener('change', () => {
        if (!a.mehrfach) gewaehlt.clear();
        if (feld.checked) gewaehlt.add(i);
        else gewaehlt.delete(i);
        melde([...gewaehlt].sort((x, y) => x - y));
      });
      liste.append(h('label', { class: 'option' }, feld, textEl('span', null, text)));
    });
    el.append(liste);
  } else if (a.typ === 'zahl') {
    const feld = h('input', { type: 'text', class: 'feld zahlfeld', inputmode: 'text', ...OHNE_KORREKTUR, value: antwort == null ? '' : String(antwort), 'aria-label': 'Deine Antwort' });
    feld.addEventListener('input', () => melde(feld.value));
    el.append(
      h('div', { class: 'zahlzeile' }, feld, a.einheit ? textEl('span', { class: 'einheit' }, a.einheit) : null),
      h('p', { class: 'eingabehinweis' }, 'Zahl eingeben – auch als Dezimalzahl (3,5) oder Bruch (7/2).'),
    );
  } else if (a.typ === 'lueckentext') {
    const werte = Array.isArray(antwort) ? antwort.map((x) => (x == null ? '' : String(x))) : [];
    const absatz = h('div', { class: 'lueckentext' });
    const teile = String(a.lueckentext || '').split('{{}}');
    teile.forEach((teil, i) => {
      if (teil) absatz.append(textEl('span', null, teil));
      if (i < teile.length - 1) {
        const feld = h('input', { type: 'text', class: 'feld luecke', ...OHNE_KORREKTUR, value: werte[i] || '', 'aria-label': `Lücke ${i + 1}` });
        feld.addEventListener('input', () => {
          for (let k = 0; k < teile.length - 1; k++) if (werte[k] == null) werte[k] = '';
          werte[i] = feld.value;
          melde(werte.slice(0, teile.length - 1));
        });
        absatz.append(feld);
      }
    });
    el.append(absatz);
  } else if (a.typ === 'zuordnung') {
    const werte = Array.isArray(antwort) ? antwort.map((x) => (x == null ? '' : String(x))) : [];
    const tabelle = h('div', { class: 'zeilenliste' });
    a.links.forEach((links, i) => {
      const wahl = h('select', { class: 'feld', 'aria-label': 'Zuordnung wählen' },
        h('option', { value: '' }, '– bitte wählen –'),
        a.rechts.map((r) => h('option', { value: r, selected: werte[i] === r }, r)));
      wahl.addEventListener('change', () => {
        for (let k = 0; k < a.links.length; k++) if (werte[k] == null) werte[k] = '';
        werte[i] = wahl.value;
        melde(werte.slice(0, a.links.length));
      });
      tabelle.append(h('div', { class: 'zeile' }, textEl('div', { class: 'zeile-links' }, links), wahl));
    });
    el.append(tabelle);
  } else if (a.typ === 'vokabeln') {
    const werte = Array.isArray(antwort) ? antwort.map((x) => (x == null ? '' : String(x))) : [];
    el.append(h('p', { class: 'eingabehinweis' }, a.richtung === 'en-de' ? 'Übersetze ins Deutsche.' : 'Übersetze ins Englische.'));
    const tabelle = h('div', { class: 'zeilenliste' });
    a.woerter.forEach((wort, i) => {
      const feld = h('input', { type: 'text', class: 'feld', ...OHNE_KORREKTUR, lang: a.richtung === 'en-de' ? 'de' : 'en', value: werte[i] || '', 'aria-label': 'Übersetzung' });
      feld.addEventListener('input', () => {
        for (let k = 0; k < a.woerter.length; k++) if (werte[k] == null) werte[k] = '';
        werte[i] = feld.value;
        melde(werte.slice(0, a.woerter.length));
      });
      tabelle.append(h('div', { class: 'zeile' }, h('div', { class: 'zeile-links' }, wort), feld));
    });
    el.append(tabelle);
  } else {
    const feld = h('textarea', { class: 'feld freitext', rows: '8', placeholder: 'Schreibe hier deine Antwort …' });
    feld.value = antwort == null ? '' : String(antwort);
    feld.addEventListener('input', () => melde(feld.value));
    el.append(feld);
  }
}

export function datumZeit(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function minSek(sek) {
  sek = Math.max(0, Math.round(sek));
  const stunden = Math.floor(sek / 3600);
  const m = Math.floor((sek % 3600) / 60);
  const s = sek % 60;
  const zz = (n) => String(n).padStart(2, '0');
  return stunden ? `${stunden}:${zz(m)}:${zz(s)}` : `${m}:${zz(s)}`;
}
