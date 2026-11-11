import { describe, expect, it } from 'vitest';
import { classifyMediaUrl, humanFileSize, isAllowedFrameSrc, readData, transformEmbedUrl } from '../../src/notes/embeds';

describe('classifyMediaUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc_123', 'youtube', 'https://www.youtube.com/embed/abc_123'],
    ['https://youtu.be/abc123', 'youtube', 'https://www.youtube.com/embed/abc123'],
    ['https://vimeo.com/12345', 'vimeo', 'https://player.vimeo.com/video/12345'],
  ])('%s', (url, kind, embedSrc) => expect(classifyMediaUrl(url)).toEqual({ kind, embedSrc }));
  it('direct files and the rest', () => {
    expect(classifyMediaUrl('https://x.test/a.MP4?dl=1')).toEqual({ kind: 'video' });
    expect(classifyMediaUrl('https://x.test/a.mp3')).toEqual({ kind: 'audio' });
    expect(classifyMediaUrl('https://x.test/page')).toEqual({ kind: 'unrecognized' });
  });
});

describe('embeds', () => {
  it('maps the three supported sites and rejects the rest', () => {
    expect(transformEmbedUrl('https://www.figma.com/file/abc/x')).toContain('https://www.figma.com/embed?embed_host=notlinear&url=');
    expect(transformEmbedUrl('https://codepen.io/me/pen/xyz')).toBe('https://codepen.io/me/embed/xyz?default-tab=result');
    expect(transformEmbedUrl('https://www.google.com/maps/place/x?q=Paris')).toBe('https://maps.google.com/maps?q=Paris&output=embed');
    expect(transformEmbedUrl('https://evil.test/')).toBeNull();
  });
  it('only ever frames an https URL on a fixed host list, whatever a note stores', () => {
    expect(isAllowedFrameSrc('https://www.youtube.com/embed/x')).toBe(true);
    expect(isAllowedFrameSrc('https://player.vimeo.com/video/1')).toBe(true);
    for (const bad of ['http://www.youtube.com/embed/x', 'https://evil.test/x', 'javascript:alert(1)', 'https://www.youtube.com.evil.test/x', '', null, 5]) {
      expect(isAllowedFrameSrc(bad)).toBe(false);
    }
  });
});

describe('helpers', () => {
  it('sizes', () => {
    expect(humanFileSize(0)).toBe('0 B');
    expect(humanFileSize(512)).toBe('512 B');
    expect(humanFileSize(1536)).toBe('1.5 KB');
    expect(humanFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
  it('readData never throws', () => {
    expect(readData('{"a":1}')).toEqual({ a: 1 });
    for (const bad of ['', 'nope', '[1]', 'null', 5, undefined]) expect(readData(bad)).toEqual({});
  });
});
