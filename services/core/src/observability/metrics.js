// Métricas em memória no formato de exposição Prometheus (texto).
// Rótulos nunca contêm identificadores pessoais — apenas categorias de baixa cardinalidade.
export function createMetrics() {
  const counters = new Map();
  const histos = new Map();
  const gauges = new Map();
  const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

  const key = (name, labels = {}) => {
    const l = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '_')}"`)
      .join(',');
    return l ? `${name}{${l}}` : name;
  };

  return {
    inc(name, labels, by = 1) {
      const k = key(name, labels);
      counters.set(k, (counters.get(k) || 0) + by);
    },
    set(name, labels, value) {
      gauges.set(key(name, labels), value);
    },
    observe(name, labels, seconds) {
      const k = key(name, labels);
      const h = histos.get(k) || { name, labels, buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
      BUCKETS.forEach((b, i) => {
        if (seconds <= b) h.buckets[i] += 1;
      });
      h.sum += seconds;
      h.count += 1;
      histos.set(k, h);
    },
    get(name, labels) {
      return counters.get(key(name, labels)) || 0;
    },
    render() {
      const lines = [];
      for (const [k, v] of counters) lines.push(`${k} ${v}`);
      for (const [k, v] of gauges) lines.push(`${k} ${v}`);
      for (const h of histos.values()) {
        BUCKETS.forEach((b, i) => lines.push(`${key(h.name + '_bucket', { ...h.labels, le: b })} ${h.buckets[i]}`));
        lines.push(`${key(h.name + '_bucket', { ...h.labels, le: '+Inf' })} ${h.count}`);
        lines.push(`${key(h.name + '_sum', h.labels)} ${h.sum}`);
        lines.push(`${key(h.name + '_count', h.labels)} ${h.count}`);
      }
      return lines.join('\n') + '\n';
    },
  };
}
