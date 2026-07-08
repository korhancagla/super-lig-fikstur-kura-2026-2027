import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Download,
  Filter,
  Home,
  Info,
  Plane,
  Play,
  RefreshCw,
  Shield,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { defaultTeams } from "./data/teams";
import {
  fixtureEngineConstants,
  generateDrawResult,
  type ConstraintResult,
  type DrawResult,
  type FixtureMatch,
  type FixtureSchedule,
  type Team,
  type TeamTag,
} from "./lib/fixtureEngine";

const tagColumns: Array<{ key: keyof TeamTag; label: string }> = [
  { key: "championsLeague", label: "CL" },
  { key: "europaLeague", label: "EL" },
  { key: "conferenceLeague", label: "ECL" },
  { key: "bigThree", label: "B3" },
  { key: "bigFour", label: "B4" },
];

const clubAccents: Record<string, string> = {
  galatasaray: "#ef233c",
  fenerbahce: "#ffd400",
  besiktas: "#f8fafc",
  trabzonspor: "#38a3d1",
};

const bigClubIds = ["galatasaray", "fenerbahce", "besiktas", "trabzonspor"];

const brandWideLogo = "/brand/korhan-cagla-wide-trimmed.png";

const highlightClubs = [
  { id: "galatasaray", shortName: "GS", name: "Galatasaray" },
  { id: "fenerbahce", shortName: "FB", name: "Fenerbahçe" },
  { id: "besiktas", shortName: "BJK", name: "Beşiktaş" },
  { id: "trabzonspor", shortName: "TS", name: "Trabzonspor" },
];

function App() {
  const [teams, setTeams] = useState<Team[]>(defaultTeams);
  const [seed, setSeed] = useState("super-lig-2026-2027");
  const [maxAttempts, setMaxAttempts] = useState(80);
  const [drawResult, setDrawResult] = useState<DrawResult>(() => generateDrawResult(defaultTeams, "super-lig-2026-2027"));
  const [schedule, setSchedule] = useState<FixtureSchedule | null>(null);
  const [teamFilter, setTeamFilter] = useState("all");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [highlightedClubIds, setHighlightedClubIds] = useState<string[]>(["fenerbahce"]);
  const workerRef = useRef<Worker | null>(null);
  const fixtureExportRef = useRef<HTMLElement | null>(null);

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const hardResults = schedule?.validationResults.filter((result) => result.severity === "hard") ?? [];
  const softResults = schedule?.validationResults.filter((result) => result.severity === "soft") ?? [];
  const failedResults = schedule?.validationResults.filter((result) => !result.passed) ?? [];
  const generatedBallNumber = drawResult.teamsWithNumbers[0]?.fixtureNumber ?? 7;

  const updateTeam = (teamId: string, updater: (team: Team) => Team) => {
    setTeams((currentTeams) => currentTeams.map((team) => (team.id === teamId ? updater(team) : team)));
  };

  const updateTag = (teamId: string, tag: keyof TeamTag, value: boolean) => {
    updateTeam(teamId, (team) => ({
      ...team,
      tags: {
        ...team.tags,
        [tag]: value,
      },
    }));
  };

  const createRandomSeed = () => `kura-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const generateFixture = () => {
    if (isGenerating) {
      return;
    }

    workerRef.current?.terminate();
    const drawSeed = schedule ? createRandomSeed() : seed.trim() || createRandomSeed();
    const optimisticDraw = generateDrawResult(teams, drawSeed);
    setSeed(drawSeed);
    setDrawResult(optimisticDraw);
    setSchedule(null);
    setGenerationError("");
    setIsGenerating(true);

    window.setTimeout(() => {
      const worker = new Worker(new URL("./workers/fixtureWorker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<{ schedule?: FixtureSchedule; error?: string }>) => {
        if (event.data.schedule) {
          setSchedule(event.data.schedule);
          setDrawResult(toDrawResult(teams, drawSeed, event.data.schedule.drawNumbers));
        } else {
          setGenerationError(event.data.error ?? "Fikstür üretilemedi.");
        }

        setIsGenerating(false);
        worker.terminate();
        workerRef.current = null;
      };

      worker.onerror = () => {
        setGenerationError("Fikstür motoru çalışırken hata oluştu.");
        setIsGenerating(false);
        worker.terminate();
        workerRef.current = null;
      };

      worker.postMessage({ teams, seed: drawSeed, maxAttempts });
    }, 700);
  };

  const selectHighlightedClub = (teamId: string) => {
    setHighlightedClubIds([teamId]);
  };

  const downloadFixturePdf = async () => {
    if (!schedule || !fixtureExportRef.current || isExportingPdf) {
      return;
    }

    setIsExportingPdf(true);

    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      await waitForImages(fixtureExportRef.current);
      const canvas = await html2canvas(fixtureExportRef.current, {
        backgroundColor: "#020811",
        scale: Math.min(2, window.devicePixelRatio || 1.5),
        useCORS: true,
        logging: false,
      });
      const imageData = canvas.toDataURL("image/png", 0.96);
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageHeight = (canvas.height * pageWidth) / canvas.width;
      let position = 0;
      let remainingHeight = imageHeight;

      pdf.addImage(imageData, "PNG", 0, position, pageWidth, imageHeight);
      remainingHeight -= pageHeight;

      while (remainingHeight > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imageData, "PNG", 0, position, pageWidth, imageHeight);
        remainingHeight -= pageHeight;
      }

      pdf.save(`super-lig-fikstur-${schedule.seed}.pdf`);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <>
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <Trophy size={34} />
          <div>
            <h1>SÜPER LİG</h1>
            <p>FİKSTÜR KURA SİMÜLASYONU</p>
          </div>
        </div>
        <div className="topbar-side">
          <div className="creator-brand">
            <img src={brandWideLogo} alt="Korhan Çağla Digital Design" />
          </div>
        </div>
      </header>

      <section className="summary-strip mb-3">
        <InfoCard icon={<Users />} title={`${teams.length} TAKIM`} subtitle="34 HAFTA" tone="blue" />
        <InfoCard icon={<Shield />} title="İLK YARI" subtitle="1 - 17. Haftalar" tone="purple" />
        <InfoCard icon={<RefreshCw />} title="İKİNCİ YARI" subtitle="18 - 34. Haftalar" tone="green" />
        <InfoCard icon={<CalendarDays />} title="HER TAKIM" subtitle="17 İç Saha / 17 Deplasman" tone="orange" />
        <InfoCard
          icon={<Info />}
          title="SONUÇ"
          subtitle={
            generationError
              ? "Motor hatası"
              : isGenerating
                ? "Kura çekiliyor"
                : schedule
                  ? failedResults.length
                    ? "Kontrol gerekli"
                    : "Kura tamamlandı"
                  : "Kura bekleniyor"
          }
          tone={generationError || failedResults.length ? "red" : "cyan"}
        />
      </section>

      <section className={`glass-card draw-stage mb-3 ${isGenerating ? "is-drawing" : ""} ${schedule ? "is-complete" : ""}`}>
        <div className="row g-4 align-items-center">
          <div className="col-12 col-lg-6">
            <div className="draw-visual" aria-label="Kura fanusu">
              <div className="confetti-layer" />
              <div className="bowl">
                <div className="main-ball">
                  <span className="ball-number">{generatedBallNumber}</span>
                  {schedule && !isGenerating && <span className="completion-badge">KURA TAMAMLANDI</span>}
                </div>
                {Array.from({ length: 14 }).map((_, index) => (
                  <span className={`mini-ball mini-ball-${index + 1}`} key={index} />
                ))}
              </div>
              <div className="stage-base" />
            </div>
          </div>

          <div className="col-12 col-lg-6">
            <div className="draw-copy">
              <h2>{isGenerating ? "KURA ÇEKİLİYOR..." : schedule ? "KURA TAMAMLANDI" : "KURA ÇEKİMİ"}</h2>
              <p>
                {generationError
                  ? generationError
                  : isGenerating
                    ? "Toplar karıştırılıyor, fikstür anahtarı hesaplanıyor."
                    : schedule
                      ? `${schedule.attempts} denemede ${schedule.generationMode}`
                      : "Tek tuşla kura numaralarını ve fikstürü üret."}
              </p>
              <div className="progress-line" aria-hidden="true" />

              <div className="row g-2 control-row">
                <div className="col-12 col-lg-8">
                  <label className="form-label">Seed</label>
                  <input className="form-control dark-control" value={seed} onChange={(event) => setSeed(event.target.value)} />
                </div>
                <div className="col-12 col-sm-4">
                  <label className="form-label">Deneme</label>
                  <input
                    className="form-control dark-control"
                    type="number"
                    min={1}
                    max={300}
                    value={maxAttempts}
                    onChange={(event) => setMaxAttempts(Number(event.target.value))}
                  />
                </div>
              </div>

              <div className="draw-actions">
                <button className="btn btn-danger btn-lg action-btn" type="button" onClick={generateFixture} disabled={isGenerating}>
                  {isGenerating ? <RefreshCw className="spin" size={21} /> : <Play size={21} />}
                  {isGenerating ? "KURA ÇEKİLİYOR..." : schedule ? "YENİ KURA ÇEKİMİ" : "KURA ÇEKİMİNİ BAŞLAT"}
                </button>
              </div>

              <HighlightSelector highlightedClubIds={highlightedClubIds} onSelect={selectHighlightedClub} />
            </div>
          </div>
        </div>
      </section>

      <section className="glass-card big-four-card mb-3">
        <SectionTitle>4 BÜYÜK TAKIMIN İLK YARI FİKSTÜRÜ</SectionTitle>
        <BigFourTable schedule={schedule} teamsById={teamsById} highlightedClubIds={highlightedClubIds} />
        <div className="legend-row">
          <span>
            <Home size={18} /> İç Saha
          </span>
          <span>
            <Plane size={18} /> Deplasman
          </span>
          <span>
            <AlertTriangle size={18} /> Avrupa kısıt haftası uyarısı
          </span>
        </div>
      </section>

      <section className="glass-card constraint-strip mb-3">
        <div className="row g-3 align-items-center">
          <ConstraintChip icon={<Users />} title="Büyük 3 İç Saha Limiti" text="Her hafta en fazla 2 takım" />
          <ConstraintChip icon={<Building2 />} title="İstanbul Takım Limiti" text="Her hafta en fazla 4 takım" />
          <ConstraintChip icon={<CalendarDays />} title="İlk 2 / Son 3 Hafta" text="Üst üste iç/dış saha yok" />
          <ConstraintChip icon={<Trophy />} title="Avrupa Kısıt Haftaları" text="1, 2, 8, 18, 22, 25, 28" />
          <div className="col-12 col-xl-auto ms-xl-auto">
            <div className="d-grid d-sm-flex gap-2">
              <button
                className="btn btn-outline-danger export-btn pdf-export-btn"
                type="button"
                disabled={!schedule || isExportingPdf}
                onClick={downloadFixturePdf}
              >
                {isExportingPdf ? <RefreshCw className="spin" size={18} /> : <Download size={18} />}
                FİKSTÜRÜ PDF OLARAK İNDİR
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="row g-3 mb-3">
        <div className="col-12 col-xl-7">
          <div className="glass-card h-100">
            <div className="module-heading">
              <h2>TAKIM & TORBA EDİTÖRÜ</h2>
              <button className="btn btn-sm btn-outline-light" type="button" onClick={() => setTeams(defaultTeams)}>
                Sıfırla
              </button>
            </div>
            <TeamEditor teams={teams} updateTeam={updateTeam} updateTag={updateTag} />
          </div>
        </div>

        <div className="col-12 col-xl-5">
          <div className="row g-3">
            <div className="col-12">
              <div className="glass-card">
                <div className="module-heading">
                  <h2>KURA NUMARALARI</h2>
                  <span className="seed-pill">{drawResult.seed}</span>
                </div>
                <DrawList drawResult={drawResult} />
              </div>
            </div>
            <div className="col-12">
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <ValidationPanel title="SERT KURALLAR" results={hardResults} />
                </div>
                <div className="col-12 col-md-6">
                  <ValidationPanel title="ESNEK KURALLAR" results={softResults} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-card fixture-card" ref={fixtureExportRef}>
        <div className="pdf-brand-heading">
          <img src={brandWideLogo} alt="Korhan Çağla Digital Design" />
          <div>
            <strong>Süper Lig Fikstür Kura Simülasyonu</strong>
            <span>by Korhan Çağla</span>
          </div>
        </div>
        <div className="module-heading fixture-heading">
          <h2>FİKSTÜR TABLOSU</h2>
          <label className="filter-control">
            <span>
              <Filter size={15} />
              Takım
            </span>
            <select className="form-select dark-control" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
              <option value="all">Tüm takımlar</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!schedule ? (
          <div className="empty-state">Fikstürü görüntülemek için kura çekimini başlat.</div>
        ) : (
          <div className="weeks-grid">
            {schedule.weeks.map((week) => {
              const matches = week.matches.filter(
                (match) =>
                  teamFilter === "all" || match.homeTeamId === teamFilter || match.awayTeamId === teamFilter,
              );

              return (
                <article className="week-block" key={week.weekNumber}>
                  <h3>{week.weekNumber}. HAFTA</h3>
                  <div className="match-list">
                    {matches.map((match) => (
                      <MatchRow
                        key={`${week.weekNumber}-${match.homeTeamId}-${match.awayTeamId}`}
                        match={match}
                        teamsById={teamsById}
                        highlightedClubIds={highlightedClubIds}
                      />
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
    <img className="fixed-brand-watermark" src={brandWideLogo} alt="" aria-hidden="true" />
    </>
  );
}

function InfoCard({ icon, title, subtitle, tone }: { icon: React.ReactNode; title: string; subtitle: string; tone: string }) {
  return (
    <div className={`info-card tone-${tone}`}>
      <div className="info-icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}

function HighlightSelector({
  highlightedClubIds,
  onSelect,
}: {
  highlightedClubIds: string[];
  onSelect: (teamId: string) => void;
}) {
  return (
    <div className="highlight-selector" aria-label="Büyük takım vurguları">
      <strong>Highlight</strong>
      <div className="highlight-options">
        {highlightClubs.map((club) => {
          const checked = highlightedClubIds.includes(club.id);
          return (
            <label className={`highlight-option ${getHighlightClass(club.id)} ${checked ? "selected" : ""}`} key={club.id}>
              <input type="radio" name="highlightClub" checked={checked} onChange={() => onSelect(club.id)} />
              <span className="fake-radio" />
              <span>{club.shortName}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="section-title">
      <span />
      <h2>{children}</h2>
      <span />
    </div>
  );
}

function ConstraintChip({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="col-12 col-sm-6 col-xl-auto">
      <div className="constraint-chip">
        {icon}
        <div>
          <strong>{title}</strong>
          <span>{text}</span>
        </div>
      </div>
    </div>
  );
}

function BigFourTable({
  schedule,
  teamsById,
  highlightedClubIds,
}: {
  schedule: FixtureSchedule | null;
  teamsById: Map<string, Team>;
  highlightedClubIds: string[];
}) {
  const weeks = Array.from({ length: 17 }, (_, index) => index + 1);
  const orderedBigClubIds = getOrderedBigClubIds(highlightedClubIds[0]);

  return (
    <div className="big-four-table-wrap" key={orderedBigClubIds.join("-")}>
      <table className="big-four-table">
        <thead>
          <tr>
            <th />
            {orderedBigClubIds.map((teamId) => {
              const team = teamsById.get(teamId);
              return (
                <th key={teamId}>
                  <div className="club-head" style={{ "--club-color": clubAccents[teamId] } as React.CSSProperties}>
                    <ClubMark team={team} />
                    <span>{team?.name ?? teamId}</span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {weeks.map((weekNumber) => (
            <tr key={weekNumber}>
              <th>{weekNumber}. HAFTA</th>
              {orderedBigClubIds.map((teamId) => (
                <td
                  className={getBigFourCellHighlightClass(schedule, teamId, weekNumber, highlightedClubIds)}
                  key={`${teamId}-${weekNumber}`}
                >
                  {renderTeamWeek(schedule, teamsById, teamId, weekNumber)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getOrderedBigClubIds(selectedTeamId?: string): string[] {
  if (!selectedTeamId || !bigClubIds.includes(selectedTeamId)) {
    return bigClubIds;
  }

  return [selectedTeamId, ...bigClubIds.filter((teamId) => teamId !== selectedTeamId)];
}

function renderTeamWeek(
  schedule: FixtureSchedule | null,
  teamsById: Map<string, Team>,
  teamId: string,
  weekNumber: number,
) {
  if (!schedule) {
    return <span className="muted-cell">...</span>;
  }

  const week = schedule.weeks.find((entry) => entry.weekNumber === weekNumber);
  const match = week?.matches.find((entry) => entry.homeTeamId === teamId || entry.awayTeamId === teamId);

  if (!match) {
    return <span className="muted-cell">...</span>;
  }

  const isHome = match.homeTeamId === teamId;
  const opponentId = isHome ? match.awayTeamId : match.homeTeamId;
  const opponent = teamsById.get(opponentId);

  return (
    <span className="fixture-cell">
      <span>{opponent?.name ?? opponentId}</span>
      <small>({isHome ? "İ" : "D"})</small>
      {isHome ? <Home size={16} /> : <Plane size={16} />}
    </span>
  );
}

function getBigFourCellHighlightClass(
  schedule: FixtureSchedule | null,
  columnTeamId: string,
  weekNumber: number,
  highlightedClubIds: string[],
): string {
  if (!schedule || !highlightedClubIds.includes(columnTeamId)) {
    return "";
  }

  const week = schedule.weeks.find((entry) => entry.weekNumber === weekNumber);
  const match = week?.matches.find((entry) => entry.homeTeamId === columnTeamId || entry.awayTeamId === columnTeamId);

  if (!match) {
    return "";
  }

  const opponentId = match.homeTeamId === columnTeamId ? match.awayTeamId : match.homeTeamId;
  const isBigFourDerby = bigClubIds.includes(match.homeTeamId) && bigClubIds.includes(match.awayTeamId);

  if (!isBigFourDerby) {
    return "";
  }

  return getHighlightClass(opponentId);
}

function ClubMark({ team }: { team?: Team }) {
  const initials =
    team?.name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "?";

  return <span className="club-mark">{initials}</span>;
}

function TeamEditor({
  teams,
  updateTeam,
  updateTag,
}: {
  teams: Team[];
  updateTeam: (teamId: string, updater: (team: Team) => Team) => void;
  updateTag: (teamId: string, tag: keyof TeamTag, value: boolean) => void;
}) {
  return (
    <div className="table-responsive module-table-wrap">
      <table className="table table-dark table-borderless editor-table align-middle mb-0">
        <thead>
          <tr>
            <th>Takım</th>
            <th>Şehir</th>
            <th>Torba</th>
            <th>İST</th>
            {tagColumns.map((tag) => (
              <th key={tag.key}>{tag.label}</th>
            ))}
            <th>Stat</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team) => (
            <tr key={team.id}>
              <td>
                <input
                  className="form-control form-control-sm dark-control"
                  value={team.name}
                  onChange={(event) => updateTeam(team.id, (entry) => ({ ...entry, name: event.target.value }))}
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm dark-control"
                  value={team.city}
                  onChange={(event) => updateTeam(team.id, (entry) => ({ ...entry, city: event.target.value }))}
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm dark-control number-input"
                  type="number"
                  min={1}
                  max={5}
                  value={team.pot}
                  onChange={(event) => updateTeam(team.id, (entry) => ({ ...entry, pot: Number(event.target.value) }))}
                />
              </td>
              <td>
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={team.isIstanbulTeam}
                  onChange={(event) => updateTeam(team.id, (entry) => ({ ...entry, isIstanbulTeam: event.target.checked }))}
                />
              </td>
              {tagColumns.map((tag) => (
                <td key={tag.key}>
                  <input
                    className="form-check-input"
                    type="checkbox"
                    checked={Boolean(team.tags[tag.key])}
                    onChange={(event) => updateTag(team.id, tag.key, event.target.checked)}
                  />
                </td>
              ))}
              <td>
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={Boolean(team.tags.sameStadiumGroup)}
                  onChange={(event) =>
                    updateTeam(team.id, (entry) => ({
                      ...entry,
                      tags: {
                        ...entry.tags,
                        sameStadiumGroup: event.target.checked ? "recep-tayyip-erdogan" : undefined,
                      },
                    }))
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DrawList({ drawResult }: { drawResult: DrawResult }) {
  return (
    <div className="draw-list">
      {drawResult.teamsWithNumbers.map(({ team, fixtureNumber }) => (
        <div className="draw-row" key={team.id}>
          <strong>{fixtureNumber}</strong>
          <span>{team.name}</span>
          <small>Torba {team.pot}</small>
        </div>
      ))}
    </div>
  );
}

function ValidationPanel({ title, results }: { title: string; results: ConstraintResult[] }) {
  return (
    <div className="glass-card validation-panel h-100">
      <div className="module-heading">
        <h2>{title}</h2>
      </div>
      {results.length === 0 ? (
        <div className="empty-state compact">Henüz fikstür yok.</div>
      ) : (
        <div className="validation-list">
          {results.map((result) => (
            <div className={`validation-row ${result.passed ? "passed" : "failed"}`} key={result.id}>
              <div className="validation-title">
                {result.passed ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                <strong>{result.name}</strong>
                <span>{result.passed ? "Geçti" : "Kaldı"}</span>
              </div>
              {!result.passed && (
                <div className="validation-detail">
                  <p>{result.explanation}</p>
                  {result.affectedWeeks.length > 0 && <small>Haftalar: {result.affectedWeeks.join(", ")}</small>}
                  {result.affectedTeams.length > 0 && <small>Takımlar: {result.affectedTeams.join(", ")}</small>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchRow({
  match,
  teamsById,
  highlightedClubIds,
}: {
  match: FixtureMatch;
  teamsById: Map<string, Team>;
  highlightedClubIds: string[];
}) {
  const homeTeam = teamsById.get(match.homeTeamId);
  const awayTeam = teamsById.get(match.awayTeamId);
  const isBigMatch = Boolean(homeTeam?.tags.bigFour && awayTeam?.tags.bigFour);
  const isIstanbulDerby = Boolean(homeTeam?.isIstanbulTeam && awayTeam?.isIstanbulTeam);
  const hasEuropeanWarning = Boolean(
    fixtureEngineConstants.europeanRestrictedFullWeeks.includes(match.week) &&
      homeTeam &&
      awayTeam &&
      isChampionsVsOtherEuropean(homeTeam, awayTeam),
  );
  const isBigFourDerby = bigClubIds.includes(match.homeTeamId) && bigClubIds.includes(match.awayTeamId);
  const highlightedTeamId = isBigFourDerby
    ? highlightedClubIds.includes(match.homeTeamId)
      ? match.homeTeamId
      : highlightedClubIds.includes(match.awayTeamId)
        ? match.awayTeamId
        : ""
    : "";

  return (
    <div
      className={[
        "match-row",
        highlightedTeamId ? getHighlightClass(highlightedTeamId) : "",
        isBigMatch ? "big-match" : "",
        isIstanbulDerby ? "istanbul-derby" : "",
        hasEuropeanWarning ? "euro-warning" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="team-cell">{homeTeam?.name ?? match.homeTeamId}</span>
      <span className="versus">vs</span>
      <span className="team-cell">{awayTeam?.name ?? match.awayTeamId}</span>
      {hasEuropeanWarning ? <AlertTriangle size={16} aria-label="Avrupa kısıt haftası uyarısı" /> : <CircleDot size={12} />}
    </div>
  );
}

function isChampionsVsOtherEuropean(teamA: Team, teamB: Team): boolean {
  const aOther = teamA.tags.europaLeague || teamA.tags.conferenceLeague;
  const bOther = teamB.tags.europaLeague || teamB.tags.conferenceLeague;
  return (teamA.tags.championsLeague && bOther) || (teamB.tags.championsLeague && aOther);
}

function getHighlightClass(teamId: string): string {
  if (teamId === "galatasaray") {
    return "highlight-galatasaray";
  }

  if (teamId === "fenerbahce") {
    return "highlight-fenerbahce";
  }

  if (teamId === "besiktas") {
    return "highlight-besiktas";
  }

  if (teamId === "trabzonspor") {
    return "highlight-trabzonspor";
  }

  return "";
}

async function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map((image) => {
      if (image.complete && image.naturalWidth > 0) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    }),
  );
}

function toDrawResult(teams: Team[], seed: string, drawNumbers: Record<string, number>): DrawResult {
  return {
    seed,
    teamsWithNumbers: [...teams]
      .sort((teamA, teamB) => drawNumbers[teamA.id] - drawNumbers[teamB.id])
      .map((team) => ({
        team,
        fixtureNumber: drawNumbers[team.id],
      })),
  };
}

export default App;
