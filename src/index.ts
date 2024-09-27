import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { RateLimiter } from 'limiter';

interface Show {
  name: string;
  path: string;
}

interface Episode {
  name: string;
  links: { rel: string; href: string }[];
}

interface Track {
  artist: string;
  title: string;
}

class NTSScraperService {
  public baseUrl = 'https://www.nts.live/api/v2';
  private rateLimiter = new RateLimiter({ tokensPerInterval: 5, interval: 'second' });

  async fetchAllEpisodes(showPath: string, isGuestShow: boolean): Promise<Episode[]> {
    if (isGuestShow) {
      // For guest shows, we don't fetch episodes, we directly fetch the tracklist
      return [{ name: '', links: [{ rel: 'tracklist', href: `${this.baseUrl}${showPath}/tracklist` }] }];
    }

    let allEpisodes: Episode[] = [];
    let offset = 0;
    const limit = 12;

    while (true) {
      await this.rateLimiter.removeTokens(1);
      const url = `${this.baseUrl}${showPath}/episodes?offset=${offset}&limit=${limit}`;
      const response = await axios.get(url);
      const episodes: Episode[] = response.data.results;

      if (episodes.length === 0) break;

      allEpisodes = allEpisodes.concat(episodes);
      offset += limit;

      // Add a slight delay of 200ms
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return allEpisodes;
  }

  async fetchTracklist(tracklistUrl: string): Promise<Track[]> {
    await this.rateLimiter.removeTokens(1);
    const response = await axios.get(tracklistUrl);
    return response.data.results.map((track: any) => ({
      artist: track.artist,
      title: track.title,
    }));
  }
}

class ShowProcessor {
  private scraperService: NTSScraperService;

  constructor(scraperService: NTSScraperService) {
    this.scraperService = scraperService;
  }

  async processShow(show: Show, outputDir: string, showIndex: number, totalShows: number, runningTotalTracks: { count: number }, checkpoint: { [key: string]: boolean }): Promise<void> {
    try {
      console.log(`Processing show ${showIndex + 1}/${totalShows}: ${show.name}`);
      const isGuestShow = show.path.includes('/guests/');
      const episodes = await this.scraperService.fetchAllEpisodes(show.path, isGuestShow);
      const allTracks = new Set<string>();

      for (const [episodeIndex, episode] of episodes.entries()) {
        console.log(`  Fetching episode ${episodeIndex + 1}/${episodes.length}`);
        const tracklistUrl = episode.links.find(link => link.rel === 'tracklist')?.href;
        if (tracklistUrl) {
          const tracklist = await this.scraperService.fetchTracklist(tracklistUrl);
          tracklist.forEach(track => {
            allTracks.add(JSON.stringify(track));
          });
        }
      }

      const deduplicatedTracks = Array.from(allTracks).map(track => JSON.parse(track));
      await this.saveTracklist(show.name, deduplicatedTracks, outputDir);

      const trackCount = deduplicatedTracks.length;
      runningTotalTracks.count += trackCount;
      console.log(`Show ${showIndex + 1}/${totalShows} processed. Track count: ${trackCount}. Running total: ${runningTotalTracks.count}`);

      // Update checkpoint
      checkpoint[show.name] = true;
      await fs.writeFile('checkpoint.json', JSON.stringify(checkpoint, null, 2));
    } catch (error) {
      console.error(`Error processing show ${show.name}:`, error.message);
    }
  }

  private async saveTracklist(showName: string, tracks: Track[], outputDir: string): Promise<void> {
    const sanitizedShowName = showName.toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_');
    const fileName = `${sanitizedShowName}_tracklist.json`;
    const filePath = path.join(outputDir, fileName);

    let existingTracks: Track[] = [];
    try {
      const existingData = await fs.readFile(filePath, 'utf-8');
      existingTracks = JSON.parse(existingData);
    } catch (error) {
      // File does not exist, proceed with an empty array
    }

    const allTracks = new Set<string>(existingTracks.map(track => JSON.stringify(track)));
    tracks.forEach(track => allTracks.add(JSON.stringify(track)));

    const deduplicatedTracks = Array.from(allTracks).map(track => JSON.parse(track));
    await fs.writeFile(filePath, JSON.stringify(deduplicatedTracks, null, 2));
    console.log(`Saved tracklist for ${showName} to ${filePath}`);
  }
}

async function main() {
  const inputData = JSON.parse(await fs.readFile('mixtapes.json', 'utf-8'));
  const outputDir = 'nts_tracklists';

  const scraperService = new NTSScraperService();
  const showProcessor = new ShowProcessor(scraperService);

  const totalShows = inputData.results.reduce((acc, mixtape) => acc + mixtape.credits.length, 0);
  let showIndex = 0;
  const runningTotalTracks = { count: 0 };

  let checkpoint: { [key: string]: boolean } = {};
  try {
    const checkpointData = await fs.readFile('checkpoint.json', 'utf-8');
    checkpoint = JSON.parse(checkpointData);
  } catch (error) {
    // Checkpoint file does not exist, proceed with an empty object
  }

  for (const mixtape of inputData.results) {
    const mixtapeFolder = path.join(outputDir, mixtape.mixtape_alias);
    await fs.mkdir(mixtapeFolder, { recursive: true });

    for (const credit of mixtape.credits) {
      if (!checkpoint[credit.name]) {
        await showProcessor.processShow(credit, mixtapeFolder, showIndex, totalShows, runningTotalTracks, checkpoint);
      } else {
        console.log(`Skipping already processed show: ${credit.name}`);
      }
      showIndex++;
    }
  }

  console.log('All shows processed successfully');
}

main().catch(console.error);