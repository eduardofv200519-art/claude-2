"""
Deanp3 - interfaz gráfica para spotDL.

Pega un enlace de Spotify (canción, álbum, playlist o artista) o escribe
el nombre de una canción, elige la carpeta y pulsa "Descargar".
"""

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

APP_NAME = "Deanp3"
APP_VERSION = "1.2.0"
CLI_FLAG = "--spotdl-cli"
EVENT_PREFIX = "@@EVT "
FORMATS = ["mp3", "m4a", "flac", "opus", "ogg", "wav"]
QUALITIES = {
    "Automática": "auto",
    "Alta (320 kbps)": "320k",
    "Media (192 kbps)": "192k",
    "Baja (128 kbps)": "128k",
}
STATUS_ES = {
    "Searching for song": "Buscando…",
    "Getting audio meta": "Preparando…",
    "Downloading": "Descargando",
    "Converting": "Convirtiendo",
    "Embedding metadata": "Guardando datos",
    "Done": "Lista",
    "Skipped": "Ya estaba",
    "Error": "Error",
}
BOT_MARKERS = ("not a bot", "Sign in to confirm", "YT-DLP download error")
BOT_HINT = (
    "YouTube no dejó descargar el audio (a veces pide confirmar que no eres un robot).\n\n"
    "Suele pasar con VPN o redes compartidas. Prueba sin VPN, espera unos minutos, "
    "o en \"Opciones avanzadas\" carga un archivo cookies.txt exportado de tu "
    "navegador con la sesión de YouTube iniciada."
)


# --------------------------------------------------------------------------
# Modo línea de comandos (proceso hijo que ejecuta spotDL)
# --------------------------------------------------------------------------
def emit(event):
    print(EVENT_PREFIX + json.dumps(event, ensure_ascii=False), flush=True)


def install_progress_events():
    """Hace que spotDL emita el progreso de cada canción como JSON por stdout."""
    from spotdl.download import progress_handler as ph

    original_init = ph.ProgressHandler.__init__
    original_set_count = ph.ProgressHandler.set_song_count

    def on_update(tracker, message):
        emit({
            "type": "song",
            "id": tracker.song.url or tracker.song_name,
            "name": tracker.song_name,
            "status": message,
            "progress": int(tracker.progress),
        })

    def patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.update_callback = on_update

    def patched_set_count(self, count):
        original_set_count(self, count)
        emit({"type": "total", "count": count})

    ph.ProgressHandler.__init__ = patched_init
    ph.ProgressHandler.set_song_count = patched_set_count


def run_spotdl_cli(args):
    """Ejecuta spotDL en este mismo proceso (usado por el .exe empaquetado)."""
    # En el .exe sin consola, stdout/stderr pueden ser None: usa el pipe heredado.
    for name, fd in (("stdout", 1), ("stderr", 2)):
        if getattr(sys, name) is None:
            try:
                setattr(sys, name, open(fd, "w", encoding="utf-8", errors="replace", closefd=False))
            except OSError:
                setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))

    from spotdl.console import console_entry_point

    if args and args[0] == "download":
        install_progress_events()
    sys.argv = ["spotdl", *args]
    console_entry_point()


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------
def app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent


def resource(name):
    base = Path(getattr(sys, "_MEIPASS", app_dir()))
    for p in (base / name, app_dir() / name):
        if p.is_file():
            return p
    return None


def spotdl_command(args):
    if getattr(sys, "frozen", False):
        return [sys.executable, CLI_FLAG, *args]
    return [sys.executable, str(Path(__file__).resolve()), CLI_FLAG, *args]


def exe_name(name):
    return name + ".exe" if os.name == "nt" else name


def find_ffmpeg():
    """Busca ffmpeg junto a la app, luego en el PATH, luego en ~/.spotdl."""
    exe = exe_name("ffmpeg")
    for c in (app_dir() / "ffmpeg" / exe, app_dir() / exe):
        if c.is_file():
            return str(c)
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    local = Path.home() / ".spotdl" / exe
    return str(local) if local.is_file() else None


def bundled_deno_dir():
    """Carpeta con deno incluido (yt-dlp lo necesita para YouTube)."""
    for d in (app_dir() / "deno", app_dir()):
        if (d / exe_name("deno")).is_file():
            return str(d)
    return None


def has_deno():
    return bool(
        bundled_deno_dir()
        or shutil.which("deno")
        or (Path.home() / ".spotdl" / exe_name("deno")).is_file()
    )


def config_path():
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    return Path(base) / "Deanp3" / "config.json"


def load_config():
    # Lee también la configuración de la versión anterior ("DescargadorMusica").
    for path in (config_path(), config_path().parent.parent / "DescargadorMusica" / "config.json"):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
    return {}


def save_config(data):
    try:
        path = config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def default_music_dir():
    music = Path.home() / "Music"
    return str(music if music.is_dir() else Path.home())


def split_queries(text):
    """Varios enlaces separados por espacios/saltos de línea, o una búsqueda."""
    text = text.strip()
    parts = text.split()
    if parts and all(p.startswith(("http://", "https://")) for p in parts):
        return parts
    return [text] if text else []


def kill_tree(proc):
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    else:
        proc.terminate()


# --------------------------------------------------------------------------
# Interfaz
# --------------------------------------------------------------------------
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_NAME)
        w = min(840, self.winfo_screenwidth() - 40)
        h = min(720, self.winfo_screenheight() - 110)
        x = max(0, (self.winfo_screenwidth() - w) // 2)
        y = max(0, (self.winfo_screenheight() - h - 60) // 2)
        self.geometry(f"{w}x{h}+{x}+{y}")
        self.minsize(640, 500)

        icon = resource("icon.ico")
        if icon and os.name == "nt":
            try:
                self.iconbitmap(default=str(icon))
            except tk.TclError:
                pass
        icon_png = resource("icon.png")
        if icon_png:
            try:
                self._icon_img = tk.PhotoImage(file=str(icon_png))
                self.iconphoto(True, self._icon_img)
            except tk.TclError:
                pass

        cfg = load_config()
        self.theme = cfg.get("theme", "dark")
        self._apply_theme()

        self.process = None
        self.cancelled = False
        self.events = queue.Queue()
        self.rows = {}
        self.total = 0
        self.counts = {"ok": 0, "skip": 0, "err": 0}
        self.last_error = ""
        self.youtube_blocked = False

        self.query_var = tk.StringVar()
        folder = cfg.get("folder") or default_music_dir()
        self.folder_var = tk.StringVar(value=folder)
        self.format_var = tk.StringVar(value=cfg.get("format", "mp3"))
        quality = cfg.get("quality", "Automática")
        self.quality_var = tk.StringVar(value=quality if quality in QUALITIES else "Automática")
        self.subfolder_var = tk.BooleanVar(value=cfg.get("subfolder", True))
        self.overwrite_var = tk.BooleanVar(value=cfg.get("overwrite", False))
        self.cookies_var = tk.StringVar(value=cfg.get("cookies", ""))
        self.status_var = tk.StringVar(value="Listo para descargar.")
        self.count_var = tk.StringVar(value="")
        self.advanced_open = tk.BooleanVar(value=False)
        self.log_open = tk.BooleanVar(value=False)

        self._build_ui()
        self.after(100, self._drain_events)

        # Modo de prueba automática (lo usa el build en la nube).
        autotest = os.environ.get("DEANP3_AUTOTEST")
        if autotest:
            self.after(2000, lambda: (self.query_var.set(autotest), self.start_download()))
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ------------------------------------------------------------ tema
    def _apply_theme(self):
        try:
            import sv_ttk

            sv_ttk.set_theme(self.theme)
        except Exception:  # noqa: BLE001 - si falla, se usa el tema por defecto
            pass
        style = ttk.Style(self)
        base = ("Segoe UI", 10) if os.name == "nt" else ("TkDefaultFont", 10)
        style.configure("Title.TLabel", font=(base[0], 20, "bold"))
        style.configure("Sub.TLabel", font=(base[0], 10), foreground="#8a8a8a")
        style.configure("Hint.TLabel", font=(base[0], 9), foreground="#8a8a8a")
        style.configure("Big.Accent.TButton", font=(base[0], 11, "bold"), padding=(18, 8))
        style.configure("Treeview", rowheight=28)
        if hasattr(self, "log"):
            self._style_log()

    def _toggle_theme(self):
        self.theme = "light" if self.theme == "dark" else "dark"
        self._apply_theme()
        self._style_tree()
        self._save()

    # ------------------------------------------------------------- UI
    def _build_ui(self):
        root = ttk.Frame(self, padding=(20, 16))
        root.pack(fill="both", expand=True)
        root.columnconfigure(0, weight=1)

        # Encabezado
        header = ttk.Frame(root)
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        ttk.Label(header, text="🎵 " + APP_NAME, style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(
            header,
            text="Pega un enlace de Spotify (canción, álbum, playlist o artista) o escribe el nombre de una canción.",
            style="Sub.TLabel",
        ).grid(row=1, column=0, sticky="w", pady=(2, 0))
        ttk.Button(header, text="◐ Tema", command=self._toggle_theme).grid(row=0, column=1, rowspan=2, sticky="e")

        # Búsqueda
        search = ttk.Frame(root)
        search.grid(row=1, column=0, sticky="ew", pady=(16, 4))
        search.columnconfigure(0, weight=1)
        self.entry = ttk.Entry(search, textvariable=self.query_var, font=("Segoe UI", 11))
        self.entry.grid(row=0, column=0, sticky="ew", ipady=4)
        self.entry.bind("<Return>", lambda _e: self.start_download())
        self.entry.focus()
        ttk.Button(search, text="Pegar", command=self._paste).grid(row=0, column=1, padx=(8, 0))
        self.download_btn = ttk.Button(
            search, text="⬇  Descargar", style="Big.Accent.TButton", command=self.start_download
        )
        self.download_btn.grid(row=0, column=2, padx=(8, 0))
        ttk.Label(
            search,
            text="Ejemplos:  https://open.spotify.com/playlist/…    ·    Queen - Bohemian Rhapsody",
            style="Hint.TLabel",
        ).grid(row=1, column=0, columnspan=3, sticky="w", pady=(4, 0))

        # Opciones
        opts = ttk.LabelFrame(root, text=" Opciones ", padding=(12, 8))
        opts.grid(row=2, column=0, sticky="ew", pady=(10, 4))
        opts.columnconfigure(1, weight=1)

        ttk.Label(opts, text="Guardar en").grid(row=0, column=0, sticky="w")
        ttk.Entry(opts, textvariable=self.folder_var).grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Button(opts, text="Elegir…", command=self._choose_folder).grid(row=0, column=2)
        ttk.Button(opts, text="Abrir", command=self._open_folder).grid(row=0, column=3, padx=(6, 0))

        row2 = ttk.Frame(opts)
        row2.grid(row=1, column=0, columnspan=4, sticky="w", pady=(8, 0))
        ttk.Label(row2, text="Formato").pack(side="left")
        ttk.Combobox(
            row2, textvariable=self.format_var, values=FORMATS, state="readonly", width=7
        ).pack(side="left", padx=(8, 20))
        ttk.Label(row2, text="Calidad").pack(side="left")
        ttk.Combobox(
            row2, textvariable=self.quality_var, values=list(QUALITIES), state="readonly", width=16
        ).pack(side="left", padx=(8, 20))
        ttk.Checkbutton(
            row2, text="Carpeta por álbum/playlist", variable=self.subfolder_var
        ).pack(side="left")

        ttk.Checkbutton(
            opts,
            text="Opciones avanzadas",
            variable=self.advanced_open,
            command=self._toggle_advanced,
            style="Toggle.TButton",
        ).grid(row=2, column=0, columnspan=4, sticky="w", pady=(8, 0))
        self.advanced = ttk.Frame(opts)
        self.advanced.columnconfigure(1, weight=1)
        ttk.Label(self.advanced, text="Cookies (opcional)").grid(row=0, column=0, sticky="w")
        ttk.Entry(self.advanced, textvariable=self.cookies_var).grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Button(self.advanced, text="Elegir…", command=self._choose_cookies).grid(row=0, column=2)
        ttk.Button(self.advanced, text="Quitar", command=lambda: self.cookies_var.set("")).grid(
            row=0, column=3, padx=(6, 0)
        )
        ttk.Label(
            self.advanced,
            text="Archivo cookies.txt de YouTube. Solo hace falta si YouTube pide confirmar que no eres un robot.",
            style="Hint.TLabel",
        ).grid(row=1, column=0, columnspan=4, sticky="w", pady=(2, 4))
        ttk.Checkbutton(
            self.advanced, text="Volver a descargar canciones que ya existen", variable=self.overwrite_var
        ).grid(row=2, column=0, columnspan=4, sticky="w")

        # Progreso general
        prog = ttk.Frame(root)
        prog.grid(row=3, column=0, sticky="ew", pady=(12, 4))
        prog.columnconfigure(0, weight=1)
        self.progress = ttk.Progressbar(prog, mode="determinate", maximum=100)
        self.progress.grid(row=0, column=0, sticky="ew")
        ttk.Label(prog, textvariable=self.count_var, anchor="e").grid(row=0, column=1, padx=(10, 0))

        # Lista de canciones
        table = ttk.Frame(root)
        table.grid(row=4, column=0, sticky="nsew", pady=(6, 4))
        root.rowconfigure(4, weight=1)
        table.columnconfigure(0, weight=1)
        table.rowconfigure(0, weight=1)
        self.tree = ttk.Treeview(table, columns=("song", "status"), show="headings", selectmode="browse")
        self.tree.heading("song", text="Canción", anchor="w")
        self.tree.heading("status", text="Estado", anchor="w")
        self.tree.column("song", anchor="w", stretch=True, width=480)
        self.tree.column("status", anchor="w", stretch=False, width=170)
        tscroll = ttk.Scrollbar(table, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=tscroll.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        tscroll.grid(row=0, column=1, sticky="ns")
        self.empty_hint = ttk.Label(
            table, text="Aquí aparecerán las canciones que descargues.", style="Hint.TLabel"
        )
        self.empty_hint.place(relx=0.5, rely=0.55, anchor="center")
        self._style_tree()

        # Registro
        bottom = ttk.Frame(root)
        bottom.grid(row=5, column=0, sticky="ew", pady=(6, 0))
        bottom.columnconfigure(1, weight=1)
        ttk.Checkbutton(
            bottom, text="Ver registro", variable=self.log_open, command=self._toggle_log, style="Toggle.TButton"
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(bottom, textvariable=self.status_var, anchor="w").grid(row=0, column=1, sticky="ew", padx=12)
        self.cancel_btn = ttk.Button(bottom, text="Cancelar", command=self.cancel, state="disabled")
        self.cancel_btn.grid(row=0, column=2, sticky="e")

        self.log_frame = ttk.Frame(root)
        self.log_frame.columnconfigure(0, weight=1)
        self.log = tk.Text(self.log_frame, height=8, wrap="word", state="disabled", relief="flat",
                           font=("Consolas", 9) if os.name == "nt" else ("TkFixedFont", 9))
        lscroll = ttk.Scrollbar(self.log_frame, command=self.log.yview)
        self.log.configure(yscrollcommand=lscroll.set)
        self.log.grid(row=0, column=0, sticky="nsew")
        lscroll.grid(row=0, column=1, sticky="ns")
        self._style_log()
        self.root_frame = root

        ttk.Label(root, text=f"v{APP_VERSION} · basado en spotDL", style="Hint.TLabel").grid(
            row=7, column=0, sticky="e", pady=(6, 0)
        )

    def _style_tree(self):
        dark = self.theme == "dark"
        self.tree.tag_configure("done", foreground="#4caf50" if dark else "#2e7d32")
        self.tree.tag_configure("skip", foreground="#9e9e9e" if dark else "#757575")
        self.tree.tag_configure("error", foreground="#ef5350" if dark else "#c62828")
        self.tree.tag_configure("active", foreground="#57a6ff" if dark else "#1565c0")

    def _style_log(self):
        dark = self.theme == "dark"
        self.log.configure(
            background="#1c1c1c" if dark else "#f6f6f6",
            foreground="#d0d0d0" if dark else "#202020",
            insertbackground="#d0d0d0" if dark else "#202020",
        )

    def _toggle_advanced(self):
        if self.advanced_open.get():
            self.advanced.grid(row=3, column=0, columnspan=4, sticky="ew", pady=(8, 0))
        else:
            self.advanced.grid_remove()

    def _toggle_log(self):
        if self.log_open.get():
            self.log_frame.grid(row=6, column=0, sticky="nsew", pady=(6, 0))
        else:
            self.log_frame.grid_remove()

    def _paste(self):
        try:
            self.query_var.set(self.clipboard_get().strip())
        except tk.TclError:
            pass

    def _choose_folder(self):
        folder = filedialog.askdirectory(initialdir=self.folder_var.get())
        if folder:
            self.folder_var.set(folder)
            self._save()

    def _choose_cookies(self):
        path = filedialog.askopenfilename(
            title="Elegir cookies.txt", filetypes=[("Cookies", "*.txt"), ("Todos", "*.*")]
        )
        if path:
            self.cookies_var.set(path)

    def _open_folder(self):
        folder = self.folder_var.get()
        if not os.path.isdir(folder):
            return
        if os.name == "nt":
            os.startfile(folder)  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", folder])
        else:
            subprocess.Popen(["xdg-open", folder])

    def _save(self):
        save_config({
            "folder": self.folder_var.get(),
            "format": self.format_var.get(),
            "quality": self.quality_var.get(),
            "subfolder": self.subfolder_var.get(),
            "overwrite": self.overwrite_var.get(),
            "cookies": self.cookies_var.get(),
            "theme": self.theme,
        })

    def _write_log(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        if int(self.log.index("end-1c").split(".")[0]) > 3000:
            self.log.delete("1.0", "500.0")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _set_running(self, running):
        self.download_btn.configure(state="disabled" if running else "normal")
        self.cancel_btn.configure(state="normal" if running else "disabled")
        if running:
            self.progress.configure(mode="indeterminate")
            self.progress.start(12)
        else:
            self.progress.stop()
            self.progress.configure(mode="determinate")

    # ------------------------------------------------------- descarga
    def start_download(self):
        if self.process:
            return
        queries = split_queries(self.query_var.get())
        folder = self.folder_var.get().strip()
        if not queries:
            messagebox.showinfo(APP_NAME, "Escribe un enlace de Spotify o el nombre de una canción.")
            self.entry.focus()
            return
        try:
            os.makedirs(folder, exist_ok=True)
        except OSError as exc:
            messagebox.showerror(APP_NAME, f"No se pudo usar la carpeta:\n{exc}")
            return
        cookies = self.cookies_var.get().strip()
        if cookies and not os.path.isfile(cookies):
            messagebox.showerror(APP_NAME, "No se encuentra el archivo de cookies elegido.")
            return
        self._save()

        self.tree.delete(*self.tree.get_children())
        self.empty_hint.place(relx=0.5, rely=0.55, anchor="center")
        self.rows.clear()
        self.total = 0
        self.counts = {"ok": 0, "skip": 0, "err": 0}
        self.last_error = ""
        self.youtube_blocked = False
        self.cancelled = False
        self.progress["value"] = 0
        self.count_var.set("")
        self._set_running(True)
        self.status_var.set("Buscando canciones…")
        self._write_log("▶ " + " ".join(queries))

        settings = {
            "folder": folder,
            "format": self.format_var.get(),
            "bitrate": QUALITIES.get(self.quality_var.get(), "auto"),
            "subfolder": self.subfolder_var.get(),
            "overwrite": self.overwrite_var.get(),
            "cookies": cookies,
        }
        threading.Thread(target=self._worker, args=(queries, settings), daemon=True).start()

    def _run(self, args):
        env = dict(os.environ, PYTHONIOENCODING="utf-8", NO_COLOR="1", TERM="dumb", COLUMNS="200")
        deno_dir = bundled_deno_dir()
        if deno_dir:
            env["PATH"] = deno_dir + os.pathsep + env.get("PATH", "")
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.process = subprocess.Popen(
            spotdl_command(args),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            creationflags=flags,
        )
        for line in self.process.stdout:
            line = line.rstrip()
            if not line:
                continue
            if line.startswith(EVENT_PREFIX):
                try:
                    self.events.put(json.loads(line[len(EVENT_PREFIX):]))
                    continue
                except ValueError:
                    pass
            self.events.put({"type": "log", "text": line})
        code = self.process.wait()
        self.process = None
        return code

    def _worker(self, queries, s):
        try:
            ffmpeg = find_ffmpeg()
            if not ffmpeg:
                self.events.put({"type": "status", "text": "Preparando FFmpeg (solo la primera vez)…"})
                self._run(["--download-ffmpeg"])
                ffmpeg = find_ffmpeg()
            if not ffmpeg:
                self.events.put({"type": "done", "code": -1, "error": "No se pudo obtener FFmpeg."})
                return
            if not has_deno():
                self.events.put({"type": "status", "text": "Preparando Deno (solo la primera vez)…"})
                self._run(["--download-deno"])
            if self.cancelled:
                return

            name = "{artists} - {title}.{output-ext}"
            base = Path(s["folder"]).as_posix().rstrip("/")
            # Si la canción no viene de un álbum/playlist, spotDL deja {list-name} vacío.
            template = f"{base}/{{list-name}}/{name}" if s["subfolder"] else f"{base}/{name}"
            args = [
                "download", *queries,
                "--output", template,
                "--format", s["format"],
                "--bitrate", s["bitrate"],
                "--ffmpeg", ffmpeg,
                "--overwrite", "force" if s["overwrite"] else "skip",
                "--simple-tui",
                "--log-level", "INFO",
            ]
            if s["cookies"]:
                args += ["--cookie-file", s["cookies"]]
            code = self._run(args)
            self.events.put({"type": "done", "code": code})
        except Exception as exc:  # noqa: BLE001
            self.process = None
            self.events.put({"type": "done", "code": -1, "error": str(exc)})

    def cancel(self):
        self.cancelled = True
        proc = self.process
        if proc:
            kill_tree(proc)
        self.status_var.set("Cancelando…")

    # ------------------------------------------------------- eventos
    def _drain_events(self):
        try:
            for _ in range(500):
                self._handle(self.events.get_nowait())
        except queue.Empty:
            pass
        self.after(100, self._drain_events)

    def _handle(self, ev):
        kind = ev.get("type")
        if kind == "log":
            text = ev["text"]
            self._write_log(text)
            if any(m in text for m in BOT_MARKERS):
                self.youtube_blocked = True
            if re.match(r"\s*\w*(Error|Exception)\b.*:", text):
                self.last_error = text.strip()
            elif self.last_error and text.startswith(" ") and len(self.last_error) < 300:
                self.last_error += " " + text.strip()
        elif kind == "status":
            self.status_var.set(ev["text"])
            self._write_log(ev["text"])
        elif kind == "total":
            self.total += ev["count"]
            self._update_overall()
        elif kind == "song":
            self._update_song(ev)
        elif kind == "done":
            self._finish(ev)

    def _update_song(self, ev):
        sid, status = ev["id"], ev["status"]
        label = STATUS_ES.get(status, status)
        if status in ("Downloading", "Converting") and 0 < ev["progress"] < 100:
            label = f"{label} {ev['progress']}%"
        tag = {"Done": "done", "Skipped": "skip", "Error": "error"}.get(status, "active")
        icon = {"done": "✔", "skip": "•", "error": "✖"}.get(tag, "⟳")
        values = (ev["name"], f"{icon}  {label}")

        row = self.rows.get(sid)
        if row is None:
            self.empty_hint.place_forget()
            row = self.tree.insert("", "end", values=values, tags=(tag,))
            self.rows[sid] = {"iid": row, "final": None}
        else:
            self.tree.item(row["iid"], values=values, tags=(tag,))
        entry = self.rows[sid]
        if tag in ("done", "skip", "error") and entry["final"] is None:
            entry["final"] = tag
            self.counts[{"done": "ok", "skip": "skip", "error": "err"}[tag]] += 1
            self._update_overall()
        if tag == "active":
            self.tree.see(entry["iid"])
            self.status_var.set(f"{label.rstrip('…')}: {ev['name']}")

    def _update_overall(self):
        finished = sum(self.counts.values())
        total = max(self.total, len(self.rows), 1)
        if self.total:
            if str(self.progress["mode"]) != "determinate":
                self.progress.stop()
                self.progress.configure(mode="determinate")
            self.progress["value"] = finished * 100 / total
            self.count_var.set(f"{finished} de {total}")

    def _finish(self, ev):
        self._set_running(False)
        ok, skip, err = self.counts["ok"], self.counts["skip"], self.counts["err"]
        if self.cancelled:
            self.status_var.set(f"Cancelado. {ok} descargada(s).")
            return
        if ev.get("error"):
            self.status_var.set("Error: " + ev["error"])
            messagebox.showerror(APP_NAME, ev["error"])
            return
        self.progress["value"] = 100 if (ok or skip or err) else 0

        parts = []
        if ok:
            parts.append(f"{ok} descargada(s)")
        if skip:
            parts.append(f"{skip} ya existía(n)")
        if err:
            parts.append(f"{err} con error")
        summary = ", ".join(parts) or "No se descargó nada"
        self.status_var.set(summary + ".")

        bot = self.youtube_blocked
        if err or not (ok or skip):
            if bot:
                detail = BOT_HINT
            else:
                detail = "Revisa que el enlace sea correcto y que tengas conexión a internet."
                if self.last_error:
                    detail += "\n\nDetalle: " + self.last_error[-300:]
                detail += "\n\nAbre \"Ver registro\" para ver más."
            messagebox.showwarning(APP_NAME, f"{summary}.\n\n{detail}")
        else:
            self.bell()

    def _on_close(self):
        if self.process:
            if not messagebox.askyesno(APP_NAME, "Hay una descarga en curso. ¿Salir de todos modos?"):
                return
            self.cancelled = True
            kill_tree(self.process)
        self._save()
        self.destroy()


def enable_dpi_awareness():
    if os.name == "nt":
        try:
            import ctypes

            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:  # noqa: BLE001
            pass


def main():
    if len(sys.argv) > 1 and sys.argv[1] == CLI_FLAG:
        run_spotdl_cli(sys.argv[2:])
        return
    enable_dpi_awareness()
    App().mainloop()


if __name__ == "__main__":
    if getattr(sys, "frozen", False):
        import multiprocessing

        multiprocessing.freeze_support()
    main()
