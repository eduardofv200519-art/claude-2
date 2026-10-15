# Descargador de Música (interfaz para spotDL)

App de escritorio para Windows con interfaz gráfica, basada en
[spotDL](https://github.com/spotdl/spotify-downloader). Pegas un enlace de
Spotify (canción, álbum, playlist o artista) o escribes el nombre de una
canción, eliges carpeta, formato y calidad, y pulsas **Descargar**.

FFmpeg ya va incluido: el usuario no necesita instalar Python ni nada más.

## Para el usuario final

1. Ve a la pestaña **Releases** del repositorio (o a **Actions → Build Windows installer → Artifacts**).
2. Descarga `DescargadorMusica-Setup.exe` y ejecútalo.
3. Abre "Descargador de Música" desde el escritorio o el menú Inicio.

También hay una versión portátil (`DescargadorMusica-portable.zip`): descomprímela
y ejecuta `DescargadorMusica.exe`.

> Windows SmartScreen puede avisar de que la app no está firmada: pulsa
> "Más información" → "Ejecutar de todas formas".

## Cómo se genera el instalador

El workflow `.github/workflows/build-windows.yml` se ejecuta en un runner de
Windows en cada push que toca esta carpeta (o manualmente desde Actions):

1. Instala `spotdl` y `pyinstaller`.
2. Descarga FFmpeg.
3. Empaqueta `app.py` con PyInstaller en `DescargadorMusica.exe`.
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
