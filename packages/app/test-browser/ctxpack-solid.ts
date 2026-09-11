import { createRequire } from "node:module"

const requirePlugin = createRequire(import.meta.resolve("vite-plugin-solid"))
const babel = requirePlugin("@babel/core") as {
  transformSync(source: string, options: Record<string, unknown>): { code: string }
}

await Bun.plugin({
  name: "ctxpack-real-dialog-solid-test",
  setup(build) {
    build.onLoad(
      {
        filter:
          /(?:ui[\\/]src[\\/].*|app[\\/]src[\\/](?:context[\\/]ctxpack[\\/](?:create-dialog|draft|selection-overlay)|pages[\\/]session[\\/]timeline[\\/]response-save-actions))\.tsx$/,
      },
      async (args) => ({
        contents: babel.transformSync(await Bun.file(args.path).text(), {
          filename: args.path,
          presets: [
            [requirePlugin("babel-preset-solid"), { generate: "dom" }],
            requirePlugin("@babel/preset-typescript"),
          ],
        }).code,
        loader: "js",
      }),
    )
  },
})
