// 手描きの軽量SVGアイコン。外部読み込みなし＝オフラインでも崩れない。
export const ICON = {
  leaf: '<path d="M4 20C4 12 10 5 20 5c0 9-7 15-15 15" /><path d="M4 20c3-6 8-9 13-10"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>',
  fridge: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M7 10h10"/><path d="M9.5 6v2M9.5 13v3"/>',
  book: '<path d="M6 4h11a1 1 0 0 1 1 1v15H7a1 1 0 0 1-1-1z"/><path d="M6 17h12"/>',
  cart: '<path d="M4 5h2l1.6 9.5a1 1 0 0 0 1 .8h7.6a1 1 0 0 0 1-.78L20 8H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6"/><path d="M15.5 14.5A5.5 5.5 0 0 1 20.5 20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v4"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  flame: '<path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-1.6.7-2.7 1.6-3.6C9.5 9.4 11 8 12 3z"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  alert: '<path d="M12 4l8 14H4z"/><path d="M12 10v4M12 17h.01"/>',
  baby: '<circle cx="12" cy="7" r="3"/><path d="M6 20c1.5-3 4-4 6-4s4.5 1 6 4"/><path d="M9 11l3 3 3-3"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15"/><path d="M4 20v-5h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M5 5l1.5 1.5M17.5 17.5L19 19M3 12h2M19 12h2M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  heart: '<path d="M12 20s-7-4.4-9-8.5C1.5 8 3.5 5 6.5 5 8.5 5 10 6.2 12 8c2-1.8 3.5-3 5.5-3 3 0 5 3 3.5 6.5C19 15.6 12 20 12 20z"/>',
  check2: '<path d="M5 12l4 4L19 6"/>',
  trash: '<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M17 6l2 2M15 8l2 2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chef: '<path d="M7 21h10M8 21v-6M16 21v-6M6 15h12a4 4 0 0 0-1-7 4 4 0 0 0-7-1 4 4 0 0 0-4 8z"/>',
  edit: '<path d="M4 20h4L18 10l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  cutlery: '<path d="M6 3v5a2 2 0 0 0 2 2M8 3v5M10 3v5a2 2 0 0 1-2 2M8 10v11"/><path d="M16 3c-1.7 0-2.8 2-2.8 4.4 0 1.9 1.2 3 2.8 3s2.8-1.1 2.8-3C18.8 5 17.7 3 16 3ZM16 10.4V21"/>'
};

export function ic(name, cls) {
  const p = ICON[name] || '';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round"' + (cls ? ' class="' + cls + '"' : '') + '>' + p + '</svg>';
}
