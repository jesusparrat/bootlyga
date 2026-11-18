# Android TV

Todavía no hay aplicación nativa. La PWA ya se maneja con flechas: la lógica está en `packages/domain/src/focus.ts` y la web la aplica a grupos, canales y vídeo.

Un envoltorio posterior puede usar ExoPlayer contra las mismas rutas `/v1/hls/...`, con la cabecera `Authorization`. El motor no corre en el televisor: corre en el PC de casa y se alcanza por la LAN o por Tailscale.

El contrato de canales está en `@bootlyga/domain`.
