import { useState, type ReactElement } from 'react';
import Fleet from './dispatch/Fleet';
import Scripts from './dispatch/Scripts';
import { PageHead, Seg } from '../components/Bits';

/**
 * The phone farm.
 *
 * Two sections because they are read at different moments: the fleet is
 * watched, the menus are edited during an incident. Splitting them keeps the
 * screen you check every morning free of a JSON editor, and keeps the editor
 * one click away when an operator changes their menu and dispatch stops.
 */
const SECTIONS = ['sims', 'ussd menus'] as const;
type Section = (typeof SECTIONS)[number];

const PANES: Record<Section, () => ReactElement> = {
  sims: Fleet,
  'ussd menus': Scripts,
};

export default function Dispatch() {
  const [section, setSection] = useState<Section>('sims');
  const Pane = PANES[section];
  return (
    <>
      <PageHead
        kicker="Dispatch"
        title="Phone farm"
        right={<Seg options={SECTIONS} value={section} onChange={setSection} />}
      />
      <Pane />
    </>
  );
}
