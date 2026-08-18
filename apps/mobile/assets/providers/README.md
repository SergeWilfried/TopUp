# Provider logos

Square marks (≥ 400 px), one per operator per market, registered in
`apps/mobile/providers.js`. Metro needs a static `require`, so adding a file
means adding an entry there too (key `Network@CC` for a market-specific mark,
bare `Network` for the general one). A network with no entry falls back to a
brand-coloured monogram, so a missing file never breaks a screen. Use `zoom`
in the registry to crop a file's own margin.

Present: orange-bf.png · moov-bf.png · telecel-bf.jpeg
