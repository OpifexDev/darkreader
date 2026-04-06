// Minimal DOM stub for tests that import modules with module-level document usage
if (typeof document === 'undefined') {
    global.document = {
        addEventListener: () => {},
        removeEventListener: () => {},
    };
}
