import fs from 'fs/promises';
import path from 'path';

interface Track {
  artist: string;
  title: string;
}

async function countAndDeduplicateTracksInDirectory(directory: string): Promise<{ totalTracks: number, deduplicatedTracks: number, showCounts: { [key: string]: { total: number, deduplicated: number } } }> {
  let totalTracks = 0;
  const allTracks = new Set<string>();
  const showCounts: { [key: string]: { total: number, deduplicated: number } } = {};

  async function traverseDirectory(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await traverseDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const fileContent = await fs.readFile(fullPath, 'utf-8');
        const tracks: Track[] = JSON.parse(fileContent);
        totalTracks += tracks.length;

        const showName = path.basename(fullPath, '.json');
        if (!showCounts[showName]) {
          showCounts[showName] = { total: 0, deduplicated: 0 };
        }
        showCounts[showName].total += tracks.length;

        const showTrackSet = new Set<string>();
        tracks.forEach(track => {
          const trackString = JSON.stringify(track);
          allTracks.add(trackString);
          showTrackSet.add(trackString);
        });
        showCounts[showName].deduplicated = showTrackSet.size;
      }
    }
  }

  await traverseDirectory(directory);
  return { totalTracks, deduplicatedTracks: allTracks.size, showCounts };
}

async function main() {
  const directory = 'nts_tracklists';
  const { totalTracks, deduplicatedTracks, showCounts } = await countAndDeduplicateTracksInDirectory(directory);
  console.log(`Total number of tracks: ${totalTracks}`);
  console.log(`Total number of deduplicated tracks: ${deduplicatedTracks}`);
  console.log('Track counts per show:');
  for (const [show, counts] of Object.entries(showCounts)) {
    console.log(`  ${show}: Total = ${counts.total}, Deduplicated = ${counts.deduplicated}`);
  }
}

main().catch(console.error);