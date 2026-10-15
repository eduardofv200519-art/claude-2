# Deanp3 (interfaz para spotDL)

App de escritorio para Windows con interfaz gráfica, basada en
[spotDL](https://github.com/spotdl/spotify-downloader). Pegas un enlace de
Spotify (canción, álbum, playlist o artista) o escribes el nombre de una
canción, eliges carpeta, formato y calidad, y pulsas **Descargar**.

- Lista de canciones con el estado de cada una (buscando, descargando %, lista, error).
- Barra de progreso general ("3 de 12").
- Tema oscuro y claro (botón **Tema**).
- Opción de crear una carpeta por álbum/playlist.
- Recuerda tus preferencias (carpeta, formato, calidad).
- Opciones avanzadas: archivo de cookies de YouTube y volver a descargar canciones existentes.
- FFmpeg y Deno ya van incluidos: no hay que instalar Python ni nada más.

## Si YouTube dice "confirma que no eres un robot"

Pasa a veces con VPN o redes compartidas. Prueba sin VPN o espera unos minutos.
Si sigue pasando, instala una extensión de navegador que exporte cookies en
formato `cookies.txt` (por ejemplo "Get cookies.txt LOCALLY"), entra a
youtube.com con tu cuenta, exporta las cookies y elige ese archivo en
**Opciones avanzadas → Cookies**.

## Para el usuario final

1. Ve a la pestaña **Releases** del repositorio (o a **Actions → Build Windows installer → Artifacts**).
2. Descarga `Deanp3-Setup.exe` y ejecútalo.
3. Abre "Deanp3" desde el escritorio o el menú Inicio.

También hay una versión portátil (`Deanp3-portable.zip`): descomprímela
y ejecuta `Deanp3.exe`.

> Windows SmartScreen puede avisar de que la app no está firmada: pulsa
> "Más información" → "Ejecutar de todas formas".

## Cómo se genera el instalador

El workflow `.github/workflows/build-windows.yml` se ejecuta en un runner de
Windows en cada push que toca esta carpeta (o manualmente desde Actions):

1. Instala `spotdl` y `pyinstaller`.
2. Descarga FFmpeg.
3. Empaqueta `app.py` con PyInstaller en `Deanp3.exe`.
4. Crea el instalador con Inno Setup (`installer.iss`).
5. Publica el instalador y el zip portátil como artefactos y como release.

Para publicar una versión "oficial", crea una etiqueta: `git tag v1.0.0 && git push origin v1.0.0`.

## Ejecutar desde el código (desarrollo)

```bash
pip install -r requirements.txt
python app.py
```

## Aviso legal

spotDL busca cada canción en YouTube Music y descarga el audio desde ahí;
Spotify solo se usa para obtener los metadatos. Úsalo solo con contenido que
tengas derecho a descargar y respetando los derechos de autor y las leyes de tu país.
