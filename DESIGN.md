# DESIGN.md, Bootlyga

Hereda el sistema aprobado en ensemblitz (papel, Archivo, IBM Plex Mono, Doto, un amarillo de bandera). Un cambio de dirección lo decide Jesús. Esto solo dice cómo se usa ese sistema en un reproductor, no en un panel de pronósticos.

## Lectura

Es la mesa del salón un domingo por la noche, en Madrid: el vídeo manda a la izquierda y la lista de canales acompaña a la derecha. Energía media, ritmo en dos columnas desiguales, movimiento corto al pulsar. Si se quita el nombre, se reconoce por la marca de cinco casillas (la del centro, amarilla y más alta) y por el marco del vídeo con sombra dura.

## Tokens

Los mismos que ensemblitz. Contraste ya medido allí.

| Token | Claro | Oscuro |
|---|---|---|
| `--paper` | `#F4F4F2` | `#0E0F11` |
| `--surface` | `#FFFFFF` | `#17181B` |
| `--ink` | `#101113` | `#F2F2EF` |
| `--ink-2` | `#50525A` | `#A6A8AF` |
| `--ink-3` | `#666870` | `#8E9098` |
| `--rule` | `#D5D5D0` | `#2A2B30` |
| `--flag` | `#FFD60A` | `#FFD60A` |
| `--on-flag` | `#101113` | `#101113` |

El amarillo es relleno: la casilla central de la marca y el fondo del enlace "saltar al vídeo" cuando recibe el foco. No es texto sobre papel. No hay verde ni rojo para el estado del motor: lo dice la frase.

Claro por defecto. `prefers-color-scheme` se respeta hasta que la persona pulsa el botón, que fija claro u oscuro. Los partidos caen de noche y el papel claro también se lee de día.

## Tipo

| Voz | Fuente | Dónde |
|---|---|---|
| Nombre, títulos, canales | Archivo variable, eje de anchura | Condensada en el nombre y en el canal. Cuerpo a anchura normal. |
| Motor, hora pequeña, calidad, avisos | IBM Plex Mono | Cifras y estados, no titulares. |
| Reloj de Madrid | Doto, 44 px | Solo la hora. Lleva `aria-label` con la misma hora. |

Sin versalitas y sin tracking ancho. El nombre usa `clamp` entre 28 y 44 px, no el titular de 164 px de la jornada de ensemblitz: aquí la imagen manda, no el rótulo.

## Composición

Contenedor de 1240 px. A partir de 960 px la página es una columna y el vídeo queda arriba, porque en el móvil se mira antes de elegir.

La división ancha favorece el escenario (aprox. 65/35): el reproductor ocupa el protagonista a la izquierda y la lista de canales forma un carril scrollable a la derecha. El marco del vídeo y el diálogo de acceso o ajustes son los únicos objetos con sombra, 6 px de desplazamiento, color tinta, sin desenfoque. El interior del marco es negro porque ahí va la imagen, no como tema de la interfaz.

Debajo del marco van la barra de estado real del motor, el botón de pantalla completa, el botón de parar y el selector de fuentes del canal cuando hay más de una. Las altas de canales, la importación de listas m3u (texto o archivo) y el cambio de clave viven dentro del diálogo de Ajustes para no estorbar la reproducción.

Las filas de canal se separan con un filete punteado de 1 px. Es el único patrón. El canal en reproducción invierte tinta y papel para leerse desde el sofá.

Los grupos y las fuentes son botones rectangulares de radio 2 px. El activo invierte la tinta. No son píldoras.

## Mando

Flechas: grupos, canales, ajustes, escenario. Derecha salta al vídeo. Izquierda vuelve a la lista. Inicio y fin van a la búsqueda y al escenario. `F` alterna pantalla completa fuera de los campos de texto. Dentro de un campo de texto las flechas mueven el cursor. Escape sale del campo, cierra Ajustes y anula un "Confirmar" a medias.

El foco visible es un contorno de 2 px, separado 3 px. En la fila invertida el contorno pasa a color papel para seguir viéndose. No se quita el contorno.

Dianas de 44 px en botones y campos.

## Movimiento

150 ms no hay: el pulsar desplaza el botón 1 px. Con `prefers-reduced-motion` ese desplazamiento se apaga. Nada en bucle. El reloj se actualiza cada 30 s, no parpadea.

## Qué se toma de las referencias

| Sitio | Se toma | No se toma |
|---|---|---|
| illos.dev | Un acento solo, el producto a la vista | Degradados |
| neaticons.com | Una rejilla para la marca de casillas | Un campo de iconos decorativos |
| autorouter.com | El control real (la clave, el identificador) en la primera pantalla | Estética de ventana de Mac |
| ogimagecn.com | Titular apretado, botón sólido junto a botón de contorno | Geist |
| mdxcn.dev | Filetes y densidad de texto | Rejilla de fondo |
| amicro.dev | El indicador de grupo que cambia de estado al pulsarlo | Fondo negro por sistema |
| easyui.site | La cifra grande del reloj junto a un control pequeño | Radios muy redondos |
| evilbuttons.com | Una marca con voz propia en el nombre | Degradado y perspectiva |
| bencho.dev | Filtros con recuento | Hero centrado con dos llamadas |

## Estados

Vacío: no hay canales y el propio marco ofrece abrir Ajustes. Cargando: "Abriendo la mesa." Buscando pares: se muestran el estado, el progreso, los pares y la velocidad reales que devuelve el motor (sin inventar cifras). Error de clave, de lista o de señal: una frase en el sitio del fallo, con opción de reintentar o saltar a la siguiente fuente. El motor en línea enseña la versión que de verdad ha contestado.

## Qué no entra

Degradados, orbes, vidrio, segundo acento, emojis, iconos de librería, insignias de "beta", flechas en los botones, secciones de tres pasos, testimonios, cifras de usuarios.
