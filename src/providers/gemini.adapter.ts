import "server-only";

export {
  generateScript,
  GEMINI_SCRIPT_MODEL,
  ScriptGenerationJsonError,
} from "@/providers/openai.adapter";

export type {
  GeneratedScriptDto,
  GenerateScriptInput,
  ScriptGenerationBrief,
} from "@/providers/openai.adapter";