import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const baseOpts = {
  bundle: true,
  format: "esm",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: prod,
};

const entryPoints = {
  background: "src/background.ts",
  popup: "src/popup.ts",
  offscreen: "src/offscreen.ts",
};

for (const [name, entry] of Object.entries(entryPoints)) {
  await esbuild.build({
    ...baseOpts,
    entryPoints: [entry],
    outfile: `${name}.js`,
  });
}

console.log("Built background.js, popup.js, offscreen.js");
