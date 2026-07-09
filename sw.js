const CACHE_NAME = 'finance-v1.1';

// Список файлов, которые нужно запереть в памяти устройства
const ASSETS = [
  '/',
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'icon.png',
  'Sber15.woff2'
];

// При установке скачиваем все файлы в локальный кеш
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Перехватываем запросы: если интернета нет, отдаем файлы из кеша
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => response || fetch(e.request))
  );
});
