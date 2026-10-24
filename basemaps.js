// Base maps sit under the fog. Add new looks here: give each a vector style URL
// (any MapLibre style) and, if you want to recolour it, a restyle(map) run after load.

const OPENFREEMAP = 'https://tiles.openfreemap.org/styles';

export const BASEMAPS = {
  positron: { label: 'Clean', style: `${OPENFREEMAP}/positron` },
  liberty: { label: 'Detailed', style: `${OPENFREEMAP}/liberty` },
};

export const DEFAULT_BASEMAP = 'positron';
