export function Icon({ name, size = 18 }: { name: 'play' | 'pause' | 'step' | 'reset' | 'bolt' | 'cross' | 'cpu' | 'shield' | 'arrow' | 'eye'; size?: number }) {
  const paths = {
    play: 'M8 5l12 7-12 7z', pause: 'M8 5v14M16 5v14', step: 'M5 5l10 7-10 7zM19 5v14',
    reset: 'M3 11a9 9 0 1 1 2 7M3 4v7h7', bolt: 'M13 2L4 14h7l-1 8 10-13h-7z',
    cross: 'M6 6l12 12M6 18L18 6', cpu: 'M5 5h14v14H5zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6',
    arrow: 'M5 12h14M13 6l6 6-6 6', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
