const NS = 'http://www.w3.org/2000/svg';

// Original stroke icons on a 24px grid. One stroke weight, round caps, so the set reads as one family.
const PATHS = {
  overview: 'M4 4h7v7H4z M13 4h7v4h-7z M13 11h7v9h-7z M4 14h7v6H4z',
  breaks: 'M12 4l9 16H3z M12 10v4 M12 17v.01',
  review: 'M4 4h16v16H4z M8 12l3 3 5-6',
  sources: 'M12 4c4.4 0 8 1.1 8 2.5S16.4 9 12 9 4 7.9 4 6.5 7.6 4 12 4z M4 6.5v5C4 12.9 7.6 14 12 14s8-1.1 8-2.5v-5 M4 11.5v5C4 17.9 7.6 19 12 19s8-1.1 8-2.5v-5',
  runs: 'M6 4l13 8-13 8z',
  audit: 'M5 5h14 M5 10h14 M5 15h10 M5 20h6',
  settings: 'M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 5v4 M6 15v4',
  upload: 'M12 16V5 M7 9l5-5 5 5 M5 19h14',
  download: 'M12 4v11 M7 11l5 5 5-5 M5 20h14',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14z M20 20l-4-4',
  x: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  clock: 'M12 4a8 8 0 100 16 8 8 0 000-16z M12 8v4l3 2',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  sort: 'M8 9l4-4 4 4 M8 15l4 4 4-4',
  logout: 'M10 4H5v16h5 M15 8l4 4-4 4 M9 12h10',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  info: 'M12 4a8 8 0 100 16 8 8 0 000-16z M12 11v5 M12 8v.01',
  alert: 'M12 4a8 8 0 100 16 8 8 0 000-16z M12 8v5 M12 16v.01',
  file: 'M7 3h7l5 5v13H7z M14 3v5h5',
  refresh: 'M20 11a8 8 0 10-2.3 5.7 M20 5v6h-6',
  'arrow-left': 'M19 12H5 M11 6l-6 6 6 6',
  plus: 'M12 5v14 M5 12h14',
};

export function icon(name, { size } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] || '');
  svg.append(path);
  return svg;
}

export function brandMark() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('class', 'brand-mark');
  svg.setAttribute('aria-hidden', 'true');
  const rect = document.createElementNS(NS, 'rect');
  for (const [k, v] of Object.entries({ width: 32, height: 32, rx: 6, fill: '#2C3E7B', class: 'mark-bg' })) rect.setAttribute(k, v);
  const bars = document.createElementNS(NS, 'path');
  for (const [k, v] of Object.entries({ d: 'M8 12h16M8 20h11', stroke: '#fff', 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none', class: 'mark-bars' })) bars.setAttribute(k, v);
  const tick = document.createElementNS(NS, 'path');
  for (const [k, v] of Object.entries({ d: 'M21.5 20.2l2.2 2.2 3.8-4.4', stroke: '#7BD3A4', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' })) tick.setAttribute(k, v);
  svg.append(rect, bars, tick);
  return svg;
}
