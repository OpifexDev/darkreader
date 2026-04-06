import type {Theme} from '../../definitions';

const INSTANT_CLASS = 'darkreader--instant';

export function injectInstantDarkStyle(theme: Theme): void {
    if (document.querySelector(`.${INSTANT_CLASS}`)) {
        return;
    }

    const bg = theme.darkSchemeBackgroundColor || '#181a1b';
    const text = theme.darkSchemeTextColor || '#e8e6e3';
    const inputBg = '#242628';
    const borderColor = '#3c3f41';
    const linkColor = '#6db3f2';

    const css = [
        `html, body { background-color: ${bg} !important; color: ${text} !important; }`,
        `img, video, canvas, iframe, embed, object, picture, svg image { filter: none !important; }`,
        `input, textarea, select, button { background-color: ${inputBg} !important; color: ${text} !important; border-color: ${borderColor} !important; }`,
        `a { color: ${linkColor} !important; }`,
        `table, th, td { border-color: ${borderColor} !important; }`,
        `::placeholder { color: ${borderColor} !important; }`,
    ].join('\n');

    const style = document.createElement('style');
    style.classList.add('darkreader');
    style.classList.add(INSTANT_CLASS);
    style.textContent = css;
    (document.head || document.documentElement).prepend(style);
}

export function removeInstantDarkStyle(): void {
    const el = document.querySelector(`.${INSTANT_CLASS}`);
    if (el) {
        el.remove();
    }
}

export function markPhaseComplete(): void {
    document.documentElement.setAttribute('data-darkreader-phase', 'complete');
}

export function clearPhaseAttribute(): void {
    document.documentElement.removeAttribute('data-darkreader-phase');
}
