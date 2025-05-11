import { execCommand } from './command-executor';
import { ConversionParams, ConversionResult } from './types';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const exec = promisify(require('child_process').exec);

/**
 * Check if ffmpeg is installed and install it if necessary
 */
export async function ensureFFmpegInstalled(): Promise<boolean> {
  try {
    // Check if ffmpeg is installed
    const { stdout } = await exec('ffmpeg -version');
    console.log('ffmpeg is already installed:', stdout.split('\n')[0]);
    return true;
  } catch (error) {
    console.log('ffmpeg is not installed. Attempting to install...');
    
    try {
      let installCommand = '';
      
      // Determine the operating system and choose appropriate installation command
      switch (os.platform()) {
        case 'darwin': // macOS
          installCommand = 'brew install ffmpeg';
          break;
        case 'linux':
          // Check for different Linux distributions
          if (fs.existsSync('/etc/debian_version')) {
            installCommand = 'apt-get update && apt-get install -y ffmpeg';
          } else if (fs.existsSync('/etc/fedora-release')) {
            installCommand = 'dnf install -y ffmpeg';
          } else if (fs.existsSync('/etc/alpine-release')) {
            installCommand = 'apk add --no-cache ffmpeg';
          } else {
            throw new Error('Unsupported Linux distribution');
          }
          break;
        case 'win32': // Windows
          installCommand = 'winget install -e --id FFmpeg.FFmpeg';
          break;
        default:
          throw new Error(`Unsupported platform: ${os.platform()}`);
      }
      
      // Execute installation command
      const { stdout, stderr } = await exec(installCommand);
      console.log('Installation output:', stdout);
      if (stderr) console.error('Installation errors:', stderr);
      
      // Verify installation
      const verifyResult = await exec('ffmpeg -version');
      console.log('ffmpeg was installed successfully:', verifyResult.stdout.split('\n')[0]);
      return true;
    } catch (installError) {
      console.error('Failed to install ffmpeg:', installError);
      return false;
    }
  }
}

/**
 * Check if a path is within allowed directories
 */
export function isPathAllowed(filePath: string, allowedDirectories: string[]): boolean {
  // If no allowed directories are configured, allow all paths
  if (!allowedDirectories || allowedDirectories.length === 0) {
    return true;
  }

  const absolutePath = path.resolve(filePath);
  return allowedDirectories.some(dir => absolutePath.startsWith(path.resolve(dir)));
}

/**
 * Get the size of a file in MB
 */
export function getFileSizeMB(filePath: string): number {
  const stats = fs.statSync(filePath);
  return stats.size / (1024 * 1024); // Convert bytes to MB
}

// Quality presets for different output formats
const qualityPresets: Record<string, Record<string, string>> = {
  mp4: {
    low: '-c:v libx264 -crf 28 -preset fast -c:a aac -b:a 128k',
    medium: '-c:v libx264 -crf 23 -preset medium -c:a aac -b:a 192k',
    high: '-c:v libx264 -crf 18 -preset slow -c:a aac -b:a 256k'
  },
  webm: {
    low: '-c:v libvpx-vp9 -crf 32 -b:v 0 -c:a libopus -b:a 96k',
    medium: '-c:v libvpx-vp9 -crf 30 -b:v 0 -c:a libopus -b:a 128k',
    high: '-c:v libvpx-vp9 -crf 24 -b:v 0 -c:a libopus -b:a 192k'
  },
  mp3: {
    low: '-vn -c:a libmp3lame -b:a 128k',
    medium: '-vn -c:a libmp3lame -b:a 192k',
    high: '-vn -c:a libmp3lame -b:a 320k'
  },
  ogg: {
    low: '-vn -c:a libvorbis -b:a 96k',
    medium: '-vn -c:a libvorbis -b:a 160k',
    high: '-vn -c:a libvorbis -b:a 240k'
  },
  wav: {
    low: '-vn -c:a pcm_s16le -ar 44100',
    medium: '-vn -c:a pcm_s24le -ar 48000',
    high: '-vn -c:a pcm_s24le -ar 96000'
  },
  gif: {
    low: '-vf "fps=10,scale=320:-1:flags=lanczos" -c:v gif',
    medium: '-vf "fps=15,scale=480:-1:flags=lanczos" -c:v gif',
    high: '-vf "fps=24,scale=720:-1:flags=lanczos" -c:v gif'
  },
  png: {
    low: '-vframes 1 -q:v 5',
    medium: '-vframes 1 -q:v 3',
    high: '-vframes 1 -q:v 1'
  }
};

/**
 * Convert a file from one format to another using ffmpeg
 */
export async function convertFile(
  params: ConversionParams, 
  allowedDirectories: string[] = [], 
  maxFileSizeMB: number = 100,
  timeoutSeconds: number = 600
): Promise<ConversionResult> {
  try {
    // Ensure ffmpeg is installed
    const ffmpegInstalled = await ensureFFmpegInstalled();
    if (!ffmpegInstalled) {
      return {
        success: false,
        output: '',
        error: 'Failed to install ffmpeg. Please install it manually and try again.'
      };
    }

    // Validate input file
    if (!fs.existsSync(params.inputPath)) {
      return {
        success: false,
        output: '',
        error: `Input file does not exist: ${params.inputPath}`
      };
    }
    
    // Check if input path is allowed
    if (!isPathAllowed(params.inputPath, allowedDirectories)) {
      return {
        success: false,
        output: '',
        error: `Access to input path ${params.inputPath} is not allowed. Allowed directories: ${allowedDirectories.join(', ') || 'none'}`
      };
    }
    
    // Check if output path is allowed
    if (!isPathAllowed(params.outputPath, allowedDirectories)) {
      return {
        success: false,
        output: '',
        error: `Access to output path ${params.outputPath} is not allowed. Allowed directories: ${allowedDirectories.join(', ') || 'none'}`
      };
    }
    
    // Check file size
    const fileSizeMB = getFileSizeMB(params.inputPath);
    if (fileSizeMB > maxFileSizeMB) {
      return {
        success: false,
        output: '',
        error: `Input file size (${fileSizeMB.toFixed(2)} MB) exceeds maximum allowed size (${maxFileSizeMB} MB)`
      };
    }

    // Ensure output directory exists
    const outputDir = path.dirname(params.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get quality preset
    const qualityPreset = qualityPresets[params.outputFormat]?.[params.quality] || '';
    
    // Build ffmpeg command
    let ffmpegCommand = `ffmpeg -i "${params.inputPath}" ${qualityPreset}`;
    
    // Add additional options if provided
    if (params.additionalOptions) {
      ffmpegCommand += ` ${params.additionalOptions}`;
    }
    
    // Add output path
    ffmpegCommand += ` "${params.outputPath}"`;

    // Execute the command
    const result = await execCommand({
      command: ffmpegCommand,
      timeout_ms: timeoutSeconds * 1000 // Convert seconds to milliseconds
    });

    // Parse the PID from the output
    const pidMatch = result.content[0].text.match(/Command started with PID (\d+)/);
    const pid = pidMatch ? parseInt(pidMatch[1], 10) : undefined;

    if (result.isError) {
      return {
        success: false,
        pid,
        output: result.content[0].text,
        error: 'Error starting conversion process'
      };
    }

    return {
      success: true,
      pid,
      output: result.content[0].text
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Get information about a media file using ffprobe
 */
export async function getFileInfo(
  filePath: string, 
  allowedDirectories: string[] = []
): Promise<any> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  
  // Check if file path is allowed
  if (!isPathAllowed(filePath, allowedDirectories)) {
    throw new Error(`Access to file path ${filePath} is not allowed. Allowed directories: ${allowedDirectories.join(', ') || 'none'}`);
  }

  const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
  
  const result = await execCommand({
    command,
    timeout_ms: 30000 // 30 seconds timeout
  });

  if (result.isError) {
    throw new Error(`Error getting file info: ${result.content[0].text}`);
  }

  try {
    // Extract JSON from output
    const outputText = result.content[0].text;
    const jsonStart = outputText.indexOf('{');
    const jsonEnd = outputText.lastIndexOf('}') + 1;
    
    if (jsonStart === -1 || jsonEnd === 0) {
      throw new Error('Could not find JSON data in ffprobe output');
    }
    
    const jsonString = outputText.substring(jsonStart, jsonEnd);
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error(`Error parsing file info: ${error instanceof Error ? error.message : String(error)}`);
  }
}