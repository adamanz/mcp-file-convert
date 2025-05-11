#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { convertFile, ensureFFmpegInstalled } from "./file-converter.js";
import { execCommand, readCommandOutput, forceTerminateCommand, listCommandSessions } from "./command-executor.js";
import * as os from 'os';
import * as fs from 'fs';

// Load configuration from environment variables
const config = {
  allowedDirectories: process.env.ALLOWED_DIRECTORIES
    ? JSON.parse(process.env.ALLOWED_DIRECTORIES)
    : [],
  timeoutSeconds: process.env.TIMEOUT_SECONDS
    ? parseInt(process.env.TIMEOUT_SECONDS, 10)
    : 600,
  maxFileSizeMB: process.env.MAX_FILE_SIZE_MB
    ? parseInt(process.env.MAX_FILE_SIZE_MB, 10)
    : 100
};

// Create server instance
const server = new McpServer({
  name: "file-converter",
  description: "MCP server for converting files between different formats using ffmpeg",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Register file conversion tool
server.tool(
  "convert-file",
  "Converts a file from one format to another using ffmpeg",
  {
    inputPath: z.string().describe("The absolute path to the input file"),
    outputPath: z.string().describe("The absolute path where the output file should be saved"),
    outputFormat: z.enum(["mp4", "webm", "mp3", "ogg", "wav", "gif", "png"]).describe("The format to convert to"),
    quality: z.enum(["low", "medium", "high"]).default("medium").describe("The quality of the output file"),
    additionalOptions: z.string().optional().describe("Additional ffmpeg options as a string"),
  },
  async ({ inputPath, outputPath, outputFormat, quality, additionalOptions }) => {
    const result = await convertFile(
      {
        inputPath,
        outputPath,
        outputFormat,
        quality,
        additionalOptions,
      },
      config.allowedDirectories,
      config.maxFileSizeMB,
      config.timeoutSeconds
    );

    return {
      content: [
        {
          type: "text",
          text: result.success 
            ? `Successfully started conversion of ${inputPath} to ${outputFormat}. Process ID: ${result.pid}\n${result.output}` 
            : `Error converting file: ${result.error}`,
        },
      ],
    };
  }
);

// Register command execution tool for advanced usage
server.tool(
  "execute-command",
  "Executes a command in a shell with proper validation",
  {
    command: z.string().describe("The command to execute"),
    timeout_ms: z.number().optional().describe("Timeout in milliseconds for command execution"),
    shell: z.string().optional().describe("Shell to use (e.g., 'bash', 'sh', 'zsh')"),
  },
  async ({ command, timeout_ms, shell }) => {
    const result = await execCommand({ command, timeout_ms, shell });
    
    return {
      content: [
        {
          type: "text",
          text: result.content[0].text,
        },
      ],
      isError: result.isError,
    };
  }
);

// Register tool to read ongoing command output
server.tool(
  "read-output",
  "Reads the output of a running command",
  {
    pid: z.number().describe("The process ID of the running command"),
  },
  async ({ pid }) => {
    const result = await readCommandOutput({ pid });
    
    return {
      content: [
        {
          type: "text",
          text: result.content[0].text,
        },
      ],
    };
  }
);

// Register tool to terminate a running command
server.tool(
  "terminate-command",
  "Terminates a running command",
  {
    pid: z.number().describe("The process ID of the command to terminate"),
  },
  async ({ pid }) => {
    const result = await forceTerminateCommand({ pid });
    
    return {
      content: [
        {
          type: "text",
          text: result.content[0].text,
        },
      ],
    };
  }
);

// Register tool to list active command sessions
server.tool(
  "list-sessions",
  "Lists all active command sessions",
  {},
  async () => {
    const result = await listCommandSessions();

    return {
      content: [
        {
          type: "text",
          text: result.content[0].text,
        },
      ],
    };
  }
);

// Register tool for getting file information
server.tool(
  "get-file-info",
  "Get detailed information about a media file using ffprobe",
  {
    filePath: z.string().describe("The absolute path to the media file"),
  },
  async ({ filePath }) => {
    try {
      const fileInfo = await getFileInfo(filePath, config.allowedDirectories);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(fileInfo, null, 2)
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting file info: ${error instanceof Error ? error.message : String(error)}`
          },
        ],
        isError: true
      };
    }
  }
);

// Register tool to check and install dependencies
server.tool(
  "check-dependencies",
  "Checks if required dependencies (ffmpeg) are installed and installs them if missing",
  {
    forceInstall: z.boolean().optional().describe("Force reinstallation even if dependency is already installed")
  },
  async ({ forceInstall = false }) => {
    try {
      let message = "";

      if (forceInstall) {
        message = "Forcing reinstallation of ffmpeg...\n";
        // For force install, we can use the package manager directly
        const platform = os.platform();
        let installCmd = "";

        switch (platform) {
          case 'darwin':
            installCmd = 'brew reinstall ffmpeg';
            break;
          case 'linux':
            if (fs.existsSync('/etc/debian_version')) {
              installCmd = 'apt-get update && apt-get install -y --reinstall ffmpeg';
            } else if (fs.existsSync('/etc/fedora-release')) {
              installCmd = 'dnf reinstall -y ffmpeg';
            } else if (fs.existsSync('/etc/alpine-release')) {
              installCmd = 'apk add --no-cache --update ffmpeg';
            }
            break;
          case 'win32':
            installCmd = 'winget install -e --id FFmpeg.FFmpeg';
            break;
        }

        if (installCmd) {
          const { stdout, stderr } = await execCommand({ command: installCmd });
          message += `Installation command result: ${stdout.content[0].text}\n`;
          if (stderr) message += `Errors: ${stderr}\n`;
        } else {
          message += "Unsupported platform for force reinstall. Please install ffmpeg manually.\n";
        }
      }

      // Check if ffmpeg is installed
      const ffmpegInstalled = await ensureFFmpegInstalled();

      if (ffmpegInstalled) {
        // Get ffmpeg version
        const { stdout, stderr } = await execCommand({ command: 'ffmpeg -version' });
        const versionOutput = stdout?.content[0]?.text || '';
        const versionLine = versionOutput.split('\n')[0];

        message += `ffmpeg is properly installed: ${versionLine}\nAll dependencies are satisfied.`;
      } else {
        message += "Failed to install ffmpeg. Please install it manually.";
      }

      return {
        content: [
          {
            type: "text",
            text: message
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error checking dependencies: ${error instanceof Error ? error.message : String(error)}`
          },
        ],
        isError: true
      };
    }
  }
);

async function main() {
  try {
    // Check if ffmpeg is installed on startup
    console.error("Checking for ffmpeg installation...");
    const ffmpegInstalled = await ensureFFmpegInstalled();

    if (!ffmpegInstalled) {
      console.error("WARNING: ffmpeg is not installed and could not be installed automatically.");
      console.error("Some functionality may be limited. Please install ffmpeg manually.");
    } else {
      console.error("ffmpeg is properly installed and available.");
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("File Converter MCP Server running on stdio");
  } catch (error) {
    console.error("Error during server startup:", error);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});