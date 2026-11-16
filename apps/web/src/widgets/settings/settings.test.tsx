import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HubMessage, HubRequest } from '../../feeds/protocol';
import { connectFeed, disconnectFeed, type FeedPort } from '../../store/feedClient';
import { KEYS_STORAGE_KEY, useKeyVault } from '../../store/keys';
import Settings from './index';

let sent: HubRequest[];
let port: FeedPort;

/** Deliver a hub message and let the promise callbacks it settles re-render. */
async function reply(message: HubMessage) {
  await act(async () => {
    port.onmessage?.(new MessageEvent('message', { data: message }));
    await Promise.resolve();
  });
}

function alpacaCard() {
  return within(screen.getByRole('region', { name: 'Alpaca' }));
}

beforeEach(() => {
  localStorage.clear();
  useKeyVault.setState({ keys: {} });
  sent = [];
  port = { postMessage: (message) => sent.push(message), onmessage: null };
  connectFeed(port);
});

afterEach(() => {
  disconnectFeed();
});

describe('Settings key vault', () => {
  it('tests the typed two-part key through the hub before anything is saved', async () => {
    render(<Settings />);
    const card = alpacaCard();
    fireEvent.change(card.getByLabelText('API key ID'), { target: { value: ' PKTEST ' } });
    fireEvent.change(card.getByLabelText('Secret key'), { target: { value: 'secret123' } });
    fireEvent.click(card.getByRole('button', { name: 'Test my key' }));

    expect(sent).toHaveLength(1);
    const request = sent[0];
    if (request?.type !== 'verify-key') throw new Error('no key check sent');
    expect(request).toMatchObject({ provider: 'alpaca', key: 'PKTEST:secret123' });
    await reply({
      type: 'verify-result',
      requestId: request.requestId,
      outcome: { result: 'rejected', message: 'auth failed' },
    });

    expect(card.getByRole('status')).toHaveTextContent('Alpaca rejected this key: auth failed');
    expect(useKeyVault.getState().keys).toEqual({});
  });

  it('saves to this browser, hands the key to the hub, and removes it again', () => {
    render(<Settings />);
    const card = alpacaCard();
    fireEvent.change(card.getByLabelText('API key ID'), { target: { value: 'PKTEST' } });
    fireEvent.change(card.getByLabelText('Secret key'), { target: { value: 'secret123' } });
    fireEvent.click(card.getByRole('button', { name: 'Save' }));

    expect(sent.at(-1)).toEqual({ type: 'keys', keys: { alpaca: 'PKTEST:secret123' } });
    expect(localStorage.getItem(KEYS_STORAGE_KEY)).toContain('PKTEST:secret123');

    fireEvent.click(card.getByRole('button', { name: 'Remove' }));
    expect(sent.at(-1)).toEqual({ type: 'keys', keys: {} });
    expect(localStorage.getItem(KEYS_STORAGE_KEY)).not.toContain('PKTEST');
    expect(card.getByLabelText('API key ID')).toHaveValue('');
  });

  it('gives a newly started hub the saved keys', () => {
    useKeyVault.getState().setKey('finnhub', 'tok');
    disconnectFeed();
    sent = [];
    connectFeed(port);
    expect(sent).toEqual([{ type: 'keys', keys: { finnhub: 'tok' } }]);
  });
});
