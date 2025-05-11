import { z } from 'zod';
import { spawn } from 'child_process';
import { ServerResult } from './types';

// Zod schemas for input validation
export const ExecuteCommandArgsSchema = z.object({
  command: z.string(),
  timeout_ms: z.number().optional().default(120000),
  shell: z.string().optional(),
});

export const ReadOutputArgsSchema = z.object({
  pid: z.number(),
});

export const ForceTerminateArgsSchema = z.object({
  pid: z.number(),
});

// Type definitions
type TerminalSession = {
  pid: number;
  process: any;
  buffer: string;
  isBlocked: boolean;
  lastRead: number;
  startTime: number;
  commandLine: string;
};

// Terminal manager to handle processes
class TerminalManager {
  private sessions: Map<number, TerminalSession> = new Map();
  private allowedCommands: Set<string> = new Set([
    'ffmpeg',
    'convert',
    'ls',
    'pwd',
    'echo',
    'file',
  ]);

  constructor() {
    // Cleanup old sessions periodically
    setInterval(() => this.cleanup(), 60000);
  }

  // Validate if a command is allowed
  async validateCommand(command: string): Promise<boolean> {
    const baseCommand = this.getBaseCommand(command);
    return this.allowedCommands.has(baseCommand);
  }

  // Extract the base command from a command string
  getBaseCommand(command: string): string {
    return command.trim().split(' ')[0];
  }

  // Extract all commands from a command string
  extractCommands(command: string): string[] {
    // Simple extraction for basic usage
    return [this.getBaseCommand(command)];
  }

  // Execute a command
  async executeCommand(
    command: string,
    timeout_ms = 120000,
    shellType?: string
  ): Promise<{ pid: number; output: string; isBlocked: boolean }> {
    try {
      // Select the shell
      const shell = shellType || (process.platform === 'win32' ? 'cmd' : 'bash');
      const shellArgs = process.platform === 'win32' 
        ? ['/c', command] 
        : ['-c', command];

      // Spawn the process
      const proc = spawn(shell, shellArgs);
      const pid = proc.pid || -1;

      if (pid === -1) {
        return { pid: -1, output: 'Failed to start process', isBlocked: false };
      }

      // Set up the terminal session
      const session: TerminalSession = {
        pid,
        process: proc,
        buffer: '',
        isBlocked: false,
        lastRead: Date.now(),
        startTime: Date.now(),
        commandLine: command,
      };

      this.sessions.set(pid, session);

      // Set up timeout
      if (timeout_ms > 0) {
        setTimeout(() => {
          // Check if session still exists before attempting to kill
          if (this.sessions.has(pid)) {
            this.forceTerminate(pid);
          }
        }, timeout_ms);
      }

      // Capture stdout
      proc.stdout.on('data', (data) => {
        const session = this.sessions.get(pid);
        if (session) {
          session.buffer += data.toString();
        }
      });

      // Capture stderr
      proc.stderr.on('data', (data) => {
        const session = this.sessions.get(pid);
        if (session) {
          session.buffer += data.toString();
        }
      });

      // Handle process completion
      proc.on('close', (code) => {
        const session = this.sessions.get(pid);
        if (session) {
          session.buffer += `\\nProcess exited with code ${code}\\n`;
          session.isBlocked = false;
        }
      });

      // Wait for initial output or up to 1 second
      const initialOutput = await new Promise<string>((resolve) => {
        let buffer = '';
        
        const captureOutput = (data: Buffer) => {
          buffer += data.toString();
        };

        proc.stdout.on('data', captureOutput);
        proc.stderr.on('data', captureOutput);

        // Resolve after a short timeout to get initial output
        setTimeout(() => {
          proc.stdout.removeListener('data', captureOutput);
          proc.stderr.removeListener('data', captureOutput);
          resolve(buffer);
        }, 1000);
      });

      // Check if the command is blocking (still running)
      const isBlocked = proc.exitCode === null;

      return {
        pid,
        output: initialOutput || 'Command started, no initial output available.',
        isBlocked,
      };
    } catch (error) {
      console.error('Execute command error:', error);
      return {
        pid: -1,
        output: \`Error executing command: \${error instanceof Error ? error.message : String(error)}\`,
        isBlocked: false,
      };
    }
  }

  // Get new output from a session
  getNewOutput(pid: number): string | null {
    const session = this.sessions.get(pid);
    if (!session) return null;

    const output = session.buffer;
    session.buffer = '';
    session.lastRead = Date.now();
    return output;
  }

  // Force terminate a session
  forceTerminate(pid: number): boolean {
    const session = this.sessions.get(pid);
    if (!session) return false;

    try {
      // Kill the process and any child processes
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
      } else {
        process.kill(-pid, 'SIGKILL');
      }
      
      this.sessions.delete(pid);
      return true;
    } catch (error) {
      console.error('Error terminating process:', error);
      return false;
    }
  }

  // List active sessions
  listActiveSessions(): Array<{ pid: number; isBlocked: boolean; runtime: number }> {
    const now = Date.now();
    return Array.from(this.sessions.values()).map(s => ({
      pid: s.pid,
      isBlocked: s.isBlocked,
      runtime: now - s.startTime,
    }));
  }

  // Cleanup old sessions
  private cleanup() {
    const now = Date.now();
    const threshold = 30 * 60 * 1000; // 30 minutes
    
    for (const [pid, session] of this.sessions.entries()) {
      if (now - session.lastRead > threshold || now - session.startTime > threshold) {
        this.forceTerminate(pid);
      }
    }
  }
}

// Create a single instance of the terminal manager
const terminalManager = new TerminalManager();

// Execute a command
export async function execCommand(args: unknown): Promise<ServerResult> {
  const parsed = ExecuteCommandArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: \`Error: Invalid arguments for execute_command: \${parsed.error}\` }],
      isError: true,
    };
  }

  // Validate the command
  const isAllowed = await terminalManager.validateCommand(parsed.data.command);
  if (!isAllowed) {
    return {
      content: [{ type: "text", text: \`Error: Command not allowed: \${parsed.data.command}\` }],
      isError: true,
    };
  }

  const result = await terminalManager.executeCommand(
    parsed.data.command,
    parsed.data.timeout_ms,
    parsed.data.shell
  );

  // Check for error condition (pid = -1)
  if (result.pid === -1) {
    return {
      content: [{ type: "text", text: result.output }],
      isError: true,
    };
  }

  return {
    content: [{
      type: "text",
      text: \`Command started with PID \${result.pid}\\nInitial output:\\n\${result.output}\${
        result.isBlocked ? '\\nCommand is still running. Use read_output to get more output.' : ''
      }\`
    }],
  };
}

// Read output from a running command
export async function readCommandOutput(args: unknown): Promise<ServerResult> {
  const parsed = ReadOutputArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: \`Error: Invalid arguments for read_output: \${parsed.error}\` }],
      isError: true,
    };
  }

  const output = terminalManager.getNewOutput(parsed.data.pid);
  return {
    content: [{
      type: "text",
      text: output === null
        ? \`No session found for PID \${parsed.data.pid}\`
        : output || 'No new output available'
    }],
  };
}

// Force terminate a command
export async function forceTerminateCommand(args: unknown): Promise<ServerResult> {
  const parsed = ForceTerminateArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: "text", text: \`Error: Invalid arguments for force_terminate: \${parsed.error}\` }],
      isError: true,
    };
  }

  const success = terminalManager.forceTerminate(parsed.data.pid);
  return {
    content: [{
      type: "text",
      text: success
        ? \`Successfully terminated session \${parsed.data.pid}\`
        : \`No active session found for PID \${parsed.data.pid}\`
    }],
  };
}

// List active command sessions
export async function listCommandSessions(): Promise<ServerResult> {
  const sessions = terminalManager.listActiveSessions();
  return {
    content: [{
      type: "text",
      text: sessions.length === 0
        ? 'No active sessions'
        : sessions.map(s =>
            \`PID: \${s.pid}, Blocked: \${s.isBlocked}, Runtime: \${Math.round(s.runtime / 1000)}s\`
          ).join('\\n')
    }],
  };
}