
const CACHE_NAME = 'controlled-drugs-pwa-sb-v3';
const PRECACHE = ['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest','./logo.png'];
self.addEventListener('install', e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(PRECACHE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate', e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME&&caches.delete(k)))))});
self.addEventListener('fetch', e=>{
  if(e.request.method==='GET' && new URL(e.request.url).origin === self.location.origin){
    e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));
  }
});
