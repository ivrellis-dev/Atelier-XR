import starryNightImg from '../assets/images/starry_night_painting_1795794336559.jpg';
import monaLisaImg from '../assets/images/mona_lisa_painting_1795794337485.jpg';
import pearlEarringImg from '../assets/images/pearl_earring_painting_1795794336704.jpg';
import greatWaveImg from '../assets/images/great_wave_painting_1795794336811.jpg';
import waterLiliesImg from '../assets/images/water_lilies_painting_1795794337091.jpg';

export type FrameFinish = 'gilded' | 'walnut' | 'ebony';

export interface PaintingSpec {
  id: string;
  title: string;
  artist: string;
  year: string;
  movement: string;
  medium: string;
  /** Physical canvas width in meters at 1.0x scale */
  widthMeters: number;
  /** Physical canvas height in meters at 1.0x scale */
  heightMeters: number;
  frameFinish: FrameFinish;
  hasMatBoard: boolean;
  imageUrl: string;
  description: string;
}

export const CLASSIC_PAINTINGS: PaintingSpec[] = [
  {
    id: 'starry-night',
    title: 'The Starry Night',
    artist: 'Vincent van Gogh',
    year: '1889',
    movement: 'Post-Impressionism',
    medium: 'Oil on canvas',
    widthMeters: 0.92,
    heightMeters: 0.73,
    frameFinish: 'gilded',
    hasMatBoard: false,
    imageUrl: starryNightImg,
    description:
      'Swirling cobalt night sky painted from Saint-Rémy-de-Provence with luminous stars and a cypress silhouette.',
  },
  {
    id: 'mona-lisa',
    title: 'Mona Lisa',
    artist: 'Leonardo da Vinci',
    year: '1503',
    movement: 'High Renaissance',
    medium: 'Oil on poplar panel',
    widthMeters: 0.56,
    heightMeters: 0.77,
    frameFinish: 'walnut',
    hasMatBoard: false,
    imageUrl: monaLisaImg,
    description:
      'Renowned portrait celebrated for delicate sfumato shading, composed stillness, and an enigmatic gaze.',
  },
  {
    id: 'pearl-earring',
    title: 'Girl with a Pearl Earring',
    artist: 'Johannes Vermeer',
    year: '1665',
    movement: 'Dutch Golden Age',
    medium: 'Oil on canvas',
    widthMeters: 0.48,
    heightMeters: 0.62,
    frameFinish: 'ebony',
    hasMatBoard: false,
    imageUrl: pearlEarringImg,
    description:
      'Intimate tronie portrait lit by soft northern window light against a deep umber backdrop.',
  },
  {
    id: 'great-wave',
    title: 'The Great Wave off Kanagawa',
    artist: 'Katsushika Hokusai',
    year: '1831',
    movement: 'Ukiyo-e',
    medium: 'Polychrome woodblock print',
    widthMeters: 0.84,
    heightMeters: 0.61,
    frameFinish: 'walnut',
    hasMatBoard: true,
    imageUrl: greatWaveImg,
    description:
      'Towering Prussian-blue cresting wave framing distant Mount Fuji in the Thirty-six Views series.',
  },
  {
    id: 'water-lilies',
    title: 'Water Lilies',
    artist: 'Claude Monet',
    year: '1919',
    movement: 'Impressionism',
    medium: 'Oil on canvas',
    widthMeters: 1.18,
    heightMeters: 0.66,
    frameFinish: 'gilded',
    hasMatBoard: false,
    imageUrl: waterLiliesImg,
    description:
      'Panoramic Giverny pond meditation capturing floating blossoms, willow shadows, and sky reflections.',
  },
];
