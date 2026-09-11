import { useLanguage } from "@/context/language"
import { makeEventListener } from "@solid-primitives/event-listener"
import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"

export function CanvasFps() {
  const language = useLanguage()
  const [state, setState] = createStore({ fps: undefined as number | undefined })

  onMount(() => {
    let frame = 0
    let start: number | undefined
    let frames = 0
    const sample = (now: number) => {
      frame = requestAnimationFrame(sample)
      if (start === undefined) {
        start = now
        return
      }
      frames += 1
      if (now - start < 500) return
      // Measure frame cadence without updating the readout on every frame.
      setState("fps", Math.round((frames * 1000) / (now - start)))
      start = now
      frames = 0
    }
    const reset = () => {
      cancelAnimationFrame(frame)
      start = undefined
      frames = 0
      setState("fps", undefined)
      if (!document.hidden) frame = requestAnimationFrame(sample)
    }
    reset()
    makeEventListener(document, "visibilitychange", reset)
    onCleanup(() => cancelAnimationFrame(frame))
  })

  return (
    <div class="canvas-fps-overlay">
      <span>{language.t("debugBar.fps.label")}</span>
      <span>{state.fps ?? language.t("debugBar.na")}</span>
    </div>
  )
}
