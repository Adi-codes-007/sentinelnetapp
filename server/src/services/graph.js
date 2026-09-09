/**
 * Graph analytics over entities (nodes) and relationships (edges).
 * Deterministic — no AI model needed for graph construction or these
 * metrics (requirement 16). Implementations are lightweight, dependency-free
 * versions suitable for demo-scale graphs (hundreds of nodes); swap in a
 * dedicated graph library / Neo4j GDS for production scale.
 */

function buildAdjacency(nodeIds, edges) {
  const adj = new Map(nodeIds.map(id => [id, new Set()]));
  edges.forEach(e => {
    if (adj.has(e.a) && adj.has(e.b)) {
      adj.get(e.a).add(e.b);
      adj.get(e.b).add(e.a);
    }
  });
  return adj;
}

function degreeCentrality(nodeIds, edges) {
  const adj = buildAdjacency(nodeIds, edges);
  const n = Math.max(1, nodeIds.length - 1);
  const out = {};
  nodeIds.forEach(id => { out[id] = Math.round((adj.get(id).size / n) * 100) / 100; });
  return out;
}

/** Brandes' algorithm — exact betweenness centrality, O(V*E). */
function betweennessCentrality(nodeIds, edges) {
  const adj = buildAdjacency(nodeIds, edges);
  const C = Object.fromEntries(nodeIds.map(id => [id, 0]));
  for (const s of nodeIds) {
    const S = [];
    const P = Object.fromEntries(nodeIds.map(id => [id, []]));
    const sigma = Object.fromEntries(nodeIds.map(id => [id, 0]));
    const dist = Object.fromEntries(nodeIds.map(id => [id, -1]));
    sigma[s] = 1; dist[s] = 0;
    const queue = [s];
    while (queue.length) {
      const v = queue.shift();
      S.push(v);
      for (const w of adj.get(v)) {
        if (dist[w] < 0) { dist[w] = dist[v] + 1; queue.push(w); }
        if (dist[w] === dist[v] + 1) { sigma[w] += sigma[v]; P[w].push(v); }
      }
    }
    const delta = Object.fromEntries(nodeIds.map(id => [id, 0]));
    while (S.length) {
      const w = S.pop();
      for (const v of P[w]) {
        delta[v] += (sigma[v] / (sigma[w] || 1)) * (1 + delta[w]);
      }
      if (w !== s) C[w] += delta[w];
    }
  }
  const n = nodeIds.length;
  const norm = n > 2 ? (n - 1) * (n - 2) : 1;
  const out = {};
  nodeIds.forEach(id => { out[id] = Math.round((C[id] / norm) * 1000) / 1000; });
  return out;
}

/** Power-iteration PageRank. */
function pageRank(nodeIds, edges, { damping = 0.85, iterations = 60 } = {}) {
  const adj = buildAdjacency(nodeIds, edges);
  const n = nodeIds.length || 1;
  let ranks = Object.fromEntries(nodeIds.map(id => [id, 1 / n]));
  for (let it = 0; it < iterations; it++) {
    const next = Object.fromEntries(nodeIds.map(id => [id, (1 - damping) / n]));
    nodeIds.forEach(id => {
      const neighbors = adj.get(id);
      if (!neighbors.size) return;
      const share = (damping * ranks[id]) / neighbors.size;
      neighbors.forEach(nb => { next[nb] += share; });
    });
    ranks = next;
  }
  const out = {};
  nodeIds.forEach(id => { out[id] = Math.round(ranks[id] * 10000) / 10000; });
  return out;
}

/** Label propagation — lightweight stand-in for Louvain/Leiden community
 *  detection. Swap-in path to a dedicated library is documented in README. */
function labelPropagationCommunities(nodeIds, edges, { iterations = 20 } = {}) {
  const adj = buildAdjacency(nodeIds, edges);
  let labels = Object.fromEntries(nodeIds.map((id, i) => [id, i]));
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    for (const id of nodeIds) {
      const neighbors = [...adj.get(id)];
      if (!neighbors.length) continue;
      const counts = {};
      neighbors.forEach(nb => { counts[labels[nb]] = (counts[labels[nb]] || 0) + 1; });
      let best = labels[id], bestCount = -1;
      Object.entries(counts).forEach(([lab, cnt]) => {
        if (cnt > bestCount) { bestCount = cnt; best = Number(lab); }
      });
      if (best !== labels[id]) { labels[id] = best; changed = true; }
    }
    if (!changed) break;
  }
  const groups = {};
  nodeIds.forEach(id => { (groups[labels[id]] = groups[labels[id]] || []).push(id); });
  return Object.values(groups).map((members, i) => ({ communityId: i + 1, members }));
}

function analyzeGraph(nodeIds, edges) {
  return {
    degree: degreeCentrality(nodeIds, edges),
    betweenness: betweennessCentrality(nodeIds, edges),
    pageRank: pageRank(nodeIds, edges),
    communities: labelPropagationCommunities(nodeIds, edges),
  };
}

module.exports = { degreeCentrality, betweennessCentrality, pageRank, labelPropagationCommunities, analyzeGraph };
