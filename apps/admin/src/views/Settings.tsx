import { useState, type ReactElement } from 'react';
import Rates from './settings/Rates';
import Features from './settings/Features';
import Team from './settings/Team';
import Security from './settings/Security';
import { PageHead, Seg } from '../components/Bits';

/**
 * Platform settings.
 *
 * One page for everything that is configured rather than transacted, and a
 * sub-nav rather than a long scroll: these sections have nothing to say to one
 * another, and stacking them made the rate book something you arrived at by
 * scrolling past a grid of feature toggles.
 *
 * Only one section is mounted at a time, so each fetches on the way in and
 * nothing loads four endpoints to show one table.
 *
 * Rates lead because a missing one stops a market taking money, and Security
 * closes because it is the page you reach for when something is already wrong.
 * The alarms themselves are not here — an unpriced market shows on the
 * dashboard. A settings page nobody opens is precisely how an empty rate table
 * went unnoticed, and hiding warnings behind a tab would rebuild that.
 */

const SECTIONS = ['exchange rates', 'features', 'team', 'security'] as const;
type Section = (typeof SECTIONS)[number];

const PANES: Record<Section, () => ReactElement> = {
  'exchange rates': Rates,
  features: Features,
  team: Team,
  security: Security,
};

export default function Settings() {
  const [section, setSection] = useState<Section>('exchange rates');
  const Pane = PANES[section];

  return (
    <>
      <PageHead
        kicker="Platform"
        title="Settings"
        right={<Seg options={SECTIONS} value={section} onChange={setSection} />}
      />
      <Pane />
    </>
  );
}
