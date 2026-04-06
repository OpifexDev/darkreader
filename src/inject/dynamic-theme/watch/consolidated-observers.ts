type AttributeHandler = (element: Element, attributeName: string) => void;
type StyleContentHandler = (styleElement: Element) => void;

const WATCHED_ATTRIBUTES = ['style', 'class', 'media', 'disabled', 'type'];

interface ConsolidatedAttributeObserver {
    register(element: Element, handler: AttributeHandler): void;
    unregister(element: Element): void;
    disconnect(): void;
}

interface ConsolidatedStyleContentObserver {
    register(styleElement: Element, handler: StyleContentHandler): void;
    unregister(styleElement: Element): void;
    disconnect(): void;
}

const attributeObservers = new Map<Node, ConsolidatedAttributeObserver>();
const styleContentObservers = new Map<Node, ConsolidatedStyleContentObserver>();

export function getConsolidatedAttributeObserver(root: Document | ShadowRoot): ConsolidatedAttributeObserver {
    if (attributeObservers.has(root)) {
        return attributeObservers.get(root)!;
    }

    const registry = new Map<Element, AttributeHandler[]>();

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            const target = mutation.target as Element;
            const handlers = registry.get(target);
            if (handlers) {
                for (const handler of handlers) {
                    handler(target, mutation.attributeName!);
                }
            }
        }
    });

    observer.observe(root, {
        attributes: true,
        attributeFilter: WATCHED_ATTRIBUTES,
        subtree: true,
    });

    const consolidated: ConsolidatedAttributeObserver = {
        register(element: Element, handler: AttributeHandler): void {
            const existing = registry.get(element) || [];
            existing.push(handler);
            registry.set(element, existing);
        },
        unregister(element: Element): void {
            registry.delete(element);
        },
        disconnect(): void {
            observer.disconnect();
            registry.clear();
            attributeObservers.delete(root);
        },
    };

    attributeObservers.set(root, consolidated);
    return consolidated;
}

export function getConsolidatedStyleContentObserver(root: Document | ShadowRoot): ConsolidatedStyleContentObserver {
    if (styleContentObservers.has(root)) {
        return styleContentObservers.get(root)!;
    }

    const registry = new Map<Element, StyleContentHandler>();

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            const target = mutation.target;
            const styleElement = target.nodeType === Node.TEXT_NODE
                ? target.parentElement
                : target as Element;
            if (styleElement && registry.has(styleElement)) {
                registry.get(styleElement)!(styleElement);
            }
        }
    });

    observer.observe(root, {
        childList: true,
        characterData: true,
        subtree: true,
    });

    const consolidated: ConsolidatedStyleContentObserver = {
        register(styleElement: Element, handler: StyleContentHandler): void {
            registry.set(styleElement, handler);
        },
        unregister(styleElement: Element): void {
            registry.delete(styleElement);
        },
        disconnect(): void {
            observer.disconnect();
            registry.clear();
            styleContentObservers.delete(root);
        },
    };

    styleContentObservers.set(root, consolidated);
    return consolidated;
}

export function disconnectAllConsolidatedObservers(): void {
    attributeObservers.forEach((obs) => obs.disconnect());
    styleContentObservers.forEach((obs) => obs.disconnect());
}
