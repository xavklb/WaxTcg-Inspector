const nf = new Intl.NumberFormat('fr-FR');

/** 1234.4 → « 1 234 » ; valeur absente → « — ». */
export function fmt(n) {
  return n == null || !Number.isFinite(n) ? '—' : nf.format(Math.round(n));
}

/** 0.153 → « +15 % ». Tronqué (0,096 → « +9 % ») pour ne jamais afficher un seuil atteint qui ne l'est pas. */
export function pct(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  const v = Math.trunc(Math.round(x * 1e6) / 1e4);
  return `${v > 0 ? '+' : ''}${v} %`;
}

/** Durée lisible : « 12 min », « 5 h », « 3 j ». */
export function duration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const hours = ms / 3_600_000;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} j`;
}

/** 8 150 000 → « 8,2 M » ; 35 000 → « 35 k ». */
export function compact(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1e4) return `${Math.round(n / 1e3)} k`;
  return fmt(n);
}

/** 205 → « 3:25 ». */
export function mmss(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ago(ts, now = Date.now()) {
  if (!Number.isFinite(ts)) return '';
  return now - ts < 60_000 ? 'à l’instant' : `il y a ${duration(now - ts)}`;
}
