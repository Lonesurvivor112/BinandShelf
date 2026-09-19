/* sw.js — offline shell for Bin & Shelf.
   The whole app is a handful of static files, so they all get pre-cached.
   Fonts are cached the first time they load, then served from the cache. */

var VERSION = 'v1';
var SHELL = 'shell-' + VERSION;
var FONTS = 'fonts-' + VERSION;

var SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './store.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(SHELL).then(function(cache){
      /* one miss should not fail the whole install */
      return Promise.all(SHELL_FILES.map(function(url){
        return cache.add(new Request(url, {cache:'reload'})).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if (k !== SHELL && k !== FONTS) return caches.delete(k);
        return null;
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function isFont(url){
  return url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* Fonts: serve what we have, refresh quietly in the background. */
  if (isFont(url)){
    e.respondWith(
      caches.open(FONTS).then(function(cache){
        return cache.match(req).then(function(hit){
          var net = fetch(req).then(function(res){
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(function(){ return hit; });
          return hit || net;
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  /* Pages: try the network so a deploy shows up, fall back to the shell. */
  if (req.mode === 'navigate'){
    e.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(SHELL).then(function(c){ c.put('./index.html', copy); }).catch(function(){});
        return res;
      }).catch(function(){
        return caches.match('./index.html', {ignoreSearch:true}).then(function(hit){
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  /* Everything else: cache first, then top the cache up. */
  e.respondWith(
    caches.match(req, {ignoreSearch:true}).then(function(hit){
      if (hit){
        fetch(req).then(function(res){
          if (res && res.ok) caches.open(SHELL).then(function(c){ c.put(req, res); });
        }).catch(function(){});
        return hit;
      }
      return fetch(req).then(function(res){
        if (res && res.ok){
          var copy = res.clone();
          caches.open(SHELL).then(function(c){ c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
