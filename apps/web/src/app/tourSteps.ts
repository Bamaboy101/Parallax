/** E3: four stops, each pointing at the element marked `data-tour="<target>"`. */
export const TOUR_STEPS: readonly { target: string; title: string; text: string }[] = [
  {
    target: 'rundown',
    title: 'The Rundown',
    text: "What's happening in markets right now, in plain words. Each section's badge says how fresh its numbers are and where they came from.",
  },
  {
    target: 'search',
    title: 'Search anything',
    text: 'Type a name or a command here, or press /. Try “bitcoin chart” or “news oil”.',
  },
  {
    target: 'cockpit',
    title: 'The full cockpit',
    text: 'Live panels you can arrange and link. Simple keeps to the essentials with hints; Pro has every panel.',
  },
  {
    target: 'keys',
    title: 'Your keys',
    text: 'Crypto, currencies, odds and news need no key. A free key here adds live US stock prices; it stays in this browser and goes only to its provider.',
  },
];
