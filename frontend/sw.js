// ==========================================
// SERVICE WORKER - DYNATUBE PRO
// ==========================================

const CACHE_NAME = 'dynatube-v2.2.1';
const CACHE_VERSION = '2.2.2';

// Assets estáticos a cachear
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/script.js',
    '/js/api.js',
    '/manifest.json'
];

// Recursos que nunca deben cachearse
const NEVER_CACHE = [
    '/api/',
    'chrome-extension://',
    'localhost:5000/api/'
];

// ==========================================
// INSTALACIÓN
// ==========================================
self.addEventListener('install', event => {
    console.log('[SW] Instalando Service Worker v' + CACHE_VERSION);

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Cacheando assets estáticos');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[SW] Assets cacheados exitosamente');
                return self.skipWaiting(); // Activa inmediatamente
            })
            .catch(err => {
                console.error('[SW] Error cacheando assets:', err);
            })
    );
});

// ==========================================
// ACTIVACIÓN
// ==========================================
self.addEventListener('activate', event => {
    console.log('[SW] Activando Service Worker v' + CACHE_VERSION);

    event.waitUntil(
        Promise.all([
            // Limpiar cachés antiguas
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('[SW] Eliminando caché antigua:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            // Tomar control inmediato
            self.clients.claim()
        ]).then(() => {
            console.log('[SW] Service Worker activado y controlando clientes');
        })
    );
});

// ==========================================
// FETCH - ESTRATEGIA DE CACHÉ
// ==========================================
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // No cachear APIs ni recursos externos específicos
    if (shouldNeverCache(url.href)) {
        event.respondWith(fetch(request));
        return;
    }

    // Estrategia: Cache First para assets estáticos, Network First para el resto
    if (isStaticAsset(url.pathname)) {
        event.respondWith(cacheFirst(request));
    } else {
        event.respondWith(networkFirst(request));
    }
});

// ==========================================
// ESTRATEGIAS DE CACHÉ
// ==========================================

/**
 * Cache First: Intenta servir desde caché, si no hay va a red
 */
async function cacheFirst(request) {
    try {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            console.log('[SW] Sirviendo desde caché:', request.url);
            return cachedResponse;
        }

        // Si no está en caché, traer de red y cachear
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        console.error('[SW] Error en cacheFirst:', error);
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
    }
}

/**
 * Network First: Intenta traer de red, si falla usa caché
 */
async function networkFirst(request) {
    try {
        const networkResponse = await fetch(request);

        // Cachear respuestas exitosas
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        console.log('[SW] Red no disponible, intentando caché para:', request.url);

        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }

        // Si no hay caché, devolver respuesta offline
        return createOfflineResponse(request);
    }
}

/**
 * Network Only: Siempre ir a la red (para APIs)
 */
async function networkOnly(request) {
    return fetch(request);
}

// ==========================================
// UTILIDADES
// ==========================================

/**
 * Verifica si un recurso nunca debe cachearse
 */
function shouldNeverCache(url) {
    return NEVER_CACHE.some(pattern => url.includes(pattern));
}

/**
 * Verifica si es un asset estático
 */
function isStaticAsset(pathname) {
    const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf'];
    return staticExtensions.some(ext => pathname.endsWith(ext)) ||
        pathname === '/' ||
        pathname.endsWith('.html');
}

/**
 * Crea una respuesta offline personalizada
 */
function createOfflineResponse(request) {
    const isHTML = request.headers.get('Accept').includes('text/html');

    if (isHTML) {
        return new Response(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sin conexión - Dynatube</title>
        <style>
          body {
            font-family: 'Segoe UI', sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #0d0d12 0%, #1a1a24 100%);
            color: #e2e2e5;
          }
          .container {
            text-align: center;
            padding: 40px;
          }
          .emoji {
            font-size: 80px;
            margin-bottom: 20px;
            animation: bounce 2s infinite;
          }
          h1 {
            font-size: 32px;
            margin-bottom: 10px;
            color: #00e5ff;
          }
          p {
            font-size: 16px;
            color: #8080a0;
            margin-bottom: 30px;
          }
          button {
            background: linear-gradient(to right, #00c8e0, #0099bb);
            color: #050a0c;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 700;
            font-size: 14px;
            cursor: pointer;
            transition: transform 0.2s;
          }
          button:hover {
            transform: scale(1.05);
          }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="emoji">📡</div>
          <h1>Sin conexión</h1>
          <p>No se pudo conectar al servidor. Verifica tu conexión a internet.</p>
          <button onclick="window.location.reload()">Reintentar</button>
        </div>
      </body>
      </html>
    `, {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/html' }
        });
    }

    return new Response('Sin conexión', {
        status: 503,
        statusText: 'Service Unavailable'
    });
}

// ==========================================
// MENSAJES
// ==========================================
self.addEventListener('message', event => {
    const { type, payload } = event.data;

    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;

        case 'CACHE_URLS':
            if (payload && payload.urls) {
                caches.open(CACHE_NAME).then(cache => {
                    cache.addAll(payload.urls);
                });
            }
            break;

        case 'CLEAR_CACHE':
            caches.delete(CACHE_NAME).then(() => {
                console.log('[SW] Caché limpiada');
            });
            break;

        case 'GET_VERSION':
            event.ports[0].postMessage({ version: CACHE_VERSION });
            break;

        default:
            console.log('[SW] Mensaje no reconocido:', type);
    }
});

// ==========================================
// PUSH NOTIFICATIONS (Opcional)
// ==========================================
self.addEventListener('push', event => {
    const options = {
        body: event.data ? event.data.text() : 'Nueva notificación',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        vibrate: [200, 100, 200],
        tag: 'dynatube-notification',
        requireInteraction: false
    };

    event.waitUntil(
        self.registration.showNotification('Dynatube Pro', options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    event.waitUntil(
        clients.openWindow('/')
    );
});

// ==========================================
// SYNC (Background Sync - Opcional)
// ==========================================
self.addEventListener('sync', event => {
    if (event.tag === 'sync-downloads') {
        event.waitUntil(syncDownloads());
    }
});

async function syncDownloads() {
    console.log('[SW] Sincronizando descargas...');
    // Implementar lógica de sincronización si es necesario
}

// ==========================================
// LOGGING
// ==========================================
console.log('[SW] Service Worker cargado - Versión:', CACHE_VERSION);