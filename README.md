# MCP File Converter

An MCP (Model Context Protocol) server for converting files between different formats using ffmpeg.

## Features

- Convert video files to MP4, WebM, and other formats
- Convert audio files to MP3, OGG, WAV
- Convert video frames to GIF or PNG
- Control conversion quality (low, medium, high)
- Monitor conversion progress
- Configurable timeout and allowed directories

## Supported Formats

### Input Formats
Any format supported by ffmpeg (mp4, mov, avi, mkv, webm, etc.)

### Output Formats
- **Video**: MP4, WebM
- **Audio**: MP3, OGG, WAV
- **Image**: GIF, PNG

## Tools

### `convert-file`

Converts a file from one format to another using ffmpeg.

**Parameters:**
- `inputPath` (string): The absolute path to the input file
- `outputPath` (string): The absolute path where the output file should be saved
- `outputFormat` (enum): The format to convert to (`mp4`, `webm`, `mp3`, `ogg`, `wav`, `gif`, `png`)
- `quality` (enum, optional): The quality of the output file (`low`, `medium`, `high`, default: `medium`)
- `additionalOptions` (string, optional): Additional ffmpeg options as a string

**Example:**
```json
{
  "inputPath": "/path/to/input.mp4",
  "outputPath": "/path/to/output.webm",
  "outputFormat": "webm",
  "quality": "high"
}
```

### `execute-command`

Executes a command in a shell with proper validation (for advanced usage).

**Parameters:**
- `command` (string): The command to execute
- `timeout_ms` (number, optional): Timeout in milliseconds for command execution
- `shell` (string, optional): Shell to use (e.g., 'bash', 'sh', 'zsh')

### `read-output`

Reads the output of a running command.

**Parameters:**
- `pid` (number): The process ID of the running command

### `terminate-command`

Terminates a running command.

**Parameters:**
- `pid` (number): The process ID of the command to terminate

### `list-sessions`

Lists all active command sessions.

### `check-dependencies`

Checks if required dependencies (ffmpeg) are installed and installs them if missing.

**Parameters:**
- `forceInstall` (boolean, optional): Force reinstallation even if dependency is already installed

## Local Development

### Prerequisites

- Node.js 16.x or higher
- ffmpeg (will be installed automatically if missing, but you can also install manually)

The server will automatically check for ffmpeg on startup and attempt to install it if missing. You can also use the `check-dependencies` tool to verify or force reinstallation.

### Setup

1. Clone the repository
   ```bash
   git clone https://github.com/yourusername/mcp-file-converter.git
   cd mcp-file-converter
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Build the project
   ```bash
   npm run build
   ```

4. Start the server
   ```bash
   npm start
   ```

## Deployment on Smithery

This MCP server is designed to be deployed on Smithery, a platform for hosting MCP servers.

### Deployment Steps

1. Push your code to a GitHub repository
2. Go to [Smithery.ai](https://smithery.ai)
3. Add your server or claim it if it's already listed
4. Click "Deploy" on the Deployments tab

## Configuration

The server can be configured using environment variables or the Smithery configuration.

### Environment Variables

- `NODE_ENV`: Set to `production` for production deployment
- Add other environment variables as needed

### Smithery Configuration

Edit the `smithery.yaml` file to configure the server:

```yaml
configSchema:
  type: object
  properties:
    allowedDirectories:
      type: array
      description: "List of directories where file conversion is allowed"
      items:
        type: string
    timeoutSeconds:
      type: number
      description: "Maximum timeout for conversion operations in seconds"
      default: 600
    maxFileSizeMB:
      type: number
      description: "Maximum file size for conversion in MB"
      default: 100
  required: []
  additionalProperties: false
```

## License

MIT