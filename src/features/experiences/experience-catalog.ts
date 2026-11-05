import type { Href } from 'expo-router';

export const showcase = {
  name: 'Medical Viewer',
  description: 'Explore anatomy, registered scan slices, and experimental scan volumes in AR.',
} as const;

export const experiences = [
  {
    route: 'medical-viewer',
    href: '/medical-viewer',
    title: 'Medical Viewer',
  },
] as const satisfies readonly { route: string; href: Href; title: string }[];
