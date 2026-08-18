import type { JSX } from "solid-js"
import type { MasterAgent } from "@opencode-ai/schema/master-agent"

export const MASTER_AGENT_BLOCK_TYPE = "master-agent" as const
export type MasterAgentBlockType = typeof MASTER_AGENT_BLOCK_TYPE

export const MASTER_AGENT_FUNCTIONALITY_ID: MasterAgent.FunctionalityID = "builtin:master-agent"

export const MASTER_AGENT_FUNCTIONALITY_BY_TYPE: Record<MasterAgentBlockType, MasterAgent.FunctionalityID> = {
  [MASTER_AGENT_BLOCK_TYPE]: MASTER_AGENT_FUNCTIONALITY_ID,
}

export type MasterAgentDirectoryBinding = MasterAgent.DirectoryBinding

export type MasterAgentInstanceConfiguration = MasterAgent.InstanceConfiguration

export interface MasterAgentClientConfiguration {
  version: 1
  directoryBinding: MasterAgentDirectoryBinding
  sessionBinding: null
}

export function initialConfiguration(directoryBinding: MasterAgentDirectoryBinding): MasterAgentClientConfiguration {
  return { version: 1, directoryBinding, sessionBinding: null }
}

const SVG_NS = "http://www.w3.org/2000/svg"

function svgElement(tag: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS(SVG_NS, tag)
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value))
  return element
}

function iconMasterAgent(): JSX.Element {
  const svg = svgElement("svg", { viewBox: "0 0 24 24" })
  svg.append(
    svgElement("circle", { cx: "12", cy: "12", r: "3.5" }),
    svgElement("path", {
      d: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4",
    }),
  )
  return svg
}

export interface MasterAgentBlockModule {
  type: MasterAgentBlockType
  functionality: MasterAgent.FunctionalityID
  title: string
  subtitle: string
  accent: string
  w: number
  h: number
  icon: () => JSX.Element
}

export const MASTER_AGENT_MODULE: MasterAgentBlockModule = {
  type: MASTER_AGENT_BLOCK_TYPE,
  functionality: MASTER_AGENT_FUNCTIONALITY_ID,
  title: "Master Agent",
  subtitle: "Hosted session · coder mode",
  accent: "var(--canvas-purple)",
  w: 440,
  h: 500,
  icon: iconMasterAgent,
}

export const MASTER_AGENT_DEFAULT_SIZE = { w: MASTER_AGENT_MODULE.w, h: MASTER_AGENT_MODULE.h } as const
