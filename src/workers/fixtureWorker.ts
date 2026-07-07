import { generateBestSchedule, type Team } from "../lib/fixtureEngine";

type FixtureWorkerRequest = {
  teams: Team[];
  seed: string;
  maxAttempts: number;
};

self.onmessage = (event: MessageEvent<FixtureWorkerRequest>) => {
  try {
    const { teams, seed, maxAttempts } = event.data;
    const schedule = generateBestSchedule(teams, seed, maxAttempts);
    self.postMessage({ schedule });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Bilinmeyen fikstür motoru hatası.",
    });
  }
};
