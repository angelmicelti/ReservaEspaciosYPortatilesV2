/* ============================================================
   Service Worker — Reserva de Espacios · IES (PWA)
   ------------------------------------------------------------
   - Precachea la «app shell» (index.html, la aplicación
     reserva-espacios-IES.html, manifest, iconos) y los SDK de
     Firebase para que la interfaz arranque sin conexión.
   - index.html es la puerta de entrada del sitio (start_url del
     manifest) y redirige a la aplicación.
   - Navegaciones: red primero (para recibir actualizaciones) con
     reserva en caché si falla la red.
   - CDNs de librerías (gstatic/jsDelivr/unpkg): stale-while-
     revalidate (caché primero + actualización en segundo plano).
   - Los DATOS de Firebase Realtime Database (firebasedatabase.app
     / firebaseio.com) NUNCA se cachean: siempre red en vivo.
   Para publicar una versión nueva, sube CACHE_VERSION.
   ============================================================ */
'use strict';

const CACHE_VERSION = 'v1.0.10';
const CACHE = 'reservas-ies-' + CACHE_VERSION;
const PAGE = './index.html';                  /* puerta de entrada (start_url) */
const APP = './index.html';    /* la aplicación */

/* App shell + SDKs imprescindibles para arrancar sin red */
const PRECACHE = [
  PAGE,
  APP,
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics-compat.js'
];

/* CDNs de librerías cargadas bajo demanda (SheetJS, jsPDF…) o de los SDK */
const CDN_HOSTS = new Set([
  'www.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com'
]);

/* Endpoints de datos en vivo: nunca interceptar */
const isLiveData = (url) =>
  /(^|\.)firebaseio\.com$/.test(url.hostname) ||
  /(^|\.)firebasedatabase\.app$/.test(url.hostname) ||
  /(^|\.)cloudfunctions\.net$/.test(url.hostname) ||
  url.hostname === 'firebaseinstallations.googleapis.com' ||
  url.hostname === 'firebaselogging-pa.googleapis.com';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* allSettled: si un CDN falla al instalar, no se rompe el registro */
    await Promise.allSettled(
      PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' })))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('reservas-ies-') && k !== CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* Página «Sin conexión» de reserva */
const offlineResponse = () => new Response(
  '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Sin conexión · Reserva de Espacios</title></head>' +
  '<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;' +
  'background:#eef2f7;display:grid;place-items:center;min-height:100vh">' +
  '<div style="text-align:center;padding:2rem">' +
  '<h1 style="color:#0f172a;margin:0 0 6px">Sin conexión</h1>' +
  '<p style="color:#64748b;margin:0">No se puede conectar con el servidor.<br>' +
  'Comprueba tu conexión a internet y recarga la página.</p></div></body></html>',
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;              // escrituras: siempre red
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isLiveData(url)) return;                   // datos RTDB en vivo: pasar de largo

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN_HOSTS.has(url.hostname)) return;

  /* 1) Navegaciones: red primero → caché → página sin conexión.
        Cada URL se guarda con su contenido; sin red se sirve la
        propia URL visitada y, si no está, directamente la app. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (_) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req, { ignoreSearch: true })) ||
               (await cache.match(APP)) ||
               (await cache.match(PAGE)) ||
               offlineResponse();
      }
    })());
    return;
  }

  /* 2) Resto (app shell y CDNs): stale-while-revalidate */
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const res = await network;
    return res || offlineResponse();
  })());
});
