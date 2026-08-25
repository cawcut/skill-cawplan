export const TTY_CANCEL_MESSAGE = "TTY selection cancelled.";

export type PromptContext = {signal: AbortSignal};
export type KeyHelp = [key: string, action: string];

export function ttyKeysHelpTip(keys: KeyHelp[]): string {
    return [...keys, ["Esc", "exit"], ["j/J", "up"], ["k/K", "down"]]
        .map(([key, action]) => `${key} ${action}`)
        .join(" • ");
}

export function assertInteractiveTerminal(message: string): void {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error(message);
    }
}

export async function withTtyShortcuts<T>(
    prompt: (context: PromptContext) => Promise<T>,
    opts: {navigationKeys?: boolean} = {}
): Promise<T> {
    const inputStream = process.stdin as typeof process.stdin & {
        emit: (eventName: string | symbol, ...args: unknown[]) => boolean;
    };
    const originalEmit = inputStream.emit;
    const controller = new AbortController();

    if (inputStream.isTTY) {
        inputStream.emit = function emitWithTtyShortcuts(eventName: string | symbol, ...args: unknown[]): boolean {
            if (eventName === "keypress") {
                const key = args[1] as {name?: string; shift?: boolean; sequence?: string} | undefined;
                if (key?.name === "escape") {
                    controller.abort(new Error(TTY_CANCEL_MESSAGE));
                    return true;
                }
                if (opts.navigationKeys && key?.name === "j") {
                    args[0] = undefined;
                    args[1] = {...key, name: "up", sequence: "\u001B[A"};
                } else if (opts.navigationKeys && key?.name === "k") {
                    args[0] = undefined;
                    args[1] = {...key, name: "down", sequence: "\u001B[B"};
                }
            }
            return originalEmit.call(this, eventName, ...args);
        };
    }

    try {
        return await prompt({signal: controller.signal});
    } catch (err) {
        if ((err as Error).name === "AbortPromptError") {
            throw new Error(TTY_CANCEL_MESSAGE);
        }
        throw err;
    } finally {
        inputStream.emit = originalEmit;
    }
}
