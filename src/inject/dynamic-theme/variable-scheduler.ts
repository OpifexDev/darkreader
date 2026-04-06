type ResolveFn = () => void;
type RAFFn = (callback: () => void) => number;

export class VariableResolutionScheduler {
    private dirty = false;
    private scheduled = false;
    private resolveFn: ResolveFn;
    private rafFn: RAFFn;
    private subscribers = new Set<() => void>();

    constructor(resolveFn: ResolveFn, rafFn: RAFFn = requestAnimationFrame.bind(window)) {
        this.resolveFn = resolveFn;
        this.rafFn = rafFn;
    }

    markDirty(): void {
        this.dirty = true;
        if (!this.scheduled) {
            this.scheduled = true;
            this.rafFn(() => {
                this.scheduled = false;
                if (this.dirty) {
                    this.resolve();
                }
            });
        }
    }

    flushIfDirty(): void {
        if (this.dirty) {
            this.resolve();
        }
    }

    subscribe(callback: () => void): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    private resolve(): void {
        this.dirty = false;
        this.resolveFn();
        this.subscribers.forEach((cb) => cb());
    }
}
