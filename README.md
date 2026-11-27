# Bootlyga

Reproductor de deportes en directo para casa. El motor Acestream vive en un contenedor. El gateway es el único origen que ven el navegador, el móvil y, más adelante, el escritorio y la televisión. La lista de canales la pone quien usa el aparato.

No hay listas de canales ni identificadores en este repositorio. No se redistribuye el binario del motor.

## Piezas

```
navegador (PWA, hls.js)
        |
        | mismo origen, clave en Authorization
        v
gateway  ----proxy HLS, sesiones, parada---->  motor
                                                (mock en CI, imagen oficial en casa)
```

| Ruta | Qué es |
|---|---|
| `packages/domain` | Catálogo, hora de Madrid, parser m3u, foco de mando. Lo compartirán Tauri y Android TV. |
| `packages/gateway` | API, proxy, auth, CORS, salud. |
| `packages/mock-engine` | Motor HTTP de mentira, con barras de color, para pruebas y para la pila por defecto. |
| `apps/web` | PWA. |
| `clients/desktop` | Hueco para Tauri y libmpv. |
| `clients/android-tv` | Hueco para el mando en el televisor. |
| `compose.yaml` | Gateway y motor simulado. El puerto del gateway solo escucha en `127.0.0.1`. El motor no publica puertos. |
| `compose.engine.yaml` | Cambia el simulador por `ghcr.io/martinbjeldbak/acestream-http-proxy` fijado por digest. |

El simulador es la pila por defecto porque el binario oficial es de código cerrado, solo existe para x86_64 y no debe viajar dentro del repo. La imagen de Martin Bjeldbak lo descarga en su propio build, con licencia MIT para el envoltorio. Aquí solo se referencia.

## Arranque en casa, con barras de prueba

```bash
cp .env.example .env
# cambia BOOTLYGA_TOKEN. El valor de ejemplo se rechaza.
docker compose up --build
```

Abre `http://127.0.0.1:8080`. Entra la clave. Añade un identificador de 40 caracteres hexadecimales (en el simulador cualquiera sirve) y dale a reproducir. Verás barras de color, prueba de que el vídeo cruza el gateway.

Sin Docker, en tres terminales:

```bash
npm install
npm run dev:mock
BOOTLYGA_TOKEN=una-clave-larga-de-casa ACE_BASE=http://127.0.0.1:6878 CATALOG_PATH=data/catalog.json npm run dev:gateway
npm run dev:web
```

La web de desarrollo está en `http://127.0.0.1:5173` y el proxy de Vite apunta al gateway.

## Motor real

```bash
docker compose -f compose.yaml -f compose.engine.yaml up --build
```

`ALLOW_REMOTE_ACCESS=yes` hace que el motor acepte al gateway, que está en otro contenedor. El puerto 6878 no se publica en el host. La API del motor no tiene clave: por eso no debe asomar a la red.

La imagen es linux/amd64. Un mini PC N100 entra. ARM no.

## Fuera de casa

Tailscale en el PC, sin Funnel y sin abrir puertos al router. Desde el móvil, en la tailnet, se abre `http://<ip-o-nombre-tailscale>:8080` solo si publicas el puerto en esa interfaz. Por defecto Compose ata el gateway a localhost. Para la tailnet, cambia el bind a la IP de Tailscale o usa `tailscale serve --bg 8080`, que queda dentro de la red de Tailscale.

No uses `tailscale funnel`.

Los puertos P2P del motor (8621) no se publican. El motor sale a buscar pares. Publicarlos en la LAN puede ayudar más adelante. No es el ajuste de esta versión.

## Clave y CORS

La clave va en `Authorization: Bearer`. Si llega en la query (`token`, `access_token`, `api_key`) la respuesta es 400, aunque la cabecera sea correcta. Así no acaba en historiales ni en registros de un proxy.

La PWA guarda la clave en `sessionStorage` y `hls.js` la pone en cada petición del manifiesto y de los segmentos en escritorio y Android. En iPhone y Safari (HLS nativo sin `MediaSource` estándar), `POST /v1/sessions` emite además una cookie `HttpOnly` firmada (`bootlyga_hls`, `SameSite=Lax`, `Path=/v1/hls/`) que solo autoriza lecturas `GET /v1/hls/...` y nunca los endpoints de catálogo, estadísticas o gestión. El flag `Secure` se controla con `BOOTLYGA_SECURE_COOKIE=auto|true|false` (`auto` por defecto, detectando HTTPS y `X-Forwarded-Proto: https` de `tailscale serve`). La clave nunca viaja en la URL.

CORS no lleva `*`. Si `BOOTLYGA_CORS_ORIGINS` está vacío, no se envía `Access-Control-Allow-Origin`. La PWA se sirve desde el propio gateway y no lo necesita. Un `*` en la variable impide arrancar.

## Sesiones

Un canal abierto es una sesión del motor (`format=json` y `use_api_stop=1`). La respuesta al navegador es una ruta relativa `/v1/hls/...`, nunca la URL del motor. Varios dispositivos en el mismo canal comparten esa sesión. El último que suelta el canal, o el silencio durante `SESSION_TTL_MS` (5 minutos), llama a `command_url?method=stop`.

Límites: 5 sesiones y 10 espectadores por sesión.

Si el manifiesto todavía no trae `#EXTM3U`, el gateway responde 503 con `Retry-After` y hls.js reintenta. Es la espera a los pares, sin devolver un flujo a medias.

## Catálogo

`data/catalog.json` (no se versiona) guarda canales, fuentes y una lista de eventos vacía. El ejemplo está en `data/catalog.example.json`.

Un evento, cuando exista la agenda, lleva `startsAt` en UTC. Si la fuente no trae hora, `timeKnown` es falso y `startsAt` es una fecha `YYYY-MM-DD`: no se inventa la medianoche. La pantalla usará `Europe/Madrid`.

También se puede pegar un m3u propio. Solo entran líneas `acestream://` con 40 hexadecimales. El resto se cuenta como omitido.

## Comprobaciones

```bash
make check
```

Encadena typecheck, lint, tests, build, integración (`scripts/smoke.mjs`) y extremo a extremo con Playwright (reproducción y accesibilidad con axe). La pila de integración sube con Docker Compose; si el motor no alcanza al gateway en la red del contenedor, el script prueba la misma ruta en el host.

Los tests de `packages/gateway/test/load.test.ts` cubren el issue de carga de iptv-player: cinco cambios de canal seguidos, dos espectadores en el mismo canal, tres canales a la vez y la caducidad por inactividad. Corren contra el simulador.

## Decisiones

- TypeScript en un solo lenguaje para el dominio, el gateway y la PWA. acexy hace un multiplexado parecido en Go, con licencia GPL-3.0: se ha mirado la idea, no el código.
- Node `http` en el gateway, sin Express. El proxy de segmentos se queda en la librería estándar.
- hls.js (Apache-2.0) en la web. El escritorio, cuando llegue, puede usar libmpv con la misma ruta y la cabecera `Authorization`, como hace Kiro con Tauri.
- El motor no se copia. Se tira de la imagen oficial en el momento de ejecutar.

## Licencias de lo que sí se incluye

Código de Bootlyga: MIT, ver `LICENSE`.

Fuentes OFL en el build de la web: Archivo, IBM Plex Mono y Doto. Copias de la licencia en `third_party/fonts/`.

hls.js: Apache-2.0.

El filtro antislop es MIT. Ver `third_party/antislop/LICENSE`.
