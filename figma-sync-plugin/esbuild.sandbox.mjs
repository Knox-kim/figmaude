import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const minify = process.argv.includes("--minify");

const ctx = await esbuild.context({
  entryPoints: ["src/sandbox/controller.ts"],
  bundle: true,
  outfile: "dist/code.js",
  format: "esm",
  target: "es2022",
  minify,
  sourcemap: false,
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["import"],
});

if (watch) {
  await ctx.watch();
  console.log("[esbuild] watching for sandbox changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
