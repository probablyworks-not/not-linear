import { describe, expect, it, vi } from 'vitest';

const fetchLinkTitle = vi.fn();
vi.mock('../../src/lib/link-title', () => ({ fetchLinkTitle: (u: string) => fetchLinkTitle(u) }));

const { nameLinkAfterItsPage, pasteUrlAsLink, upgradeLinkNames } = await import('../../src/notes/paste-link');

const URL_ = 'https://techcrunch.com/2026/10/21/bad-day-for-everyone/';
const linkBlock = (text: string) => ({
  id: 'b1',
  content: [{ type: 'link', href: URL_, content: [{ type: 'text', text, styles: { bold: true } }] }],
});

function editor(blocks: unknown[]) {
  const updateBlock = vi.fn();
  return { ed: { document: blocks as never, updateBlock }, updateBlock };
}

describe('nameLinkAfterItsPage', () => {
  it('renames the link to the article title, keeping its styles', async () => {
    fetchLinkTitle.mockResolvedValue('The internet is having a very bad cybersecurity day');
    const { ed, updateBlock } = editor([linkBlock('Bad day for everyone')]);
    await nameLinkAfterItsPage(ed, URL_, 'Bad day for everyone');
    expect(updateBlock).toHaveBeenCalledWith('b1', {
      content: [{ type: 'link', href: URL_, content: [{ type: 'text', text: 'The internet is having a very bad cybersecurity day', styles: { bold: true } }] }],
    });
  });

  it('leaves a link the user has since renamed alone', async () => {
    fetchLinkTitle.mockResolvedValue('Some title');
    const { ed, updateBlock } = editor([linkBlock('my own words')]);
    await nameLinkAfterItsPage(ed, URL_, 'Bad day for everyone');
    expect(updateBlock).not.toHaveBeenCalled();
  });

  it('does nothing when there is no title to use', async () => {
    fetchLinkTitle.mockResolvedValue(null);
    const { ed, updateBlock } = editor([linkBlock('Bad day for everyone')]);
    await nameLinkAfterItsPage(ed, URL_, 'Bad day for everyone');
    expect(updateBlock).not.toHaveBeenCalled();
  });

  it('reaches a link nested in a child block, and skips blocks with no inline content', async () => {
    fetchLinkTitle.mockResolvedValue('Nested piece');
    const { ed, updateBlock } = editor([{ id: 'p', content: undefined, children: [linkBlock('Bad day for everyone')] }]);
    await nameLinkAfterItsPage(ed, URL_, 'Bad day for everyone');
    expect(updateBlock).toHaveBeenCalledTimes(1);
  });
});

describe('pasteUrlAsLink', () => {
  it('links the selected text as-is, without renaming it', () => {
    const createLink = vi.fn();
    fetchLinkTitle.mockClear();
    pasteUrlAsLink({ document: [], updateBlock: vi.fn(), getSelectedText: () => 'read this', createLink }, URL_);
    expect(createLink).toHaveBeenCalledWith(URL_);
    expect(fetchLinkTitle).not.toHaveBeenCalled();
  });

  it('names the link from the slug straight away, with no wait for the network', () => {
    fetchLinkTitle.mockResolvedValue(null);
    const createLink = vi.fn();
    pasteUrlAsLink({ document: [], updateBlock: vi.fn(), getSelectedText: () => '', createLink }, URL_);
    expect(createLink).toHaveBeenCalledWith(URL_, 'Bad day for everyone');
  });

  it('falls back to the site when the URL says nothing about the page', () => {
    fetchLinkTitle.mockResolvedValue(null);
    const createLink = vi.fn();
    pasteUrlAsLink({ document: [], updateBlock: vi.fn(), getSelectedText: () => '', createLink }, 'https://stripe.com/pricing');
    expect(createLink).toHaveBeenCalledWith('https://stripe.com/pricing', 'stripe.com');
  });
});

describe('upgradeLinkNames', () => {
  it('renames a link left showing a bare site name', () => {
    fetchLinkTitle.mockResolvedValue(null);
    const { ed, updateBlock } = editor([linkBlock('techcrunch.com')]);
    upgradeLinkNames(ed);
    expect(updateBlock).toHaveBeenCalledWith('b1', {
      content: [{ type: 'link', href: URL_, content: [{ type: 'text', text: 'Bad day for everyone', styles: { bold: true } }] }],
    });
  });

  it('leaves text the user wrote, and settles after one pass', () => {
    fetchLinkTitle.mockResolvedValue(null);
    const mine = editor([linkBlock('my own words')]);
    upgradeLinkNames(mine.ed);
    expect(mine.updateBlock).not.toHaveBeenCalled();
    const already = editor([linkBlock('Bad day for everyone')]);
    upgradeLinkNames(already.ed);
    expect(already.updateBlock).not.toHaveBeenCalled();
  });

  it('leaves a link whose URL offers no better name', () => {
    fetchLinkTitle.mockResolvedValue(null);
    const { ed, updateBlock } = editor([{ id: 'b1', content: [{ type: 'link', href: 'https://stripe.com/pricing', content: [{ type: 'text', text: 'stripe.com', styles: {} }] }] }]);
    upgradeLinkNames(ed);
    expect(updateBlock).not.toHaveBeenCalled();
  });
});
