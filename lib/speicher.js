// Datenspeicher: einfache JSON-Dateien im Ordner „daten“.
// Jede Änderung wird sofort und „atomar“ geschrieben (erst temporäre Datei, dann umbenennen),
// damit auch bei einem Absturz keine halb geschriebene Datei entsteht.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const WURZEL = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Reihenfolge: dauerhafter Speicher bei Railway (dort automatisch gesetzt) – eigene Angabe – Ordner „daten“ neben dem Programm.
export const DATEN = path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATEN_ORDNER || path.join(WURZEL, 'daten'));

// Läuft die Anwendung bei Railway ohne angehängten Speicher, gehen bei jedem Neustart alle Daten verloren.
export const speicherWarnung = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) && !process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? 'Kein dauerhafter Speicher eingerichtet: Bei Railway ist noch kein Volume an diesen Dienst angehängt. Alle Tests und Antworten gehen beim nächsten Neustart oder Update verloren. Bitte vor dem ersten echten Test ein Volume anlegen.'
  : '';
const TESTS = path.join(DATEN, 'tests');

fs.mkdirSync(TESTS, { recursive: true });

const ID_RE = /^[a-z0-9]{4,12}$/;
export const istTestId = (id) => typeof id === 'string' && ID_RE.test(id);

function lies(datei) {
  try {
    return JSON.parse(fs.readFileSync(datei, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function schreib(datei, obj) {
  const tmp = `${datei}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, datei);
}

export function zufall(laenge, alphabet) {
  const bytes = crypto.randomBytes(laenge);
  let s = '';
  for (let i = 0; i < laenge; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

// ---------- Grundeinstellungen (Passwort-Ersatz, Cookie-Geheimnis) ----------

const CONFIG_DATEI = path.join(DATEN, 'config.json');
export const config = lies(CONFIG_DATEI) || {};
if (!config.geheimnis) {
  config.geheimnis = crypto.randomBytes(32).toString('hex');
  schreib(CONFIG_DATEI, config);
}
export function speichereConfig() {
  schreib(CONFIG_DATEI, config);
}

// ---------- Tests ----------

const testCache = new Map(); // id -> Test
const teilnahmeCache = new Map(); // id -> Map(nummer -> Teilnahme)

const ordner = (id) => path.join(TESTS, id);

export function alleTests() {
  const aus = [];
  for (const name of fs.readdirSync(TESTS)) {
    if (!istTestId(name)) continue;
    const t = holTest(name);
    if (t) aus.push(t);
  }
  return aus.sort((a, b) => (b.erstellt || 0) - (a.erstellt || 0));
}

export function holTest(id) {
  if (!istTestId(id)) return null;
  if (testCache.has(id)) return testCache.get(id);
  const t = lies(path.join(ordner(id), 'test.json'));
  if (t) testCache.set(id, t);
  return t;
}

export function speichereTest(test) {
  test.geaendert = Date.now();
  fs.mkdirSync(path.join(ordner(test.id), 'teilnahmen'), { recursive: true });
  fs.mkdirSync(path.join(ordner(test.id), 'bilder'), { recursive: true });
  schreib(path.join(ordner(test.id), 'test.json'), test);
  testCache.set(test.id, test);
}

export function neueTestId() {
  for (;;) {
    const id = zufall(6, 'abcdefghjkmnpqrstuvwxyz23456789');
    if (!fs.existsSync(ordner(id))) return id;
  }
}

export function loescheTest(id) {
  if (!istTestId(id)) return;
  fs.rmSync(ordner(id), { recursive: true, force: true });
  testCache.delete(id);
  teilnahmeCache.delete(id);
}

// ---------- Teilnahmen (eine Datei pro Nummer) ----------

function teilnahmenMap(testId) {
  if (teilnahmeCache.has(testId)) return teilnahmeCache.get(testId);
  const map = new Map();
  const dir = path.join(ordner(testId), 'teilnahmen');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const m = name.match(/^(\d+)\.json$/);
      if (!m) continue;
      const t = lies(path.join(dir, name));
      if (t) map.set(Number(m[1]), t);
    }
  }
  teilnahmeCache.set(testId, map);
  return map;
}

export function alleTeilnahmen(testId) {
  return [...teilnahmenMap(testId).values()].sort((a, b) => a.nummer - b.nummer);
}

export function holTeilnahme(testId, nummer) {
  return teilnahmenMap(testId).get(Number(nummer)) || null;
}

export function speichereTeilnahme(testId, t) {
  const dir = path.join(ordner(testId), 'teilnahmen');
  fs.mkdirSync(dir, { recursive: true });
  schreib(path.join(dir, `${Number(t.nummer)}.json`), t);
  teilnahmenMap(testId).set(Number(t.nummer), t);
}

export function loescheTeilnahme(testId, nummer) {
  fs.rmSync(path.join(ordner(testId), 'teilnahmen', `${Number(nummer)}.json`), { force: true });
  teilnahmenMap(testId).delete(Number(nummer));
}

// ---------- Bilder ----------

const BILD_RE = /^[a-f0-9]{8,40}\.(jpg|png)$/;

export function speichereBild(testId, puffer, endung) {
  const name = `${crypto.randomBytes(8).toString('hex')}.${endung}`;
  const dir = path.join(ordner(testId), 'bilder');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), puffer);
  return name;
}

export function bildPfad(testId, name) {
  if (!istTestId(testId) || !BILD_RE.test(name || '')) return null;
  const p = path.join(ordner(testId), 'bilder', name);
  return fs.existsSync(p) ? p : null;
}
