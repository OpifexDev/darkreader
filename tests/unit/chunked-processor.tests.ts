import {ChunkedStylesheetProcessor} from '../../src/inject/dynamic-theme/chunked-processor';

describe('ChunkedStylesheetProcessor', () => {
    let rafCallbacks: Array<() => void>;
    let processedSheets: string[];

    beforeEach(() => {
        rafCallbacks = [];
        processedSheets = [];
    });

    function mockRAF(cb: () => void): number {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
    }

    function flushRAF() {
        const cbs = [...rafCallbacks];
        rafCallbacks = [];
        cbs.forEach((cb) => cb());
    }

    it('should process all sheets eventually', () => {
        const onComplete = jest.fn();
        const processor = new ChunkedStylesheetProcessor({
            processSheet: (sheet: any) => { processedSheets.push(sheet.id); },
            onComplete,
            frameBudgetMs: 1000,
            rafFn: mockRAF,
            nowFn: () => 0,
        });

        processor.enqueue([{id: 'a'}, {id: 'b'}, {id: 'c'}]);
        processor.start();
        flushRAF();

        expect(processedSheets).toEqual(['a', 'b', 'c']);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('should split across frames when budget exceeded', () => {
        let time = 0;
        const onComplete = jest.fn();
        const processor = new ChunkedStylesheetProcessor({
            processSheet: (sheet: any) => {
                processedSheets.push(sheet.id);
                time += 10;
            },
            onComplete,
            frameBudgetMs: 12,
            rafFn: mockRAF,
            nowFn: () => time,
        });

        processor.enqueue([{id: 'a'}, {id: 'b'}, {id: 'c'}]);
        processor.start();

        flushRAF();
        expect(processedSheets).toEqual(['a', 'b']);
        expect(onComplete).not.toHaveBeenCalled();

        time = 0;
        flushRAF();
        expect(processedSheets).toEqual(['a', 'b', 'c']);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('should prioritize critical sheets first', () => {
        const onComplete = jest.fn();
        const processor = new ChunkedStylesheetProcessor({
            processSheet: (sheet: any) => { processedSheets.push(sheet.id); },
            onComplete,
            frameBudgetMs: 1000,
            rafFn: mockRAF,
            nowFn: () => 0,
        });

        processor.enqueueCritical([{id: 'critical'}]);
        processor.enqueue([{id: 'standard'}]);
        processor.enqueueDeferred([{id: 'deferred'}]);
        processor.start();
        flushRAF();

        expect(processedSheets).toEqual(['critical', 'standard', 'deferred']);
    });

    it('should handle new sheets added during processing', () => {
        let time = 0;
        const processor = new ChunkedStylesheetProcessor({
            processSheet: (sheet: any) => {
                processedSheets.push(sheet.id);
                time += 10;
            },
            onComplete: jest.fn(),
            frameBudgetMs: 12,
            rafFn: mockRAF,
            nowFn: () => time,
        });

        processor.enqueue([{id: 'a'}, {id: 'b'}]);
        processor.start();
        flushRAF();

        processor.enqueueCritical([{id: 'urgent'}]);
        time = 0;
        flushRAF();

        expect(processedSheets).toContain('urgent');
    });
});
