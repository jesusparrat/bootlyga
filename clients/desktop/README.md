# Escritorio

Todavía no hay aplicación. El sitio previsto es Tauri 2 con libmpv, el mismo esquema que WatchKiro/kiro: la interfaz puede ser esta PWA y el vídeo lo pinta mpv por debajo, sin abrir VLC.

mpv acepta la clave en una cabecera:

```text
mpv --http-header-fields="Authorization: Bearer <clave>" \
  http://127.0.0.1:8080/v1/hls/<sesión>/index.m3u8
```

La sesión se abre con `POST /v1/sessions` y se cierra con `DELETE` cuando el reproductor para. El motor sigue en Docker, en el PC de casa. No se embebe el binario.

El contrato de canales está en `@bootlyga/domain`.
