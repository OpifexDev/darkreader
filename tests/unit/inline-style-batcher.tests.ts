describe('parseStyleProps', () => {
    // Reimplementation for testing (module-private in inline-style.ts)
    function parseStyleProps(cssText: string): Map<string, string> {
        const props = new Map<string, string>();
        const parts = cssText.split(';');
        for (const part of parts) {
            const colonIndex = part.indexOf(':');
            if (colonIndex > 0) {
                const name = part.substring(0, colonIndex).trim();
                const value = part.substring(colonIndex + 1).trim();
                props.set(name, value);
            }
        }
        return props;
    }

    it('should parse simple CSS properties', () => {
        const props = parseStyleProps('color: red; background: blue');
        expect(props.get('color')).toBe('red');
        expect(props.get('background')).toBe('blue');
    });

    it('should handle empty string', () => {
        const props = parseStyleProps('');
        expect(props.size).toBe(0);
    });

    it('should handle trailing semicolons', () => {
        const props = parseStyleProps('color: red;');
        expect(props.get('color')).toBe('red');
        expect(props.size).toBe(1);
    });

    it('should handle values with colons', () => {
        const props = parseStyleProps('background-image: url(http://example.com)');
        expect(props.get('background-image')).toBe('url(http://example.com)');
    });

    it('should handle whitespace variations', () => {
        const props = parseStyleProps('  color : red ;  background:blue  ');
        expect(props.get('color')).toBe('red');
        expect(props.get('background')).toBe('blue');
    });
});

describe('hasColorPropertyChanged', () => {
    const COLOR_PROPERTIES = new Set([
        'color', 'background', 'background-color', 'background-image',
        'border-color', 'border-top-color', 'border-right-color',
        'border-bottom-color', 'border-left-color',
        'outline-color', 'fill', 'stroke', 'stop-color',
        'box-shadow', 'text-shadow', 'text-decoration-color',
        'column-rule-color', 'caret-color', 'flood-color', 'lighting-color',
    ]);

    function parseStyleProps(cssText: string): Map<string, string> {
        const props = new Map<string, string>();
        const parts = cssText.split(';');
        for (const part of parts) {
            const colonIndex = part.indexOf(':');
            if (colonIndex > 0) {
                const name = part.substring(0, colonIndex).trim();
                const value = part.substring(colonIndex + 1).trim();
                props.set(name, value);
            }
        }
        return props;
    }

    function hasColorChanged(previousCSS: string | undefined, currentCSS: string): boolean {
        if (previousCSS === undefined) {
            return true;
        }
        if (previousCSS === currentCSS) {
            return false;
        }
        const currentProps = parseStyleProps(currentCSS);
        const previousProps = parseStyleProps(previousCSS);
        for (const prop of COLOR_PROPERTIES) {
            if (currentProps.get(prop) !== previousProps.get(prop)) {
                return true;
            }
        }
        return false;
    }

    it('should return true for first observation', () => {
        expect(hasColorChanged(undefined, 'color: red')).toBe(true);
    });

    it('should return false when nothing changed', () => {
        expect(hasColorChanged('color: red', 'color: red')).toBe(false);
    });

    it('should return true when color property changed', () => {
        expect(hasColorChanged('color: red', 'color: blue')).toBe(true);
    });

    it('should return false when only non-color property changed', () => {
        expect(hasColorChanged('transform: translateX(0px)', 'transform: translateX(10px)')).toBe(false);
    });

    it('should return false when only opacity changed', () => {
        expect(hasColorChanged('opacity: 0', 'opacity: 1')).toBe(false);
    });

    it('should detect background-color change among non-color changes', () => {
        expect(hasColorChanged(
            'width: 100px; background-color: red; height: 50px',
            'width: 200px; background-color: blue; height: 50px',
        )).toBe(true);
    });

    it('should return false when non-color properties change but colors stay same', () => {
        expect(hasColorChanged(
            'width: 100px; color: red; height: 50px',
            'width: 200px; color: red; height: 100px',
        )).toBe(false);
    });

    it('should detect border-color changes', () => {
        expect(hasColorChanged('border-color: red', 'border-color: blue')).toBe(true);
        expect(hasColorChanged('border-top-color: red', 'border-top-color: blue')).toBe(true);
    });

    it('should detect fill and stroke changes', () => {
        expect(hasColorChanged('fill: red', 'fill: blue')).toBe(true);
        expect(hasColorChanged('stroke: red', 'stroke: blue')).toBe(true);
    });

    it('should detect box-shadow changes', () => {
        expect(hasColorChanged('box-shadow: 0 0 5px red', 'box-shadow: 0 0 5px blue')).toBe(true);
    });
});
