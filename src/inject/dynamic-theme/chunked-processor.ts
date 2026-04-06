interface ChunkedProcessorOptions<T> {
    processSheet: (sheet: T) => void;
    onComplete: () => void;
    frameBudgetMs?: number;
    rafFn?: (cb: () => void) => number;
    nowFn?: () => number;
}

const DEFAULT_FRAME_BUDGET = 12;

export class ChunkedStylesheetProcessor<T = unknown> {
    private criticalQueue: T[] = [];
    private standardQueue: T[] = [];
    private deferredQueue: T[] = [];
    private processSheet: (sheet: T) => void;
    private onComplete: () => void;
    private frameBudgetMs: number;
    private rafFn: (cb: () => void) => number;
    private nowFn: () => number;
    private running = false;

    constructor(options: ChunkedProcessorOptions<T>) {
        this.processSheet = options.processSheet;
        this.onComplete = options.onComplete;
        this.frameBudgetMs = options.frameBudgetMs ?? DEFAULT_FRAME_BUDGET;
        this.rafFn = options.rafFn ?? requestAnimationFrame.bind(window);
        this.nowFn = options.nowFn ?? performance.now.bind(performance);
    }

    enqueueCritical(sheets: T[]): void {
        this.criticalQueue.push(...sheets);
        if (this.running) {
            this.scheduleNext();
        } else {
            this.running = true;
            this.scheduleNext();
        }
    }

    enqueue(sheets: T[]): void {
        this.standardQueue.push(...sheets);
    }

    enqueueDeferred(sheets: T[]): void {
        this.deferredQueue.push(...sheets);
    }

    removeFromQueue(predicate: (sheet: T) => boolean): void {
        this.criticalQueue = this.criticalQueue.filter((s) => !predicate(s));
        this.standardQueue = this.standardQueue.filter((s) => !predicate(s));
        this.deferredQueue = this.deferredQueue.filter((s) => !predicate(s));
    }

    start(): void {
        this.running = true;
        this.scheduleNext();
    }

    private scheduleNext(): void {
        this.rafFn(() => this.processNextBatch());
    }

    private getNextSheet(): T | undefined {
        if (this.criticalQueue.length > 0) {
            return this.criticalQueue.shift();
        }
        if (this.standardQueue.length > 0) {
            return this.standardQueue.shift();
        }
        if (this.deferredQueue.length > 0) {
            return this.deferredQueue.shift();
        }
        return undefined;
    }

    private hasMore(): boolean {
        return this.criticalQueue.length > 0 ||
            this.standardQueue.length > 0 ||
            this.deferredQueue.length > 0;
    }

    private processNextBatch(): void {
        const startTime = this.nowFn();

        while (this.hasMore()) {
            const sheet = this.getNextSheet()!;
            this.processSheet(sheet);
            if (this.nowFn() - startTime > this.frameBudgetMs) {
                break;
            }
        }

        if (this.hasMore()) {
            this.scheduleNext();
        } else {
            this.running = false;
            this.onComplete();
        }
    }
}
