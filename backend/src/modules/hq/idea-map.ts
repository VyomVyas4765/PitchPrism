// W-27 idea map. Each idea's fingerprint (PRD A-19: trade, offering, customers) becomes a TF-IDF vector over its
// title, trade and redacted evidence; the map projects the vectors to 2D with PCA and groups them with k-means
// (cosine). Clusters are named by their top terms. This is a lexical map: words in common, not meaning. When A-19
// stores semantic embeddings, pass those vectors to layout() instead; projection and clustering stay the same.
// Deterministic: the same ideas always give the same map.

export interface MapInput { id: string; text: string }
export interface MapPoint { id: string; x: number; y: number; cluster: number }
export interface MapCluster { id: number; label: string; terms: string[]; size: number; x: number; y: number }

const STOPWORDS = new Set(('the and for with that this from will have are was were been they their them our your you who what when where which '
  + 'into also than then there here about over under more most some such only very can could would should shop business sell selling sold '
  + 'make making made per month monthly year customers customer local area people need needs want wants other others any all not but its '
  + 'has had being use used using one two three four five pitch idea plan answer question segment synthetic').split(' '));

export function tokens(text: string) {
  return (text.toLowerCase().match(/\p{L}{3,}/gu) ?? []).filter(word => !STOPWORDS.has(word));
}

/** Seeded PRNG (mulberry32) so k-means and PCA start the same way every time. */
function random(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const dot = (a: Float64Array, b: Float64Array) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!; return sum; };
function normalise(vector: Float64Array) { const length = Math.sqrt(dot(vector, vector)); if (length) for (let i = 0; i < vector.length; i++) vector[i]! /= length; return vector; }

/** TF-IDF vectors (L2-normalised) and the vocabulary, capped to the most widely used terms. */
export function vectorise(inputs: MapInput[], maxTerms = 1500) {
  const docs = inputs.map(input => tokens(input.text));
  const df = new Map<string, number>();
  for (const words of docs) for (const word of new Set(words)) df.set(word, (df.get(word) ?? 0) + 1);
  // Terms in a single idea say nothing about similarity once there are enough ideas.
  const minDf = inputs.length >= 20 ? 2 : 1;
  const vocabulary = [...df.entries()].filter(([, count]) => count >= minDf).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxTerms).map(([word]) => word);
  const index = new Map(vocabulary.map((word, i) => [word, i]));
  const vectors = docs.map(words => {
    const vector = new Float64Array(vocabulary.length);
    for (const word of words) { const i = index.get(word); if (i !== undefined) vector[i]! += 1; }
    for (let i = 0; i < vector.length; i++) if (vector[i]) vector[i] = (1 + Math.log(vector[i]!)) * (Math.log((1 + inputs.length) / (1 + df.get(vocabulary[i]!)!)) + 1); // smoothed IDF: never zero
    return normalise(vector);
  });
  return { vectors, vocabulary };
}

/** First two principal components by power iteration with deflation. */
function project(vectors: Float64Array[]) {
  const n = vectors.length, d = vectors[0]?.length ?? 0;
  if (!d) return vectors.map(() => [0.5, 0.5] as [number, number]);
  const mean = new Float64Array(d);
  for (const vector of vectors) for (let i = 0; i < d; i++) mean[i]! += vector[i]! / n;
  const centred = vectors.map(vector => vector.map((value, i) => value - mean[i]!));
  const next = random(7);
  const components: Float64Array[] = [];
  for (let c = 0; c < 2; c++) {
    let axis = normalise(Float64Array.from({ length: d }, () => next() - 0.5));
    for (let iteration = 0; iteration < 60; iteration++) {
      const scores = centred.map(row => dot(row, axis));
      const updated = new Float64Array(d);
      centred.forEach((row, r) => { for (let i = 0; i < d; i++) updated[i]! += row[i]! * scores[r]!; });
      for (const previous of components) { const overlap = dot(updated, previous); for (let i = 0; i < d; i++) updated[i]! -= overlap * previous[i]!; }
      if (!dot(updated, updated)) break;
      axis = normalise(updated);
    }
    components.push(axis);
  }
  const raw = centred.map(row => [dot(row, components[0]!), dot(row, components[1]!)] as [number, number]);
  const scale = (k: 0 | 1) => { const values = raw.map(point => point[k]); const min = Math.min(...values), max = Math.max(...values); return (v: number) => max > min ? 0.05 + 0.9 * (v - min) / (max - min) : 0.5; };
  const sx = scale(0), sy = scale(1);
  return raw.map(([x, y]) => [sx(x), sy(y)] as [number, number]);
}

/** Spherical k-means with k-means++ seeding (seeded, so stable). */
function cluster(vectors: Float64Array[], k: number) {
  const next = random(11);
  const centres: Float64Array[] = [Float64Array.from(vectors[Math.floor(next() * vectors.length)]!)];
  while (centres.length < k) {
    const distances = vectors.map(vector => Math.max(0, 1 - Math.max(...centres.map(centre => dot(vector, centre)))));
    const total = distances.reduce((sum, value) => sum + value, 0);
    if (!total) break;
    let pick = next() * total, chosen = 0;
    for (; chosen < distances.length - 1 && pick > distances[chosen]!; chosen++) pick -= distances[chosen]!;
    centres.push(Float64Array.from(vectors[chosen]!));
  }
  let assignment = vectors.map(() => 0);
  for (let iteration = 0; iteration < 30; iteration++) {
    const updated = vectors.map(vector => { let best = 0, score = -Infinity; centres.forEach((centre, c) => { const s = dot(vector, centre); if (s > score) { score = s; best = c; } }); return best; });
    const changed = updated.some((value, i) => value !== assignment[i]);
    assignment = updated;
    centres.forEach((centre, c) => { centre.fill(0); vectors.forEach((vector, i) => { if (assignment[i] === c) for (let j = 0; j < centre.length; j++) centre[j]! += vector[j]!; }); normalise(centre); });
    if (!changed && iteration > 0) break;
  }
  return { assignment, centres };
}

/** Lay out ideas: 2D positions, clusters and cluster names (top terms). */
export function layout(inputs: MapInput[]) {
  if (!inputs.length) return { points: [] as MapPoint[], clusters: [] as MapCluster[] };
  const { vectors, vocabulary } = vectorise(inputs);
  const positions = project(vectors);
  const k = Math.max(1, Math.min(12, Math.round(Math.sqrt(inputs.length / 2))));
  const { assignment, centres } = cluster(vectors, k);
  // Renumber clusters by size so colours and names are stable for the same data.
  const sizes = centres.map((_, c) => assignment.filter(value => value === c).length);
  const order = sizes.map((size, c) => [size, c] as const).filter(([size]) => size > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, c]) => c);
  const renumber = new Map(order.map((c, i) => [c, i]));
  const points = inputs.map((input, i) => ({ id: input.id, x: positions[i]![0], y: positions[i]![1], cluster: renumber.get(assignment[i]!)! }));
  const clusters = order.map((c, i) => {
    const members = points.filter(point => point.cluster === i);
    const terms = [...centres[c]!].map((weight, term) => [weight, term] as const).filter(([weight]) => weight > 0).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, term]) => vocabulary[term]!);
    return { id: i, label: terms.length ? terms.join(' · ') : 'unlabelled', terms, size: members.length,
      x: members.reduce((sum, point) => sum + point.x, 0) / members.length, y: members.reduce((sum, point) => sum + point.y, 0) / members.length };
  });
  return { points, clusters };
}
