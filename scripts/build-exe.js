// Empaqueta SimClínica IA como un solo ejecutable con Node.js incluido (Node "Single Executable Applications").
// Uso: npm run build:exe                     → dist/SimClinica-IA.exe (Windows x64)
//      node scripts/build-exe.js linux-x64   → dist/SimClinica-IA-linux (para probar en Linux)
//
// Se puede generar desde cualquier sistema: descarga el binario oficial de Node (misma versión que la
// que corre este script, verificado con SHA-256) e inyecta la app con `postject`.

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const CACHE = path.join(DIST, "cache");
const VERSION = process.version; // el blob SEA solo es válido para la misma versión de Node
const TARGET = process.argv[2] || "win-x64";
const TARGETS = {
  "win-x64": { archive: "win-x64/node.exe", output: "SimClinica-IA.exe" },
  "linux-x64": { archive: `node-${VERSION}-linux-x64.tar.xz`, inner: `node-${VERSION}-linux-x64/bin/node`, output: "SimClinica-IA-linux" },
};
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

if (!TARGETS[TARGET]) {
  console.error(`Destino no soportado: ${TARGET}. Opciones: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

async function download(url, dest) {
  if (fs.existsSync(dest)) return;
  console.log(`Descargando ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar ${url} (${res.status})`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// El node.exe oficial viene firmado (Authenticode). Inyectar la app rompe esa firma, y Windows desconfía
// más de una firma corrupta que de un ejecutable sin firma, así que se quita antes (equivale a
// `signtool remove /s`): se vacía la entrada "Certificate Table" del encabezado PE y se recorta el certificado.
function stripPeSignature(file) {
  const buf = fs.readFileSync(file);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error("node.exe no tiene un encabezado PE válido");
  const optional = pe + 24;
  const magic = buf.readUInt16LE(optional);
  const dirs = optional + (magic === 0x20b ? 112 : 96); // PE32+ o PE32
  const security = dirs + 4 * 8; // IMAGE_DIRECTORY_ENTRY_SECURITY
  const offset = buf.readUInt32LE(security);
  const size = buf.readUInt32LE(security + 4);
  if (!offset || !size) return false;
  if (offset + size !== buf.length) throw new Error("El certificado no está al final de node.exe; no se puede quitar.");
  buf.writeUInt32LE(0, security);
  buf.writeUInt32LE(0, security + 4);
  fs.writeFileSync(file, buf.subarray(0, offset));
  return true;
}

function listFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.posix.join(dir, e.name)) : [path.posix.join(dir, e.name)]
  );
}

(async () => {
  const t = TARGETS[TARGET];
  fs.mkdirSync(CACHE, { recursive: true });

  // 1. Binario oficial de Node para el destino, verificado contra SHASUMS256.txt.
  const base = `https://nodejs.org/dist/${VERSION}`;
  const sums = path.join(CACHE, `SHASUMS256-${VERSION}.txt`);
  await download(`${base}/SHASUMS256.txt`, sums);
  const archive = path.join(CACHE, `${VERSION}-${t.archive.replace(/\//g, "-")}`);
  await download(`${base}/${t.archive}`, archive);
  const expected = fs.readFileSync(sums, "utf8").split("\n").find((l) => l.endsWith(`  ${t.archive}`))?.split(" ")[0];
  const actual = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  if (!expected || expected !== actual) throw new Error(`La suma SHA-256 de ${t.archive} no coincide; borra dist/cache y reintenta.`);

  const out = path.join(DIST, t.output);
  if (t.inner) {
    execFileSync("tar", ["-xJf", archive, "-C", CACHE, t.inner]);
    fs.copyFileSync(path.join(CACHE, t.inner), out);
  } else {
    fs.copyFileSync(archive, out);
    if (stripPeSignature(out)) console.log("Firma digital de node.exe retirada (se invalidaría al inyectar la app).");
  }
  fs.chmodSync(out, 0o755);

  // 2. Blob con server.js y los archivos de la app como assets. Sin code cache ni snapshot para que
  //    el blob sirva en otro sistema operativo.
  const assets = Object.fromEntries([...listFiles("public"), ...listFiles("data")].map((f) => [f, path.join(ROOT, f)]));
  const config = path.join(DIST, "sea-config.json");
  const blob = path.join(DIST, "sea-prep.blob");
  fs.writeFileSync(
    config,
    JSON.stringify(
      { main: path.join(ROOT, "server.js"), output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets },
      null,
      2
    )
  );
  execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "inherit" });

  // 3. Inyectar el blob en el binario de Node.
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(npx, ["--yes", "postject@1.0.0-alpha.6", out, "NODE_SEA_BLOB", blob, "--sentinel-fuse", FUSE], { stdio: "inherit" });

  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(0);
  console.log(`\n✓ ${path.relative(ROOT, out)} (${mb} MB, Node ${VERSION}, ${Object.keys(assets).length} archivos incluidos)`);
})().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
