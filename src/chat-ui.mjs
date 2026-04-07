import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { agentColor, sectionColor, userColor } from "./terminal.mjs";

function normalizeCommands(commands) {
  return commands.map((command) => ({
    name: command.name,
    description: command.description || "",
  }));
}

export class TerminalChatUI {
  constructor() {
    this.closedByIo = false;
    this.isClosed = false;
    this.activeInterface = null;

    const swallowIoError = (error) => {
      if (!error) {
        return;
      }
      const code = error.code || "";
      const message = String(error.message || error);
      if (code === "EIO" || message.includes("EIO")) {
        this.closedByIo = true;
        return;
      }
      throw error;
    };

    input.on("error", swallowIoError);
    this.handleSigTstp = () => {
      this.closeActiveInterface();
    };
    this.handleSigCont = () => {
      this.closedByIo = false;
    };
    // Some shells enable job-control behaviors that can stop the process with
    // "tty output" when readline toggles terminal state. Ignore these signals
    // so the foreground chat session stays interactive.
    this.handleSigTtou = () => {};
    this.handleSigTtin = () => {};
    process.on("SIGTSTP", this.handleSigTstp);
    process.on("SIGCONT", this.handleSigCont);
    process.on("SIGTTOU", this.handleSigTtou);
    process.on("SIGTTIN", this.handleSigTtin);
  }

  close() {
    this.isClosed = true;
    this.closeActiveInterface();
    process.off("SIGTSTP", this.handleSigTstp);
    process.off("SIGCONT", this.handleSigCont);
    process.off("SIGTTOU", this.handleSigTtou);
    process.off("SIGTTIN", this.handleSigTtin);
  }

  closeActiveInterface() {
    const rl = this.activeInterface;
    this.activeInterface = null;
    if (!rl) {
      return;
    }
    try {
      rl.close();
    } catch (error) {
      const message = String(error?.message || error);
      if (!message.includes("setRawMode EIO")) {
        throw error;
      }
    }
  }

  async readLine(prompt) {
    if (this.isClosed || this.closedByIo) {
      return null;
    }

    const rl = readline.createInterface({ input, output });
    this.activeInterface = rl;

    const swallowIoError = (error) => {
      if (!error) {
        return;
      }
      const code = error.code || "";
      const message = String(error.message || error);
      if (code === "EIO" || message.includes("EIO")) {
        this.closedByIo = true;
        try {
          rl.close();
        } catch {}
        return;
      }
      throw error;
    };

    rl.on("error", swallowIoError);

    try {
      return await rl.question(prompt);
    } catch (error) {
      if (
        error &&
        (error.code === "ERR_USE_AFTER_CLOSE" ||
          error.code === "EIO" ||
          this.closedByIo)
      ) {
        return null;
      }
      throw error;
    } finally {
      if (this.activeInterface === rl) {
        this.activeInterface = null;
      }
      try {
        rl.close();
      } catch (error) {
        const message = String(error?.message || error);
        if (!message.includes("setRawMode EIO")) {
          throw error;
        }
      }
    }
  }

  section(title) {
    console.log(`\n${sectionColor("=== " + title + " ===")}`);
  }

  message(role, text) {
    console.log(`\n${agentColor(role, "[" + role + "]")}`);
    console.log(agentColor(role, text));
  }

  info(text) {
    console.log(`\n${text}`);
  }

  async compose({
    title,
    instructions,
    commands = [],
    allowEmpty = false,
  }) {
    const availableCommands = normalizeCommands(commands);

    console.log(`\n${userColor("[" + title + "]")}`);
    if (instructions) {
      console.log(instructions);
    }
    if (availableCommands.length) {
      console.log(
        `Commands: ${availableCommands
          .map((command) => `/${command.name}`)
          .join(", ")}`,
      );
    }

    const lines = [];

    while (true) {
      const prefix = lines.length === 0 ? "you> " : "... ";
      const line = await this.readLine(prefix);
      if (line === null) {
        return {
          type: "command",
          command: "exit",
        };
      }
      const trimmed = line.trim();

      if (trimmed === "/help") {
        if (!availableCommands.length) {
          console.log("사용 가능한 명령이 없습니다.");
        } else {
          console.log("사용 가능한 명령:");
          for (const command of availableCommands) {
            const suffix = command.description ? ` - ${command.description}` : "";
            console.log(`/${command.name}${suffix}`);
          }
          console.log("/clear - 현재 입력 버퍼 비우기");
        }
        continue;
      }

      if (trimmed === "/clear") {
        lines.length = 0;
        console.log("입력 버퍼를 비웠습니다.");
        continue;
      }

      const directCommand = availableCommands.find(
        (command) => trimmed === `/${command.name}`,
      );
      if (directCommand && lines.length === 0) {
        return {
          type: "command",
          command: directCommand.name,
        };
      }

      if (trimmed === "/send") {
        const text = lines.join("\n").trim();
        if (!text && !allowEmpty) {
          console.log("보낼 내용을 입력한 뒤 /send 를 입력하세요.");
          continue;
        }
        return {
          type: "message",
          text,
        };
      }

      lines.push(line);
    }
  }

  async askLine(question) {
    const answer = await this.readLine(question);
    if (answer === null) {
      return "/exit";
    }
    return answer.trim();
  }
}
