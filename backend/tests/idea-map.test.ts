import { describe, expect, it } from 'vitest';
import { layout, tokens, vectorise } from '../src/modules/hq/idea-map.js';

// W-27 layout on synthetic idea texts: similar ideas land together, clusters are named, results are stable.
const tailoring = ['Tailoring shop stitching blouses and school uniforms', 'Stitching unit for blouses and kurtis', 'Tailoring and alteration of school uniforms',
  'Ladies tailoring blouses stitching', 'Uniform stitching for schools'];
const dairy = ['Dairy selling cow milk and paneer', 'Buffalo milk collection and paneer making', 'Milk dairy with ghee and paneer',
  'Cow milk delivery dairy', 'Paneer and curd from fresh milk'];
const ideas = [...tailoring, ...dairy].map((text, i) => ({ id: `idea-${i}`, text }));

describe('idea map layout', () => {
  it('drops stopwords and short words', () => {
    expect(tokens('The tailoring shop for our customers, and uniforms')).toEqual(['tailoring', 'uniforms']);
  });

  it('places similar ideas in the same cluster and names it by shared terms', () => {
    const { points, clusters } = layout(ideas);
    const clusterOf = (prefix: string[]) => new Set(points.filter((_, i) => prefix.includes(ideas[i]!.text)).map(point => point.cluster));
    expect(clusterOf(tailoring).size).toBe(1);
    expect(clusterOf(dairy).size).toBe(1);
    expect([...clusterOf(tailoring)][0]).not.toBe([...clusterOf(dairy)][0]);
    const labels = clusters.map(group => group.label).join(' | ');
    expect(labels).toMatch(/milk|paneer|dairy/);
    expect(labels).toMatch(/stitching|blouses|uniforms|tailoring/);
    expect(points.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true);
  });

  it('is deterministic and handles tiny or empty inputs', () => {
    expect(layout(ideas)).toEqual(layout(ideas));
    expect(layout([])).toEqual({ points: [], clusters: [] });
    const one = layout([{ id: 'only', text: 'Tailoring' }]);
    expect(one.points).toEqual([{ id: 'only', x: 0.5, y: 0.5, cluster: 0 }]);
    expect(vectorise([{ id: 'a', text: '' }]).vocabulary).toEqual([]);
  });
});
