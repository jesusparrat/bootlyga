# Instrucciones para agentes

Bootlyga es el reproductor de directos de Jesús. El motor Acestream va aparte. Este repo no es una lista de canales.

## Qué no se hace

- No se empuja a `main`. Cada cambio va en una rama y en un pull request. No se fusiona sin que Jesús lo diga.
- No se añaden listas m3u, identificadores Acestream ni enlaces a emisiones concretas. El usuario trae los suyos. Un test de higiene falla si cuela el identificador que estaba en el README viejo de iptv-player.
- No se vende ni se copia el binario del motor. La imagen `ghcr.io/martinbjeldbak/acestream-http-proxy` se referencia por digest en `compose.engine.yaml`. El simulador de `packages/mock-engine` es lo que usa CI.
- No se abre un puerto público. Compose publica el gateway solo en `127.0.0.1`. El acceso de fuera es Tailscale, sin Funnel.
- La clave no viaja en la query. CORS no usa `*`.
- No se cambia la dirección visual de `DESIGN.md` sin que Jesús lo apruebe.

## Idioma y texto

Español de España en la interfaz, el README y este archivo. Horas de pantalla en `Europe/Madrid`. Lo que se guarda, en UTC.

Sin raya larga (el carácter em dash) en texto escrito ni en la interfaz. Coma, punto, dos puntos o paréntesis.

Sin cifras inventadas. Si el motor no ha contestado, se dice. No se pinta un porcentaje de salud que el código no calcula.

## Diseño

`DESIGN.md` fija tokens, fuentes y el uso del amarillo. El filtro antislop está en `third_party/antislop/` (MIT). Modo de este repo: during. Se aplica al escribir. Al terminar, se recorre la interfaz de verdad: vacío, error, reproducción, claro, oscuro, ancho de móvil.

## Comprobaciones

```bash
npm run check
docker compose up --build
BOOTLYGA_TOKEN=… node scripts/smoke.mjs
```

`npm run check` es typecheck, tests y build. Si un test falla, se arregla la causa. No se relaja el test para que pase.

Los tests de carga viven en `packages/gateway/test/load.test.ts` y hablan con el simulador. No hace falta el binario.

## Mapa

- `packages/domain`: contrato de `Channel`, `Source` y `AgendaEvent`. La agenda no está construida. Los eventos se conservan al editar canales.
- `packages/gateway/src/engine.ts`: único sitio que conoce el HTTP API del motor (`format=json`, `command_url?method=stop`).
- `packages/gateway/src/sessions.ts`: fan-out, límites y TTL de inactividad.
- `apps/web`: PWA. El foco de mando está en `packages/domain/src/focus.ts`.
- `clients/desktop` y `clients/android-tv`: todavía sin código. Leen el mismo gateway.

## Huecos a propósito

- iPhone: Safari no adjunta `Authorization` al HLS nativo. No se resuelve metiendo la clave en la URL.
- Agenda, salud de fuentes y conmutación automática: el modelo está, la pantalla no.
- Tauri + libmpv y el cliente de Android TV: después de que la PWA lleve un tiempo en casa.
