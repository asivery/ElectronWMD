import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
export interface LabelPdfRequest {
    pages: string[];
    paperSize: { width: number; height: number };
}
const tags = new Set([
    'svg',
    'g',
    'defs',
    'clipPath',
    'mask',
    'path',
    'rect',
    'ellipse',
    'circle',
    'line',
    'polyline',
    'polygon',
    'pattern',
    'image',
    'use',
    'filter',
    'feGaussianBlur',
]);
const attributes = new Set([
    'xmlns',
    'xmlns:xlink',
    'width',
    'height',
    'viewBox',
    'x',
    'y',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'x1',
    'x2',
    'y1',
    'y2',
    'd',
    'points',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-dasharray',
    'stroke-miterlimit',
    'fill-rule',
    'clip-rule',
    'opacity',
    'fill-opacity',
    'stroke-opacity',
    'transform',
    'id',
    'clip-path',
    'mask',
    'maskUnits',
    'maskContentUnits',
    'patternUnits',
    'patternTransform',
    'preserveAspectRatio',
    'href',
    'xlink:href',
    'filter',
    'filterUnits',
    'stdDeviation',
]);
export function validateLabelPdfRequest(value: unknown): LabelPdfRequest {
    const r = value as LabelPdfRequest;
    if (!r || !Array.isArray(r.pages) || !r.pages.length || r.pages.length > 100 || !r.paperSize)
        throw new Error('Invalid label PDF request');
    if (![r.paperSize.width, r.paperSize.height].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 10 && v <= 2000))
        throw new Error('Invalid paper dimensions');
    let length = 0;
    const pages = r.pages.map((source) => {
        if (typeof source !== 'string' || (length += source.length) > 128 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(source))
            throw new Error('Invalid SVG size or declaration');
        const doc = new DOMParser({
            onError: () => {
                throw new Error('Malformed label SVG');
            },
        }).parseFromString(source, 'image/svg+xml');
        if (doc.documentElement?.localName !== 'svg') throw new Error('Expected SVG');
        let nodes = 0;
        const ids = new Set<string>();
        const imageIds = new Set<string>();
        const imageReferences: string[] = [];
        const filterIds = new Set<string>();
        const filterReferences: string[] = [];
        const walk = (el: any) => {
            if (++nodes > 400000 || !tags.has(el.localName) || el.namespaceURI !== 'http://www.w3.org/2000/svg')
                throw new Error('Unsupported SVG element');
            if (el.localName === 'filter') {
                const children = Array.from(el.childNodes).filter((child: any) => child.nodeType === 1) as any[];
                if (
                    el.parentNode?.localName !== 'defs' ||
                    children.length !== 1 ||
                    children[0].localName !== 'feGaussianBlur' ||
                    el.getAttribute('filterUnits') !== 'userSpaceOnUse' ||
                    !/^[\w-]+$/.test(el.getAttribute('id') || '')
                )
                    throw new Error('Unsupported SVG filter');
                for (const name of ['x', 'y', 'width', 'height']) {
                    const value = el.getAttribute(name);
                    const number = Number(value);
                    if (
                        value === null ||
                        value.trim() === '' ||
                        !Number.isFinite(number) ||
                        Math.abs(number) > 10000 ||
                        ((name === 'width' || name === 'height') && number <= 0)
                    )
                        throw new Error('Invalid SVG filter region');
                }
            }
            if (el.localName === 'feGaussianBlur') {
                const value = el.getAttribute('stdDeviation');
                const number = Number(value);
                if (
                    el.parentNode?.localName !== 'filter' ||
                    el.childNodes.length ||
                    value === null ||
                    value.trim() === '' ||
                    !Number.isFinite(number) ||
                    number < 0 ||
                    number > 5
                )
                    throw new Error('Invalid SVG blur');
            }
            for (let i = 0; i < el.attributes.length; i++) {
                const a = el.attributes.item(i);
                const v = a.value;
                if (!attributes.has(a.name)) throw new Error('Unsupported SVG attribute');
                if (el.localName === 'filter' && !['id', 'filterUnits', 'x', 'y', 'width', 'height'].includes(a.name))
                    throw new Error('Unsupported SVG filter attribute');
                if (el.localName === 'feGaussianBlur' && a.name !== 'stdDeviation') throw new Error('Unsupported SVG blur attribute');
                if (
                    (a.name === 'filterUnits' && el.localName !== 'filter') ||
                    (a.name === 'stdDeviation' && el.localName !== 'feGaussianBlur')
                )
                    throw new Error('Misplaced SVG filter attribute');
                if (a.name === 'filter') {
                    if (!['g', 'path'].includes(el.localName) || !/^url\(#[\w-]+\)$/.test(v))
                        throw new Error('Invalid SVG filter reference');
                    filterReferences.push(v.slice(5, -1));
                }
                if (a.name === 'id') {
                    if (ids.has(v)) throw new Error('Duplicate SVG ID');
                    ids.add(v);
                    if (el.localName === 'image') imageIds.add(v);
                    if (el.localName === 'filter') filterIds.add(v);
                }
                if (a.name === 'href' || a.name === 'xlink:href') {
                    if (el.localName === 'use') {
                        if (!/^#[\w-]+$/.test(v)) throw new Error('Only internal image reuse is allowed');
                        imageReferences.push(v.slice(1));
                    } else if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v))
                        throw new Error('Only embedded raster images are allowed');
                } else if (a.name !== 'xmlns' && a.name !== 'xmlns:xlink') {
                    if (/(?:javascript:|https?:|file:|data:|@import)/i.test(v) || (/url\(/i.test(v) && !/^url\(#[\w-]+\)$/.test(v)))
                        throw new Error('External SVG resource');
                }
            }
            for (let child = el.firstChild; child; child = child.nextSibling) {
                if (child.nodeType === 1) walk(child);
                else if (child.nodeType !== 3 && child.nodeType !== 8) throw new Error('Unsupported SVG node');
            }
        };
        walk(doc.documentElement);
        if (imageReferences.some((id) => !imageIds.has(id))) throw new Error('SVG reuse must reference an embedded image');
        if (filterReferences.some((id) => !filterIds.has(id))) throw new Error('SVG filter reference must target an internal blur filter');
        return new XMLSerializer().serializeToString(doc.documentElement);
    });
    return { pages, paperSize: { ...r.paperSize } };
}
