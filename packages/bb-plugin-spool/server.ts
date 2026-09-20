import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * Spool's MCP process is supplied through the Agent Plugins payload in this
 * package. The BB half owns the skill and setup page; it does not duplicate
 * the MCP gateway with a second native tool surface.
 */
export default function plugin(bb: BbPluginApi) {
  bb.log.info("Spool skill and MCP payload ready");
}
