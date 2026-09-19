/* app.js — Bin & Shelf.
   Ported from reference/bin-and-shelf-artifact.html. The screens, copy and
   behaviour are the prototype's; only the storage and the file saving were
   swapped for things that work on a plain static host. */

import * as store from './store.js';

/* ---------------- icons ---------------- */
var I = {
  chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  pen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>'
};

/* ---------------- state ---------------- */
var S = {
  ready:false,
  fatal:null,
  places:[],
  bins:[],
  view:{name:'home'},
  stack:[],
  q:'',
  busy:false,
  lastBackup:null,
  backupNudged:false
};

var BACKUP_INTERVAL = 30 * 24 * 60 * 60 * 1000; /* 30 days */

var screen = document.getElementById('screen');
var qInput = document.getElementById('q');
var qClear = document.getElementById('q-clear');
var toastEl = document.getElementById('toast');
var toastTimer;

/* ---------------- helpers ---------------- */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
var uid = store.uid;
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.classList.remove('on'); }, 2600);
}
function plural(n, one, many){ return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function placeById(id){
  for (var i=0;i<S.places.length;i++) if (S.places[i].id === id) return S.places[i];
  return null;
}
function binById(id){
  for (var i=0;i<S.bins.length;i++) if (S.bins[i].id === id) return S.bins[i];
  return null;
}
function binsIn(placeId){
  return S.bins.filter(function(b){ return b.placeId === placeId; })
    .sort(function(a,b){ return (a.code||'').localeCompare(b.code||'') || (a.name||'').localeCompare(b.name||''); });
}
/* Items live in two kinds of owner: a container, or a place itself for the
   things that are simply standing there - a ladder, a bike, a spare mattress. */
function itemCount(owner){ return ((owner && owner.items) || []).length; }
function totalItems(){
  var n = S.bins.reduce(function(n,b){ return n + itemCount(b); }, 0);
  return S.places.reduce(function(n,p){ return n + itemCount(p); }, n);
}
/* everything kept in a place: inside its containers, plus the loose things */
function placeItemTotal(p){
  return binsIn(p.id).reduce(function(n,b){ return n + itemCount(b); }, 0) + itemCount(p);
}
function ownerOf(kind, id){ return kind === 'place' ? placeById(id) : binById(id); }
function ownerCollection(kind){ return kind === 'place' ? 'places' : 'containers'; }
function sortedPlaces(){
  return S.places.slice().sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
}

/* label code: three letters of the place + a running number, e.g. GAR-03 */
function makeCode(placeName){
  var pre = String(placeName || '').replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase();
  while (pre.length < 3) pre += 'X';
  var taken = {};
  S.bins.forEach(function(b){ if (b.code) taken[b.code] = 1; });
  var n = 1;
  while (taken[pre + '-' + String(n).padStart(2,'0')]) n++;
  return pre + '-' + String(n).padStart(2,'0');
}

/* ---------------- navigation ---------------- */
function go(view){
  S.stack.push(S.view);
  S.view = view;
  window.scrollTo(0,0);
  render();
}
function back(){
  S.view = S.stack.pop() || {name:'home'};
  window.scrollTo(0,0);
  render();
}
function home(){
  S.stack = [];
  S.view = {name:'home'};
  window.scrollTo(0,0);
  render();
}

/* ---------------- search ---------------- */
function searchAll(qRaw){
  var q = qRaw.trim().toLowerCase();
  var itemHits = [], binHits = [];
  if (!q) return {items:itemHits, bins:binHits};
  S.bins.forEach(function(b){
    var hay = [b.name, b.code, b.spot, b.notes, b.kind].join(' ').toLowerCase();
    if (hay.indexOf(q) !== -1) binHits.push(b);
    (b.items || []).forEach(function(it){
      var ih = [it.name, it.note].join(' ').toLowerCase();
      if (ih.indexOf(q) !== -1) itemHits.push({item:it, bin:b});
    });
  });
  S.places.forEach(function(p){
    (p.items || []).forEach(function(it){
      var ih = [it.name, it.note].join(' ').toLowerCase();
      if (ih.indexOf(q) !== -1) itemHits.push({item:it, place:p});
    });
  });
  itemHits.sort(function(a,b){ return a.item.name.localeCompare(b.item.name); });
  binHits.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
  return {items:itemHits, bins:binHits};
}
function highlight(text, q){
  var t = String(text == null ? '' : text);
  var needle = q.trim().toLowerCase();
  if (!needle) return esc(t);
  var i = t.toLowerCase().indexOf(needle);
  if (i === -1) return esc(t);
  return esc(t.slice(0,i)) + '<mark class="mark">' + esc(t.slice(i, i+needle.length)) + '</mark>' + esc(t.slice(i+needle.length));
}

/* ---------------- rendering ---------------- */
function render(){
  if (S.fatal){ screen.innerHTML = S.fatal; return; }
  if (!S.ready){ screen.innerHTML = '<div class="loading">Opening your inventory&hellip;</div>'; return; }

  if (S.q.trim()) { screen.innerHTML = viewSearch(); return; }

  var v = S.view;
  if (v.name === 'place'){
    var p = placeById(v.id);
    if (!p) { home(); return; }
    screen.innerHTML = viewPlace(p);
  } else if (v.name === 'bin'){
    var b = binById(v.id);
    if (!b) { home(); return; }
    screen.innerHTML = viewBin(b);
  } else if (v.name === 'all'){
    screen.innerHTML = viewAllBins();
  } else {
    screen.innerHTML = viewHome();
  }
}

function crumb(parts){
  var h = '<nav class="crumb">';
  parts.forEach(function(p, i){
    if (i) h += '<span class="sep">/</span>';
    if (p.act) h += '<button data-act="' + p.act + '"' + (p.id ? ' data-id="' + esc(p.id) + '"' : '') + '>' + esc(p.label) + '</button>';
    else h += '<span>' + esc(p.label) + '</span>';
  });
  return h + '</nav>';
}

function sampleBanner(){
  var hasSample = S.bins.some(function(b){ return b.sample; }) || S.places.some(function(p){ return p.sample; });
  if (!hasSample) return '';
  return '<div class="banner">' +
    '<p><strong>Example data.</strong> Two places and three containers are here to show the shape of things. Clear them whenever you\'re ready.</p>' +
    '<button class="btn sm" data-act="clear-samples">Clear examples</button></div>';
}

/* A quiet nudge once a month, only when there is something worth losing. */
function backupBanner(){
  if (!S.bins.length && !S.places.length) return '';
  if (S.lastBackup && (Date.now() - S.lastBackup) < BACKUP_INTERVAL) return '';
  var line = S.lastBackup
    ? 'Your last backup was ' + daysAgo(S.lastBackup) + '. This inventory lives on this device only.'
    : 'This inventory lives on this device only. A backup file takes a second and saves you from a lost phone.';
  return '<div class="banner">' +
    '<p><strong>Back it up.</strong> ' + esc(line) + '</p>' +
    '<button class="btn sm" data-act="settings">Back up now</button></div>';
}
function daysAgo(ts){
  var d = Math.round((Date.now() - ts) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 60) return d + ' days ago';
  return Math.round(d / 30) + ' months ago';
}

function viewHome(){
  var places = sortedPlaces();
  var h = '';
  h += '<div class="stats">' +
    '<div class="stat"><b>' + places.length + '</b><span>Places</span></div>' +
    '<div class="stat"><b>' + S.bins.length + '</b><span>Containers</span></div>' +
    '<div class="stat"><b>' + totalItems() + '</b><span>Items</span></div>' +
    '</div>';
  h += sampleBanner();
  h += backupBanner();

  if (!places.length && !S.bins.length){
    h += '<div class="sectionhead"><span class="eyebrow">Get started</span></div>';
    h += '<div class="empty"><h3>Nothing catalogued yet</h3>' +
      '<p>Start with a place you store things &mdash; the garage, the attic, a storage unit &mdash; then add the bins and boxes inside it.</p>' +
      '<button class="btn primary" data-act="new-place">' + I.plus + ' Add your first place</button></div>';
    return h;
  }

  h += '<div class="sectionhead"><span class="eyebrow">Places</span>' +
       '<button class="linkbtn" data-act="new-place">Add place</button></div>';
  h += '<div class="rows">';
  places.forEach(function(p){
    var bs = binsIn(p.id);
    var items = placeItemTotal(p);
    h += '<button class="row" data-act="open-place" data-id="' + esc(p.id) + '">' +
      '<span class="rmain"><span class="rtitle">' + esc(p.name) + '</span>' +
      '<span class="rsub">' + plural(bs.length, 'container') + ' &middot; ' + plural(items, 'item') + '</span></span>' +
      '<span class="tally">' + bs.length + '</span>' +
      '<span class="chev">' + I.chev + '</span></button>';
  });
  h += '</div>';

  var loose = S.bins.filter(function(b){ return !placeById(b.placeId); });
  if (loose.length){
    h += '<div class="sectionhead"><span class="eyebrow">Unfiled containers</span></div><div class="cards">';
    loose.forEach(function(b){ h += binCard(b); });
    h += '</div>';
  }

  if (S.bins.length){
    h += '<div class="sectionhead"><span class="eyebrow">Everything</span></div>';
    h += '<button class="row" data-act="open-all"><span class="rmain">' +
      '<span class="rtitle">All containers</span>' +
      '<span class="rsub">Browse the full list, newest changes first</span></span>' +
      '<span class="chev">' + I.chev + '</span></button>';
  }
  return h;
}

function binCard(b, q){
  var p = placeById(b.placeId);
  var n = itemCount(b);
  var peek = (b.items || []).slice(0,4).map(function(i){ return i.name; }).join(', ');
  if (n > 4) peek += ', +' + (n - 4) + ' more';
  var sub = [];
  if (p) sub.push(esc(p.name));
  if (b.spot) sub.push(esc(b.spot));
  return '<button class="card" data-act="open-bin" data-id="' + esc(b.id) + '">' +
    '<span class="card-top">' +
      (b.code ? '<span class="code mono">' + esc(b.code) + '</span>' : '') +
      '<span class="card-name">' + (q ? highlight(b.name, q) : esc(b.name)) + '</span>' +
      '<span class="tally">' + n + '</span>' +
    '</span>' +
    (sub.length ? '<span class="card-sub">' + sub.join(' <span class="dot">&middot;</span> ') + '</span>' : '') +
    (peek ? '<span class="peek">' + esc(peek) + '</span>' : '<span class="peek">Empty &mdash; nothing listed inside yet</span>') +
    '</button>';
}

/* the shared list of items, used by both a container and a place */
function itemList(kind, ownerId, items){
  var h = '<div class="items">';
  items.forEach(function(it){
    var attrs = ' data-owner="' + kind + '" data-id="' + esc(ownerId) + '" data-item="' + esc(it.id) + '"';
    h += '<div class="item">' +
      '<span class="qty mono">' + esc(it.qty || 1) + '</span>' +
      '<span class="iname"><button data-act="edit-item"' + attrs + ' style="text-align:left">' +
        esc(it.name) + '</button>' +
        (it.note ? '<span class="inote">' + esc(it.note) + '</span>' : '') +
      '</span>' +
      '<button class="xbtn" data-act="del-item"' + attrs + ' aria-label="Remove ' + esc(it.name) + '">' + I.x + '</button>' +
      '</div>';
  });
  return h + '</div>';
}
function quickAddForm(placeholder, label){
  return '<form class="quickadd" id="quickadd">' +
    '<input id="quick-name" type="text" placeholder="' + esc(placeholder) + '" autocomplete="off" aria-label="' + esc(label) + '">' +
    '<button class="btn primary" type="submit">Add</button></form>';
}

function viewPlace(p){
  var bs = binsIn(p.id);
  var loose = (p.items || []);
  var h = crumb([{label:'Places', act:'home'}, {label:p.name}]);
  h += '<div class="sectionhead"><h2 style="font-size:24px">' + esc(p.name) + '</h2>' +
    '<button class="linkbtn" data-act="edit-place" data-id="' + esc(p.id) + '">Edit</button></div>';
  h += '<p style="color:var(--muted); font-size:13px; margin:0 0 14px">' +
    plural(bs.length, 'container') + ' &middot; ' +
    plural(placeItemTotal(p), 'item') +
    (loose.length ? ' &middot; ' + loose.length + ' not in a container' : '') + '</p>';

  if (!bs.length && !loose.length){
    h += '<div class="empty"><h3>No containers here yet</h3>' +
      '<p>Add the first bin, box or shelf you keep in ' + esc(p.name) + '.</p>' +
      '<button class="btn primary" data-act="new-bin" data-id="' + esc(p.id) + '">' + I.plus + ' Add a container</button></div>';
  } else if (!bs.length){
    h += '<div style="margin-top:4px"><button class="btn wide" data-act="new-bin" data-id="' + esc(p.id) + '">' + I.plus + ' Add a container here</button></div>';
  } else {
    h += '<div class="cards">';
    bs.forEach(function(b){ h += binCard(b); });
    h += '</div>';
    h += '<div style="margin-top:12px"><button class="btn wide" data-act="new-bin" data-id="' + esc(p.id) + '">' + I.plus + ' Add a container here</button></div>';
  }

  /* things that are just here, in no bin or box at all */
  h += '<div class="sectionhead"><span class="eyebrow">Not in a container</span></div>';
  if (loose.length) h += itemList('place', p.id, loose);
  h += quickAddForm('Add something loose here…', 'Add an item kept loose in ' + p.name);
  h += '<p style="font-size:12px;color:var(--faint);margin-top:8px">' +
    (loose.length
      ? 'Tap an item name to set a quantity or a note.'
      : 'For the things that sit in the open &mdash; a ladder, a bike, a spare mattress.') +
    '</p>';

  h += '<div style="margin-top:22px"><button class="btn danger sm" data-act="del-place" data-id="' + esc(p.id) + '">' + I.trash + ' Delete this place</button></div>';
  return h;
}

function viewAllBins(){
  var bs = S.bins.slice().sort(function(a,b){ return (b.updatedAt||0) - (a.updatedAt||0); });
  var h = crumb([{label:'Places', act:'home'}, {label:'All containers'}]);
  h += '<div class="sectionhead"><span class="eyebrow">' + plural(bs.length,'container') + '</span></div>';
  h += '<div class="cards">';
  bs.forEach(function(b){ h += binCard(b); });
  h += '</div>';
  return h;
}

function viewBin(b){
  var p = placeById(b.placeId);
  var items = (b.items || []);
  var h = crumb([
    {label:'Places', act:'home'},
    p ? {label:p.name, act:'open-place', id:p.id} : {label:'Unfiled'},
    {label:b.name}
  ]);

  h += '<div class="detail-head">';
  if (b.code) h += '<span class="code mono">' + esc(b.code) + '</span>';
  h += '<h2>' + esc(b.name) + '</h2>';
  h += '<div class="meta">';
  h += '<div><dt>Place</dt><dd>' + esc(p ? p.name : 'Not assigned') + '</dd></div>';
  if (b.spot) h += '<div><dt>Exactly</dt><dd>' + esc(b.spot) + '</dd></div>';
  if (b.kind) h += '<div><dt>Type</dt><dd>' + esc(b.kind) + '</dd></div>';
  if (b.notes) h += '<div><dt>Notes</dt><dd>' + esc(b.notes) + '</dd></div>';
  h += '<div><dt>Contents</dt><dd>' + plural(items.length, 'item') + '</dd></div>';
  h += '</div>';
  h += '<div class="headacts">' +
    '<button class="btn sm" data-act="edit-bin" data-id="' + esc(b.id) + '">' + I.pen + ' Edit</button>' +
    '<button class="btn sm danger" data-act="del-bin" data-id="' + esc(b.id) + '">' + I.trash + ' Delete</button>' +
    '</div>';
  h += '</div>';

  h += '<div class="sectionhead"><span class="eyebrow">What\'s inside</span></div>';

  if (items.length){
    h += itemList('bin', b.id, items);
  } else {
    h += '<div class="empty" style="padding:20px 16px"><h3>Nothing listed yet</h3>' +
      '<p>Type what\'s in this container below &mdash; one line each.</p></div>';
  }

  h += quickAddForm('Add an item…', 'Add an item to this container');
  h += '<p style="font-size:12px;color:var(--faint);margin-top:8px">Tap an item name to set a quantity or a note.</p>';
  return h;
}

function viewSearch(){
  var q = S.q;
  var r = searchAll(q);
  var h = '<div class="sectionhead"><span class="eyebrow">Results for &ldquo;' + esc(q.trim()) + '&rdquo;</span>' +
    '<button class="linkbtn" data-act="clear-q">Clear</button></div>';

  if (!r.items.length && !r.bins.length){
    h += '<div class="empty"><h3>No match</h3><p>Nothing in the inventory mentions &ldquo;' + esc(q.trim()) + '&rdquo;. ' +
      'Try a shorter word, or check a container you haven\'t listed the contents of yet.</p></div>';
    return h;
  }

  if (r.items.length){
    h += '<div class="sectionhead"><span class="eyebrow">' + plural(r.items.length,'item') + '</span></div>';
    h += '<div class="rows">';
    r.items.forEach(function(hit){
      var where, act, target;
      if (hit.place){
        where = esc(hit.place.name) + ' <span class="dot">&middot;</span> not in a container';
        act = 'open-place';
        target = hit.place.id;
      } else {
        var p = placeById(hit.bin.placeId);
        where = (hit.bin.code ? hit.bin.code + ' &middot; ' : '') + esc(hit.bin.name) +
          (p ? ' <span class="dot">&middot;</span> ' + esc(p.name) : '') +
          (hit.bin.spot ? ' <span class="dot">&middot;</span> ' + esc(hit.bin.spot) : '');
        act = 'open-bin';
        target = hit.bin.id;
      }
      h += '<button class="row" data-act="' + act + '" data-id="' + esc(target) + '">' +
        '<span class="qty mono">' + esc(hit.item.qty || 1) + '</span>' +
        '<span class="rmain"><span class="rtitle">' + highlight(hit.item.name, q) + '</span>' +
        '<span class="rsub">' + where + '</span></span>' +
        '<span class="chev">' + I.chev + '</span></button>';
    });
    h += '</div>';
  }

  if (r.bins.length){
    h += '<div class="sectionhead"><span class="eyebrow">' + plural(r.bins.length,'container') + '</span></div>';
    h += '<div class="cards">';
    r.bins.forEach(function(b){ h += binCard(b, q); });
    h += '</div>';
  }
  return h;
}

/* ---------------- sheets ---------------- */
var openScrim = null;
function sheet(inner, onMount){
  closeSheet();
  var scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="grip"></div>' + inner + '</div>';
  document.body.appendChild(scrim);
  openScrim = scrim;
  requestAnimationFrame(function(){ scrim.classList.add('on'); });
  scrim.addEventListener('click', function(e){ if (e.target === scrim) closeSheet(); });
  if (onMount) onMount(scrim);
  var first = scrim.querySelector('input, textarea, select');
  if (first && window.matchMedia('(min-width: 640px)').matches) first.focus();
}
function closeSheet(){
  if (openScrim && openScrim.parentNode) openScrim.parentNode.removeChild(openScrim);
  openScrim = null;
}
document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeSheet(); });

function placeOptions(selected){
  var o = '';
  sortedPlaces().forEach(function(p){
    o += '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>';
  });
  return o;
}

function placeSheet(existing){
  var title = existing ? 'Rename place' : 'New place';
  sheet(
    '<h3>' + title + '</h3>' +
    '<div class="field"><label for="f-place">Name</label>' +
    '<input id="f-place" type="text" value="' + esc(existing ? existing.name : '') + '" placeholder="Garage, attic, unit 214&hellip;">' +
    '<p class="hint">A room, building or rented unit &mdash; the big bucket. Shelves and bins go inside it.</p></div>' +
    '<div class="sheet-acts"><button class="btn" data-close="1">Cancel</button>' +
    '<button class="btn primary" id="f-save">' + (existing ? 'Save' : 'Add place') + '</button></div>',
    function(scrim){
      scrim.querySelector('[data-close]').onclick = closeSheet;
      scrim.querySelector('#f-save').onclick = function(){
        var name = scrim.querySelector('#f-place').value.trim();
        if (!name) { toast('Give the place a name first.'); return; }
        if (existing) savePlace(existing.id, {name:name});
        else addPlace(name);
      };
      scrim.querySelector('#f-place').addEventListener('keydown', function(e){
        if (e.key === 'Enter') scrim.querySelector('#f-save').click();
      });
    }
  );
}

function binSheet(existing, presetPlace){
  var hasPlaces = S.places.length > 0;
  var title = existing ? 'Edit container' : 'New container';
  var pid = existing ? existing.placeId : (presetPlace || (sortedPlaces()[0] && sortedPlaces()[0].id));
  var placeField = hasPlaces
    ? '<div class="field"><label for="f-place">Place</label><select id="f-place">' + placeOptions(pid) + '</select></div>'
    : '<div class="field"><label for="f-newplace">Place</label><input id="f-newplace" type="text" placeholder="Garage"><p class="hint">No places yet &mdash; this creates one.</p></div>';

  sheet(
    '<h3>' + title + '</h3>' +
    '<div class="field"><label for="f-name">What is it</label>' +
    '<input id="f-name" type="text" value="' + esc(existing ? existing.name : '') + '" placeholder="Christmas decorations"></div>' +
    placeField +
    '<div class="duo">' +
      '<div class="field"><label for="f-kind">Type</label>' +
      '<select id="f-kind">' +
        ['Tote / bin','Cardboard box','Shelf','Drawer','Cabinet','Bag','Rack','Pallet','Other'].map(function(k){
          return '<option' + ((existing && existing.kind === k) ? ' selected' : '') + '>' + k + '</option>';
        }).join('') +
      '</select></div>' +
      '<div class="field"><label for="f-spot">Exact spot</label>' +
      '<input id="f-spot" type="text" value="' + esc(existing ? (existing.spot||'') : '') + '" placeholder="Shelf B, 2nd from top"></div>' +
    '</div>' +
    '<div class="field"><label for="f-notes">Notes</label>' +
    '<textarea id="f-notes" placeholder="Red lid, heavy, fragile ornaments on top">' + esc(existing ? (existing.notes||'') : '') + '</textarea></div>' +
    (existing && existing.code ? '<p class="hint" style="margin:-4px 0 12px">Label code <strong class="mono">' + esc(existing.code) + '</strong> &mdash; write it on tape and stick it on the real container.</p>' : '') +
    '<div class="sheet-acts"><button class="btn" data-close="1">Cancel</button>' +
    '<button class="btn primary" id="f-save">' + (existing ? 'Save' : 'Add container') + '</button></div>',
    function(scrim){
      scrim.querySelector('[data-close]').onclick = closeSheet;
      scrim.querySelector('#f-save').onclick = function(){
        var name = scrim.querySelector('#f-name').value.trim();
        if (!name) { toast('Give the container a name first.'); return; }
        var payload = {
          name: name,
          kind: scrim.querySelector('#f-kind').value,
          spot: scrim.querySelector('#f-spot').value.trim(),
          notes: scrim.querySelector('#f-notes').value.trim()
        };
        if (hasPlaces) payload.placeId = scrim.querySelector('#f-place').value;
        if (existing) saveBin(existing.id, payload);
        else {
          var newPlaceName = hasPlaces ? null : scrim.querySelector('#f-newplace').value.trim();
          addBin(payload, newPlaceName);
        }
      };
    }
  );
}

function itemSheet(kind, ownerId, item){
  var owner = ownerOf(kind, ownerId);
  if (!owner) return;
  sheet(
    '<h3>' + (item ? 'Edit item' : 'Add item') + '</h3>' +
    (kind === 'place'
      ? '<p class="hint" style="margin:-8px 0 12px">Kept loose in ' + esc(owner.name) + ', not in a container.</p>'
      : '') +
    '<div class="duo">' +
      '<div class="field" style="flex:3"><label for="f-iname">Item</label>' +
      '<input id="f-iname" type="text" value="' + esc(item ? item.name : '') + '" placeholder="Tree topper"></div>' +
      '<div class="field" style="flex:1"><label for="f-qty">Qty</label>' +
      '<input id="f-qty" type="number" inputmode="numeric" min="1" value="' + esc(item ? (item.qty||1) : 1) + '"></div>' +
    '</div>' +
    '<div class="field"><label for="f-inote">Note</label>' +
    '<input id="f-inote" type="text" value="' + esc(item ? (item.note||'') : '') + '" placeholder="Glass, wrapped in newspaper"></div>' +
    '<div class="sheet-acts">' +
      (item ? '<button class="btn danger" id="f-del">' + I.trash + ' Remove</button>' : '<button class="btn" data-close="1">Cancel</button>') +
      '<button class="btn primary" id="f-save">Save</button></div>',
    function(scrim){
      var close = scrim.querySelector('[data-close]');
      if (close) close.onclick = closeSheet;
      var del = scrim.querySelector('#f-del');
      if (del) del.onclick = function(){ removeItem(kind, ownerId, item.id); };
      scrim.querySelector('#f-save').onclick = function(){
        var name = scrim.querySelector('#f-iname').value.trim();
        if (!name) { toast('Name the item first.'); return; }
        var qty = parseInt(scrim.querySelector('#f-qty').value, 10);
        if (!qty || qty < 1) qty = 1;
        var note = scrim.querySelector('#f-inote').value.trim();
        if (item) updateItem(kind, ownerId, item.id, {name:name, qty:qty, note:note});
        else addItem(kind, ownerId, name, qty, note);
      };
    }
  );
}

function settingsSheet(){
  var backupLine = S.lastBackup
    ? 'Last backup ' + daysAgo(S.lastBackup) + ', on ' + new Date(S.lastBackup).toLocaleDateString() + '.'
    : 'You haven\'t made a backup yet.';
  var overdue = !S.lastBackup || (Date.now() - S.lastBackup) >= BACKUP_INTERVAL;

  sheet(
    '<h3>Keep it on your phone</h3>' +
    '<div class="prose">' +
    '<p>This page works as a home-screen app on iOS:</p>' +
    '<ol>' +
    '<li>Open this link in <strong>Safari</strong> (not inside another app).</li>' +
    '<li>Tap the <strong>Share</strong> button &mdash; the square with the arrow.</li>' +
    '<li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>' +
    '</ol>' +
    '<p>It opens full screen from then on, works without a signal, and everything you enter is saved on the device itself.</p>' +
    '<p style="margin-top:14px"><strong>Label codes.</strong> Every container gets a short code like <span class="mono">GAR-04</span>. Write it on a strip of tape on the real bin &mdash; then you can search the code here, or read the bin and find it in the app.</p>' +
    '</div>' +

    '<div class="sectionhead" style="margin-bottom:8px"><span class="eyebrow">Backup</span></div>' +
    '<div class="prose"><p>Your inventory is stored on this device only. Export a copy now and then &mdash; to Files, iCloud Drive, or wherever you keep things.</p></div>' +
    (overdue ? '<div class="banner" style="margin-bottom:4px"><p>' + esc(backupLine) + ' A minute now beats retyping it all later.</p></div>'
             : '<p class="hint" style="margin:8px 0 4px">' + esc(backupLine) + '</p>') +
    '<div class="sheet-acts" style="margin-top:12px">' +
      '<button class="btn" id="f-json">Export JSON</button>' +
      '<button class="btn" id="f-csv">Export CSV</button>' +
    '</div>' +
    '<div class="sheet-acts" style="margin-top:8px">' +
      '<button class="btn" id="f-import">Restore from JSON</button>' +
    '</div>' +
    '<input id="f-file" type="file" accept="application/json,.json" hidden>' +

    '<div class="sheet-acts" style="margin-top:18px">' +
    '<button class="btn primary wide" data-close="1">Done</button></div>',
    function(scrim){
      scrim.querySelector('[data-close]').onclick = closeSheet;
      scrim.querySelector('#f-json').onclick = exportJson;
      scrim.querySelector('#f-csv').onclick = exportCsv;
      var file = scrim.querySelector('#f-file');
      scrim.querySelector('#f-import').onclick = function(){ file.click(); };
      file.onchange = function(){
        var f = file.files && file.files[0];
        file.value = '';
        if (f) readBackup(f);
      };
    }
  );
}

function confirmSheet(title, body, label, fn){
  sheet(
    '<h3>' + esc(title) + '</h3>' +
    '<div class="prose"><p>' + body + '</p></div>' +
    '<div class="sheet-acts"><button class="btn" data-close="1">Keep it</button>' +
    '<button class="btn danger" id="f-go">' + esc(label) + '</button></div>',
    function(scrim){
      scrim.querySelector('[data-close]').onclick = closeSheet;
      scrim.querySelector('#f-go').onclick = fn;
    }
  );
}

/* ---------------- writes ---------------- */
function guard(){
  if (!S.ready){ toast('Still opening the inventory.'); return false; }
  if (S.busy){ return false; }
  return true;
}
function failed(e){
  S.busy = false;
  var code = (e && e.code) || '';
  if (code === 'quota_exceeded') toast('This device is out of room. Delete something first.');
  else if (code === 'invalid_argument') toast('That record is gone, so nothing was saved.');
  else toast('Could not save. Try again.');
  if (e) console.error(e);
}

function addPlace(name){
  if (!guard()) return;
  S.busy = true;
  store.add('places', {name:name, items:[], createdAt:Date.now()}).then(function(){
    S.busy = false; closeSheet(); toast('Added ' + name + '.');
  }, failed);
}
function savePlace(id, patch){
  if (!guard()) return;
  S.busy = true;
  store.update('places', id, patch).then(function(){
    S.busy = false; closeSheet();
  }, failed);
}
function deletePlace(id){
  if (!guard()) return;
  var p = placeById(id);
  var kids = binsIn(id);
  S.busy = true;
  var chain = Promise.resolve();
  kids.forEach(function(b){
    chain = chain.then(function(){ return store.remove('containers', b.id); });
  });
  chain.then(function(){ return store.remove('places', id); }).then(function(){
    S.busy = false; closeSheet(); home();
    toast('Deleted ' + (p ? p.name : 'place') + '.');
  }, failed);
}

function addBin(payload, newPlaceName){
  if (!guard()) return;
  S.busy = true;
  var start = newPlaceName
    ? store.add('places', {name:newPlaceName, items:[], createdAt:Date.now()})
    : Promise.resolve(payload.placeId);
  start.then(function(pid){
    var p = placeById(pid);
    var doc = {
      name: payload.name,
      placeId: pid || '',
      kind: payload.kind || '',
      spot: payload.spot || '',
      notes: payload.notes || '',
      code: makeCode(p ? p.name : (newPlaceName || payload.name)),
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    return store.add('containers', doc).then(function(id){
      S.busy = false; closeSheet();
      go({name:'bin', id:id});
      toast('Added ' + doc.name + ' (' + doc.code + ').');
    });
  }).catch(failed);
}
function saveBin(id, patch){
  if (!guard()) return;
  S.busy = true;
  patch.updatedAt = Date.now();
  store.update('containers', id, patch).then(function(){
    S.busy = false; closeSheet();
  }, failed);
}
function deleteBin(id){
  if (!guard()) return;
  var b = binById(id);
  S.busy = true;
  store.remove('containers', id).then(function(){
    S.busy = false; closeSheet(); back();
    toast('Deleted ' + (b ? b.name : 'container') + '.');
  }, failed);
}

/* kind is 'bin' or 'place' - a place holds the things kept loose in it */
function writeItems(kind, ownerId, items, done){
  if (!guard()) return;
  S.busy = true;
  store.update(ownerCollection(kind), ownerId, {items:items, updatedAt:Date.now()}).then(function(){
    S.busy = false;
    if (done) done();
  }, failed);
}
function addItem(kind, ownerId, name, qty, note){
  var owner = ownerOf(kind, ownerId);
  if (!owner) return;
  var items = (owner.items || []).slice();
  items.push({id:uid(), name:name, qty:qty || 1, note:note || ''});
  writeItems(kind, ownerId, items, function(){ closeSheet(); });
}
function updateItem(kind, ownerId, itemId, patch){
  var owner = ownerOf(kind, ownerId);
  if (!owner) return;
  var items = (owner.items || []).map(function(it){
    return it.id === itemId ? Object.assign({}, it, patch) : it;
  });
  writeItems(kind, ownerId, items, function(){ closeSheet(); });
}
function removeItem(kind, ownerId, itemId){
  var owner = ownerOf(kind, ownerId);
  if (!owner) return;
  var items = (owner.items || []).filter(function(it){ return it.id !== itemId; });
  writeItems(kind, ownerId, items, function(){ closeSheet(); });
}

function clearSamples(){
  if (!guard()) return;
  S.busy = true;
  var chain = Promise.resolve();
  S.bins.filter(function(b){ return b.sample; }).forEach(function(b){
    chain = chain.then(function(){ return store.remove('containers', b.id); });
  });
  S.places.filter(function(p){ return p.sample; }).forEach(function(p){
    chain = chain.then(function(){ return store.remove('places', p.id); });
  });
  chain.then(function(){
    S.busy = false; closeSheet(); home(); toast('Examples cleared.');
  }, failed);
}

/* ---------------- files out and in ---------------- */
function stamp(){ return new Date().toISOString().slice(0,10); }

/* iOS has no real downloads folder, so hand the file to the share sheet there
   and use a plain download link everywhere else. */
var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function saveFile(filename, text, mime){
  var blob = new Blob([text], {type: mime});
  var file = null;
  try { file = new File([blob], filename, {type: mime}); } catch (e) { /* no File constructor */ }

  if (IS_IOS && file && navigator.canShare && navigator.share) {
    var payload = {files:[file], title:filename};
    var ok = false;
    try { ok = navigator.canShare(payload); } catch (e) { ok = false; }
    if (ok) {
      return navigator.share(payload).then(function(){ return true; }, function(e){
        if (e && (e.name === 'AbortError' || e.code === 20)) return false;
        return linkDownload(filename, blob);
      });
    }
  }
  return Promise.resolve(linkDownload(filename, blob));
}
function linkDownload(filename, blob){
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  return true;
}
function markBackedUp(){
  S.lastBackup = Date.now();
  store.setMeta('lastBackupAt', S.lastBackup).catch(function(){});
  render();
}

function csvCell(v){
  var s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}
function exportCsv(){
  var rows = [['Place','Container','Code','Type','Exact spot','Container notes','Item','Qty','Item note']];
  S.bins.slice().sort(function(a,b){ return (a.code||'').localeCompare(b.code||''); }).forEach(function(b){
    var p = placeById(b.placeId);
    var base = [p ? p.name : '', b.name, b.code || '', b.kind || '', b.spot || '', b.notes || ''];
    var items = b.items || [];
    if (!items.length) rows.push(base.concat(['', '', '']));
    else items.forEach(function(it){ rows.push(base.concat([it.name, it.qty || 1, it.note || ''])); });
  });
  /* the loose things: a place, no container */
  sortedPlaces().forEach(function(p){
    (p.items || []).forEach(function(it){
      rows.push([p.name, '(not in a container)', '', '', '', '', it.name, it.qty || 1, it.note || '']);
    });
  });
  var csv = rows.map(function(r){ return r.map(csvCell).join(','); }).join('\r\n');
  saveFile('storage-inventory-' + stamp() + '.csv', csv, 'text/csv').then(function(done){
    if (done) { markBackedUp(); toast('Spreadsheet saved.'); }
  }, function(){ toast('Could not save the file.'); });
}
function exportJson(){
  store.exportAll().then(function(data){
    return saveFile('bin-and-shelf-backup-' + stamp() + '.json', JSON.stringify(data, null, 2), 'application/json');
  }).then(function(done){
    if (done) { markBackedUp(); toast('Backup saved.'); }
  }, function(){ toast('Could not save the backup.'); });
}

function readBackup(file){
  file.text().then(function(text){
    var data;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!data || (!Array.isArray(data.places) && !Array.isArray(data.containers))){
      toast('That file is not a Bin & Shelf backup.');
      return;
    }
    var np = (data.places || []).length, nb = (data.containers || []).length;
    confirmSheet('Restore this backup?',
      'It holds <strong>' + plural(np, 'place') + '</strong> and <strong>' + plural(nb, 'container') + '</strong>. ' +
      'Everything currently in the app is replaced. This cannot be undone.',
      'Replace everything',
      function(){ doRestore(data); });
  }, function(){ toast('Could not read that file.'); });
}
function doRestore(data){
  if (!guard()) return;
  S.busy = true;
  store.replaceAll(data).then(function(){
    S.busy = false; closeSheet(); home();
    toast('Restored ' + plural((data.containers||[]).length, 'container') + '.');
  }, failed);
}

/* ---------------- first-run examples ---------------- */
var SEED = {
  places: [
    {key:'garage', name:'Garage', sample:true, items:[
      {name:'Extension ladder', qty:1, note:'Hanging on the back wall'}
    ]},
    {key:'attic',  name:'Attic',  sample:true, items:[]}
  ],
  containers: [
    {
      place:'garage', name:'Christmas decorations', code:'GAR-01', kind:'Tote / bin',
      spot:'Metal shelf, left wall, top row', notes:'Red lid. Fragile ornaments on top.',
      items:[
        {name:'Tree topper', qty:1, note:'Glass, wrapped in newspaper'},
        {name:'String lights', qty:6, note:'Warm white, 2 sets are dead'},
        {name:'Wreath', qty:2, note:''},
        {name:'Ornament boxes', qty:4, note:''}
      ]
    },
    {
      place:'garage', name:'Camping gear', code:'GAR-02', kind:'Tote / bin',
      spot:'Under the workbench', notes:'',
      items:[
        {name:'Two-person tent', qty:1, note:'Poles in the side pocket'},
        {name:'Sleeping bags', qty:2, note:''},
        {name:'Camp stove', qty:1, note:'Propane is on the shelf above'}
      ]
    },
    {
      place:'attic', name:'Baby clothes 0-12m', code:'ATT-01', kind:'Cardboard box',
      spot:'By the chimney, stacked second from the bottom', notes:'Vacuum bagged.',
      items:[
        {name:'Onesies', qty:14, note:''},
        {name:'Winter suit', qty:1, note:'6-9 months'}
      ]
    }
  ]
};

function seedExamples(){
  var now = Date.now();
  var ids = {};
  var chain = Promise.resolve();
  SEED.places.forEach(function(p){
    chain = chain.then(function(){
      return store.add('places', {
        name: p.name,
        sample: true,
        items: (p.items || []).map(function(it){ return {id:uid(), name:it.name, qty:it.qty, note:it.note || ''}; }),
        createdAt: now,
        updatedAt: now
      }).then(function(id){ ids[p.key] = id; });
    });
  });
  SEED.containers.forEach(function(c){
    chain = chain.then(function(){
      return store.add('containers', {
        name: c.name,
        placeId: ids[c.place] || '',
        kind: c.kind,
        spot: c.spot,
        notes: c.notes,
        code: c.code,
        sample: true,
        items: c.items.map(function(it){ return {id:uid(), name:it.name, qty:it.qty, note:it.note || ''}; }),
        createdAt: now,
        updatedAt: now
      });
    });
  });
  return chain;
}

/* ---------------- events ---------------- */
screen.addEventListener('click', function(e){
  var t = e.target.closest('[data-act]');
  if (!t) return;
  var act = t.getAttribute('data-act');
  var id = t.getAttribute('data-id');
  var itemId = t.getAttribute('data-item');
  var ownerKind = t.getAttribute('data-owner') === 'place' ? 'place' : 'bin';

  if (act === 'home') { home(); }
  else if (act === 'open-place') { clearQuery(true); go({name:'place', id:id}); }
  else if (act === 'open-bin') { clearQuery(true); go({name:'bin', id:id}); }
  else if (act === 'open-all') { go({name:'all'}); }
  else if (act === 'new-place') { placeSheet(null); }
  else if (act === 'edit-place') { placeSheet(placeById(id)); }
  else if (act === 'settings') { settingsSheet(); }
  else if (act === 'del-place') {
    var p = placeById(id), n = binsIn(id).length, loose = itemCount(p);
    var what = [];
    if (n) what.push('<strong>' + n + '</strong> container' + (n===1?'':'s') + ' and everything listed inside');
    if (loose) what.push('<strong>' + plural(loose, 'item') + '</strong> kept loose here');
    confirmSheet('Delete ' + (p ? p.name : 'place') + '?',
      what.length ? 'Its ' + what.join(', plus ') + ' will go too. This cannot be undone.'
        : 'Nothing is stored in it. This cannot be undone.',
      'Delete', function(){ deletePlace(id); });
  }
  else if (act === 'new-bin') { binSheet(null, id); }
  else if (act === 'edit-bin') { binSheet(binById(id)); }
  else if (act === 'del-bin') {
    var b = binById(id);
    confirmSheet('Delete ' + (b ? b.name : 'container') + '?',
      'The container and its ' + plural(b ? itemCount(b) : 0, 'item') + ' will be removed. This cannot be undone.',
      'Delete', function(){ deleteBin(id); });
  }
  else if (act === 'edit-item') {
    var owner = ownerOf(ownerKind, id);
    var it = owner && (owner.items || []).filter(function(x){ return x.id === itemId; })[0];
    if (it) itemSheet(ownerKind, id, it);
  }
  else if (act === 'del-item') { removeItem(ownerKind, id, itemId); }
  else if (act === 'clear-q') { clearQuery(); }
  else if (act === 'clear-samples') {
    confirmSheet('Clear the examples?', 'The example places and containers will be deleted. Anything you added yourself stays.', 'Clear examples', clearSamples);
  }
});

screen.addEventListener('submit', function(e){
  if (e.target.id !== 'quickadd') return;
  e.preventDefault();
  var input = document.getElementById('quick-name');
  var name = input.value.trim();
  if (!name) return;
  if (S.view.name !== 'bin' && S.view.name !== 'place') return;
  input.value = '';
  addItem(S.view.name === 'place' ? 'place' : 'bin', S.view.id, name, 1, '');
});

function clearQuery(silent){
  S.q = '';
  qInput.value = '';
  qClear.hidden = true;
  if (!silent) render();
}
var qTimer;
qInput.addEventListener('input', function(){
  S.q = qInput.value;
  qClear.hidden = !S.q;
  clearTimeout(qTimer);
  qTimer = setTimeout(render, 110);
});
qClear.addEventListener('click', function(){ clearQuery(); qInput.focus(); });

document.getElementById('dock-loc').onclick = function(){ placeSheet(null); };
document.getElementById('dock-bin').onclick = function(){
  binSheet(null, S.view.name === 'place' ? S.view.id : null);
};
document.getElementById('btn-help').onclick = settingsSheet;

/* ---------------- boot ---------------- */
function fatal(msg){
  S.fatal = '<div class="empty" style="margin-top:20px"><h3>Storage unavailable</h3><p>' + esc(msg) + '</p></div>';
  render();
}

store.subscribe('places', function(rows){
  S.places = rows.map(function(p){
    if (!Array.isArray(p.items)) p.items = [];
    return p;
  });
  if (S.ready) render();
});
store.subscribe('containers', function(rows){
  S.bins = rows.map(function(v){
    if (!Array.isArray(v.items)) v.items = [];
    return v;
  });
  if (S.ready) render();
});

if (!('indexedDB' in window)){
  fatal('This browser will not let the app store anything. Try Safari or Chrome with private browsing turned off.');
} else {
  store.persist().catch(function(){});

  Promise.all([store.getMeta('seeded'), store.getMeta('lastBackupAt'), store.all('places'), store.all('containers')])
    .then(function(r){
      var seeded = r[0], lastBackup = r[1], places = r[2], bins = r[3];
      S.lastBackup = typeof lastBackup === 'number' ? lastBackup : null;
      if (!seeded && !places.length && !bins.length){
        return seedExamples().then(function(){ return store.setMeta('seeded', true); });
      }
      if (!seeded) return store.setMeta('seeded', true);
      return null;
    })
    .then(function(){
      S.ready = true;
      render();
    })
    .catch(function(e){
      console.error(e);
      S.ready = true;
      render();
    });
}

/* keep the app working in a garage with no signal */
if ('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').catch(function(e){ console.warn('Service worker did not register', e); });
  });
}
