/**
 * Short, interesting place descriptions from Wikipedia and Wikivoyage.
 * The place is found from the marker's name and position, so a misspelled name still works.
 */

export interface PlaceSuggestion {
  /** Short description, one or two sentences. */
  text: string;
  /** Article title. */
  title: string;
  source: 'Wikipedia' | 'Wikivoyage';
  url: string;
  /** A photo of the place, usable in the video. */
  imageUrl?: string;
}

const WIKI = 'https://en.wikipedia.org';
const VOYAGE = 'https://en.wikivoyage.org';
const MAX_CHARS = 220;

interface Summary {
  type?: string;
  title: string;
  extract?: string;
  description?: string;
  content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source: string; width: number; height: number };
  originalimage?: { source: string; width: number; height: number };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim();

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bb = bigrams(b);
  let hits = 0;
  for (const g of bigrams(a)) {
    const i = bb.indexOf(g);
    if (i >= 0) {
      hits++;
      bb.splice(i, 1);
    }
  }
  return (2 * hits) / (a.length - 1 + b.length - 1);
}

/** Word-order independent, typo tolerant similarity of a name and an article title (0..1). */
export function nameSimilarity(name: string, title: string): number {
  const q = norm(name).split(/\s+/).filter((w) => w.length > 1);
  const t = norm(title).split(/\s+/).filter((w) => w.length > 1);
  if (!q.length || !t.length) return 0;
  const cover = (a: string[], b: string[]) => a.reduce((sum, w) => sum + Math.max(...b.map((x) => dice(w, x))), 0) / a.length;
  // mostly "does the title contain my words", a little "does it add other words"
  return 0.7 * cover(q, t) + 0.3 * cover(t, q);
}

/** Marker names the app generates itself, which say nothing about the place. */
const GENERIC = /^(stop|pause|point|marker|sign|waypoint|new stop)\s*\d*$/i;

// ------------------------------------------------------------------ choosing interesting sentences

const SPICE = /\b(first|only|oldest|largest|biggest|tallest|highest|longest|deepest|most|famous|iconic|known for|best[- ]known|world|unesco|heritage|legend|historic|ancient|medieval|unique|record|landmark|photographed|visited|popular|spectacular|stunning|beautiful|breathtaking)\b/i;
const DRY = /\b(administrative|municipality|prefecture|county|district|metropolitan|census|population of|located in|situated|region of|province of|is a city in|is a town in|coordinates|operated by|owned by|licen[cs]es?)\b/i;

function splitSentences(text: string): string[] {
  const clean = text
    .replace(/\s*\([^()]*\)/g, '') // pronunciations, native names, measurements in brackets
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

function sentenceScore(s: string, index: number): number {
  let score = 0;
  const spice = s.match(new RegExp(SPICE.source, 'gi'));
  score += (spice ? spice.length : 0) * 2;
  if (DRY.test(s)) score -= 2;
  score -= Math.max(0, s.length - 160) / 60; // prefer short
  score -= (s.match(/\d/g)?.length || 0) * 0.15; // numbers are dry
  if (index === 0) score += 0.5; // the lead often defines the place
  return score;
}

/** Make a sentence stand on its own: "It was the first…" → "Tokyo Disneyland was the first…". */
function standAlone(s: string, title: string): string {
  return s.replace(/^(It|This|The (?:park|city|town|bridge|site|island|building|museum|lake|mountain|castle|temple|church|station|resort))\b/, title);
}

function trimTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '), cut.lastIndexOf(' '));
  return cut.slice(0, at > max * 0.6 ? at : max).replace(/[,;:\s]+$/, '') + '…';
}

/** Up to two short, interesting sentences from an article lead. */
export function pickInteresting(extract: string, title: string): string[] {
  const sentences = splitSentences(extract);
  if (!sentences.length) return [];
  const ranked = sentences.map((s, i) => ({ s: standAlone(s, title), i, score: sentenceScore(s, i) })).sort((a, b) => b.score - a.score);
  const out: string[] = [];
  // best single sentence, and the best pair that fits, as separate options
  const best = ranked[0];
  out.push(trimTo(best.s, MAX_CHARS));
  for (const other of ranked.slice(1)) {
    const pair = [best, other].sort((a, b) => a.i - b.i).map((x) => x.s).join(' ');
    if (pair.length <= MAX_CHARS) {
      out.push(pair);
      break;
    }
  }
  if (ranked[1]) out.push(trimTo(ranked[1].s, MAX_CHARS));
  return [...new Set(out)];
}

// ------------------------------------------------------------------ finding the article

interface Candidate {
  title: string;
  score: number;
}

async function geoCandidates(lat: number, lng: number): Promise<{ title: string; dist: number }[]> {
  const url = `${WIKI}/w/api.php?action=query&list=geosearch&gscoord=${lat.toFixed(5)}|${lng.toFixed(5)}&gsradius=10000&gslimit=30&format=json&origin=*`;
  const j = await getJson<{ query?: { geosearch?: { title: string; dist: number }[] } }>(url);
  return j?.query?.geosearch ?? [];
}

async function searchTitles(q: string): Promise<string[]> {
  const url = `${WIKI}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5&srinfo=suggestion&format=json&origin=*`;
  const j = await getJson<{ query?: { search?: { title: string }[]; searchinfo?: { suggestion?: string } } }>(url);
  const titles = j?.query?.search?.map((r) => r.title) ?? [];
  const suggestion = j?.query?.searchinfo?.suggestion;
  if (!titles.length && suggestion) return searchTitles(suggestion);
  return titles;
}

/** Name of the town or area at a position (for generic marker names). */
async function placeNameAt(lat: number, lng: number): Promise<{ name?: string; wikipedia?: string }> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=12&extratags=1&accept-language=en`;
  const j = await getJson<{ name?: string; extratags?: { wikipedia?: string }; address?: Record<string, string> }>(url);
  if (!j) return {};
  const a = j.address || {};
  return { name: j.name || a.city || a.town || a.village || a.county, wikipedia: j.extratags?.wikipedia };
}

async function summary(base: string, title: string): Promise<Summary | null> {
  const s = await getJson<Summary>(`${base}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  if (!s || s.type === 'disambiguation' || !s.extract) return null;
  return s;
}

/** A large but standard-size thumbnail of the article image. */
function imageFrom(s: Summary): string | undefined {
  const t = s.thumbnail?.source;
  if (!t) return undefined;
  const orig = s.originalimage;
  if (orig && Math.max(orig.width, orig.height) <= 1280) return orig.source;
  return t.replace(/\/\d+px-/, '/1280px-');
}

/** Find short descriptions for a place. The first suggestion is the best guess. */
export async function suggestPlaceInfo(name: string, lat: number, lng: number): Promise<PlaceSuggestion[]> {
  const generic = !name.trim() || GENERIC.test(name.trim());
  const candidates: Candidate[] = [];
  const add = (title: string, score: number) => {
    const c = candidates.find((x) => x.title === title);
    if (c) c.score = Math.max(c.score, score);
    else candidates.push({ title, score });
  };

  const [geo, found] = await Promise.all([geoCandidates(lat, lng), generic ? Promise.resolve([] as string[]) : searchTitles(name)]);
  for (const g of geo) {
    const near = 1 - Math.min(1, g.dist / 10000);
    add(g.title, (generic ? 0.6 : nameSimilarity(name, g.title) * 1.6) + near * 0.5);
  }
  found.forEach((t, i) => add(t, nameSimilarity(name, t) * 1.6 + 0.3 - i * 0.05));

  // nothing convincing: describe the town or area instead
  const bestScore = Math.max(0, ...candidates.map((c) => c.score));
  if (generic || bestScore < 1.1) {
    const place = await placeNameAt(lat, lng);
    if (place.wikipedia?.startsWith('en:')) add(place.wikipedia.slice(3), 1.5);
    if (place.name) add(place.name, 1.2);
  }

  candidates.sort((a, b) => b.score - a.score);
  const out: PlaceSuggestion[] = [];
  for (const c of candidates.slice(0, 3)) {
    const [wp, wv] = await Promise.all([summary(WIKI, c.title), summary(VOYAGE, c.title)]);
    for (const [s, source] of [
      [wp, 'Wikipedia'],
      [wv, 'Wikivoyage'],
    ] as const) {
      if (!s?.extract) continue;
      for (const text of pickInteresting(s.extract, s.title)) {
        out.push({ text, title: s.title, source, url: s.content_urls?.desktop?.page || `${source === 'Wikipedia' ? WIKI : VOYAGE}/wiki/${encodeURIComponent(s.title)}`, imageUrl: imageFrom(wp ?? s) });
      }
    }
    if (out.length >= 3) break;
  }
  return out;
}
