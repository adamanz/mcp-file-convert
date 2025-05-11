// Common type definitions for the MCP server

// Server response type
export interface ServerResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// File conversion parameters
export interface ConversionParams {
  inputPath: string;
  outputPath: string;
  outputFormat: "mp4" | "webm" | "mp3" | "ogg" | "wav" | "gif" | "png";
  quality: "low" | "medium" | "high";
  additionalOptions?: string;
}

// Conversion result
export interface ConversionResult {
  success: boolean;
  pid?: number;
  output: string;
  error?: string;
}