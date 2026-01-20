import esbuild from "esbuild";

const isProd = process.argv.includes("production");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "node",
  target: "es2018",
  outfile: "main.js",
  sourcemap: isProd ? false : "inline",
  minify: isProd
});

if (isProd) {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("[obsidian-llm-helper] build complete");
} else {
  await ctx.watch();
  console.log("[obsidian-llm-helper] watching...");
}
