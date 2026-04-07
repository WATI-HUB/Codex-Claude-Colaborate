const NO_COLOR =
  !!process.env.NO_COLOR ||
  (!process.stdout.isTTY && !process.stderr.isTTY);

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const FG_RED = "\x1b[31m";
const FG_GREEN = "\x1b[32m";
const FG_YELLOW = "\x1b[33m";
const FG_BLUE = "\x1b[34m";
const FG_MAGENTA = "\x1b[35m";
const FG_CYAN = "\x1b[36m";
const FG_WHITE = "\x1b[37m";

function wrap(codes, text) {
  if (NO_COLOR) return text;
  return `${codes}${text}${RESET}`;
}

export function codex(text) {
  return wrap(BOLD + FG_CYAN, text);
}

export function claude(text) {
  return wrap(BOLD + FG_MAGENTA, text);
}

export function agentColor(name, text) {
  const lower = String(name).toLowerCase();
  if (lower.includes("codex")) return codex(text);
  if (lower.includes("claude")) return claude(text);
  return bold(text);
}

export function sectionColor(text) {
  return wrap(BOLD + FG_YELLOW, text);
}

export function success(text) {
  return wrap(BOLD + FG_GREEN, text);
}

export function error(text) {
  return wrap(BOLD + FG_RED, text);
}

export function dim(text) {
  return wrap(DIM, text);
}

export function bold(text) {
  return wrap(BOLD + FG_WHITE, text);
}

export function userColor(text) {
  return wrap(BOLD + FG_BLUE, text);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  constructor() {
    this.index = 0;
    this.interval = null;
    this.message = "";
  }

  start(message) {
    this.stop();
    this.message = message;
    this.index = 0;

    if (NO_COLOR) {
      process.stderr.write(`  ${message}\n`);
      return;
    }

    this.interval = setInterval(() => {
      const frame = SPINNER_FRAMES[this.index % SPINNER_FRAMES.length];
      process.stderr.write(`\r${frame} ${this.message}`);
      this.index += 1;
    }, 80);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stderr.write("\x1b[2K\r");
    }
  }
}

export async function withSpinner(spinner, message, fn) {
  spinner.start(message);
  try {
    return await fn();
  } finally {
    spinner.stop();
  }
}
