"""
Descargador de Música - interfaz gráfica para spotDL.

Pega un enlace de Spotify (canción, álbum, playlist o artista) o escribe
el nombre de una canción, elige la carpeta y pulsa "Descargar".
"""

import os
import queue
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

APP_NAME = "Descargador de Música"
CLI_FLAG = "--spotdl-cli"
FORMATS = ["mp3", "m4a", "flac", "opus", "ogg", "wav"]
BITRATES = ["auto", "128k", "192k", "256k", "320k"]


def run_spotdl_cli(args):
    """Ejecuta spotDL en este mismo proceso (usado por el .exe empaquetado)."""
    from spotdl.console import console_entry_point

    # En el .exe sin consola, stdout/stderr pueden ser None: usa el pipe heredado.
    for name, fd in (("stdout", 1), ("stderr", 2)):
        if getattr(sys, name) is None:
            try:
                setattr(sys, name, open(fd, "w", encoding="utf-8", errors="replace", closefd=False))
            except OSError:
                setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))

    sys.argv = ["spotdl", *args]
    console_entry_point()


def app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent


def spotdl_command(args):
    if getattr(sys, "frozen", False):
        return [sys.executable, CLI_FLAG, *args]
    return [sys.executable, str(Path(__file__).resolve()), CLI_FLAG, *args]


def find_ffmpeg():
    """Busca ffmpeg junto a la app, luego en el PATH, luego en ~/.spotdl."""
    exe = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    candidates = [
        app_dir() / "ffmpeg" / exe,
        app_dir() / exe,
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    spotdl_ffmpeg = Path.home() / ".spotdl" / exe
    if spotdl_ffmpeg.is_file():
        return str(spotdl_ffmpeg)
    return None


def bundled_deno_dir():
    """Carpeta con deno.exe incluido (yt-dlp lo necesita para YouTube)."""
    exe = "deno.exe" if os.name == "nt" else "deno"
    for d in (app_dir() / "deno", app_dir()):
        if (d / exe).is_file():
            return str(d)
    return None


def has_deno():
    exe = "deno.exe" if os.name == "nt" else "deno"
    return bool(
        bundled_deno_dir()
        or shutil.which("deno")
        or (Path.home() / ".spotdl" / exe).is_file()
    )


def default_music_dir():
    music = Path.home() / "Music"
    return str(music if music.is_dir() else Path.home())


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_NAME)
        self.geometry("720x520")
        self.minsize(560, 420)

        icon = app_dir() / "icon.ico"
        if os.name == "nt" and icon.is_file():
            try:
                self.iconbitmap(str(icon))
            except tk.TclError:
                pass

        self.process = None
        self.lines = queue.Queue()

        self.query_var = tk.StringVar()
        self.folder_var = tk.StringVar(value=default_music_dir())
        self.format_var = tk.StringVar(value="mp3")
        self.bitrate_var = tk.StringVar(value="auto")
        self.status_var = tk.StringVar(value="Listo.")

        self._build_ui()
        self.after(100, self._drain_output)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ---------------------------------------------------------------- UI
    def _build_ui(self):
        pad = {"padx": 10, "pady": 5}
        root = ttk.Frame(self, padding=10)
        root.pack(fill="both", expand=True)
        root.columnconfigure(1, weight=1)

        ttk.Label(root, text=APP_NAME, font=("Segoe UI", 16, "bold")).grid(
            row=0, column=0, columnspan=3, sticky="w", **pad
        )

        ttk.Label(root, text="Enlace o canción:").grid(row=1, column=0, sticky="w", **pad)
        entry = ttk.Entry(root, textvariable=self.query_var)
        entry.grid(row=1, column=1, sticky="ew", **pad)
        entry.focus()
        entry.bind("<Return>", lambda _e: self.start_download())
        ttk.Button(root, text="Pegar", command=self._paste).grid(row=1, column=2, **pad)

        ttk.Label(
            root,
            text="Ej.: https://open.spotify.com/playlist/...  o  \"Artista - Canción\"",
            foreground="gray",
        ).grid(row=2, column=1, sticky="w", padx=10)

        ttk.Label(root, text="Guardar en:").grid(row=3, column=0, sticky="w", **pad)
        ttk.Entry(root, textvariable=self.folder_var).grid(row=3, column=1, sticky="ew", **pad)
        ttk.Button(root, text="Elegir…", command=self._choose_folder).grid(row=3, column=2, **pad)

        opts = ttk.Frame(root)
        opts.grid(row=4, column=0, columnspan=3, sticky="w", **pad)
        ttk.Label(opts, text="Formato:").pack(side="left")
        ttk.Combobox(
            opts, textvariable=self.format_var, values=FORMATS, state="readonly", width=8
        ).pack(side="left", padx=(5, 20))
        ttk.Label(opts, text="Calidad:").pack(side="left")
        ttk.Combobox(
            opts, textvariable=self.bitrate_var, values=BITRATES, state="readonly", width=8
        ).pack(side="left", padx=5)

        buttons = ttk.Frame(root)
        buttons.grid(row=5, column=0, columnspan=3, sticky="ew", **pad)
        self.download_btn = ttk.Button(buttons, text="⬇  Descargar", command=self.start_download)
        self.download_btn.pack(side="left")
        self.cancel_btn = ttk.Button(buttons, text="Cancelar", command=self.cancel, state="disabled")
        self.cancel_btn.pack(side="left", padx=10)
        ttk.Button(buttons, text="Abrir carpeta", command=self._open_folder).pack(side="right")

        self.progress = ttk.Progressbar(root, mode="indeterminate")
        self.progress.grid(row=6, column=0, columnspan=3, sticky="ew", **pad)

        log_frame = ttk.Frame(root)
        log_frame.grid(row=7, column=0, columnspan=3, sticky="nsew", **pad)
        root.rowconfigure(7, weight=1)
        self.log = tk.Text(log_frame, height=12, wrap="word", state="disabled")
        scroll = ttk.Scrollbar(log_frame, command=self.log.yview)
        self.log.configure(yscrollcommand=scroll.set)
        self.log.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        ttk.Label(root, textvariable=self.status_var).grid(
            row=8, column=0, columnspan=3, sticky="w", padx=10
        )

    def _paste(self):
        try:
            self.query_var.set(self.clipboard_get().strip())
        except tk.TclError:
            pass

    def _choose_folder(self):
        folder = filedialog.askdirectory(initialdir=self.folder_var.get())
        if folder:
            self.folder_var.set(folder)

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

    def _write_log(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _set_running(self, running):
        self.download_btn.configure(state="disabled" if running else "normal")
        self.cancel_btn.configure(state="normal" if running else "disabled")
        if running:
            self.progress.start(12)
        else:
            self.progress.stop()

    # ---------------------------------------------------------- download
    def start_download(self):
        if self.process:
            return
        query = self.query_var.get().strip()
        folder = self.folder_var.get().strip()
        if not query:
            messagebox.showwarning(APP_NAME, "Escribe un enlace de Spotify o el nombre de una canción.")
            return
        try:
            os.makedirs(folder, exist_ok=True)
        except OSError as exc:
            messagebox.showerror(APP_NAME, f"No se pudo usar la carpeta:\n{exc}")
            return

        self._set_running(True)
        self.status_var.set("Descargando…")
        self._write_log(f"▶ {query}")
        threading.Thread(target=self._worker, args=(query, folder), daemon=True).start()

    def _run(self, args):
        env = dict(os.environ, PYTHONIOENCODING="utf-8", NO_COLOR="1", TERM="dumb")
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
            if line:
                self.lines.put(("log", line))
        code = self.process.wait()
        self.process = None
        return code

    def _worker(self, query, folder):
        try:
            ffmpeg = find_ffmpeg()
            if not ffmpeg:
                self.lines.put(("log", "FFmpeg no encontrado, descargándolo (solo la primera vez)…"))
                self._run(["--download-ffmpeg"])
                ffmpeg = find_ffmpeg()
            if not ffmpeg:
                self.lines.put(("done", "Error: no se pudo obtener FFmpeg."))
                return

            if not has_deno():
                self.lines.put(("log", "Deno no encontrado, descargándolo (solo la primera vez)…"))
                self._run(["--download-deno"])

            output = str(Path(folder) / "{artists} - {title}.{output-ext}")
            args = [
                "download",
                query,
                "--output", output,
                "--format", self.format_var.get(),
                "--bitrate", self.bitrate_var.get(),
                "--ffmpeg", ffmpeg,
                "--simple-tui",
                "--log-level", "INFO",
            ]
            code = self._run(args)
            if code == 0:
                self.lines.put(("done", "✔ Descarga terminada."))
            else:
                self.lines.put(("done", f"Terminó con errores (código {code})."))
        except Exception as exc:  # noqa: BLE001
            self.process = None
            self.lines.put(("done", f"Error: {exc}"))

    def cancel(self):
        if self.process:
            self.process.terminate()
            self.status_var.set("Cancelado.")

    def _drain_output(self):
        try:
            while True:
                kind, text = self.lines.get_nowait()
                self._write_log(text)
                if kind == "done":
                    self.status_var.set(text)
                    self._set_running(False)
        except queue.Empty:
            pass
        self.after(100, self._drain_output)

    def _on_close(self):
        if self.process:
            if not messagebox.askyesno(APP_NAME, "Hay una descarga en curso. ¿Salir de todos modos?"):
                return
            self.process.terminate()
        self.destroy()


def main():
    if len(sys.argv) > 1 and sys.argv[1] == CLI_FLAG:
        run_spotdl_cli(sys.argv[2:])
        return
    App().mainloop()


if __name__ == "__main__":
    if getattr(sys, "frozen", False):
        import multiprocessing

        multiprocessing.freeze_support()
    main()
