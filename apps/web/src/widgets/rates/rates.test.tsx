import { render, screen } from '@testing-library/react';
import type { IDockviewPanelProps } from 'dockview-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GLOSSARY } from '../../design/learn';
import effr from '../../store/rates/fixtures/effr.json';
import sofr from '../../store/rates/fixtures/sofr.json';
import treasuryCsv from '../../store/rates/fixtures/treasury-2026.csv?raw';
import Rates from './index';

const props = { api: { id: 'rates-1' }, params: {} } as unknown as IDockviewPanelProps;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Rates desk', () => {
  it('shows the curve, overnight rates, the target range and the New York Fed notice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.startsWith('https://home.treasury.gov/')) {
          return Promise.resolve(new Response(treasuryCsv, { status: 200 }));
        }
        if (url.includes('/secured/sofr/')) return Promise.resolve(json(sofr));
        if (url.includes('/unsecured/effr/')) return Promise.resolve(json(effr));
        return Promise.resolve(new Response('{}', { status: 404 }));
      }),
    );
    render(<Rates {...props} />);

    expect(await screen.findByText(/Treasury curve · /)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /yield curve/ })).toBeInTheDocument();
    expect(screen.getByText('SOFR').closest('div')).toHaveTextContent('3.93%');
    expect(screen.getByText('EFFR').closest('div')).toHaveTextContent('target 3.75–4.00%');
    expect(screen.getByText(/\+25 bp to 3\.75–4\.00%/)).toBeInTheDocument();
    // The New York Fed's required notice for reference-rate data.
    expect(
      screen.getByText(
        /The New York Fed is not responsible for publication of the SOFR and EFFR by Parallax/,
      ),
    ).toBeInTheDocument();
    // Learn mode can explain every heading and figure label.
    const labels = [
      ...document.querySelectorAll(
        '.rates-panel .market-columns > *, .rates-panel .rates-figures dt',
      ),
    ].map((element) => element.textContent);
    for (const label of labels) expect(GLOSSARY[label], label).toBeDefined();
  });
});
